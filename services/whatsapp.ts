import { Sale, Customer, WhatsAppSettings } from "../types";

const GREEN_API_BASE_URL = process.env.REACT_APP_GREEN_API_HOST || "https://api.green-api.com";
const PARTNER_TOKEN = process.env.REACT_APP_GREEN_API_PARTNER_TOKEN;

// Helper to format phone number to 79XXXXXXXXX format (assuming RU/KZ region primarily, adaptable)
const formatPhone = (phone: string): string | null => {
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length < 10) return null;
    // Simple logic: if starts with 8, replace with 7. If 7, keep. 
    // Green API requires country code.
    if (cleaned.startsWith('8')) return '7' + cleaned.slice(1);
    if (cleaned.startsWith('7')) return cleaned;
    // Fallback for other codes if user entered full code
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

export const createPartnerInstance = async (description: string = "InstallMate User"): Promise<{ idInstance: string, apiTokenInstance: string } | null> => {
    if (!PARTNER_TOKEN) {
        console.error("Partner token not found");
        return null;
    }

    try {
        const response = await fetch(`${GREEN_API_BASE_URL}/partner/createInstance`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${PARTNER_TOKEN}`
            },
            body: JSON.stringify({
                type: "whatsapp",
                mark: description
            })
        });

        if (!response.ok) {
            throw new Error(`API Error: ${response.statusText}`);
        }

        const data = await response.json();
        return {
            idInstance: data.idInstance,
            apiTokenInstance: data.apiTokenInstance
        };
    } catch (error) {
        console.error("Failed to create partner instance:", error);
        return null;
    }
};

export const getQrCode = async (idInstance: string, apiTokenInstance: string): Promise<string | null> => {
    try {
        const response = await fetch(`${GREEN_API_BASE_URL}/waInstance${idInstance}/getQRCode/${apiTokenInstance}`);
        const data = await response.json();
        // data.message contains the base64 image string in Green API response for getQRCode
        // However, standard getQRCode usually returns type: "qrCode" and message: "base64..."
        return data.message || null;
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

// Returns an array of updated sales with new lastNotificationDate
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

    // Check if time condition is met (simple check: is it past reminder time?)
    const now = new Date();
    const [remHour, remMinute] = settings.reminderTime.split(':').map(Number);
    const reminderTime = new Date();
    reminderTime.setHours(remHour, remMinute, 0, 0);

    // If currently earlier than scheduled time, don't send (unless manual trigger)
    if (now < reminderTime) {
        return { updatedSales: [], sentCount: 0, errors: 0 };
    }

    let sentCount = 0;
    let errors = 0;
    const salesToUpdate: Sale[] = [];

    // Clone sales to avoid direct mutation
    const processedSales = JSON.parse(JSON.stringify(sales)) as Sale[];

    for (const sale of processedSales) {
        if (sale.status !== 'ACTIVE') continue;

        const customer = customers.find(c => c.id === sale.customerId);
        if (!customer) continue;

        let saleModified = false;

        for (const payment of sale.paymentPlan) {
            if (payment.isPaid) continue;

            const paymentDate = new Date(payment.date);
            paymentDate.setHours(0,0,0,0);

            // Calculate day difference
            const diffTime = paymentDate.getTime() - today.getTime();
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
            // 0 = today, 1 = tomorrow, -1 = yesterday

            // Check if this specific day offset is in settings
            if (settings.reminderDays.includes(diffDays)) {
                // Check if already notified TODAY
                if (payment.lastNotificationDate === todayStr) continue;

                // Calculate Prior Debt (strictly before this payment's date)
                // This covers arrears from previous payments that were not fully paid.
                const priorDebt = sale.paymentPlan
                    .filter(p => !p.isPaid && new Date(p.date) < paymentDate)
                    .reduce((sum, p) => sum + p.amount, 0);

                const totalToPay = payment.amount + priorDebt;
                
                let debtMessagePart = "";
                if (priorDebt > 0) {
                    debtMessagePart = `\n⚠️ Также есть долг за прошлые периоды: ${priorDebt.toLocaleString()} ₽.\n*Всего к оплате: ${totalToPay.toLocaleString()} ₽*.`;
                }

                let message = '';
                if (diffDays === 0) {
                    message = `Здравствуйте, ${customer.name}! Напоминаем, что сегодня (${new Date(payment.date).toLocaleDateString()}) день оплаты по договору "${sale.productName}". Сумма текущего платежа: ${payment.amount.toLocaleString()} ₽.${debtMessagePart} ${companyName}`;
                } else if (diffDays > 0) {
                    message = `Здравствуйте, ${customer.name}! Напоминаем о предстоящем платеже по договору "${sale.productName}". Дата: ${new Date(payment.date).toLocaleDateString()}. Сумма: ${payment.amount.toLocaleString()} ₽.${debtMessagePart} ${companyName}`;
                } else {
                    message = `Здравствуйте, ${customer.name}! У вас просрочен платеж по договору "${sale.productName}". Дата была: ${new Date(payment.date).toLocaleDateString()}. Сумма: ${payment.amount.toLocaleString()} ₽.${debtMessagePart} Пожалуйста, внесите оплату. ${companyName}`;
                }

                const success = await sendWhatsAppMessage(settings.idInstance, settings.apiTokenInstance, customer.phone, message);
                
                if (success) {
                    payment.lastNotificationDate = todayStr;
                    saleModified = true;
                    sentCount++;
                } else {
                    errors++;
                }
            }
        }

        if (saleModified) {
            salesToUpdate.push(sale);
        }
    }

    return { updatedSales: salesToUpdate, sentCount, errors };
};