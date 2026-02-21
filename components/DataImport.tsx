import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { api } from '../services/api';
import { ICONS } from '../constants';
import { Customer, Product, Sale, Account, Investor } from '../types';

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

    const processImport = async () => {
        if (!file) return;
        setIsProcessing(true);
        addLog("Начало обработки файла...");

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = e.target?.result;
                const workbook = XLSX.read(data, { type: 'binary' });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const jsonData: any[] = XLSX.utils.sheet_to_json(worksheet);

                addLog(`Найдено ${jsonData.length} строк.`);

                // Fetch existing data to avoid duplicates
                const { customers, products, accounts, investors } = await api.fetchAllData();

                let newCustomersCount = 0;
                let newSalesCount = 0;
                let newProductsCount = 0;

                for (const row of jsonData) {
                    // 1. Extract Fields (Flexible mapping)
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

                    // 2. Find or Create Customer
                    let customer = customers.find(c => c.phone === phone || c.name === clientName);
                    if (!customer) {
                        const newCustomer: Customer = {
                            id: `cust_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                            userId: 'import',
                            name: clientName,
                            phone: phone || '',
                            address: '',
                            notes: 'Imported'
                        };
                        await api.saveItem('customers', newCustomer);
                        customers.push(newCustomer);
                        customer = newCustomer;
                        newCustomersCount++;
                    }

                    // 3. Find or Create Product (Optional, just for reference)
                    // We don't strictly need a product ID for a sale, but good to have
                    let product = products.find(p => p.name === productName);
                    if (!product) {
                         // Create dummy product
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

                    // 4. Handle Investor / Account
                    let accountId = accounts.find(a => a.type === 'MAIN')?.id || '';
                    if (investorName) {
                        // Try to find investor account
                        const investor = investors.find(i => i.name === investorName);
                        if (investor) {
                            const invAccount = accounts.find(a => a.ownerId === investor.id);
                            if (invAccount) accountId = invAccount.id;
                        } else {
                            // If investor doesn't exist, we might skip creating them automatically to avoid mess,
                            // or default to Main account and log warning.
                            addLog(`Внимание: Инвестор "${investorName}" не найден. Продажа привязана к основному счету.`);
                        }
                    }

                    // 5. Create Sale
                    const saleId = `sale_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

                    // Parse Date
                    let startDate = new Date().toISOString();
                    if (saleDateStr) {
                        // Handle Excel serial date or string
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

                    // Generate Payment Plan
                    const paymentPlan = [];
                    let paidSoFar = 0;

                    // If "Total Paid" is provided (excluding down payment), we mark installments as paid
                    // Usually "Total Paid" in exports includes down payment. Let's assume it DOES.
                    // So paidForInstallments = TotalPaid - DownPayment
                    let paidForInstallments = Math.max(0, totalPaid - downPayment);

                    for (let i = 0; i < installments; i++) {
                        const pDate = new Date(startDate);
                        pDate.setMonth(pDate.getMonth() + 1 + i); // First payment usually next month

                        let isPaid = false;
                        if (paidForInstallments >= monthlyPayment - 1) { // Tolerance for rounding
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

                    // Recalculate remaining based on plan
                    const actualRemaining = paymentPlan.filter(p => !p.isPaid).reduce((sum, p) => sum + p.amount, 0);

                    const newSale: Sale = {
                        id: saleId,
                        userId: 'import',
                        customerId: customer.id,
                        productId: product?.id || '',
                        productName: productName,
                        accountId: accountId,
                        buyPrice: buyPrice,
                        price: price, // Legacy field
                        totalAmount: price,
                        downPayment: downPayment,
                        remainingAmount: actualRemaining,
                        installments: installments,
                        interestRate: 0, // Hard to calc, set 0
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

    const downloadTemplate = () => {
        const ws = XLSX.utils.json_to_sheet([
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
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Template");
        XLSX.writeFile(wb, "import_template.xlsx");
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
