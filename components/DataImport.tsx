import React, { useState, useRef } from 'react';
import { api } from '@/services/api';
import { Customer, Sale, Payment, User } from '../types';
import * as XLSX from 'xlsx';

interface DataImportProps {
    onClose: () => void;
    onImportSuccess: () => void;
}

const DataImport: React.FC<DataImportProps> = ({ onClose, onImportSuccess }) => {
    const [file, setFile] = useState<File | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [logs, setLogs] = useState<string[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const addLog = (msg: string) => setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);

    const parseMoney = (val: any): number => {
        if (typeof val === 'number') return val;
        const str = String(val || '0').replace(/[^\d.,-]/g, '').replace(',', '.');
        return parseFloat(str) || 0;
    };

    // Хелпер для получения даты из Excel (учитывая разные форматы)
    const formatDate = (val: any): string => {
        if (val instanceof Date) return val.toISOString();
        if (typeof val === 'number') {
            const date = XLSX.SSF.parse_date_code(val);
            return new Date(date.y, date.m - 1, date.d).toISOString();
        }
        const d = new Date(val);
        return !isNaN(d.getTime()) ? d.toISOString() : new Date().toISOString();
    };

    const processImport = async () => {
        if (!file) return;
        setIsProcessing(true);
        setLogs([]);
        addLog("🚀 Начинаю импорт данных...");

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = e.target?.result;
                const workbook = XLSX.read(data, { type: 'binary', cellDates: true });

                const sheetOverview = workbook.Sheets["Обзор клиентов"];
                const sheetPayments = workbook.Sheets["История платежей"];

                if (!sheetOverview) throw new Error("Лист 'Обзор клиентов' не найден");

                const overviewData: any[] = XLSX.utils.sheet_to_json(sheetOverview, { defval: "" });
                const paymentsData: any[] = sheetPayments ? XLSX.utils.sheet_to_json(sheetPayments, { defval: "" }) : [];

                const me = await api.getMe();
                const userId = me.id;
                const existing = await api.fetchAllData();

                const customersToSave: Customer[] = [];
                const salesToSave: Sale[] = [];

                addLog(`Найдено договоров: ${overviewData.length}. Найдено оплат: ${paymentsData.length}.`);

                for (const row of overviewData) {
                    const clientName = String(row['Клиент'] || '').trim();
                    const productName = String(row['Товар'] || '').trim();
                    if (!clientName || !productName) continue;

                    // 1. КЛИЕНТ
                    let customer = existing.customers.find(c => c.name === clientName) ||
                                   customersToSave.find(c => c.name === clientName);

                    if (!customer) {
                        customer = {
                            id: `cust_${Math.random().toString(36).substr(2, 9)}`,
                            userId,
                            name: clientName,
                            phone: String(row['Телефон'] || ''),
                            email: '',
                            trustScore: 100,
                            notes: 'Импорт из Excel',
                            allowWhatsappNotification: true
                        };
                        customersToSave.push(customer);
                    }

                    // 2. ДОГОВОР
                    const totalAmount = parseMoney(row['Цена рассрочки']);
                    const downPayment = parseMoney(row['Взнос']);
                    const installments = Number(row['Срок (мес)']) || 1;
                    const startDate = formatDate(row['Дата оформления']);
                    const saleId = `sale_${Math.random().toString(36).substr(2, 9)}`;

                    // 3. ОБРАБОТКА ПЛАТЕЖЕЙ СО ВТОРОЙ СТРАНИЦЫ (Фактические оплаты)
                    const historyRows = paymentsData.filter(p =>
                        String(p['Клиент']).trim() === clientName &&
                        String(p['Товар']).trim() === productName
                    );

                    const finalPaymentPlan: Payment[] = [];
                    let totalPaidAmount = 0;

                    // Добавляем фактические платежи из истории
                    historyRows.forEach((hp, index) => {
                        const amount = parseMoney(hp['Сумма']);
                        const actualDate = formatDate(hp['Дата платежа']);
                        totalPaidAmount += amount;

                        finalPaymentPlan.push({
                            id: `pay_hist_${saleId}_${index}`,
                            saleId: saleId,
                            amount: amount,
                            date: actualDate, // ТУТ ИСПОЛЬЗУЕТСЯ ДАТА ИЗ EXCEL
                            isPaid: true
                        });
                    });

                    // 4. ГЕНЕРАЦИЯ БУДУЩИХ ПЛАТЕЖЕЙ (Если еще не всё оплачено)
                    const remainingToPlan = totalAmount - downPayment - totalPaidAmount;

                    // Если остался долг, создаем плановые платежи на будущие месяцы
                    if (remainingToPlan > 0) {
                        const monthlyAmount = remainingToPlan / installments;
                        const lastHistDate = historyRows.length > 0
                            ? new Date(formatDate(historyRows[historyRows.length - 1]['Дата платежа']))
                            : new Date(startDate);

                        for (let i = 1; i <= installments; i++) {
                            const pDate = new Date(lastHistDate);
                            pDate.setMonth(pDate.getMonth() + i);

                            finalPaymentPlan.push({
                                id: `pay_plan_${saleId}_${i}`,
                                saleId: saleId,
                                amount: Number(monthlyAmount.toFixed(2)),
                                date: pDate.toISOString(),
                                isPaid: false
                            });
                        }
                    }

                    // Сортируем все платежи по дате
                    finalPaymentPlan.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

                    const newSale: Sale = {
                        id: saleId,
                        userId,
                        type: 'INSTALLMENT',
                        customerId: customer.id,
                        productName: productName,
                        buyPrice: parseMoney(row['Цена закупа']),
                        totalAmount: totalAmount,
                        downPayment: downPayment,
                        remainingAmount: Math.max(0, totalAmount - downPayment - totalPaidAmount),
                        interestRate: 0,
                        installments: installments,
                        startDate: startDate,
                        status: (totalAmount - downPayment - totalPaidAmount) <= 1 ? 'COMPLETED' : 'ACTIVE',
                        accountId: 'MAIN',
                        paymentPlan: finalPaymentPlan
                    };

                    salesToSave.push(newSale);
                }

                // 5. СОХРАНЕНИЕ В БАЗУ
                addLog(`Сохраняю клиентов...`);
                for (const c of customersToSave) await api.saveItem('customers', c);

                addLog(`Сохраняю договоры и историю платежей...`);
                for (const s of salesToSave) await api.saveItem('sales', s);

                addLog("✅ Данные успешно импортированы!");
                onImportSuccess();
                setTimeout(() => setIsProcessing(false), 1000);

            } catch (err: any) {
                addLog(`❌ Ошибка: ${err.message}`);
                setIsProcessing(false);
            }
        };
        reader.readAsBinaryString(file);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl p-6 space-y-4" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center border-b pb-2">
                    <h3 className="text-xl font-bold">Импорт с историей дат</h3>
                    <button onClick={onClose} className="text-slate-400">✕</button>
                </div>

                <div
                    className="border-2 border-dashed border-indigo-200 rounded-xl p-10 text-center cursor-pointer hover:bg-indigo-50 transition-colors"
                    onClick={() => fileInputRef.current?.click()}
                >
                    <input type="file" ref={fileInputRef} onChange={(e) => setFile(e.target.files?.[0] || null)} hidden accept=".xlsx" />
                    <div className="text-4xl mb-2">📊</div>
                    <p className="text-sm text-slate-600">{file ? file.name : "Нажмите, чтобы выбрать файл Excel"}</p>
                </div>

                {logs.length > 0 && (
                    <div className="bg-slate-900 text-green-400 p-3 rounded-lg text-xs font-mono h-48 overflow-y-auto">
                        {logs.map((log, i) => <div key={i}>{log}</div>)}
                    </div>
                )}

                <button
                    onClick={processImport}
                    disabled={!file || isProcessing}
                    className="w-full py-4 bg-indigo-600 text-white rounded-xl font-bold shadow-lg shadow-indigo-100 disabled:bg-slate-300"
                >
                    {isProcessing ? "Обработка данных..." : "Начать загрузку"}
                </button>
            </div>
        </div>
    );
};

export default DataImport;