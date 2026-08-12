import { Sale, Customer, WhatsAppSettings } from "../types";
import { api } from "./api";

// ⚠️ Здесь было `process.env.REACT_APP_GREEN_API_HOST`. В браузере глобального `process` нет,
// а `define`-блок, который его подставлял, убрали из vite.config.ts вместе с ключом Gemini —
// из-за этого модуль падал с "process is not defined" прямо при импорте. А импортируется он
// статически из NewSale/NewIncome, то есть ложилось всё приложение на старте. В Vite переменные
// окружения для клиента читаются через import.meta.env и обязаны иметь префикс VITE_
// (префикс REACT_APP_ остался от Create React App и тут не работал в принципе).
const GREEN_API_BASE_URL = import.meta.env.VITE_GREEN_API_HOST || "https://api.green-api.com";

// Helper to format phone number to 79XXXXXXXXX format
const formatPhone = (phone: string): string | null => {
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length < 10) return null;
    if (cleaned.startsWith('8')) return '7' + cleaned.slice(1);
    if (cleaned.startsWith('7')) return cleaned;
    return cleaned;
};

export const checkGreenApiConnection = async (idInstance: string, apiTokenInstance: string): Promise<boolean> => {
    try {
        const response = await fetch(`${GREEN_API_BASE_URL}/waInstance${idInstance}/getStateInstance/${apiTokenInstance}`);
        const data = await response.json();
        return data.stateInstance === 'authorized';
    } catch (error) {
        console.error("WhatsApp Connection Error:", error);
        return false;
    }
};

export const createPartnerInstance = async (phoneNumber: string): Promise<{ idInstance: string, apiTokenInstance: string } | null> => {
    try {
        const credentials = await api.createWhatsAppInstance(phoneNumber);
        return credentials;
    } catch (error) {
        console.error("Failed to create partner instance:", error);
        return null;
    }
};

export const getQrCode = async (idInstance: string, apiTokenInstance: string): Promise<string | null> => {
    try {
        const response = await fetch(`${GREEN_API_BASE_URL}/waInstance${idInstance}/getQRCode/${apiTokenInstance}`);
        const data = await response.json();
        if (data && data.type === 'qrCode' && data.message) {
            return data.message;
        }
        return null;
    } catch (error) {
        console.error("Failed to get QR code:", error);
        return null;
    }
};

export const sendWhatsAppMessage = async (
    idInstance: string, 
    apiTokenInstance: string, 
    phone: string, 
    message: string
): Promise<boolean> => {
    try {
        const formattedPhone = formatPhone(phone);
        if (!formattedPhone) return false;

        const chatId = `${formattedPhone}@c.us`;

        const response = await fetch(`${GREEN_API_BASE_URL}/waInstance${idInstance}/sendMessage/${apiTokenInstance}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chatId, message })
        });

        const data = await response.json();
        return !!data.idMessage;
    } catch (error) {
        console.error("WhatsApp Send Error:", error);
        return false;
    }
};

export const sendWhatsAppFile = async (
    idInstance: string, 
    apiTokenInstance: string, 
    phone: string, 
    fileBlob: Blob,
    fileName: string
): Promise<boolean> => {
    try {
        const formattedPhone = formatPhone(phone);
        if (!formattedPhone) return false;

        const chatId = `${formattedPhone}@c.us`;
        
        const formData = new FormData();
        formData.append('chatId', chatId);
        formData.append('file', fileBlob, fileName);

        const response = await fetch(`${GREEN_API_BASE_URL}/waInstance${idInstance}/sendFileByUpload/${apiTokenInstance}`, {
            method: 'POST',
            body: formData
        });

        const data = await response.json();
        return !!data.idMessage;
    } catch (error) {
        console.error("WhatsApp Send File Error:", error);
        return false;
    }
};

// --- TEMPLATE PROCESSING ---

const DEFAULT_TEMPLATES = {
    today: `🔔 *Напоминание об оплате*\n\n*{имя}!*\n\n📅 Сегодня *{дата}* — день оплаты!\n\n🔸 *{товар}*\n   • К оплате: *{сумма} ₽*\n\n{долг_блок}\n\n\`И будьте верны своим обещаниям, ибо за обещания вас призовут к ответу. Quran(17:34)\``,
    overdue: `🔔 *Напоминание об оплате*\n\n*{имя}!*\n\n📅 Сегодня *{дата}* — день оплаты!\n\n🔸 *{товар}*\n   • Ежемесячный платёж: *{сумма} ₽*\n   • Задолженность: *{долг} ₽* ({месяцы} мес.)\n\n💰 *ИТОГО К ОПЛАТЕ: {итого} ₽*\n\n\`И будьте верны своим обещаниям, ибо за обещания вас призовут к ответу. Quran(17:34)\``
};

const formatTemplate = (template: string, data: Record<string, string>) => {
    let result = template;
    for (const key in data) {
        result = result.replace(new RegExp(`{${key}}`, 'g'), data[key]);
    }
    return result;
};

// Helper to calculate months of debt
const getDebtMonths = (paymentDate: Date): number => {
    const now = new Date();
    let months = (now.getFullYear() - paymentDate.getFullYear()) * 12 + (now.getMonth() - paymentDate.getMonth());
    if (now.getDate() < paymentDate.getDate()) months--;
    return Math.max(1, months);
};

export const processDailyReminders = async (
    settings: WhatsAppSettings,
    sales: Sale[],
    customers: Customer[],
    companyName: string
): Promise<{ updatedSales: Sale[], sentCount: number, errors: number }> => {

    if (!settings.enabled || !settings.idInstance || !settings.apiTokenInstance) {
        return { updatedSales: [], sentCount: 0, errors: 0 };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];

    const now = new Date();
    const [remHour, remMinute] = settings.reminderTime.split(':').map(Number);
    const reminderTime = new Date();
    reminderTime.setHours(remHour, remMinute, 0, 0);

    if (now < reminderTime) {
        return { updatedSales: [], sentCount: 0, errors: 0 };
    }

    let sentCount = 0;
    let errors = 0;
    const salesToUpdate: Sale[] = [];
    const processedSales = JSON.parse(JSON.stringify(sales)) as Sale[];
    const templates = { ...DEFAULT_TEMPLATES, ...(settings.templates || {}) };

    for (const sale of processedSales) {
        if (sale.status !== 'ACTIVE') continue;

        const customer = customers.find(c => c.id === sale.customerId);
        if (!customer || !customer.phone) continue;
        if (customer.allowWhatsappNotification === false) continue;

        let saleModified = false;

        for (const payment of sale.paymentPlan) {
            if (payment.isPaid || payment.lastNotificationDate === todayStr) continue;

            const paymentDate = new Date(payment.date);
            paymentDate.setHours(0, 0, 0, 0);
            const diffDays = Math.ceil((paymentDate - today) / (1000 * 60 * 60 * 24));

            // 🔑 ТОЧНАЯ ЛОГИКА:
            let shouldSend = false;
            if (diffDays === 0 && settings.reminderDays.includes(0)) shouldSend = true;      // сегодня
            else if (diffDays === -1 && settings.reminderDays.includes(-1)) shouldSend = true; // за 1 день
            else if (diffDays < 0 && settings.reminderDays.includes(1)) shouldSend = true;     // просрочка

            if (!shouldSend) continue;

            const priorDebt = sale.paymentPlan
                .filter(p => !p.isPaid && new Date(p.date) < paymentDate)
                .reduce((sum, p) => sum + p.amount, 0);

            const totalToPay = payment.amount + priorDebt;
            const isOverdue = diffDays < 0;

            // Подготовка данных для шаблона
            const dateStr = paymentDate.toLocaleDateString('ru-RU', {
                day: 'numeric',
                month: 'long',
                year: 'numeric'
            });

            let debtBlock = '';
            let debtMonths = '0';
            if (priorDebt > 0) {
                debtMonths = getDebtMonths(paymentDate).toString();
                debtBlock = `   • Задолженность: *${priorDebt.toLocaleString()} ₽* (${debtMonths} мес.)\n💰 *ИТОГО К ОПЛАТЕ: ${totalToPay.toLocaleString()} ₽*`;
            }

            const templateData = {
                'имя': customer.name,
                'товар': sale.productName,
                'сумма': payment.amount.toLocaleString(),
                'дата': dateStr,
                'долг': priorDebt.toLocaleString(),
                'итого': totalToPay.toLocaleString(),
                'месяцы': debtMonths,
                'долг_блок': debtBlock
            };

            // Выбор шаблона
            let rawMessage = templates.today;
            if (isOverdue) {
                rawMessage = templates.overdue || templates.today;
            }

            let message = formatTemplate(rawMessage, templateData);

            const success = await sendWhatsAppMessage(settings.idInstance, settings.apiTokenInstance, customer.phone, message);
            
            if (success) {
                payment.lastNotificationDate = todayStr;
                saleModified = true;
                sentCount++;
            } else {
                errors++;
            }
        }

        if (saleModified) {
            salesToUpdate.push(sale);
        }
    }

    return { updatedSales: salesToUpdate, sentCount, errors };
};