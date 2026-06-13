import React, { useState } from 'react';
import { api } from '@/services/api';
import { Customer, Sale, Account, Investor, Payment } from '../types';

declare const XLSX: any;

interface DataExportProps {
    onClose: () => void;
}

const DataExport: React.FC<DataExportProps> = ({ onClose }) => {
    const [isProcessing, setIsProcessing] = useState(false);
    const [logs, setLogs] = useState<string[]>([]);

    const today = new Date().toISOString().split('T')[0];
    const firstDayOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];

    const [startDate, setStartDate] = useState<string>(firstDayOfMonth);
    const [endDate, setEndDate] = useState<string>(today);
    const [onlyActive, setOnlyActive] = useState<boolean>(false);
    const [includePlanned, setIncludePlanned] = useState<boolean>(false);

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

    // 🔧 НОВАЯ ФУНКЦИЯ: Автоматический расчёт ширины колонок
    const calculateColumnWidths = (data: any[]): { wch: number }[] => {
        if (!data || data.length === 0) return [];

        const colWidths: Map<string, number> = new Map();

        // Проходим по всем строкам и считаем максимальную длину для каждой колонки
        for (const row of data) {
            for (const [key, value] of Object.entries(row)) {
                const cellValue = value === null || value === undefined ? '' : String(value);
                // Берём максимум из текущей ширины и длины значения
                const currentMax = colWidths.get(key) || key.length; // Учитываем и длину заголовка
                const newLen = Math.max(currentMax, cellValue.length);
                colWidths.set(key, newLen);
            }
        }

        // Преобразуем в массив с небольшим отступом (+2 символа)
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

            const filterStart = startDate ? new Date(startDate + 'T00:00:00').getTime() : 0;
            const filterEnd = endDate ? new Date(endDate + 'T23:59:59').getTime() : Infinity;

            const overviewData: any[] = [];
            const paymentsData: any[] = [];
            let filteredSalesCount = 0;

            // 🔧 НОВОЕ: Счётчики для сводки
            let totalSalesAmount = 0;
            let totalBuyPrice = 0;
            let totalDownPayment = 0;
            let totalPeriodPayments = 0;
            let totalDebt = 0;

            for (const sale of sales) {
                if (onlyActive && sale.status === 'COMPLETED') continue;

                const saleDate = new Date(sale.startDate).getTime();
                if (saleDate < filterStart || saleDate > filterEnd) continue;

                filteredSalesCount++;
                const customer = customers.find(c => c.id === sale.customerId);
                const account = accounts.find(a => a.id === sale.accountId);

                // Универсальный поиск инвестора через ownerId
                let investor: Investor | undefined;
                if (account?.ownerId) {
                    investor = investors.find(i => i.id === account.ownerId);
                }

                const statusStr = sale.status === 'COMPLETED' ? 'Завершен' : (sale.status === 'DRAFT' ? 'Оформлен' : 'Активен');

                // 🔧 Считаем суммы для сводки
                totalSalesAmount += sale.totalAmount || 0;
                totalBuyPrice += sale.buyPrice || 0;
                totalDownPayment += sale.downPayment || 0;

                // === ЛИСТ 1: Обзор клиентов (БЕЗ email/телефона/процента инвестора) ===
                overviewData.push({
                    'Клиент': customer?.name || 'Неизвестный клиент',
                    'Товар': sale.productName || '',
                    'Инвестор': investor?.name || '-',
                    'Телефон': customer?.phone || '',
                    'Адрес': customer?.address || '',
                    'Поручитель': sale.guarantorName || '',
                    'Телефон поручителя': sale.guarantorPhone || '',
                    'Цена закупа': sale.buyPrice || 0,
                    'Цена рассрочки': sale.totalAmount || 0,
                    'Взнос': sale.downPayment || 0,
                    'Остаток долга': Math.max(0, (sale.totalAmount || 0) - (sale.downPayment || 0) - (sale.remainingAmount || 0)),
                    'Срок (мес)': sale.installments || 0,
                    'Дата оформления': new Date(sale.startDate).toLocaleDateString('ru-RU'),
                    'Дата первого платежа': sale.paymentPlan && sale.paymentPlan.length > 0
                        ? new Date(sale.paymentPlan[0].date).toLocaleDateString('ru-RU')
                        : '',
                    'Статус': statusStr
                });

                // === ЛИСТ 2: История платежей (БЕЗ статуса платежа) ===
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
                        // 🔧 Считаем сумму платежей за период
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
                addLog("💡 Попробуйте расширить диапазон дат или снять галочку 'Только активные'.");
                setIsProcessing(false);
                return;
            }

            // 🔧 НОВОЕ: Итоговая строка в истории платежей
            paymentsData.push({}); // Пустая строка-разделитель
            paymentsData.push({
                'Клиент': 'ИТОГО ЗА ПЕРИОД:',
                'Товар': `Продаж: ${filteredSalesCount}`,
                'Статус товара': '',
                'Сумма': totalPeriodPayments,
                'Дата платежа': '',
                'Платёж': ''
            });

            // 🔧 НОВОЕ: Лист "Сводка"
            const summaryData = [
                { 'Параметр': '📅 Период выгрузки', 'Значение': `${new Date(filterStart).toLocaleDateString('ru-RU')} — ${new Date(filterEnd).toLocaleDateString('ru-RU')}` },
                { 'Параметр': '', 'Значение': '' },
                { 'Параметр': '📦 Всего продаж', 'Значение': filteredSalesCount },
                { 'Параметр': '💰 Общая сумма рассрочки', 'Значение': `${totalSalesAmount.toLocaleString('ru-RU')} ₽` },
                { 'Параметр': '🏷️ Общая сумма закупок', 'Значение': `${totalBuyPrice.toLocaleString('ru-RU')} ₽` },
                { 'Параметр': '💵 Сумма первоначальных взносов', 'Значение': `${totalDownPayment.toLocaleString('ru-RU')} ₽` },
                { 'Параметр': '💳 Получено платежей за период', 'Значение': `${totalPeriodPayments.toLocaleString('ru-RU')} ₽` },
                { 'Параметр': '', 'Значение': '' },
                { 'Параметр': '📊 Средний чек продажи', 'Значение': `${filteredSalesCount > 0 ? (totalSalesAmount / filteredSalesCount).toLocaleString('ru-RU') : 0} ₽` },
                { 'Параметр': '📈 Средний платёж', 'Значение': `${totalPeriodPayments.toLocaleString('ru-RU')} ₽` },
                { 'Параметр': '', 'Значение': '' },
                { 'Параметр': '🕐 Дата формирования', 'Значение': new Date().toLocaleString('ru-RU') },
                { 'Параметр': '⚙️ Режим', 'Значение': `${onlyActive ? 'Только активные' : 'Все продажи'}${includePlanned ? ' + плановые платежи' : ''}` }
            ];

            addLog(`📝 Формирование листов Excel...`);
            addLog(`   - "Обзор клиентов": ${overviewData.length} записей`);
            addLog(`   - "История платежей": ${paymentsData.length} записей`);
            addLog(`   - "Сводка": ${summaryData.length} строк`);

            const wb = XLSX_LIB.utils.book_new();

            // === ЛИСТ 1: Обзор клиентов ===
            const ws1 = XLSX_LIB.utils.json_to_sheet(overviewData);
            ws1['!cols'] = calculateColumnWidths(overviewData);
            ws1['!views'] = [{ state: 'frozen', ySplit: 1 }]; // Закрепляем шапку
            ws1['!autofilter'] = { ref: `A1:${XLSX_LIB.utils.encode_col(overviewData[0] ? Object.keys(overviewData[0]).length - 1 : 0)}1` };
            XLSX_LIB.utils.book_append_sheet(wb, ws1, "Обзор клиентов");

            // === ЛИСТ 2: История платежей ===
            const ws2 = XLSX_LIB.utils.json_to_sheet(paymentsData);
            ws2['!cols'] = calculateColumnWidths(paymentsData);
            ws2['!views'] = [{ state: 'frozen', ySplit: 1 }];
            ws2['!autofilter'] = { ref: `A1:${XLSX_LIB.utils.encode_col(paymentsData[0] ? Object.keys(paymentsData[0]).length - 1 : 0)}1` };
            XLSX_LIB.utils.book_append_sheet(wb, ws2, "История платежей");

            // === ЛИСТ 3: Сводка ===
            const ws3 = XLSX_LIB.utils.json_to_sheet(summaryData);
            ws3['!cols'] = [{ wch: 35 }, { wch: 40 }];
            XLSX_LIB.utils.book_append_sheet(wb, ws3, "Сводка");

            const fileName = `Export_${startDate}_to_${endDate}.xlsx`;
            XLSX_LIB.writeFile(wb, fileName);

            addLog(`✅ Файл "${fileName}" успешно скачан!`);
            addLog(`📈 Итого: ${filteredSalesCount} продаж на ${totalSalesAmount.toLocaleString('ru-RU')} ₽`);
            addLog(`💳 Получено платежей за период: ${totalPeriodPayments.toLocaleString('ru-RU')} ₽`);

        } catch (error: any) {
            console.error("Export error:", error);
            addLog(`❌ Ошибка при экспорте: ${error.message || String(error)}`);
        } finally {
            setTimeout(() => setIsProcessing(false), 1000);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in" onClick={onClose}>
            <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl p-6 space-y-5 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center border-b border-slate-100 pb-4">
                    <h3 className="text-xl font-bold text-slate-800">Экспорт данных в Excel</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl">✕</button>
                </div>

                <div className="space-y-4">
                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                        <h4 className="font-bold text-slate-700 text-sm">⚙️ Настройки выгрузки</h4>

                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs font-medium text-slate-500 mb-1">Дата с</label>
                                <input
                                    type="date"
                                    value={startDate}
                                    onChange={(e) => setStartDate(e.target.value)}
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-500 mb-1">Дата по</label>
                                <input
                                    type="date"
                                    value={endDate}
                                    onChange={(e) => setEndDate(e.target.value)}
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                />
                            </div>
                        </div>

                        <div className="space-y-2 pt-2 border-t border-slate-200">
                            <label className="flex items-center space-x-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={onlyActive}
                                    onChange={(e) => setOnlyActive(e.target.checked)}
                                    className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                                />
                                <span className="text-sm text-slate-700">Только активные продажи</span>
                            </label>
                            <label className="flex items-center space-x-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={includePlanned}
                                    onChange={(e) => setIncludePlanned(e.target.checked)}
                                    className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                                />
                                <span className="text-sm text-slate-700">Включить плановые платежи <span className="text-xs text-slate-400">(для бэкапа)</span></span>
                            </label>
                        </div>
                    </div>

                    <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 text-xs text-emerald-800">
                        <p className="font-bold mb-1">📋 Файл будет содержать 3 листа:</p>
                        <ul className="list-disc list-inside space-y-0.5">
                            <li><b>Обзор клиентов</b> — все продажи с контактами</li>
                            <li><b>История платежей</b> — оплаты за период + итого</li>
                            <li><b>Сводка</b> — общая статистика</li>
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
                            className="flex-1 py-3 bg-slate-100 text-slate-700 font-bold rounded-xl hover:bg-slate-200 transition-colors text-sm"
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