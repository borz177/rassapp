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

    // --- УЛУЧШЕННЫЙ ПАРСИНГ ДАТ (Поддержка ДД.ММ.ГГГГ) ---
    const parseExcelDate = (val: any): string => {
        if (!val) return new Date().toISOString();

        // 1. Если это число (формат даты Excel)
        if (typeof val === 'number') {
            const dateObj = new Date((val - (25567 + 2)) * 86400 * 1000);
            if (!isNaN(dateObj.getTime())) {
                return dateObj.toISOString();
            }
        }

        // 2. Если это строка (например, "03.07.2025")
        if (typeof val === 'string') {
            const trimmed = val.trim();
            const dateRegex = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;
            const match = trimmed.match(dateRegex);

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
                const workbook = XLSX_LIB.read(data, { type: 'binary' });

                const sheetOverview = workbook.Sheets["Обзор клиентов"];
                const sheetPayments = workbook.Sheets["История платежей"];

                if (!sheetOverview) {
                    addLog("Ошибка: Не найден лист 'Обзор клиентов'.");
                    setIsProcessing(false);
                    return;
                }

                const overviewData: any[] = XLSX_LIB.utils.sheet_to_json(sheetOverview);
                const paymentsData: any[] = sheetPayments ? XLSX_LIB.utils.sheet_to_json(sheetPayments) : [];

                addLog(`Найдено товаров: ${overviewData.length}`);
                addLog(`Найдено записей о платежах: ${paymentsData.length}`);

                const { customers, products, accounts, investors } = await api.fetchAllData();

                let newCustomersCount = 0;
                let newSalesCount = 0;
                let newInvestorsCount = 0;
                let realPaymentsCount = 0;

                const createdSalesMap = new Map<string, any>();

                // === ЭТАП 1: Создание договоров и планов ===
                addLog("Этап 1: Создание клиентов и договоров...");

                for (const row of overviewData) {
                    const clientName = String(row['Клиент'] || '').trim();
                    const productName = String(row['Товар'] || '').trim();
                    const investorNameRaw = row['Инвестор'];
                    const investorName = investorNameRaw ? String(investorNameRaw).trim() : '';

                    if (!clientName || !productName) continue;

                    // 1. Клиент
                    const phone = String(row['Телефон'] || row['Mobile'] || '').trim();
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
                        accountId = mainAccount.id; // По умолчанию Основной счет
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

                    // Расчет даты первого платежа
                    let firstPaymentDateStr = row['Дата первого платежа'] || row['First Payment Date'];
                    if (!firstPaymentDateStr && saleDateRaw) {
                        const saleDateObj = new Date(parseExcelDate(saleDateRaw));
                        const currentYear = new Date().getFullYear();
                        const fileYear = saleDateObj.getFullYear();

                        if (fileYear !== currentYear || Math.abs(Date.now() - saleDateObj.getTime()) > 86400000 * 2) {
                             saleDateObj.setMonth(saleDateObj.getMonth() + 1);
                             firstPaymentDateStr = saleDateObj.toISOString();
                        } else {
                             const strVal = String(saleDateRaw);
                             const match = strVal.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
                             if (match) {
                                 const d = new Date(parseInt(match[3]), parseInt(match[2])-1, parseInt(match[1]));
                                 d.setMonth(d.getMonth() + 1);
                                 firstPaymentDateStr = d.toISOString();
                             } else {
                                 firstPaymentDateStr = new Date().toISOString();
                             }
                        }
                    } else if (!firstPaymentDateStr) {
                        firstPaymentDateStr = new Date().toISOString();
                    }

                    const startDate = parseExcelDate(firstPaymentDateStr);
                    const statusStr = String(row['Статус'] || '');
                    const saleKey = `${clientName}__${productName}`;

                    // Генерация ПЛАНОВОГО графика (все isPaid: false)
                    const remainingAfterDown = Math.max(0, totalPrice - downPayment);
                    const monthlyAvg = installmentsCount > 0 ? remainingAfterDown / installmentsCount : 0;

                    const tempPaymentPlan: Payment[] = [];
                    for (let i = 0; i < installmentsCount; i++) {
                        const pDate = new Date(startDate);
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
                        startDate: startDate,
                        status: statusStr.includes('Завершен') ? 'COMPLETED' : (statusStr.includes('Оформлен') ? 'DRAFT' : 'ACTIVE'),
                        type: 'INSTALLMENT',
                        paymentPlan: tempPaymentPlan,
                        paymentDay: new Date(startDate).getDate(),
                        notes: 'Импорт из Excel'
                    };

                    await api.saveItem('sales', newSale);
                    createdSalesMap.set(saleKey, newSale);
                    newSalesCount++;
                }

                addLog(`Создано: Клиентов=${newCustomersCount}, Инвесторов=${newInvestorsCount}, Договоров=${newSalesCount}`);
                addLog("Этап 2: Импорт реальных платежей...");

                // === ЭТАП 2: Импорт реальных платежей (ТОЧНЫЕ СУММЫ И ДАТЫ) ===
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

                    const paymentDateIso = parseExcelDate(dateVal);

                    // Проверка на дубликаты (чтобы не добавить один платеж дважды)
                    const exists = sale.paymentPlan.some((p: any) =>
                        p.isPaid &&
                        p.note?.includes(`Импорт №${paymentNum}`) &&
                        Math.abs(p.amount - amount) < 1.0 &&
                        Math.abs(new Date(p.date).getTime() - new Date(paymentDateIso).getTime()) < 86400000
                    );

                    if (exists) continue;

                    // 1. ДОБАВЛЯЕМ РЕАЛЬНЫЙ ПЛАТЕЖ В ИСТОРИЮ
                    // Создаем новую запись со статусом "Оплачено" и ТОЧНОЙ суммой из файла.
                    sale.paymentPlan.push({
                        id: `pay_real_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                        saleId: sale.id,
                        amount: amount, // Точная сумма из файла (например, 20 000)
                        date: paymentDateIso,
                        isPaid: true,
                        actualDate: paymentDateIso,
                        note: `Импорт №${paymentNum}`,
                        isRealPayment: true // Флаг, что это реальный ввод
                    });

                    realPaymentsCount++;
                }

                addLog(`Добавлено реальных платежей: ${realPaymentsCount}`);

                // === ЭТАП 3: Распределение денег (Waterfall) и Пересчет ===
                addLog("Этап 3: Распределение платежей и пересчет остатков...");

                for (const [key, sale] of createdSalesMap.entries()) {
                    // Собираем все реальные платежи
                    const realPayments = sale.paymentPlan.filter((p: any) => p.isRealPayment);

                    // Собираем все плановые платежи
                    const planPayments = sale.paymentPlan
                        .filter((p: any) => !p.isRealPayment)
                        .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());

                    // Считаем общую сумму всех реальных денег
                    const totalRealMoney = realPayments.reduce((sum, p) => sum + (p.amount || 0), 0);

                    // ЗАПУСКАЕМ ВОДОПАД (Распределяем деньги по плановым месяцам)
                    let moneyLeft = totalRealMoney;

                    for (const planItem of planPayments) {
                        if (moneyLeft <= 0) break;

                        const debt = planItem.amount;

                        if (moneyLeft >= debt) {
                            // Денег хватает на весь месяц -> Помечаем как оплаченный
                            planItem.isPaid = true;
                            moneyLeft -= debt;
                        } else {
                            // Денег меньше -> Частичная оплата (месяц остается неоплаченным в графике)
                            planItem.note = `Частично внесено: ${moneyLeft} ₽`;
                            moneyLeft = 0;
                        }
                    }

                    // ФИНАЛЬНЫЙ ПЕРЕСЧЕТ ОСТАТКА
                    const debtBeforePayments = sale.totalAmount - sale.downPayment;
                    const currentRemaining = Math.max(0, debtBeforePayments - totalRealMoney);

                    sale.remainingAmount = currentRemaining;

                    if (currentRemaining < 1 && sale.status !== 'COMPLETED') {
                        sale.status = 'COMPLETED';
                    } else if (currentRemaining > 0 && sale.status === 'COMPLETED') {
                        sale.status = 'ACTIVE';
                    }

                    // Сортируем весь план по дате
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
        alert("Для импорта используйте файл выгрузки системы (с листами 'Обзор клиентов' и 'История платежей').");
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
                            <li>Лист 1: <b>Обзор клиентов</b> (создает договоры).</li>
                            <li>Лист 2: <b>История платежей</b> (добавляет реальные оплаты).</li>
                            <li>Если инвестор не указан, используется Основной счет.</li>
                            <li>Платежи со статусом "Удалён" игнорируются.</li>
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