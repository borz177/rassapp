import React, { useState, useEffect } from 'react';
import { api } from '@/services/api';
import { Customer, Sale, Account, Investor, Payment } from '../types';

declare const XLSX: any;

interface DataExportProps {
    onClose: () => void;
}

const DataExport: React.FC<DataExportProps> = ({ onClose }) => {
    const [isProcessing, setIsProcessing] = useState(false);
    const [logs, setLogs] = useState<string[]>([]);

    // 🔧 НОВОЕ: Состояние для выбора "Весь период"
    const [allTime, setAllTime] = useState<boolean>(true); // По умолчанию включено

    const [startDate, setStartDate] = useState<string>("");
    const [endDate, setEndDate] = useState<string>("");

    const [onlyActive, setOnlyActive] = useState<boolean>(false);
    const [includePlanned, setIncludePlanned] = useState<boolean>(false);

    // 🔧 Эффект: при переключении "Весь период" очищаем или восстанавливаем даты
    useEffect(() => {
        if (allTime) {
            setStartDate("");
            setEndDate("");
        } else {
            const today = new Date().toISOString().split('T')[0];
            const firstDay = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
            setStartDate(firstDay);
            setEndDate(today);
        }
    }, [allTime]);

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

    const calculateColumnWidths = (data: any[]): { wch: number }[] => {
        if (!data || data.length === 0) return [];
        const colWidths: Map<string, number> = new Map();
        for (const row of data) {
            for (const [key, value] of Object.entries(row)) {
                const cellValue = value === null || value === undefined ? '' : String(value);
                const currentMax = colWidths.get(key) || key.length;
                const newLen = Math.max(currentMax, cellValue.length);
                colWidths.set(key, newLen);
            }
        }
        return Array.from(colWidths.values()).map(width => ({ wch: Math.min(width + 2, 50) }));
    };

    const processExport = async () => {
        setIsProcessing(true);
        setLogs([]);
        addLog("🚀 Начало подготовки данных...");

        let XLSX_LIB: any;
        try {
            XLSX_LIB = await getXLSX();
            addLog("✅ Библиотека Excel загружена");
        } catch (err) {
            addLog("❌ Ошибка: Не удалось загрузить библиотеку Excel.");
            setIsProcessing(false);
            return;
        }

        try {
            const { customers, sales, investors, accounts } = await api.fetchAllData();
            addLog(`📊 Загружено из базы: Клиентов=${customers.length}, Продаж=${sales.length}`);

            // 🔧 МАГИЯ: Если даты пустые, берем 0 и Infinity (то есть весь период)
            const filterStart = startDate ? new Date(startDate + 'T00:00:00').getTime() : 0;
            const filterEnd = endDate ? new Date(endDate + 'T23:59:59').getTime() : Infinity;

            const overviewData: any[] = [];
            const paymentsData: any[] = [];
            let filteredSalesCount = 0;

            let totalPeriodPayments = 0;
            let totalClientDebt = 0;

            for (const sale of sales) {
                if (onlyActive && sale.status === 'COMPLETED') continue;

                const saleDate = new Date(sale.startDate).getTime();

                // Если saleDate попадает в диапазон (при allTime это всегда true, т.к. 0 <= saleDate <= Infinity)
                if (saleDate < filterStart || saleDate > filterEnd) continue;

                filteredSalesCount++;
                const customer = customers.find(c => c.id === sale.customerId);
                const account = accounts.find(a => a.id === sale.accountId);

                let investor: Investor | undefined;
                if (account?.ownerId) {
                    investor = investors.find(i => i.id === account.ownerId);
                }

                const statusStr = sale.status === 'COMPLETED' ? 'Завершен' : (sale.status === 'DRAFT' ? 'Оформлен' : 'Активен');

                const totalRealPaid = sale.paymentPlan
                    .filter((p: Payment) => p.isRealPayment && p.isPaid)
                    .reduce((sum, p) => sum + (p.amount || 0), 0);

                const currentDebt = Math.max(0, (sale.totalAmount || 0) - (sale.downPayment || 0) - totalRealPaid);
                totalClientDebt += currentDebt;

                overviewData.push({
                    'Клиент': customer?.name || 'Неизвестный клиент',
                    'Товар': sale.productName || '',
                    'Инвестор': investor?.name || '-',
                    'Телефон': customer?.phone || '',
                    'Адрес': customer?.address || '',
                    'Поручитель': sale.guarantorName || '',
                    'Телефон поручителя': sale.guarantorPhone || '',
                    'Цена рассрочки': sale.totalAmount || 0,
                    'Взнос': sale.downPayment || 0,
                    'Остаток долга': currentDebt,
                    'Срок (мес)': sale.installments || 0,
                    'Дата оформления': new Date(sale.startDate).toLocaleDateString('ru-RU'),
                    'Дата первого платежа': sale.paymentPlan && sale.paymentPlan.length > 0
                        ? new Date(sale.paymentPlan[0].date).toLocaleDateString('ru-RU')
                        : '',
                    'Статус': statusStr
                });

                let paymentsToExport = sale.paymentPlan?.filter((p: Payment) => p.isRealPayment) || [];
                if (includePlanned) {
                    paymentsToExport = sale.paymentPlan || [];
                }

                paymentsToExport = paymentsToExport.filter((p: Payment) => {
                    const pDate = new Date(p.date).getTime();
                    return pDate >= filterStart && pDate <= filterEnd;
                });

                if (paymentsToExport.length === 0) {
                    paymentsData.push({
                        'Клиент': customer?.name || 'Неизвестный клиент',
                        'Товар': sale.productName || '',
                        'Статус товара': statusStr,
                        'Сумма': 0,
                        'Дата платежа': '',
                        'Платёж': 'Нет платежей в периоде'
                    });
                } else {
                    for (const payment of paymentsToExport) {
                        if (payment.isRealPayment && payment.isPaid) {
                            totalPeriodPayments += payment.amount || 0;
                        }

                        paymentsData.push({
                            'Клиент': customer?.name || 'Неизвестный клиент',
                            'Товар': sale.productName || '',
                            'Статус товара': statusStr,
                            'Сумма': payment.amount || 0,
                            'Дата платежа': new Date(payment.date).toLocaleDateString('ru-RU'),
                            'Платёж': payment.note || (payment.isRealPayment ? 'Оплата' : 'План')
                        });
                    }
                }
            }

            if (filteredSalesCount === 0) {
                addLog("⚠️ Внимание: За выбранный период данных не найдено.");
                setIsProcessing(false);
                return;
            }

            paymentsData.push({});
            paymentsData.push({
                'Клиент': 'ИТОГО:',
                'Товар': `Продаж: ${filteredSalesCount}`,
                'Статус товара': '',
                'Сумма': totalPeriodPayments,
                'Дата платежа': '',
                'Платёж': ''
            });

            // 🔧 Адаптивный текст для сводки
            const periodText = allTime
                ? 'Весь период (с начала работы)'
                : `${new Date(filterStart).toLocaleDateString('ru-RU')} — ${new Date(filterEnd).toLocaleDateString('ru-RU')}`;

            const summaryData = [
                { 'Параметр': '📅 Период выгрузки', 'Значение': periodText },
                { 'Параметр': '', 'Значение': '' },
                { 'Параметр': '💳 Получено платежей', 'Значение': `${totalPeriodPayments.toLocaleString('ru-RU')} ₽` },
                { 'Параметр': '📉 Общий долг клиентов', 'Значение': `${totalClientDebt.toLocaleString('ru-RU')} ₽` },
                { 'Параметр': '', 'Значение': '' },
                { 'Параметр': '🕐 Дата формирования', 'Значение': new Date().toLocaleString('ru-RU') }
            ];

            addLog(`📝 Формирование листов Excel...`);
            addLog(`   - Найдено продаж: ${filteredSalesCount}`);

            const wb = XLSX_LIB.utils.book_new();

            const ws1 = XLSX_LIB.utils.json_to_sheet(overviewData);
            ws1['!cols'] = calculateColumnWidths(overviewData);
            ws1['!views'] = [{ state: 'frozen', ySplit: 1 }];
            ws1['!autofilter'] = { ref: `A1:${XLSX_LIB.utils.encode_col(overviewData[0] ? Object.keys(overviewData[0]).length - 1 : 0)}1` };
            XLSX_LIB.utils.book_append_sheet(wb, ws1, "Обзор клиентов");

            const ws2 = XLSX_LIB.utils.json_to_sheet(paymentsData);
            ws2['!cols'] = calculateColumnWidths(paymentsData);
            ws2['!views'] = [{ state: 'frozen', ySplit: 1 }];
            ws2['!autofilter'] = { ref: `A1:${XLSX_LIB.utils.encode_col(paymentsData[0] ? Object.keys(paymentsData[0]).length - 1 : 0)}1` };
            XLSX_LIB.utils.book_append_sheet(wb, ws2, "История платежей");

            const ws3 = XLSX_LIB.utils.json_to_sheet(summaryData);
            ws3['!cols'] = [{ wch: 45 }, { wch: 40 }];
            XLSX_LIB.utils.book_append_sheet(wb, ws3, "Сводка");

            const fileName = allTime
                ? `Export_All_Time_${new Date().toISOString().slice(0, 10)}.xlsx`
                : `Export_${startDate}_to_${endDate}.xlsx`;

            XLSX_LIB.writeFile(wb, fileName);

            addLog(`✅ Файл "${fileName}" успешно скачан!`);

        } catch (error: any) {
            console.error("Export error:", error);
            addLog(`❌ Ошибка при экспорте: ${error.message || String(error)}`);
        } finally {
            setTimeout(() => setIsProcessing(false), 1000);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in" onClick={onClose}>
            <div className="bg-white dark:bg-slate-800 w-full max-w-lg rounded-2xl shadow-2xl p-6 space-y-5 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-700 pb-4">
                    <h3 className="text-xl font-bold text-slate-800 dark:text-white">Экспорт данных в Excel</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-2xl">✕</button>
                </div>

                <div className="space-y-4">
                    <div className="bg-slate-50 dark:bg-slate-700/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3">
                        <h4 className="font-bold text-slate-700 dark:text-slate-300 text-sm">⚙️ Настройки выгрузки</h4>

                        {/* 🔧 НОВОЕ: Переключатель "Весь период" */}
                        <label className="flex items-center space-x-2 cursor-pointer bg-white dark:bg-slate-800 p-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-800 transition-colors">
                            <input
                                type="checkbox"
                                checked={allTime}
                                onChange={(e) => setAllTime(e.target.checked)}
                                className="w-4 h-4 text-indigo-600 rounded border-slate-300 dark:border-slate-600 focus:ring-indigo-500"
                            />
                            <span className="text-sm font-medium text-slate-800 dark:text-white">Выгрузить за весь период</span>
                        </label>

                        {/* Блок дат: блокируется, если выбран "Весь период" */}
                        <div className={`grid grid-cols-2 gap-3 transition-all duration-300 ${allTime ? 'opacity-40 pointer-events-none grayscale' : ''}`}>
                            <div>
                                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Дата с</label>
                                <input
                                    type="date"
                                    value={startDate}
                                    onChange={(e) => setStartDate(e.target.value)}
                                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Дата по</label>
                                <input
                                    type="date"
                                    value={endDate}
                                    onChange={(e) => setEndDate(e.target.value)}
                                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                />
                            </div>
                        </div>

                        <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                            <label className="flex items-center space-x-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={onlyActive}
                                    onChange={(e) => setOnlyActive(e.target.checked)}
                                    className="w-4 h-4 text-indigo-600 rounded border-slate-300 dark:border-slate-600 focus:ring-indigo-500"
                                />
                                <span className="text-sm text-slate-700 dark:text-slate-300">Только активные продажи</span>
                            </label>

                        </div>
                    </div>

                    <div className="bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-100 dark:border-emerald-900/50 rounded-xl p-3 text-xs text-emerald-800 dark:text-emerald-400">
                        <p className="font-bold mb-1">📋 Файл будет содержать 3 листа:</p>
                        <ul className="list-disc list-inside space-y-0.5">
                            <li><b>Обзор клиентов</b> — продажи с точным остатком долга</li>
                            <li><b>История платежей</b> — оплаты + итого</li>
                            <li><b>Сводка</b> — поступления и общий долг</li>
                        </ul>
                    </div>

                    {logs.length > 0 && (
                        <div className="bg-slate-900 text-green-400 p-3 rounded-xl text-[10px] font-mono h-32 overflow-y-auto">
                            {logs.map((log, i) => <div key={i}>{log}</div>)}
                        </div>
                    )}

                    <div className="flex gap-3 pt-2">
                        <button
                            onClick={onClose}
                            className="flex-1 py-3 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-xl hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors text-sm"
                        >
                            Отмена
                        </button>
                        <button
                            onClick={processExport}
                            disabled={isProcessing}
                            className="flex-[2] py-3 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-emerald-200 transition-all text-sm flex items-center justify-center gap-2"
                        >
                            {isProcessing ? (
                                <>
                                    <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    Обработка...
                                </>
                            ) : (
                                <>📥 Скачать Excel</>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default DataExport;