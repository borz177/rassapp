import React, { useState, useRef } from 'react';
import { api } from '@/services/api';
import { Customer, Product, Sale, Account, Investor, Payment } from '../types';

declare const XLSX: any;

interface DataImportProps {
    onClose: () => void;
    onImportSuccess: () => void;
}

const DataImport: React.FC<DataImportProps> = ({ onClose, onImportSuccess }) => {
    const [file, setFile] = useState<File | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [logs, setLogs] = useState<string[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setFile(e.target.files[0]);
            setLogs([]);
        }
    };

    const addLog = (msg: string) => setLogs(prev => [...prev, msg]);

    const getXLSX = async () => {
        try {
            const module = await import('xlsx');
            return module.default || module;
        } catch (error) {
            if (typeof window !== 'undefined' && (window as any).XLSX) {
                return (window as any).XLSX;
            }
            throw new Error("XLSX library not found");
        }
    };

    // === НАДЕЖНЫЙ ПАРСИНГ ДАТ ===
    const parseExcelDate = (val: any): string => {
        if (!val) return new Date().toISOString();

        // 1. Если это число (серийный номер даты Excel)
        if (typeof val === 'number') {
            // Excel epoch is 1899-12-30, but has a bug for 1900, so we use 25569 days offset usually,
            // but standard formula: (val - 25567) * 86400 * 1000 works for most modern Excel files.
            // Using robust conversion:
            const utcDays = val - 25567; // 25567 for 1970-01-01
            const ms = utcDays * 86400 * 1000;
            const dateObj = new Date(ms);

            // Корректировка часового пояса (чтобы дата не уехала на вчера/завтра)
            // Мы хотим получить дату именно так, как она написана в ячейке (локальную)
            const userTimezoneOffset = dateObj.getTimezoneOffset() * 60000;
            const correctedDate = new Date(dateObj.getTime() + userTimezoneOffset);

            if (!isNaN(correctedDate.getTime())) {
                // Check if date is way too far in the future (e.g. > 2050) which might indicate bad parsing
                if (correctedDate.getFullYear() > 2050) {
                     console.warn(`Date too far in future: ${correctedDate.toISOString()}, original: ${val}`);
                }
                return correctedDate.toISOString();
            }
        }

        // 2. Если это строка
        if (typeof val === 'string') {
            const trimmed = val.trim();
            if (!trimmed) return new Date().toISOString();

            // Пробуем формат ДД.ММ.ГГГГ
            const dmyRegex = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;
            const match = trimmed.match(dmyRegex);

            if (match) {
                const day = parseInt(match[1], 10);
                const month = parseInt(match[2], 10) - 1;
                const year = parseInt(match[3], 10);
                const dateObj = new Date(year, month, day);
                if (!isNaN(dateObj.getTime())) {
                    return dateObj.toISOString();
                }
            }

            // Пробуем формат ГГГГ-ММ-ДД (ISO)
            const isoRegex = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
            const isoMatch = trimmed.match(isoRegex);
            if (isoMatch) {
                 const dateObj = new Date(trimmed);
                 if (!isNaN(dateObj.getTime())) return dateObj.toISOString();
            }

            // Try MM/DD/YYYY (common in some exports)
            const mdyRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
            const mdyMatch = trimmed.match(mdyRegex);
            if (mdyMatch) {
                const month = parseInt(mdyMatch[1], 10) - 1;
                const day = parseInt(mdyMatch[2], 10);
                const year = parseInt(mdyMatch[3], 10);
                const dateObj = new Date(year, month, day);
                if (!isNaN(dateObj.getTime())) return dateObj.toISOString();
            }

            // Попытка стандартного парсера JS
            const parsed = new Date(trimmed);
            if (!isNaN(parsed.getTime())) {
                return parsed.toISOString();
            }
        }

        // Если ничего не подошло
        console.warn(`Не удалось распарсить дату: ${val}`);
        return new Date().toISOString();
    };

    const parseMoney = (val: any): number => {
        if (typeof val === 'number') return val;
        if (!val) return 0;
        const str = String(val).replace(/[^\d.,-]/g, '').replace(',', '.');
        const num = parseFloat(str);
        return isNaN(num) ? 0 : num;
    };

    const parsePhone = (val: any): string => {
        if (!val) return '';
        const str = String(val).trim();
        // Remove all non-digit characters except +
        let cleaned = str.replace(/[^\d+]/g, '');

        // If it starts with 8, replace with +7
        if (cleaned.startsWith('8') && cleaned.length === 11) {
            cleaned = '+7' + cleaned.substring(1);
        }
        // If it starts with 9, add +7
        if (cleaned.startsWith('9') && cleaned.length === 10) {
            cleaned = '+7' + cleaned;
        }
        // If no +, add +
        if (!cleaned.startsWith('+')) {
             cleaned = '+' + cleaned;
        }

        return cleaned;
    };

    const processImport = async () => {
        if (!file) return;
        setIsProcessing(true);
        addLog("Начало обработки файла...");

        let XLSX_LIB: any;
        try {
            XLSX_LIB = await getXLSX();
        } catch (err) {
            addLog("Ошибка: Не удалось загрузить библиотеку Excel.");
            setIsProcessing(false);
            return;
        }

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = e.target?.result;
                // Читаем файл, преобразуя даты в строки там, где это возможно, но оставляем числа для надежного парсинга
                const workbook = XLSX_LIB.read(data, { type: 'binary', cellDates: false });

                const sheetOverview = workbook.Sheets["Обзор клиентов"];
                const sheetPayments = workbook.Sheets["История платежей"];

                if (!sheetOverview) {
                    addLog("Ошибка: Не найден лист 'Обзор клиентов'.");
                    setIsProcessing(false);
                    return;
                }

                const overviewData: any[] = XLSX_LIB.utils.sheet_to_json(sheetOverview, { defval: "" });
                const paymentsData: any[] = sheetPayments ? XLSX_LIB.utils.sheet_to_json(sheetPayments, { defval: "" }) : [];

                addLog(`Найдено товаров: ${overviewData.length}`);
                addLog(`Найдено записей о платежах: ${paymentsData.length}`);

                const { customers, products, accounts, investors } = await api.fetchAllData();

                let newCustomersCount = 0;
                let newSalesCount = 0;
                let newInvestorsCount = 0;
                let realPaymentsCount = 0;

                const createdSalesMap = new Map<string, any>();

                // === ЭТАП 1: Создание договоров ===
                addLog("Этап 1: Создание клиентов и договоров...");

                for (const row of overviewData) {
                    const clientName = String(row['Клиент'] || '').trim();
                    const productName = String(row['Товар'] || '').trim();
                    const investorNameRaw = row['Инвестор'];
                    const investorName = investorNameRaw ? String(investorNameRaw).trim() : '';

                    if (!clientName || !productName) continue;

                    // 1. Клиент
                    const phoneRaw = row['Телефон'] || row['Mobile'] || row['Phone'] || '';
                    const phone = parsePhone(phoneRaw);
                    let customer = customers.find(c => c.name === clientName);

                    if (!customer) {
                        const newCustomer: Customer = {
                            id: `cust_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                            userId: 'import',
                            name: clientName,
                            phone: phone || '',
                            email: '',
                            address: '',
                            trustScore: 100,
                            notes: 'Импорт из Excel'
                        };
                        await api.saveItem('customers', newCustomer);
                        customers.push(newCustomer);
                        customer = newCustomer;
                        newCustomersCount++;
                    }

                    // 2. Инвестор и Счет
                    let accountId = '';
                    const mainAccount = accounts.find(a => a.type === 'MAIN');
                    if (mainAccount) {
                        accountId = mainAccount.id;
                    }

                    if (investorName && investorName !== '') {
                        let investor = investors.find(i => i.name.toLowerCase() === investorName.toLowerCase());

                        if (!investor) {
                            addLog(`Создание нового инвестора: ${investorName}...`);
                            const newInvestor: Investor = {
                                id: `inv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                                name: investorName,
                                phone: '',
                                notes: 'Создан автоматически при импорте',
                                color: '#' + Math.floor(Math.random()*16777215).toString(16),
                                email: '',
                                initialAmount: 0,
                                profitPercentage: 0,
                                permissions: { canViewContracts: false, canViewHistory: false }
                            };
                            await api.saveItem('investors', newInvestor);
                            investors.push(newInvestor);
                            investor = newInvestor;
                            newInvestorsCount++;

                            const newAccount: Account = {
                                id: `acc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                                userId: 'import',
                                name: `Счет: ${investorName}`,
                                type: 'INVESTOR',
                                balance: 0,
                                ownerId: investor.id,
                                currency: 'RUB',
                                isArchived: false
                            };
                            await api.saveItem('accounts', newAccount);
                            accounts.push(newAccount);
                            accountId = newAccount.id;
                        } else {
                            const invAccount = accounts.find(a => a.ownerId === investor.id && a.type === 'INVESTOR');
                            if (invAccount) accountId = invAccount.id;
                        }
                    }

                    // 3. Данные о продаже
                    const buyPrice = parseMoney(row['Цена закупа']);
                    const totalPrice = parseMoney(row['Цена рассрочки']);
                    const downPayment = parseMoney(row['Взнос']);
                    const installmentsCount = Number(row['Срок (мес)']) || 1;

                    // === КЛЮЧЕВОЙ МОМЕНТ: Парсинг даты оформления ===
                    const saleDateRaw = row['Дата оформления'];
                    const saleDateIso = parseExcelDate(saleDateRaw);

                    // Расчет даты первого платежа
                    let firstPaymentDateStr = row['Дата первого платежа'] || row['First Payment Date'];

                    if (!firstPaymentDateStr) {
                        // Если нет явной даты первого платежа, считаем: Дата оформления + 1 месяц
                        const d = new Date(saleDateIso);
                        d.setMonth(d.getMonth() + 1);
                        firstPaymentDateStr = d.toISOString();
                    } else {
                        firstPaymentDateStr = parseExcelDate(firstPaymentDateStr);
                    }

                    const statusStr = String(row['Статус'] || '');
                    const saleKey = `${clientName}__${productName}`;

                    // Генерация ПЛАНОВОГО графика
                    const remainingAfterDown = Math.max(0, totalPrice - downPayment);
                    const monthlyAvg = installmentsCount > 0 ? remainingAfterDown / installmentsCount : 0;

                    const tempPaymentPlan: Payment[] = [];
                    for (let i = 0; i < installmentsCount; i++) {
                        const pDate = new Date(firstPaymentDateStr);
                        pDate.setMonth(pDate.getMonth() + i);

                        tempPaymentPlan.push({
                            id: `plan_pay_${i}`,
                            saleId: '',
                            amount: Number(monthlyAvg.toFixed(2)),
                            date: pDate.toISOString(),
                            isPaid: false,
                            actualDate: null,
                            note: "План"
                        });
                    }

                    const newSale: Sale = {
                        id: `sale_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        userId: 'import',
                        customerId: customer.id,
                        productId: '',
                        productName: productName,
                        accountId: accountId,
                        buyPrice: buyPrice,
                        totalAmount: totalPrice,
                        downPayment: downPayment,
                        remainingAmount: remainingAfterDown,
                        installments: installmentsCount,
                        interestRate: 0,
                        startDate: saleDateIso, // Сохраняем точную дату оформления из файла
                        status: statusStr.includes('Завершен') ? 'COMPLETED' : (statusStr.includes('Оформлен') ? 'DRAFT' : 'ACTIVE'),
                        type: 'INSTALLMENT',
                        paymentPlan: tempPaymentPlan,
                        paymentDay: new Date(firstPaymentDateStr).getDate(),
                        notes: 'Импорт из Excel'
                    };

                    await api.saveItem('sales', newSale);
                    createdSalesMap.set(saleKey, newSale);
                    newSalesCount++;
                }

                addLog(`Создано: Клиентов=${newCustomersCount}, Инвесторов=${newInvestorsCount}, Договоров=${newSalesCount}`);
                addLog("Этап 2: Импорт реальных платежей...");

                // === ЭТАП 2: Импорт реальных платежей ===
                let skippedDeleted = 0;
                let skippedNotFound = 0;

                for (const row of paymentsData) {
                    const clientName = String(row['Клиент'] || '').trim();
                    const productName = String(row['Товар'] || '').trim();
                    const paymentStatus = String(row['Статус платежа'] || '');
                    const amount = parseMoney(row['Сумма']);
                    const dateVal = row['Дата платежа'];
                    const paymentNum = row['Платёж №'];

                    if (!clientName || !productName || paymentStatus === 'Нет платежей' || !amount) continue;

                    const saleKey = `${clientName}__${productName}`;
                    const sale = createdSalesMap.get(saleKey);

                    if (!sale) {
                        skippedNotFound++;
                        continue;
                    }

                    if (paymentStatus === 'Удалён') {
                        skippedDeleted++;
                        continue;
                    }

                    // === КЛЮЧЕВОЙ МОМЕНТ: Парсинг даты платежа ===
                    const paymentDateIso = parseExcelDate(dateVal);

                    // Проверка на дубликаты
                    const exists = sale.paymentPlan.some((p: any) =>
                        p.isPaid &&
                        p.note?.includes(`Импорт №${paymentNum}`) &&
                        Math.abs(p.amount - amount) < 1.0 &&
                        Math.abs(new Date(p.date).getTime() - new Date(paymentDateIso).getTime()) < 86400000
                    );

                    if (exists) continue;

                    // Добавляем РЕАЛЬНЫЙ платеж в историю с ТОЧНОЙ суммой и датой из файла
                    sale.paymentPlan.push({
                        id: `pay_real_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                        saleId: sale.id,
                        amount: amount,
                        date: paymentDateIso,
                        isPaid: true,
                        actualDate: paymentDateIso,
                        note: `Импорт №${paymentNum}`,
                        isRealPayment: true
                    });

                    realPaymentsCount++;
                }

                addLog(`Добавлено реальных платежей: ${realPaymentsCount}`);

                // === ЭТАП 3: Распределение денег (Waterfall) и Пересчет ===
                addLog("Этап 3: Распределение платежей и пересчет остатков...");

                for (const [key, sale] of createdSalesMap.entries()) {
                    const realPayments = sale.paymentPlan.filter((p: any) => p.isRealPayment);

                    const planPayments = sale.paymentPlan
                        .filter((p: any) => !p.isRealPayment)
                        .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());

                    const totalRealMoney = realPayments.reduce((sum, p) => sum + (p.amount || 0), 0);

                    // ВОДОПАД: Гасим самые старые долги первыми
                    let moneyLeft = totalRealMoney;

                    for (const planItem of planPayments) {
                        if (moneyLeft <= 0) break;

                        const debt = planItem.amount;

                        if (moneyLeft >= debt) {
                            planItem.isPaid = true;
                            // Можно записать дату фактического погашения этого месяца (дата последнего платежа, который его закрыл)
                            // Но лучше оставить плановую дату в графике, а факт видеть в истории
                            moneyLeft -= debt;
                        } else {
                            // Частичное погашение
                            planItem.note = `Частично внесено: ${moneyLeft} ₽`;
                            moneyLeft = 0;
                        }
                    }

                    // Финальный пересчет
                    const debtBeforePayments = sale.totalAmount - sale.downPayment;
                    const currentRemaining = Math.max(0, debtBeforePayments - totalRealMoney);

                    sale.remainingAmount = currentRemaining;

                    if (currentRemaining < 1 && sale.status !== 'COMPLETED') {
                        sale.status = 'COMPLETED';
                    } else if (currentRemaining > 0 && sale.status === 'COMPLETED') {
                        sale.status = 'ACTIVE';
                    }

                    sale.paymentPlan.sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());

                    await api.saveItem('sales', sale);
                }

                addLog("✅ Импорт завершен успешно!");
                addLog(`Пропущено (удаленные): ${skippedDeleted}`);
                addLog(`Пропущено (не найдены договоры): ${skippedNotFound}`);
                addLog(`Всего договоров обновлено: ${createdSalesMap.size}`);

                setTimeout(() => {
                    setIsProcessing(false);
                    onImportSuccess();
                }, 2000);

            } catch (error) {
                console.error(error);
                addLog("❌ Критическая ошибка при чтении файла.");
                addLog(String(error));
                setIsProcessing(false);
            }
        };
        reader.readAsBinaryString(file);
    };

    const downloadTemplate = async () => {
        alert("Для импорта используйте файл выгрузки системы.");
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in" onClick={onClose}>
            <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl p-6 space-y-5" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center border-b border-slate-100 pb-4">
                    <h3 className="text-xl font-bold text-slate-800">Импорт данных (Excel)</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
                </div>

                <div className="space-y-4">
                    <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100 text-sm text-indigo-800">
                        <p className="font-bold mb-1">Инструкция:</p>
                        <ul className="list-disc list-inside space-y-1">
                            <li>Загрузите файл выгрузки с двумя листами.</li>
                            <li>Даты будут взяты точно из файла (поддержка формата ДД.ММ.ГГГГ).</li>
                            <li>Платежи распределяются на самые старые долги.</li>
                        </ul>
                    </div>

                    <div className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center hover:bg-slate-50 transition-colors cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                        <input
                            type="file"
                            ref={fileInputRef}
                            onChange={handleFileChange}
                            accept=".xlsx, .xls"
                            className="hidden"
                        />
                        <div className="text-4xl mb-2">📄</div>
                        {file ? (
                            <p className="font-bold text-slate-800">{file.name}</p>
                        ) : (
                            <p className="text-slate-500">Нажмите для выбора файла</p>
                        )}
                    </div>

                    {logs.length > 0 && (
                        <div className="bg-slate-900 text-green-400 p-3 rounded-xl text-xs font-mono h-48 overflow-y-auto">
                            {logs.map((log, i) => <div key={i}>{log}</div>)}
                        </div>
                    )}

                    <button
                        onClick={processImport}
                        disabled={!file || isProcessing}
                        className="w-full py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-indigo-200"
                    >
                        {isProcessing ? 'Обработка...' : 'Начать импорт'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default DataImport;