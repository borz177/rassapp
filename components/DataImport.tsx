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

        if (typeof val === 'number') {
            const utcDays = val - 25567;
            const ms = utcDays * 86400 * 1000;
            const dateObj = new Date(ms);
            const userTimezoneOffset = dateObj.getTimezoneOffset() * 60000;
            const correctedDate = new Date(dateObj.getTime() + userTimezoneOffset);
            if (!isNaN(correctedDate.getTime())) {
                return correctedDate.toISOString();
            }
        }

        if (typeof val === 'string') {
            const trimmed = val.trim();
            if (!trimmed) return new Date().toISOString();

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

            const parsed = new Date(trimmed);
            if (!isNaN(parsed.getTime())) {
                return parsed.toISOString();
            }
        }

        return new Date().toISOString();
    };

    const parseMoney = (val: any): number => {
        if (typeof val === 'number') return val;
        if (!val) return 0;
        const str = String(val).replace(/[^\d.,-]/g, '').replace(',', '.');
        const num = parseFloat(str);
        return isNaN(num) ? 0 : num;
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
                let updatedPhonesCount = 0;
                let newSalesCount = 0;
                let newInvestorsCount = 0;
                let realPaymentsCount = 0;
                let skippedDuplicates = 0;

                const createdSalesMap = new Map<string, any>();

                // === ЭТАП 1: Создание договоров и обновление клиентов ===
                addLog("Этап 1: Обработка клиентов и договоров...");

                for (const row of overviewData) {
                    const clientName = String(row['Клиент'] || '').trim();
                    const productName = String(row['Товар'] || '').trim();
                    const investorNameRaw = row['Инвестор'];
                    const investorName = investorNameRaw ? String(investorNameRaw).trim() : '';

                    if (!clientName || !productName) continue;

                    // 1. Клиент + Телефон
                    const phoneRaw = row['Телефон'] || row['Mobile'] || '';
                    const phone = phoneRaw ? String(phoneRaw).trim() : '';

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
                    } else {
                        // Если клиент есть, но в файле указан телефон и он отличается -> Обновляем
                        if (phone && customer.phone !== phone) {
                            customer.phone = phone;
                            await api.saveItem('customers', customer);
                            updatedPhonesCount++;
                        }
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

                    const saleDateRaw = row['Дата оформления'];
                    const saleDateIso = parseExcelDate(saleDateRaw);

                    let firstPaymentDateStr = row['Дата первого платежа'] || row['First Payment Date'];

                    if (!firstPaymentDateStr) {
                        const d = new Date(saleDateIso);
                        d.setMonth(d.getMonth() + 1);
                        firstPaymentDateStr = d.toISOString();
                    } else {
                        firstPaymentDateStr = parseExcelDate(firstPaymentDateStr);
                    }

                    const statusStr = String(row['Статус'] || '');
                    const saleKey = `${clientName}__${productName}`;

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
                        startDate: saleDateIso,
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

                addLog(`Создано: Клиентов=${newCustomersCount}, Обновлено телефонов=${updatedPhonesCount}, Инвесторов=${newInvestorsCount}, Договоров=${newSalesCount}`);
                addLog("Этап 2: Импорт реальных платежей...");

                // === ЭТАП 2: Импорт реальных платежей (с защитой от дублей) ===
                let skippedDeleted = 0;
                let skippedNotFound = 0;

                for (const row of paymentsData) {
                    const clientName = String(row['Клиент'] || '').trim();
                    const productName = String(row['Товар'] || '').trim();
                    const paymentStatus = String(row['Статус платежа'] || '');
                    const amount = parseMoney(row['Сумма']);
                    const dateVal = row['Дата платежа'];
                    const paymentNumRaw = row['Платёж №'];
                    const paymentNum = paymentNumRaw ? String(paymentNumRaw).trim() : '';

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

                    const paymentDateIso = parseExcelDate(dateVal);

                    // === ЖЕСТКАЯ ПРОВЕРКА НА ДУБЛИКАТЫ ===
                    const exists = sale.paymentPlan.some((p: any) => {
                        if (!p.isPaid) return false;

                        // 1. Проверка по номеру платежа (если есть)
                        if (paymentNum && p.note?.includes(`Импорт №${paymentNum}`)) {
                            return true;
                        }

                        // 2. Проверка по точной дате и сумме (допуск 1 день и 1 рубль)
                        const pDate = new Date(p.date).getTime();
                        const inputDate = new Date(paymentDateIso).getTime();
                        const dateDiff = Math.abs(pDate - inputDate);
                        const amountDiff = Math.abs(p.amount - amount);

                        return dateDiff < 86400000 && amountDiff < 1.0;
                    });

                    if (exists) {
                        skippedDuplicates++;
                        continue;
                    }

                    // Добавляем РЕАЛЬНЫЙ платеж
                    sale.paymentPlan.push({
                        id: `pay_real_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                        saleId: sale.id,
                        amount: amount,
                        date: paymentDateIso,
                        isPaid: true,
                        actualDate: paymentDateIso,
                        note: paymentNum ? `Импорт №${paymentNum}` : 'Импорт',
                        isRealPayment: true
                    });

                    realPaymentsCount++;
                }

                addLog(`Добавлено реальных платежей: ${realPaymentsCount}`);
                if (skippedDuplicates > 0) addLog(`Пропущено дубликатов: ${skippedDuplicates}`);

                // === ЭТАП 3: УМНОЕ РАСПРЕДЕЛЕНИЕ ПО ДАТАМ (Waterfall) ===
                addLog("Этап 3: Распределение платежей и пересчет...");

                for (const [key, sale] of createdSalesMap.entries()) {
                    const realPayments = sale.paymentPlan
                        .filter((p: any) => p.isRealPayment)
                        .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());

                    const planPayments = sale.paymentPlan
                        .filter((p: any) => !p.isRealPayment)
                        .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());

                    // Проходим по каждому реальному платежу
                    for (const realPay of realPayments) {
                        let amountLeftToCover = realPay.amount;

                        // Ищем первый неоплаченный плановый месяц
                        // Логика: берем самый ранний неоплаченный, независимо от даты платежа (досрочное гашение)
                        // Но если даты близки, стараемся попасть в этот месяц
                        let targetPlanItem = planPayments.find((p: any) => !p.isPaid);

                        while (targetPlanItem && amountLeftToCover > 0.5) {
                            const debt = targetPlanItem.amount;

                            if (amountLeftToCover >= debt) {
                                // Полное погашение месяца
                                targetPlanItem.isPaid = true;
                                targetPlanItem.actualDate = realPay.date; // Записываем дату фактического платежа
                                if (!targetPlanItem.note?.includes('Импорт')) {
                                    targetPlanItem.note = `Оплачено ${realPay.date.split('T')[0]}`;
                                }
                                amountLeftToCover -= debt;

                                // Ищем следующий неоплаченный
                                targetPlanItem = planPayments.find((p: any) => !p.isPaid);
                            } else {
                                // Частичное погашение
                                targetPlanItem.note = `Частично внесено: ${amountLeftToCover} ₽ (${realPay.date.split('T')[0]})`;
                                amountLeftToCover = 0;
                            }
                        }

                        // Если деньги остались, а плановых месяцев нет -> Переплата
                        if (amountLeftToCover > 0.5) {
                            realPay.note += ` (Переплата: ${amountLeftToCover} ₽)`;
                        }
                    }

                    // Финальный пересчет остатка
                    const totalRealMoney = realPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
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
                            <li>Колонка <b>Телефон</b> обновит данные клиента, если изменится.</li>
                            <li>Платежи распределяются на самые старые долги (водопад).</li>
                            <li>Дубликаты платежей автоматически пропускаются.</li>
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