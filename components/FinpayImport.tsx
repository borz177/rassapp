import React, { useEffect, useMemo, useState } from 'react';
import { api } from '@/services/api';
import { Account } from '../types';
import { FinpayExport, analyzeFinpay, buildFinpayRecords } from '../src/finpayImport';

interface FinpayImportProps {
    data: FinpayExport;
    currentUserId: string;
    onDone: () => void;
}

const NEW_ACCOUNT = '__new__';
const money = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`;

// Записи уходят по одной (generic /api/data/:type), но параллельно — иначе
// полторы тысячи запросов шли бы несколько минут
const runPool = async <T,>(items: T[], worker: (item: T) => Promise<void>, onStep: () => void, size = 5) => {
    let next = 0;
    const lane = async () => {
        while (next < items.length) {
            const item = items[next++];
            await worker(item);
            onStep();
        }
    };
    await Promise.all(Array.from({ length: Math.min(size, items.length) }, lane));
};

const FinpayImport: React.FC<FinpayImportProps> = ({ data, currentUserId, onDone }) => {
    const analysis = useMemo(() => analyzeFinpay(data), [data]);
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [existing, setExisting] = useState<{ customers: Set<string>; sales: Set<string>; expenses: Set<string> } | null>(null);
    const [accountMap, setAccountMap] = useState<Record<string, string>>({});
    const [withPurchase, setWithPurchase] = useState(true);
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState({ done: 0, total: 0 });
    const [logs, setLogs] = useState<string[]>([]);
    const addLog = (msg: string) => setLogs(prev => [...prev, msg]);

    useEffect(() => {
        api.fetchAllData().then((all: any) => {
            const list: Account[] = (all.accounts || []).filter((a: Account) => !a.isArchived);
            setAccounts(list);
            setExisting({
                customers: new Set((all.customers || []).map((c: any) => c.id)),
                sales: new Set((all.sales || []).map((s: any) => s.id)),
                expenses: new Set((all.expenses || []).map((e: any) => e.id)),
            });
            // По умолчанию каждому счёту FinPay — свой новый счёт (переименовать можно потом)
            const initial: Record<string, string> = {};
            analysis.fundingAccounts.forEach(f => { initial[f.id] = NEW_ACCOUNT; });
            setAccountMap(initial);
        }).catch(e => addLog(`❌ Не удалось загрузить ваши данные: ${e.message || e}`));
    }, [analysis]);

    const alreadyImported = existing
        ? data.installments.filter(i => existing.sales.has(`finpay_${i.id}`)).length
        : 0;

    const runImport = async () => {
        if (!existing) return;
        setBusy(true);
        setLogs([]);
        try {
            // 1. Новые счета — по одному на каждый счёт FinPay, отмеченный «Создать новый»
            const map = { ...accountMap };
            let n = 0;
            for (const f of analysis.fundingAccounts) {
                if (map[f.id] !== NEW_ACCOUNT) continue;
                n++;
                const acc: Account = {
                    id: `acc_finpay_${f.id}`,
                    userId: currentUserId,
                    name: `FinUchet: счёт ${n}`,
                    type: 'CUSTOM',
                    balance: 0,
                    currency: 'RUB',
                    isArchived: false,
                };
                await api.saveItem('accounts', acc);
                map[f.id] = acc.id;
                addLog(`➕ Счёт «${acc.name}» (${f.contracts} договоров)`);
            }

            // 2. Записи
            const built = buildFinpayRecords(data, { userId: currentUserId, accountMap: map, withPurchaseExpenses: withPurchase });
            const customers = built.customers.filter(c => !existing.customers.has(c.id));
            const sales = built.sales.filter(s => !existing.sales.has(s.id));
            const expenses = built.expenses.filter(e => !existing.expenses.has(e.id) && !existing.sales.has(e.id.replace(/^exp_sale_/, '')));
            const skipped = built.sales.length - sales.length;
            if (skipped) addLog(`⏭ Уже загружено раньше — пропущено договоров: ${skipped}`);

            setProgress({ done: 0, total: customers.length + sales.length + expenses.length });
            const step = () => setProgress(p => ({ ...p, done: p.done + 1 }));
            const failed: string[] = [];
            const save = (type: string, label: (x: any) => string) => async (item: any) => {
                try { await api.saveItem(type, item); }
                catch (e: any) { failed.push(`${label(item)}: ${e.message || e}`); }
            };

            addLog(`👤 Клиенты: ${customers.length}`);
            await runPool(customers, save('customers', c => c.name), step);
            addLog(`📄 Договоры: ${sales.length}`);
            await runPool(sales, save('sales', s => s.productName), step);
            if (expenses.length) {
                addLog(`💸 Закупы: ${expenses.length}`);
                await runPool(expenses, save('expenses', e => e.title), step);
            }

            if (failed.length) {
                addLog(`⚠️ Не сохранилось ${failed.length}:`);
                failed.slice(0, 20).forEach(f => addLog(`   ${f}`));
                addLog('Повторите импорт этого же файла — загруженное пропустится, догрузится остальное.');
                setBusy(false);
                return;
            }
            addLog('✅ Готово');
            onDone();
        } catch (e: any) {
            addLog(`❌ Ошибка: ${e.message || String(e)}`);
            setBusy(false);
        }
    };

    return (
        <div className="space-y-4">
            <div className="bg-slate-50 dark:bg-slate-800 rounded-xl p-4 text-sm text-slate-700 dark:text-slate-300 space-y-1">
                <p className="font-bold text-slate-800 dark:text-white">FinUchet · {analysis.companyName}</p>
                <p>Клиентов: <b>{analysis.clients}</b> · договоров: <b>{analysis.contracts}</b> (активных {analysis.activeContracts})</p>
                <p>Поступлений: <b>{analysis.payments}</b> на {money(analysis.receivedTotal)}</p>
                <p>Остаток долга клиентов: <b>{money(analysis.remainingTotal)}</b></p>
                {alreadyImported > 0 && <p className="text-amber-600 dark:text-amber-400">Уже загружено раньше: {alreadyImported} договоров — они пропустятся.</p>}
            </div>

            {analysis.warnings.length > 0 && (
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-900/40 rounded-xl p-3 text-xs text-amber-800 dark:text-amber-300 space-y-1">
                    {analysis.warnings.map((w, i) => <p key={i}>• {w}</p>)}
                </div>
            )}

            <div className="space-y-2">
                <p className="text-sm font-bold text-slate-800 dark:text-white">Счета из файла → ваши счета</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">В выгрузке нет названий счетов — узнайте их по договорам.</p>
                {analysis.fundingAccounts.map(f => (
                    <div key={f.id} className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-2">
                        <p className="text-xs text-slate-600 dark:text-slate-400">
                            <b className="text-slate-800 dark:text-white">{f.contracts} договоров</b>, закуп {money(f.buyTotal)}
                            <br />{f.sample.join(' · ')}
                        </p>
                        <select
                            value={accountMap[f.id] || NEW_ACCOUNT}
                            onChange={e => setAccountMap(m => ({ ...m, [f.id]: e.target.value }))}
                            disabled={busy}
                            className="w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm p-2 text-slate-800 dark:text-white"
                        >
                            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                            <option value={NEW_ACCOUNT}>➕ Создать новый счёт</option>
                        </select>
                    </div>
                ))}
            </div>

            <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                <input type="checkbox" checked={withPurchase} onChange={e => setWithPurchase(e.target.checked)} disabled={busy} className="mt-1" />
                <span>Списать закуп со счетов (расход «Себестоимость», как при оформлении договора). Без этого баланс счетов будет без закупов.</span>
            </label>

            {(busy || logs.length > 0) && (
                <div className="bg-slate-900 text-green-400 p-3 rounded-xl text-[10px] font-mono max-h-40 overflow-y-auto">
                    {progress.total > 0 && <div>Сохранено {progress.done} из {progress.total}</div>}
                    {logs.map((log, i) => <div key={i}>{log}</div>)}
                </div>
            )}

            <button
                onClick={runImport}
                disabled={busy || !existing}
                className="w-full py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
            >
                {busy ? '⏳ Импорт…' : !existing ? '⏳ Загрузка ваших счетов…' : '🚀 Импортировать'}
            </button>
        </div>
    );
};

export default FinpayImport;
