import React, { useState, useRef } from 'react';
import { api } from '@/services/api';
import { ICONS } from '../constants';
import { Customer, Product, Sale, Account, Investor } from '../types';

// Объявляем тип для глобальной переменной XLSX (на случай использования CDN напрямую)
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

    // ✅ Функция загрузки вынесена внутрь компонента или выше, но ПОСЛЕ импортов
    const getXLSX = async () => {
        try {
            const module = await import('xlsx');
            return module.default || module;
        } catch (error) {
            console.error("Failed to load XLSX dynamically, trying global...", error);
            // Фоллбэк на глобальную переменную из CDN, если динамический импорт не сработал
            if (typeof window !== 'undefined' && (window as any).XLSX) {
                return (window as any).XLSX;
            }
            throw new Error("XLSX library not found");
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setFile(e.target.files[0]);
            setLogs([]);
        }
    };

    const addLog = (msg: string) => {
        setLogs(prev => [...prev, msg]);
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
                // Используем загруженную библиотеку
                const workbook = XLSX_LIB.read(data, { type: 'binary' });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const jsonData: any[] = XLSX_LIB.utils.sheet_to_json(worksheet);

                addLog(`Найдено ${jsonData.length} строк.`);

                const { customers, products, accounts, investors } = await api.fetchAllData();

                let newCustomersCount = 0;
                let newSalesCount = 0;
                let newProductsCount = 0;

                for (const row of jsonData) {
                    const clientName = row['ФИО Клиента'] || row['Client Name'] || row['Name'] || row['Клиент'];
                    const phone = row['Телефон'] || row['Phone'] || row['Mobile'];
                    const productName = row['Товар'] || row['Product'] || row['Item'];
                    const saleDateStr = row['Дата продажи'] || row['Sale Date'] || row['Date'];
                    const price = Number(row['Цена продажи'] || row['Price'] || row['Amount'] || 0);
                    const buyPrice = Number(row['Закупочная цена'] || row['Buy Price'] || row['Cost'] || 0);
                    const downPayment = Number(row['Первоначальный взнос'] || row['Down Payment'] || row['Initial'] || 0);
                    const installments = Number(row['Срок (мес)'] || row['Term'] || row['Months'] || 1);
                    const investorName = row['Инвестор'] || row['Investor'];
                    const totalPaid = Number(row['Оплачено всего'] || row['Total Paid'] || 0);

                    if (!clientName || !productName) {
                        addLog(`Пропуск строки: нет имени клиента или товара.`);
                        continue;
                    }

                    let customer = customers.find(c => c.phone === phone || c.name === clientName);
                    if (!customer) {
                        const newCustomer: Customer = {
                            id: `cust_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                            userId: 'import',
                            name: clientName,
                            phone: phone || '',
                            email: '',
                            address: '',
                            trustScore: 100,
                            notes: 'Imported'
                        };
                        await api.saveItem('customers', newCustomer);
                        customers.push(newCustomer);
                        customer = newCustomer;
                        newCustomersCount++;
                    }

                    let product = products.find(p => p.name === productName);
                    if (!product) {
                         const newProduct: Product = {
                             id: `prod_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                             userId: 'import',
                             name: productName,
                             price: price,
                             category: 'Imported',
                             stock: 1
                         };
                         await api.saveItem('products', newProduct);
                         products.push(newProduct);
                         product = newProduct;
                         newProductsCount++;
                    }

                    let accountId = accounts.find(a => a.type === 'MAIN')?.id || '';
                    if (investorName) {
                        const investor = investors.find(i => i.name === investorName);
                        if (investor) {
                            const invAccount = accounts.find(a => a.ownerId === investor.id);
                            if (invAccount) accountId = invAccount.id;
                        } else {
                            addLog(`Внимание: Инвестор "${investorName}" не найден. Продажа привязана к основному счету.`);
                        }
                    }

                    const saleId = `sale_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                    let startDate = new Date().toISOString();

                    if (saleDateStr) {
                        if (typeof saleDateStr === 'number') {
                            const dateObj = new Date((saleDateStr - (25567 + 2)) * 86400 * 1000);
                             startDate = dateObj.toISOString();
                        } else {
                            const parsed = new Date(saleDateStr);
                            if (!isNaN(parsed.getTime())) startDate = parsed.toISOString();
                        }
                    }

                    const remainingAmount = Math.max(0, price - downPayment);
                    const monthlyPayment = installments > 0 ? remainingAmount / installments : 0;
                    const paymentPlan = [];
                    let paidForInstallments = Math.max(0, totalPaid - downPayment);

                    for (let i = 0; i < installments; i++) {
                        const pDate = new Date(startDate);
                        pDate.setMonth(pDate.getMonth() + 1 + i);

                        let isPaid = false;
                        if (paidForInstallments >= monthlyPayment - 1) {
                            isPaid = true;
                            paidForInstallments -= monthlyPayment;
                        }

                        paymentPlan.push({
                            id: `pay_${saleId}_${i}`,
                            saleId: saleId,
                            amount: Number(monthlyPayment.toFixed(2)),
                            date: pDate.toISOString(),
                            isPaid: isPaid
                        });
                    }

                    const actualRemaining = paymentPlan.filter(p => !p.isPaid).reduce((sum, p) => sum + p.amount, 0);

                    const newSale: Sale = {
                        id: saleId,
                        userId: 'import',
                        customerId: customer.id,
                        productId: product?.id || '',
                        productName: productName,
                        accountId: accountId,
                        buyPrice: buyPrice,
                        totalAmount: price,
                        downPayment: downPayment,
                        remainingAmount: actualRemaining,
                        installments: installments,
                        interestRate: 0,
                        startDate: startDate,
                        status: actualRemaining < 1 ? 'COMPLETED' : 'ACTIVE',
                        type: 'INSTALLMENT',
                        paymentPlan: paymentPlan,
                        paymentDay: new Date(startDate).getDate()
                    };

                    await api.saveItem('sales', newSale);
                    newSalesCount++;
                }

                addLog(`Импорт завершен!`);
                addLog(`Клиентов создано: ${newCustomersCount}`);
                addLog(`Товаров создано: ${newProductsCount}`);
                addLog(`Продаж создано: ${newSalesCount}`);

                setTimeout(() => {
                    setIsProcessing(false);
                    onImportSuccess();
                }, 1500);

            } catch (error) {
                console.error(error);
                addLog("Ошибка при чтении файла. Проверьте формат.");
                setIsProcessing(false);
            }
        };
        reader.readAsBinaryString(file);
    };

    const downloadTemplate = async () => {
        let XLSX_LIB: any;
        try {
            XLSX_LIB = await getXLSX();
        } catch (err) {
            alert("Ошибка загрузки библиотеки Excel");
            return;
        }

        const ws = XLSX_LIB.utils.json_to_sheet([
            {
                'ФИО Клиента': 'Иван Иванов',
                'Телефон': '89990000000',
                'Товар': 'iPhone 15',
                'Дата продажи': '2023-10-01',
                'Цена продажи': 100000,
                'Закупочная цена': 80000,
                'Первоначальный взнос': 20000,
                'Срок (мес)': 10,
                'Инвестор': '',
                'Оплачено всего': 30000
            }
        ]);
        const wb = XLSX_LIB.utils.book_new();
        XLSX_LIB.utils.book_append_sheet(wb, ws, "Template");
        XLSX_LIB.writeFile(wb, "import_template.xlsx");
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
                            <li>Подготовьте файл .xlsx</li>
                            <li>Первая строка должна содержать заголовки</li>
                            <li>Скачайте шаблон для правильного формата</li>
                        </ul>
                        <button onClick={downloadTemplate} className="mt-3 text-indigo-600 underline font-bold hover:text-indigo-800">
                            Скачать шаблон
                        </button>
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
                        <div className="bg-slate-900 text-green-400 p-3 rounded-xl text-xs font-mono h-32 overflow-y-auto">
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