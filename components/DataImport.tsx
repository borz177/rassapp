import React, { useState, useRef } from 'react';
import { api } from '@/services/api';
import { Customer, Product, Sale, Account, Investor, Payment } from '../types';

// Объявляем тип для глобальной переменной XLSX (из CDN)
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

    const addLog = (msg: string) => {
        setLogs(prev => [...prev, msg]);
    };

    // Функция загрузки библиотеки
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

    // Парсинг дат (Excel serial date или строка)
    const parseExcelDate = (val: any): string => {
        if (!val) return new Date().toISOString();
        if (typeof val === 'number') {
            const dateObj = new Date((val - (25567 + 2)) * 86400 * 1000);
            return dateObj.toISOString();
        }
        const parsed = new Date(val);
        return isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
    };

    // Парсинг денег (убирает "₽", пробелы, запятые)
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

                const createdSalesMap = new Map<string, any>();

                // === ЭТАП 1: Создание клиентов, инвесторов и продаж ===
                addLog("Этап 1: Создание клиентов, инвесторов и товаров...");

                for (const row of overviewData) {
                    const clientName = String(row['Клиент'] || '').trim();
                    const productName = String(row['Товар'] || '').trim();
                    const investorName = String(row['Инвестор'] || '').trim();

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

                    // 2. Инвестор и Счет (Автоматическое создание)
                    let accountId = accounts.find(a => a.type === 'MAIN')?.id || '';

                    if (investorName && investorName.trim() !== '') {
                        let investor = investors.find(i => i.name.toLowerCase() === investorName.toLowerCase());

                        if (!investor) {
                            addLog(`Создание нового инвестора: ${investorName}...`);
                            const newInvestor: Investor = {
                                id: `inv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                                name: investorName,
                                phone: '',
                                notes: 'Создан автоматически при импорте',
                                color: '#' + Math.floor(Math.random()*16777215).toString(16)
                            };
                            await api.saveItem('investors', newInvestor);
                            investors.push(newInvestor);
                            investor = newInvestor;
                            newInvestorsCount++;

                            // Создаем счет инвестора
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
                    const downPayment = parseMoney(row['Взнос']); // Первый взнос

                    // Срок и даты
                    const installmentsCount = Number(row['Срок (мес)']) || 1;
                    const saleDateStr = row['Дата оформления'];

                    // Дата первого платежа: либо из колонки "Дата первого платежа", либо Дата оформления + 1 мес
                    let firstPaymentDateStr = row['Дата первого платежа'] || row['First Payment Date'];
                    if (!firstPaymentDateStr && saleDateStr) {
                        const d = new Date(parseExcelDate(saleDateStr));
                        d.setMonth(d.getMonth() + 1);
                        firstPaymentDateStr = d.toISOString();
                    }

                    const startDate = parseExcelDate(firstPaymentDateStr || saleDateStr);
                    const statusStr = String(row['Статус'] || '');

                    const saleKey = `${clientName}__${productName}`;

                    // Генерация плана платежей (пока пустого/чернового, заполним на этапе 2)
                    const remainingAfterDown = Math.max(0, totalPrice - downPayment);
                    const monthlyAvg = installmentsCount > 0 ? remainingAfterDown / installmentsCount : 0;

                    const tempPaymentPlan: Payment[] = [];
                    for (let i = 0; i < installmentsCount; i++) {
                        const pDate = new Date(startDate);
                        pDate.setMonth(pDate.getMonth() + i); // Сдвиг по месяцам от даты первого платежа

                        tempPaymentPlan.push({
                            id: `temp_pay_${i}`,
                            saleId: '', // Заполним позже
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
                        downPayment: downPayment, // Сохраняем первый взнос
                        remainingAmount: remainingAfterDown, // Временно, пересчитаем после импорта платежей
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

                addLog(`Создано: Клиентов=${newCustomersCount}, Инвесторов=${newInvestorsCount}, Товаров=${newSalesCount}`);
                addLog("Этап 2: Обработка истории платежей...");

                                // === ЭТАП 2: Обработка истории платежей (ОБНОВЛЕННАЯ ЛОГИКА) ===
                addLog("Этап 2: Обработка истории платежей...");
                let processedPayments = 0;
                let skippedDeleted = 0;
                let extraPaymentsCreated = 0;

                for (const row of paymentsData) {
                    const clientName = String(row['Клиент'] || '').trim();
                    const productName = String(row['Товар'] || '').trim();
                    const paymentStatus = String(row['Статус платежа'] || '');
                    const amount = parseMoney(row['Сумма']);
                    const dateVal = row['Дата платежа'];
                    const paymentNum = row['Платёж №']; // Номер платежа из файла

                    if (!clientName || !productName || paymentStatus === 'Нет платежей' || !amount) continue;

                    const saleKey = `${clientName}__${productName}`;
                    const sale = createdSalesMap.get(saleKey);

                    if (!sale) {
                        // addLog(`Предупреждение: Продажа не найдена для ${clientName} - ${productName}`);
                        continue;
                    }

                    // Пропускаем удаленные платежи
                    if (paymentStatus === 'Удалён') {
                        skippedDeleted++;
                        continue;
                    }

                    // === НОВАЯ ЛОГИКА: Создание записи под конкретный платеж ===
                    // Мы не ищем старый элемент в плане, а создаем новый или расширяем план

                    const paymentDateIso = parseExcelDate(dateVal);

                    // Проверяем, есть ли уже такой платеж (защита от дублей при повторном импорте)
                    // Сравниваем дату и сумму с допуском
                    const exists = sale.paymentPlan.some((p: any) =>
                        Math.abs(new Date(p.date).getTime() - new Date(paymentDateIso).getTime()) < 86400000 && // +/- 1 день
                        Math.abs(p.amount - amount) < 1.0
                    );

                    if (exists) {
                        continue;
                    }

                    // Добавляем платеж в план
                    // Если это досрочный платеж или платеж большей суммы, он просто добавляется в конец или сортируется позже
                    sale.paymentPlan.push({
                        id: `pay_imp_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                        saleId: sale.id,
                        amount: amount, // Берем ТОЧНУЮ сумму из файла (хоть 13000, хоть 6500)
                        date: paymentDateIso, // Точную дату
                        isPaid: true,
                        actualDate: paymentDateIso,
                        note: `Импорт (№${paymentNum})`
                    });

                    processedPayments++;
                    extraPaymentsCreated++;
                }

                // Сортируем план платежей по дате, чтобы график был красивым
                for (const [key, sale] of createdSalesMap.entries()) {
                    sale.paymentPlan.sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
                }

                // === ЭТАП 3: Финальный пересчет остатков ===
                addLog("Этап 3: Пересчет остатков и сохранение...");

                for (const [key, sale] of createdSalesMap.entries()) {
                    // Считаем общую сумму всех оплаченных платежей (фактических)
                    const totalPaidInPlan = sale.paymentPlan
                        .filter((p: any) => p.isPaid)
                        .reduce((sum: number, p: any) => sum + (p.amount || 0), 0);

                    // Остаток = (Цена товара - Первый взнос) - ВСЕ ОПЛАЧЕННЫЕ деньги
                    const debtBeforePayments = sale.totalAmount - sale.downPayment;
                    const currentRemaining = Math.max(0, debtBeforePayments - totalPaidInPlan);

                    sale.remainingAmount = currentRemaining;

                    // Обновляем статус
                    if (currentRemaining < 1 && sale.status !== 'COMPLETED') {
                        sale.status = 'COMPLETED';
                    } else if (currentRemaining > 0 && sale.status === 'COMPLETED') {
                        sale.status = 'ACTIVE';
                    }

                    // ВАЖНО: Обновляем количество платежей в объекте продажи, если оно хранилось отдельно
                    // sale.installments = sale.paymentPlan.length; // Можно раскомментировать, если нужно динамически менять срок

                    await api.saveItem('sales', sale);
                }

                addLog("✅ Импорт завершен успешно!");
                addLog(`Обработано платежей: ${processedPayments}`);
                addLog(`Пропущено (удаленные): ${skippedDeleted}`);
                addLog(`Всего товаров обновлено: ${newSalesCount}`);

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
        alert("Для импорта используйте файл выгрузки системы (с листами 'Обзор клиентов' и 'История платежей'). Убедитесь, что в файле есть колонка 'Взнос'.");
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
                            <li>Лист 1: <b>Обзор клиентов</b> (должен содержать колонку <b>Взнос</b>).</li>
                            <li>Лист 2: <b>История платежей</b> (расставляет даты оплат).</li>
                            <li>Инвесторы создаются автоматически по имени.</li>
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