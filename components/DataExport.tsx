import React, { useState, useEffect } from 'react';
import { api } from '@/services/api';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
// @ts-ignore — общий JS-модуль без типов, используется и сервером (server/index.js)
import { buildExcelReport } from '../shared/excelReport.js';

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

    const base64ToBlob = (base64: string): Blob => {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
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
            const data = await api.fetchAllData();
            addLog(`📊 Загружено из базы: Клиентов=${data.customers.length}, Продаж=${data.sales.length}`);

            // Сборка книги живёт в shared/excelReport.js — тот же модуль использует
            // планировщик резервного копирования на сервере, чтобы файл из письма
            // и файл из этой кнопки не разъезжались.
            const { base64, salesCount } = buildExcelReport(XLSX_LIB, data, {
                startDate: allTime ? undefined : startDate,
                endDate: allTime ? undefined : endDate,
                onlyActive,
                includePlanned,
            });

            if (!base64) {
                addLog("⚠️ Внимание: За выбранный период данных не найдено.");
                setIsProcessing(false);
                return;
            }

            addLog(`📝 Файл сформирован. Продаж: ${salesCount}`);

            const fileName = allTime
                ? `Export_All_Time_${new Date().toISOString().slice(0, 10)}.xlsx`
                : `Export_${startDate}_to_${endDate}.xlsx`;

            const base64Data = base64;

            // 🔹 В нативном Android/iOS-приложении (Capacitor WebView) обычный браузерный
            // download через <a download> / blob-ссылку не срабатывает — WebView не умеет
            // сохранять его на устройство. Поэтому пишем файл через Filesystem-плагин и
            // открываем системный диалог "Поделиться/Сохранить".
            if (Capacitor.isNativePlatform()) {
                addLog("📱 Сохранение файла на устройство...");
                const saved = await Filesystem.writeFile({
                    path: fileName,
                    data: base64Data,
                    directory: Directory.Cache,
                });
                await Share.share({
                    title: fileName,
                    text: 'Экспорт данных FinUchet',
                    url: saved.uri,
                    dialogTitle: 'Сохранить или отправить файл',
                });
                addLog(`✅ Файл "${fileName}" готов — выберите, куда сохранить или кому отправить.`);
            } else {
                const url = URL.createObjectURL(base64ToBlob(base64Data));
                const link = document.createElement('a');
                link.href = url;
                link.download = fileName;
                link.click();
                URL.revokeObjectURL(url);
                addLog(`✅ Файл "${fileName}" успешно скачан!`);
            }

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
                        <p className="font-bold mb-1">📋 Файл будет содержать 4 листа:</p>
                        <ul className="list-disc list-inside space-y-0.5">
                            <li><b>Обзор клиентов</b> — закуп, цена, прибыль, долг, просрочка</li>
                            <li><b>История платежей</b> — оплаты + итого</li>
                            <li><b>По инвесторам</b> — итоги по каждому инвестору</li>
                            <li><b>Сводка</b> — поступления, долг и прибыль</li>
                        </ul>
                        <p className="mt-1.5 opacity-80">💡 Клик по имени клиента открывает его платежи, клик обратно — карточку продажи.</p>
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