import React, { useState, useRef } from 'react';
import { api } from '@/services/api';
import { Customer, Product, Sale, Account, Investor } from '../types';

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

    // Вспомогательная функция для парсинга дат из Excel (число или строка)
    const parseExcelDate = (val: any): string => {
        if (!val) return new Date().toISOString();
        if (typeof val === 'number') {
            // Excel serial date
            const dateObj = new Date((val - (25567 + 2)) * 86400 * 1000);
            return dateObj.toISOString();
        }
        const parsed = new Date(val);
        return isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
    };

    // Вспомогательная функция для очистки денег (убирает "₽", пробелы, запятые)
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

                // 1. Проверяем наличие нужных листов
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

                // 2. Загружаем текущие данные, чтобы не дублировать
                const { customers, products, accounts, investors } = await api.fetchAllData();

                let newCustomersCount = 0;
                let newSalesCount = 0;
                let updatedPaymentsCount = 0;

                // Словарь для быстрого поиска созданных продаж: Ключ = "Клиент + Товар"
                const createdSalesMap = new Map<string, any>();

                // 3. Этап А: Создание товаров и продаж (из листа "Обзор клиентов")
                addLog("Этап 1: Создание клиентов и товаров...");

                for (const row of overviewData) {
                    const clientName = String(row['Клиент'] || '').trim();
                    const productName = String(row['Товар'] || '').trim();
                    const investorName = String(row['Инвестор'] || '').trim();

                    if (!clientName || !productName) continue;

                    // Поиск или создание клиента
                    const phone = String(row['Телефон'] || row['Mobile'] || '').trim(); // В этом файле телефона может не быть в обзоре
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

                    // Поиск инвестора/счета
                    let accountId = accounts.find(a => a.type === 'MAIN')?.id || '';
                    if (investorName) {
                        const investor = investors.find(i => i.name === investorName);
                        if (investor) {
                            const invAccount = accounts.find(a => a.ownerId === investor.id);
                            if (invAccount) accountId = invAccount.id;
                        }
                    }

                    // Данные о товаре
                    const buyPrice = parseMoney(row['Цена закупа']);
                    const totalPrice = parseMoney(row['Цена рассрочки']);
                    const downPayment = parseMoney(row['Взнос']);
                    const installmentsCount = Number(row['Срок (мес)']) || 1;
                    const statusStr = String(row['Статус'] || '');
                    const saleDateStr = row['Дата оформления'];

                    // Создаем продажу
                    const saleKey = `${clientName}__${productName}`;

                    const startDate = parseExcelDate(saleDateStr);

                    // Генерируем план платежей на основе общих данных (как заглушку, потом обновим реальными)
                    const remainingTotal = totalPrice - downPayment;
                    const monthlyAvg = installmentsCount > 0 ? remainingTotal / installmentsCount : 0;

                    const tempPaymentPlan = [];
                    for (let i = 0; i < installmentsCount; i++) {
                        const pDate = new Date(startDate);
                        pDate.setMonth(pDate.getMonth() + 1 + i);
                        tempPaymentPlan.push({
                            id: `temp_pay_${i}`,
                            amount: Number(monthlyAvg.toFixed(2)),
                            date: pDate.toISOString(),
                            isPaid: false,
                            actualDate: null,
                            note: "Сгенерировано автоматически"
                        });
                    }

                    const newSale: Sale = {
                        id: `sale_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        userId: 'import',
                        customerId: customer.id,
                        productId: '', // Продукты в этой системе часто виртуальные
                        productName: productName,
                        accountId: accountId,
                        buyPrice: buyPrice,
                        totalAmount: totalPrice,
                        downPayment: downPayment,
                        remainingAmount: remainingTotal, // Временно, пересчитаем после импорта платежей
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

                addLog(`Создано клиентов: ${newCustomersCount}, Товаров: ${newSalesCount}`);
                addLog("Этап 2: Обработка истории платежей...");

                // 4. Этап Б: Привязка реальных платежей (из листа "История платежей")
                let processedPayments = 0;
                let skippedDeleted = 0;

                for (const row of paymentsData) {
                    const clientName = String(row['Клиент'] || '').trim();
                    const productName = String(row['Товар'] || '').trim();
                    const paymentStatus = String(row['Статус платежа'] || '');
                    const amount = parseMoney(row['Сумма']);
                    const dateVal = row['Дата платежа'];

                    // Пропускаем служебные строки или заголовки
                    if (!clientName || !productName || paymentStatus === 'Нет платежей') continue;

                    const saleKey = `${clientName}__${productName}`;
                    const sale = createdSalesMap.get(saleKey);

                    if (!sale) {
                        // addLog(`Предупреждение: Продажа не найдена для ${clientName} - ${productName}`);
                        continue;
                    }

                    // Если платеж удален — игнорируем его
                    if (paymentStatus === 'Удалён') {
                        skippedDeleted++;
                        continue;
                    }

                    // Находим соответствующий элемент в плане платежей sale.paymentPlan
                    // Логика: ищем первый неоплаченный элемент ИЛИ элемент с похожей суммой/датой
                    // Для простоты найдем первый неоплаченный (isPaid: false)

                    let targetInstallmentIndex = -1;

                    // Попытка найти по сумме (с небольшим допуском) среди неоплаченных
                    const unpaidIndices = sale.paymentPlan
                        .map((p: any, idx: number) => ({ idx, p }))
                        .filter(item => !item.p.isPaid);

                    const match = unpaidIndices.find(item => Math.abs(item.p.amount - amount) < 1.0);

                    if (match) {
                        targetInstallmentIndex = match.idx;
                    } else if (unpaidIndices.length > 0) {
                        // Если суммы не совпадают (клиент платил частями или больше), берем самый старый неоплаченный
                        targetInstallmentIndex = unpaidIndices[0].idx;
                    }

                    if (targetInstallmentIndex !== -1) {
                        // Обновляем запись в плане
                        const installment = sale.paymentPlan[targetInstallmentIndex];
                        installment.isPaid = true;
                        installment.actualDate = parseExcelDate(dateVal);
                        installment.note = `Импорт: ${amount} ₽`;

                        // Если сумма отличается от плановой, можно скорректировать остаток, но пока оставим как есть
                        processedPayments++;
                    } else {
                        // Если все планы оплачены, а платеж еще есть (переплата), можно добавить новый запись в план
                        // Для простоты пока просто логируем
                        // sale.paymentPlan.push({ ...новый платеж... });
                    }
                }

                // 5. Финальный пересчет остатков и сохранение обновленных продаж
                addLog("Этап 3: Сохранение обновленных данных...");

                for (const [key, sale] of createdSalesMap.entries()) {
                    // Пересчитываем оплаченную сумму
                    const totalPaidInPlan = sale.paymentPlan
                        .filter((p: any) => p.isPaid)
                        .reduce((sum: number, p: any) => sum + (p.amount || 0), 0);

                    const currentRemaining = Math.max(0, (sale.totalAmount - sale.downPayment) - totalPaidInPlan);

                    sale.remainingAmount = currentRemaining;

                    // Обновляем статус, если все оплачено
                    if (currentRemaining < 1 && sale.status !== 'COMPLETED') {
                        sale.status = 'COMPLETED';
                    }

                    // Сохраняем изменения в продаже
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
        // Шаблон теперь не нужен, так как мы грузим ваш экспортный формат
        alert("Для импорта используйте файл выгрузки 'экспорт_клиенты_....xlsx', содержащий листы 'Обзор клиентов' и 'История платежей'.");
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
                            <li>Загрузите файл выгрузки системы (с двумя листами).</li>
                            <li>Лист 1: <b>Обзор клиентов</b> (создает товары).</li>
                            <li>Лист 2: <b>История платежей</b> (расставляет даты оплат).</li>
                            <li>Платежи со статусом "Удалён" будут проигнорированы.</li>
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