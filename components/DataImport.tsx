import React, { useState, useRef } from 'react';
import { api } from '@/services/api';
import { Customer, Product, Sale, Account, Investor, Payment, Expense } from '../types';

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

    // === ПРОВЕРКА НА ДУБЛИКАТ ПЛАТЕЖА ===
    const isDuplicatePayment = (sale: Sale, amount: number, dateIso: string, paymentNum?: string): boolean => {
        const inputDate = new Date(dateIso).getTime();

        return sale.paymentPlan.some((p: Payment) => {
            if (p.isRealPayment === false) return false;

            if (paymentNum && p.note?.includes(`Импорт №${paymentNum}`)) {
                return true;
            }

            const pDate = new Date(p.date).getTime();
            const dateDiff = Math.abs(pDate - inputDate);
            const amountDiff = Math.abs(p.amount - amount);

            return dateDiff < 86400000 && amountDiff < 1.0;
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

                const { customers, products, accounts, investors, sales: existingSales } = await api.fetchAllData();

                let newCustomersCount = 0;
                let updatedPhonesCount = 0;
                let updatedAddressesCount = 0;
                let newSalesCount = 0;
                let updatedSalesCount = 0;
                let newInvestorsCount = 0;
                let realPaymentsCount = 0;
                let skippedDuplicates = 0;
                let skippedDeleted = 0;
                let skippedNotFound = 0;

                const processedSalesMap = new Map<string, Sale[]>();

                // === ЭТАП 1: Обработка клиентов и создание/обновление продаж ===
                addLog("📦 Этап 1: Обработка клиентов и договоров...");

                for (const row of overviewData) {
                    const clientName = String(row['Клиент'] || '').trim();
                    const productName = String(row['Товар'] || '').trim();
                    const investorNameRaw = row['Инвестор'];
                    const investorName = investorNameRaw ? String(investorNameRaw).trim() : '';

                    if (!clientName || !productName) continue;

                    // === ЧТЕНИЕ ПОЛЕЙ: Телефон и Адрес ===
                    const phoneRaw = row['Телефон'] || row['Mobile'] || '';
                    const phone = phoneRaw ? String(phoneRaw).trim() : '';

                    const addressRaw = row['Адрес'] || row['Address'] || '';
                    const address = addressRaw ? String(addressRaw).trim() : '';

                    // 1. Клиент + Телефон + Адрес
                    let customer = customers.find(c => c.name === clientName);

                    if (!customer) {
                        const newCustomer: Customer = {
                            id: `cust_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                            userId: 'import',
                            name: clientName,
                            phone: phone || '',
                            email: '',
                            address: address,  // <-- Сохраняем адрес
                            trustScore: 100,
                            notes: 'Импорт из Excel'
                        };
                        await api.saveItem('customers', newCustomer);
                        customers.push(newCustomer);
                        customer = newCustomer;
                        newCustomersCount++;
                        addLog(`➕ Новый клиент: ${clientName}`);
                    } else {
                        // Обновляем телефон если изменился
                        if (phone && customer.phone !== phone) {
                            customer.phone = phone;
                            await api.saveItem('customers', customer);
                            updatedPhonesCount++;
                        }
                        // <-- Обновляем адрес если изменился
                        if (address && customer.address !== address) {
                            customer.address = address;
                            await api.saveItem('customers', customer);
                            updatedAddressesCount++;
                        }
                    }

                    // 2. Инвестор и Счет (исправленная логика)
                    let accountId = '';
                    const mainAccount = accounts.find(a => a.type === 'MAIN');

                    // Если в файле указан инвестор (не пусто, не "-", не пробелы)
                    if (investorName && investorName !== '-' && investorName.trim() !== '') {
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
                    } else {
                        // === НЕТ ИНВЕСТОРА В ФАЙЛЕ ===
                        // Используем основной счет приложения (MAIN)
                        if (mainAccount) {
                            accountId = mainAccount.id;
                        } else {
                            // Fallback: если нет MAIN счета, создаём его
                            const newMainAccount: Account = {
                                id: `acc_main_${Date.now()}`,
                                userId: 'import',
                                name: 'Основной счет',
                                type: 'MAIN',
                                balance: 0,
                                ownerId: null,
                                currency: 'RUB',
                                isArchived: false
                            };
                            await api.saveItem('accounts', newMainAccount);
                            accounts.push(newMainAccount);
                            accountId = newMainAccount.id;
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
                    const groupKey = `${clientName}__${productName}`.toLowerCase();

                    // Поиск существующей продажи
                    let sale = existingSales.find(s =>
                        s.customerId === customer.id &&
                        s.productName.toLowerCase() === productName.toLowerCase() &&
                        s.startDate.substring(0, 10) === saleDateIso.substring(0, 10) &&
                        s.accountId === accountId
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
                        addLog(`✏️ Обновлена продажа: ${productName} (${new Date(saleDateIso).toLocaleDateString()})`);
                    } else {
                        // Создаём новую продажу
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
                                isRealPayment: false
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
                        newSale.paymentPlan.forEach(p => p.saleId = newSale.id);

                        await api.saveItem('sales', newSale);

                        if (buyPrice > 0) {
                            const buyPriceExpense: Expense = {
                                id: `exp_${newSale.id}`,
                                userId: 'import',
                                accountId: accountId,
                                title: `Закуп: ${productName}`,
                                amount: buyPrice,
                                category: 'Себестоимость',
                                date: saleDateIso
                            };
                            await api.saveItem('expenses', buyPriceExpense);
                        }

                        existingSales.push(newSale);
                        sale = newSale;
                        newSalesCount++;
                        addLog(`➕ Новая продажа: ${productName} (${new Date(saleDateIso).toLocaleDateString()})`);
                    }

                    // Add to map for Step 2
                    const groupList = processedSalesMap.get(groupKey) || [];
                    groupList.push(sale);
                    processedSalesMap.set(groupKey, groupList);
                }

                addLog(`✅ Этап 1 завершён: Клиентов=${newCustomersCount}, Адресов обновлено=${updatedAddressesCount}, Инвесторов=${newInvestorsCount}, Продаж создано=${newSalesCount}, обновлено=${updatedSalesCount}`);

                // === ЭТАП 2: Импорт реальных платежей ===
                addLog("💰 Этап 2: Импорт реальных платежей...");

                for (const row of paymentsData) {
                    const clientName = String(row['Клиент'] || '').trim();
                    const productName = String(row['Товар'] || '').trim();
                    const paymentStatus = String(row['Статус платежа'] || '');
                    const productStatus = String(row['Статус товара'] || '');
                    const amount = parseMoney(row['Сумма']);
                    const dateVal = row['Дата платежа'];
                    const paymentNumRaw = row['Платёж'] || row['Платёж №'];
                    const paymentNum = paymentNumRaw && paymentNumRaw !== '-' && paymentNumRaw !== 'Нет платежей' ? String(paymentNumRaw).trim() : '';

                    if (!clientName || !productName || paymentStatus === 'Нет платежей' || paymentStatus === 'Удалён' || !amount) {
                        if (paymentStatus === 'Удалён') skippedDeleted++;
                        continue;
                    }

                    const groupKey = `${clientName}__${productName}`.toLowerCase();
                    const candidates = processedSalesMap.get(groupKey);

                    if (!candidates || candidates.length === 0) {
                        skippedNotFound++;
                        continue;
                    }

                    const paymentDateIso = parseExcelDate(dateVal);
                    const paymentTime = new Date(paymentDateIso).getTime();
                    const paymentInvestor = String(row['Инвестор'] || '').trim();

                    // === ВЫБОР ПРОДАЖИ ДЛЯ ПЛАТЕЖА ===
                    let selectedSale: Sale | undefined;

                    if (paymentNum) {
                        const exactDuplicateSale = candidates.find(s =>
                            s.paymentPlan.some(p =>
                                p.isRealPayment &&
                                p.note?.includes(`Импорт №${paymentNum}`) &&
                                Math.abs(new Date(p.date).getTime() - paymentTime) < 86400000 &&
                                Math.abs(p.amount - amount) < 1.0
                            )
                        );
                        if (exactDuplicateSale) {
                            selectedSale = exactDuplicateSale;
                        }
                    }

                    if (!selectedSale) {
                        let filtered = candidates;

                        if (paymentInvestor) {
                            const inv = investors.find(i => i.name.toLowerCase() === paymentInvestor.toLowerCase());
                            if (inv) {
                                const invAccount = accounts.find(a => a.ownerId === inv.id);
                                if (invAccount) {
                                     const accountMatches = filtered.filter(s => s.accountId === invAccount.id);
                                     if (accountMatches.length > 0) filtered = accountMatches;
                                }
                            }
                        }

                        if (productStatus) {
                            const targetStatus = productStatus.includes('Завершен') ? 'COMPLETED' : 'ACTIVE';
                            filtered = filtered.filter(s => s.status === targetStatus);
                        }

                        filtered = filtered.filter(s => new Date(s.startDate).getTime() <= paymentTime + 86400000);

                        if (paymentNum) {
                            const withoutNum = filtered.filter(s => !s.paymentPlan.some(p => p.isRealPayment && p.note?.includes(`Импорт №${paymentNum}`)));
                            if (withoutNum.length > 0) filtered = withoutNum;
                        }

                        if (filtered.length > 1) {
                            const amountMatches = filtered.filter(s => {
                                if (s.installments > 0) {
                                    const monthly = (s.totalAmount - s.downPayment) / s.installments;
                                    if (Math.abs(monthly - amount) < 50) return true;
                                }
                                const planMatch = s.paymentPlan.some(p => !p.isRealPayment && Math.abs(p.amount - amount) < 1.0);
                                if (planMatch) return true;
                                return false;
                            });
                            if (amountMatches.length > 0) filtered = amountMatches;
                        }

                        if (filtered.length === 1) {
                            selectedSale = filtered[0];
                        } else if (filtered.length > 1) {
                            filtered.sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
                            selectedSale = filtered[0];
                        } else {
                            if (paymentNum) {
                                const fallback = candidates.find(s => !s.paymentPlan.some(p => p.isRealPayment && p.note?.includes(`Импорт №${paymentNum}`)));
                                if (fallback) selectedSale = fallback;
                            }
                            if (!selectedSale) selectedSale = candidates[0];
                        }
                    }

                    if (!selectedSale) {
                        skippedNotFound++;
                        continue;
                    }

                    if (isDuplicatePayment(selectedSale, amount, paymentDateIso, paymentNum)) {
                        skippedDuplicates++;
                        continue;
                    }

                    selectedSale.paymentPlan.push({
                        id: `pay_real_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        saleId: selectedSale.id,
                        amount: amount,
                        date: paymentDateIso,
                        isPaid: true,
                        actualDate: paymentDateIso,
                        note: paymentNum ? `Импорт №${paymentNum}` : 'Импорт',
                        isRealPayment: true,
                        importedAt: new Date().toISOString()
                    });

                    realPaymentsCount++;
                }

                for (const salesList of processedSalesMap.values()) {
                    for (const sale of salesList) {
                        await api.saveItem('sales', sale);
                    }
                }

                addLog(`✅ Этап 2 завершён: Платежей=${realPaymentsCount}, Дублей=${skippedDuplicates}`);

                // === ЭТАП 3: Распределение платежей (Waterfall) ===
                addLog("🔄 Этап 3: Распределение платежей...");

                for (const salesList of processedSalesMap.values()) {
                    for (const sale of salesList) {
                        const realPayments = sale.paymentPlan
                            .filter((p: Payment) => p.isRealPayment && p.isPaid)
                            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

                        const planPayments = sale.paymentPlan
                            .filter((p: Payment) => !p.isRealPayment)
                            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

                        for (const realPay of realPayments) {
                            let amountLeft = realPay.amount;
                            let targetPlan = planPayments.find((p: Payment) => !p.isPaid);

                            while (targetPlan && amountLeft > 0.5) {
                                const debt = targetPlan.amount;
                                if (amountLeft >= debt - 0.01) {
                                    targetPlan.isPaid = true;
                                    targetPlan.actualDate = realPay.date;
                                    if (!targetPlan.note?.includes('Оплачено')) {
                                        targetPlan.note = `Оплачено ${new Date(realPay.date).toLocaleDateString()}`;
                                    }
                                    amountLeft -= debt;
                                    targetPlan = planPayments.find((p: Payment) => !p.isPaid);
                                } else {
                                    targetPlan.note = `Частично: ${amountLeft} ₽ (${new Date(realPay.date).toLocaleDateString()})`;
                                    amountLeft = 0;
                                }
                            }
                            if (amountLeft > 0.5) {
                                realPay.note = `${realPay.note || ''} (Переплата: ${amountLeft.toFixed(2)} ₽)`.trim();
                            }
                        }

                        const totalRealPaid = sale.paymentPlan
                            .filter((p: Payment) => p.isRealPayment && p.isPaid)
                            .reduce((sum, p) => sum + p.amount, 0);

                        const debtBefore = sale.totalAmount - sale.downPayment;
                        const currentRemaining = Math.max(0, debtBefore - totalRealPaid);

                        sale.remainingAmount = Number(currentRemaining.toFixed(2));

                        if (currentRemaining < 1 && sale.status !== 'COMPLETED') {
                            sale.status = 'COMPLETED';
                        } else if (currentRemaining >= 1 && sale.status === 'COMPLETED') {
                            sale.status = 'ACTIVE';
                        }

                        sale.paymentPlan.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
                        await api.saveItem('sales', sale);
                    }
                }

                addLog("✅ Импорт успешно завершён!");
                addLog(`📈 Итог: ${newCustomersCount} клиентов, ${newSalesCount + updatedSalesCount} продаж, ${realPaymentsCount} платежей`);

                setTimeout(() => {
                    setIsProcessing(false);
                    onImportSuccess();
                }, 1500);

            } catch (error: any) {
                console.error("Import error:", error);
                addLog(`❌ Ошибка: ${error.message || String(error)}`);
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
                            <li>Клиенты ищутся по имени, продажи — по <i>Клиент+Товар+Дата</i></li>
                            <li>Поля <b>Телефон</b> и <b>Адрес</b> обновляются автоматически</li>
                            <li>Если инвестор не указан — используется <b>Основной счет</b></li>
                            <li>Платежи с номером <b>не импортируются повторно</b></li>
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