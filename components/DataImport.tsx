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

    const addLog = (msg: string) => setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);

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

    // === ПРОВЕРКА НА ДУБЛИКАТ ПЛАТЕЖА (исправленная версия) ===
    const isDuplicatePayment = (sale: Sale, amount: number, dateIso: string, paymentNum?: string): boolean => {
        const inputDate = new Date(dateIso).getTime();

        return sale.paymentPlan.some((p: Payment) => {
            // 1. Проверка по номеру платежа (самый надёжный способ)
            if (paymentNum && p.note?.includes(`Импорт №${paymentNum}`)) {
                return true;
            }

            // 2. Проверка по дате и сумме для ВСЕХ платежей (не только isPaid)
            const pDate = new Date(p.date).getTime();
            const dateDiff = Math.abs(pDate - inputDate);
            const amountDiff = Math.abs(p.amount - amount);

            return dateDiff < 86400000 && amountDiff < 1.0; // ±1 день, ±1 рубль
        });
    };

    const processImport = async () => {
        if (!file) return;
        setIsProcessing(true);
        addLog("🚀 Начало обработки файла...");

        let XLSX_LIB: any;
        try {
            XLSX_LIB = await getXLSX();
        } catch (err) {
            addLog("❌ Ошибка: Не удалось загрузить библиотеку Excel.");
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
                    addLog("❌ Ошибка: Не найден лист 'Обзор клиентов'.");
                    setIsProcessing(false);
                    return;
                }

                const overviewData: any[] = XLSX_LIB.utils.sheet_to_json(sheetOverview, { defval: "" });
                const paymentsData: any[] = sheetPayments ? XLSX_LIB.utils.sheet_to_json(sheetPayments, { defval: "" }) : [];

                addLog(`📊 Найдено записей: клиенты=${overviewData.length}, платежи=${paymentsData.length}`);

                // Загружаем текущие данные из базы
                const { customers, products, accounts, investors, sales: existingSales } = await api.fetchAllData();

                let newCustomersCount = 0;
                let updatedPhonesCount = 0;
                let newSalesCount = 0;
                let updatedSalesCount = 0;
                let newInvestorsCount = 0;
                let realPaymentsCount = 0;
                let skippedDuplicates = 0;
                let skippedDeleted = 0;
                let skippedNotFound = 0;

                const processedSalesMap = new Map<string, Sale>();

                // === ЭТАП 1: Обработка клиентов и создание/обновление продаж ===
                addLog("📦 Этап 1: Обработка клиентов и договоров...");

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
                        addLog(`➕ Новый клиент: ${clientName}`);
                    } else if (phone && customer.phone !== phone) {
                        customer.phone = phone;
                        await api.saveItem('customers', customer);
                        updatedPhonesCount++;
                    }

                    // 2. Инвестор и Счет
                    let accountId = '';
                    const mainAccount = accounts.find(a => a.type === 'MAIN');
                    if (mainAccount) accountId = mainAccount.id;

                    if (investorName && investorName !== '') {
                        let investor = investors.find(i => i.name.toLowerCase() === investorName.toLowerCase());

                        if (!investor) {
                            addLog(`➕ Новый инвестор: ${investorName}`);
                            const newInvestor: Investor = {
                                id: `inv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                                userId: 'import',
                                joinedDate: new Date().toISOString(),
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
                    const saleKey = `${clientName}__${productName}`.toLowerCase();

                    // === ПРОВЕРКА: существует ли уже продажа ===
                    let sale = existingSales.find(s =>
                        s.customerId === customer.id &&
                        s.productName.toLowerCase() === productName.toLowerCase()
                    );

                    if (sale) {
                        // Обновляем существующую продажу
                        sale.totalAmount = totalPrice;
                        sale.buyPrice = buyPrice;
                        sale.downPayment = downPayment;
                        sale.installments = installmentsCount;
                        sale.startDate = saleDateIso;
                        sale.status = statusStr.includes('Завершен') ? 'COMPLETED' : (statusStr.includes('Оформлен') ? 'DRAFT' : 'ACTIVE');
                        sale.accountId = accountId;
                        sale.notes = 'Обновлено при импорте';
                        await api.saveItem('sales', sale);
                        updatedSalesCount++;
                        addLog(`✏️ Обновлена продажа: ${productName}`);
                    } else {
                        // Создаём новую продажу с планом платежей
                        const remainingAfterDown = Math.max(0, totalPrice - downPayment);
                        const monthlyAvg = installmentsCount > 0 ? remainingAfterDown / installmentsCount : 0;

                        const tempPaymentPlan: Payment[] = [];
                        for (let i = 0; i < installmentsCount; i++) {
                            const pDate = new Date(firstPaymentDateStr);
                            pDate.setMonth(pDate.getMonth() + i);

                            tempPaymentPlan.push({
                                id: `plan_pay_${Date.now()}_${i}_${Math.random().toString(36).substr(2, 5)}`,
                                saleId: '',
                                amount: Number(monthlyAvg.toFixed(2)),
                                date: pDate.toISOString(),
                                isPaid: false,
                                actualDate: null,
                                note: "План",
                                isRealPayment: false // Explicitly mark as plan
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
                        existingSales.push(newSale);
                        sale = newSale;
                        newSalesCount++;
                        addLog(`➕ Новая продажа: ${productName}`);
                    }

                    processedSalesMap.set(saleKey, sale);
                }

                addLog(`✅ Этап 1 завершён: Клиентов=${newCustomersCount}, Телефонов обновлено=${updatedPhonesCount}, Инвесторов=${newInvestorsCount}, Продаж создано=${newSalesCount}, обновлено=${updatedSalesCount}`);

                // === ЭТАП 2: Импорт реальных платежей ===
                addLog("💰 Этап 2: Импорт реальных платежей...");

                for (const row of paymentsData) {
                    const clientName = String(row['Клиент'] || '').trim();
                    const productName = String(row['Товар'] || '').trim();
                    const paymentStatus = String(row['Статус платежа'] || '');
                    const amount = parseMoney(row['Сумма']);
                    const dateVal = row['Дата платежа'];
                    const paymentNumRaw = row['Платёж №'];
                    const paymentNum = paymentNumRaw && paymentNumRaw !== '-' && paymentNumRaw !== 'Нет платежей' ? String(paymentNumRaw).trim() : '';

                    // Пропускаем пустые и удалённые платежи
                    if (!clientName || !productName || paymentStatus === 'Нет платежей' || paymentStatus === 'Удалён' || !amount) {
                        if (paymentStatus === 'Удалён') skippedDeleted++;
                        continue;
                    }

                    const saleKey = `${clientName}__${productName}`.toLowerCase();
                    const sale = processedSalesMap.get(saleKey);

                    if (!sale) {
                        skippedNotFound++;
                        continue;
                    }

                    const paymentDateIso = parseExcelDate(dateVal);

                    // === ЖЁСТКАЯ ПРОВЕРКА НА ДУБЛИКАТЫ ===
                    if (isDuplicatePayment(sale, amount, paymentDateIso, paymentNum)) {
                        skippedDuplicates++;
                        continue;
                    }

                    // Добавляем РЕАЛЬНЫЙ платёж
                    sale.paymentPlan.push({
                        id: `pay_real_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        saleId: sale.id,
                        amount: amount,
                        date: paymentDateIso,
                        isPaid: true,
                        actualDate: paymentDateIso,
                        note: paymentNum ? `Импорт №${paymentNum}` : 'Импорт',
                        isRealPayment: true,  // ← КЛЮЧЕВОЙ ФЛАГ
                        importedAt: new Date().toISOString()
                    });

                    realPaymentsCount++;
                }

                // Сохраняем все обновлённые продажи с платежами
                for (const sale of processedSalesMap.values()) {
                    await api.saveItem('sales', sale);
                }

                addLog(`✅ Этап 2 завершён: Добавлено платежей=${realPaymentsCount}, Пропущено дублей=${skippedDuplicates}, Удалённых=${skippedDeleted}, Не найдено продаж=${skippedNotFound}`);

                // === ЭТАП 3: Распределение платежей (Waterfall) и пересчёт остатка ===
                addLog("🔄 Этап 3: Распределение платежей и пересчёт остатков...");

                for (const [key, sale] of processedSalesMap.entries()) {
                    // Получаем реальные платежи, отсортированные по дате
                    const realPayments = sale.paymentPlan
                        .filter((p: Payment) => p.isRealPayment && p.isPaid)
                        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

                    // Получаем плановые платежи, отсортированные по дате
                    const planPayments = sale.paymentPlan
                        .filter((p: Payment) => !p.isRealPayment)
                        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

                    // Waterfall: каждый реальный платёж покрывает самые старые неоплаченные плановые
                    for (const realPay of realPayments) {
                        let amountLeft = realPay.amount;

                        // Ищем первый неоплаченный плановый платёж
                        let targetPlan = planPayments.find((p: Payment) => !p.isPaid);

                        while (targetPlan && amountLeft > 0.5) {
                            const debt = targetPlan.amount;

                            if (amountLeft >= debt - 0.01) {
                                // Полное погашение месяца
                                targetPlan.isPaid = true;
                                targetPlan.actualDate = realPay.date;
                                if (!targetPlan.note?.includes('Оплачено')) {
                                    targetPlan.note = `Оплачено ${new Date(realPay.date).toLocaleDateString()}`;
                                }
                                amountLeft -= debt;
                                targetPlan = planPayments.find((p: Payment) => !p.isPaid);
                            } else {
                                // Частичное погашение
                                targetPlan.note = `Частично: ${amountLeft} ₽ (${new Date(realPay.date).toLocaleDateString()})`;
                                amountLeft = 0;
                            }
                        }

                        // Если остались деньги после покрытия всех плановых — переплата
                        if (amountLeft > 0.5) {
                            realPay.note = `${realPay.note || ''} (Переплата: ${amountLeft.toFixed(2)} ₽)`.trim();
                        }
                    }

                    // Пересчитываем остаток долга ТОЛЬКО по реальным платежам
                    const totalRealPaid = sale.paymentPlan
                        .filter((p: Payment) => p.isRealPayment && p.isPaid)
                        .reduce((sum, p) => sum + p.amount, 0);

                    const debtBefore = sale.totalAmount - sale.downPayment;
                    const currentRemaining = Math.max(0, debtBefore - totalRealPaid);

                    sale.remainingAmount = Number(currentRemaining.toFixed(2));

                    // Обновляем статус
                    if (currentRemaining < 1 && sale.status !== 'COMPLETED') {
                        sale.status = 'COMPLETED';
                    } else if (currentRemaining >= 1 && sale.status === 'COMPLETED') {
                        sale.status = 'ACTIVE';
                    }

                    // Сортируем paymentPlan по дате для удобства
                    sale.paymentPlan.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

                    await api.saveItem('sales', sale);
                }

                addLog("✅ Импорт успешно завершён!");
                addLog(`📈 Итог: ${newCustomersCount} новых клиентов, ${newSalesCount + updatedSalesCount} продаж обработано, ${realPaymentsCount} платежей импортировано`);

                setTimeout(() => {
                    setIsProcessing(false);
                    onImportSuccess();
                }, 1500);

            } catch (error: any) {
                console.error("Import error:", error);
                addLog(`❌ Критическая ошибка: ${error.message || String(error)}`);
                setIsProcessing(false);
            }
        };
        reader.readAsBinaryString(file);
    };

    const downloadTemplate = () => {
        alert("📥 Используйте файл выгрузки из системы как шаблон для импорта.");
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in" onClick={onClose}>
            <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl p-6 space-y-5 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center border-b border-slate-100 pb-4">
                    <h3 className="text-xl font-bold text-slate-800">Импорт данных (Excel)</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl">✕</button>
                </div>

                <div className="space-y-4">
                    <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100 text-sm text-indigo-800">
                        <p className="font-bold mb-2">📋 Инструкция:</p>
                        <ul className="list-disc list-inside space-y-1 text-xs">
                            <li>Файл должен содержать листы: <b>Обзор клиентов</b> и <b>История платежей</b></li>
                            <li>Клиенты ищутся по имени, продажи — по <i>Клиент + Товар</i></li>
                            <li>Платежи с номером <b>не импортируются повторно</b> (защита от дублей)</li>
                            <li>Реальные платежи помечаются флагом <code>isRealPayment</code></li>
                            <li>При повторном импорте продажи <b>обновляются</b>, а не создаются заново</li>
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
                            <p className="font-bold text-slate-800 text-sm break-all">{file.name}</p>
                        ) : (
                            <p className="text-slate-500 text-sm">Нажмите для выбора файла Excel</p>
                        )}
                    </div>

                    {logs.length > 0 && (
                        <div className="bg-slate-900 text-green-400 p-3 rounded-xl text-[10px] font-mono h-40 overflow-y-auto">
                            {logs.map((log, i) => <div key={i}>{log}</div>)}
                        </div>
                    )}

                    <div className="flex gap-3">
                        <button
                            onClick={downloadTemplate}
                            className="flex-1 py-3 bg-slate-100 text-slate-700 font-bold rounded-xl hover:bg-slate-200 transition-colors text-sm"
                        >
                            📥 Шаблон
                        </button>
                        <button
                            onClick={processImport}
                            disabled={!file || isProcessing}
                            className="flex-[2] py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-indigo-200 transition-all text-sm"
                        >
                            {isProcessing ? '⏳ Обработка...' : '🚀 Начать импорт'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default DataImport;