import React, { useEffect, useRef, useState } from 'react';
import type { Account, Investor, PoolMonthReport, PoolProfitBasis } from '../types';
import GlassSheet, { SheetSection, SheetField, sheetInputClass } from './GlassSheet';
import { ModalParkContext } from './ModalPortal';
import { api } from '../services/api';
import { formatCurrency } from '../src/utils';
import { poolDay, poolTime, poolMonth, poolMonthStart, nextPoolMonth, poolTermsAt, poolProfitBasis, poolProfitDisposition, isPoolMemberActiveAt } from '../shared/profit.js';
import { appConfirm } from '../src/dialogs';
type State = {
    balances?: {
        investors: Record<string, {
            earned: number; confirmed: number;
            pending: number;
            paid: number;
            reinvested: number;
            available: number;
        }>;
    };
    account: Account;
    investors: Investor[];
    reports: (PoolMonthReport & {
        fingerprint: string;
    })[];
    historicalContracts: {
        id: string;
        productName: string;
        date: string;
        previouslyPersonal: boolean;
    }[];
    settlementIssues?: {accountId:string;message:string}[];
};
const profitBasisLabels: Record<PoolProfitBasis, string> = {
    MONTH: 'По месяцу взноса',
    SCHEDULE_PERIOD: 'По полному периоду графика',
};
const operationTitles = {
    add: 'Новый инвестор',
    capital: 'Инвестор',
    deposit: 'Пополнить',
    withdraw: 'Вернуть вложение',
    reinvest: 'Реинвестировать',
    terms: 'Условия',
    entryDate: 'Дата первого входа',
    reentry: 'Повторный вход',
    management: 'Доли за управление',
    adjustment: 'Корректировка',
    basis: 'Настройки расчёта прибыли',
} as const;
type Operation = keyof typeof operationTitles;
const saveClass = 'w-full rounded-xl bg-slate-200 p-3 font-semibold text-black disabled:opacity-40 dark:bg-slate-700 dark:text-white';
type EntryDateCorrection = {
    months: string[];
    fingerprint: string;
    rows: { id: string; name: string; before: number; after: number; closedDelta: number; availableAfter: number }[];
};
export default function PoolAccountingSheet({ account, onClose, onChanged }: {
    account: Account;
    onClose: () => void;
    onChanged: (data: any) => void;
}) {
    const [data, setData] = useState<State | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    const [month, setMonth] = useState(poolMonth(Date.now())), [startMonth, setStartMonth] = useState(nextPoolMonth(poolMonth(Date.now())));
    const [includeHistory, setIncludeHistory] = useState(true);
    const [comparison, setComparison] = useState<{
        month: string;
        startMonth?: string;
        issues?: string[];
        fingerprint?: string;
        rows: {
            id: string;
            name: string;
            current: number;
            proposed: number;
            paid?: number;
        }[];
    } | null>(null);
    const [excluded, setExcluded] = useState<string[]>([]), [verified, setVerified] = useState(false);
    const [operation, setOperation] = useState<Operation | ''>(''), [investorId, setInvestorId] = useState(''), [amount, setAmount] = useState(''), [name, setName] = useState(''), [rate, setRate] = useState('50'), [mode, setMode] = useState('PAYABLE');
    const [date, setDate] = useState(''), [effectiveMonth, setEffectiveMonth] = useState(nextPoolMonth(poolMonth(Date.now())));
    const [entryDateCorrection, setEntryDateCorrection] = useState<EntryDateCorrection | null>(null);
    const [reason, setReason] = useState('');
    const [profitBasis, setProfitBasis] = useState<PoolProfitBasis | null>(null);
    const [management, setManagement] = useState<Record<string, string>>({});
    const money = (n: number) => `${formatCurrency(n, true)} ₽`;
    const appliedRevision=useRef(account.poolAccounting?.revision||0);
    const applyAutomatic=(r:any)=>{const revision=Number(r.account.poolAccounting?.revision||0);if(revision>appliedRevision.current&&!(r.changed&&Object.keys(r.changed).length===0)){appliedRevision.current=revision;onChanged(r.changed||{accounts:[r.account],investors:r.investors});}};
    const load = () => api.poolRequest(account.id).then((r: State) => { applyAutomatic(r);setData(r); setExcluded(r.account.poolAccounting?.excludedSaleIds || r.historicalContracts.filter(c => c.previouslyPersonal).map(c => c.id)); setManagement(Object.fromEntries((poolTermsAt(r.account, Date.now())?.managerShareSplit || r.account.managerShareSplit || []).map(s => [s.investorId, String(s.percent)]))); return r; });
    useEffect(() => { let alive = true; api.poolRequest(account.id).then((r: State) => { if (!alive)
        return; applyAutomatic(r);setData(r); setExcluded(r.account.poolAccounting?.excludedSaleIds || r.historicalContracts.filter(c => c.previouslyPersonal).map(c => c.id)); setManagement(Object.fromEntries((poolTermsAt(r.account, Date.now())?.managerShareSplit || r.account.managerShareSplit || []).map(s => [s.investorId, String(s.percent)]))); }).catch(e => alive && setError(e.message)); return () => { alive = false; }; }, [account.id]);
    const run = async (action: string, body: any) => { if (busy)
        return; setBusy(true); setError(''); try {
        const r = await api.poolRequest(account.id, action, body);
        onChanged(r.changed || { accounts: [r.account], investors: r.investors });
        appliedRevision.current=Number(r.account.poolAccounting?.revision||0);
        await load();
        if (action === 'profitBasis') setProfitBasis(null);
        if (action === 'correctEntryDate') setEntryDateCorrection(null);
        setOperation(action === 'exit' || investorAction ? 'capital' : '');
        setAmount('');
        setVerified(false);
    }
    catch (e: any) {
        if (action === 'correctEntryDate' && e.status === 409) setEntryDateCorrection(null);
        setError(e.message);
    }
    finally {
        setBusy(false);
    } };
    const config = data?.account.poolAccounting, currentMonth = poolMonth(Date.now());
    const nextMonth = nextPoolMonth(currentMonth);
    const basisMonth = config && config.startMonth > nextMonth ? config.startMonth : nextMonth;
    const currentBasis = poolProfitBasis(data?.account);
    const savedBasis = poolProfitBasis(data?.account, poolMonthStart(basisMonth));
    const selectedBasis = profitBasis ?? savedBasis;
    // Нативный календарь может выдать пустое значение или месяц за пределами min/max.
    // В поле и расчёте всегда используем один и тот же доступный месяц.
    const selectedMonth = config
        ? month < config.startMonth ? config.startMonth : month > currentMonth ? (config.startMonth > currentMonth ? config.startMonth : currentMonth) : month
        : month;
    const report = data?.reports.find(r => r.month === selectedMonth);
    const activeInvestor = data?.investors.find(i => i.id === investorId);
    const firstEntryTime = activeInvestor?.investmentPeriods?.length
        ? Math.min(...activeInvestor.investmentPeriods.map(period => poolTime(period.joinedDate)))
        : poolTime(activeInvestor?.joinedDate);
    const firstEntryDay = Number.isFinite(firstEntryTime) ? poolDay(firstEntryTime) : '';
    const parentParked = React.useContext(ModalParkContext);
    const investorAction = ['deposit', 'withdraw', 'reinvest', 'terms', 'entryDate', 'reentry'].includes(operation);
    const selectManagementMonth = (value: string) => {
        setEffectiveMonth(value);
        if (value) setManagement(Object.fromEntries((poolTermsAt(data?.account, poolMonthStart(value))?.managerShareSplit || [])
            .map(row => [row.investorId, String(row.percent)])));
    };
    const begin = (next: Operation) => {
        setError('');
        setAmount('');
        setDate('');
        if (next === 'management') selectManagementMonth(nextMonth);
        else setEffectiveMonth(nextMonth);
        setOperation(next);
    };
    const back = () => {
        setError('');
        setOperation(operation === 'entryDate' ? 'terms' : investorAction ? 'capital' : '');
    };
    const select = (id: string) => { setInvestorId(id); begin('capital'); };
    const previewEntryDate = async () => {
        setBusy(true);
        setError('');
        setEntryDateCorrection(null);
        try {
            const result = await api.poolRequest(account.id, 'preview', { entryDateCorrection: { investorId, entryDate: date } });
            applyAutomatic(result);
            setEntryDateCorrection(result.entryDateCorrection);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setBusy(false);
        }
    };
    const formSnapshot = JSON.stringify({ amount, name, rate, mode, date, effectiveMonth, reason, management, profitBasis });
    const openedForm = useRef(formSnapshot);
    useEffect(() => { openedForm.current = formSnapshot; }, [operation]);
    const confirmLeave = async () => {
        if (busy) return false;
        return operation === 'capital' || openedForm.current === formSnapshot
            || await appConfirm({ title: 'Закрыть без сохранения?', message: 'Изменения будут сброшены.',
                confirmLabel: 'Закрыть', cancelLabel: 'Продолжить' });
    };
    const confirming = useRef(false);
    const editEntryDate = () => {
        setDate(firstEntryDay);
        setEntryDateCorrection(null);
        setError('');
        setOperation('entryDate');
    };
    const execute = async () => {
        if (busy || confirming.current) return;
        if (['deposit', 'withdraw', 'reinvest', 'reentry', 'adjustment', 'add'].includes(operation)) {
            confirming.current = true;
            try {
                if (!await appConfirm({ title: operationTitles[operation as Operation],
                    message: [activeInvestor?.name, money(Number(amount || 0)), date ? date.split('-').reverse().join('.') : 'Сегодня'].filter(Boolean).join(' · '),
                    confirmLabel: 'Подтвердить', cancelLabel: 'Проверить данные' })) return;
            } finally { confirming.current = false; }
        }
        if ((operation === 'terms' || operation === 'management') && effectiveMonth < nextMonth) {
            setError('Новые проценты действуют со следующего месяца. Дату участия измените через «Исправить дату входа».');
            return;
        }
        const common = { investorId, date: date || undefined };
        if (operation === 'adjustment')
            void run('adjustment', { amount: Number(amount), reason, date:common.date, confirmed: true });
        if (operation === 'reentry')
            void run('reentry', { ...common, amount: Number(amount || 0) });
        if (operation === 'deposit' || operation === 'withdraw')
            void run('capital', { ...common, amount: Number(amount), kind: operation === 'deposit' ? 'DEPOSIT' : 'WITHDRAW' });
        if (operation === 'reinvest')
            void run('reinvest', { investorId, amount: Number(amount) });
        if (operation === 'terms')
            void run('terms', { investorId, rate: Number(rate), disposition: mode, month: effectiveMonth });
        if (operation === 'add')
            void run('addInvestor', { name, amount: Number(amount || 0), rate: Number(rate), disposition: mode, date: common.date });
        if (operation === 'management')
            void run('management', { month: effectiveMonth, split: Object.entries(management).filter(([, v]) => Number(v) > 0).map(([investorId, percent]) => ({ investorId, percent: Number(percent) })) });
    };
    return <>
    <ModalParkContext.Provider value={parentParked || !!operation}>
    <GlassSheet title="Общий пул" subtitle={account.name} onClose={onClose} zIndex={10000} confirmClose={() => !busy}>
    <div className="space-y-5 pb-8">
      {error && !operation && <p role="alert" className="rounded-2xl bg-rose-50 p-4 text-sm text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{error}</p>}
      {data?.settlementIssues?.map(issue=><p key={issue.accountId} role="alert" className="rounded-2xl bg-rose-50 p-4 text-sm text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{issue.message}</p>)}
      {!data && !error && <p className="p-5 text-sm text-slate-500">Загрузка…</p>}
      {data && !config && <>
        <SheetSection title="Месячный учёт">
          <label className="flex gap-3 p-4 text-sm"><input type="checkbox" checked={includeHistory} disabled={busy} onChange={e => { setIncludeHistory(e.target.checked); setComparison(null); setVerified(false); }}/>Пересчитать всю историю</label>
          {!includeHistory && <SheetField label="Начать с"><input aria-label="Месяц перехода" type="month" min={nextMonth} value={startMonth} onChange={e => setStartMonth(e.target.value)} className={sheetInputClass}/></SheetField>}
        </SheetSection>
        {data.historicalContracts.some(c => c.previouslyPersonal) && <SheetSection title="Личные договоры" hint="Отмеченные договоры останутся вне распределения пула.">
          {data.historicalContracts.filter(c => c.previouslyPersonal).map(c => <label key={c.id} className="flex gap-3 p-4 text-sm"><input type="checkbox" checked={excluded.includes(c.id)} disabled={busy} onChange={e => { setComparison(null); setVerified(false); setExcluded(x => e.target.checked ? [...x, c.id] : x.filter(id => id !== c.id)); }}/><span>{c.productName} · {c.date.slice(0, 10)}</span></label>)}
        </SheetSection>}
        <button disabled={busy} className="w-full rounded-2xl bg-slate-100 p-3 text-sm font-semibold text-primary-600 dark:bg-slate-800" onClick={async () => { setBusy(true); setError(''); try {
            setComparison((await api.poolRequest(account.id, 'preview', { excludedSaleIds: excluded, history: includeHistory })).comparison);
            setVerified(false);
        }
        catch (e: any) {
            setError(e.message);
        }
        finally {
            setBusy(false);
        } }}>Сравнить расчёт</button>
        {comparison && <SheetSection title={comparison.startMonth ? `История с ${comparison.startMonth} по ${comparison.month}` : `Пример за ${comparison.month}`} hint="Прибыль после общих расходов, до выплат."><div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-3 p-4 text-xs"><span>Участник</span><span>Сейчас</span><span>По-новому</span>{comparison.rows.map(r => <React.Fragment key={r.id}><span className="min-w-0 break-words">{r.name}{includeHistory && !!r.paid && <small className="block text-slate-500 dark:text-slate-400">Выплачено {money(r.paid)}</small>}</span><span className="text-right tabular-nums">{money(r.current)}</span><strong className="text-right tabular-nums">{money(r.proposed)}</strong></React.Fragment>)}</div></SheetSection>}
        {!!comparison?.issues?.length && <ul role="alert" className="space-y-2 rounded-2xl bg-rose-50 p-4 text-sm text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{comparison.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
        {includeHistory && comparison && <p className="px-4 text-xs text-slate-500 dark:text-slate-400">Для истории используются сохранённые ставки. Проведённые выплаты сохраняются.</p>}
        {(!includeHistory || comparison?.fingerprint && !comparison.issues?.length) && <label className="flex gap-3 px-4 text-sm"><input type="checkbox" checked={verified} disabled={busy} onChange={e => setVerified(e.target.checked)}/>Суммы вложений и условия проверены</label>}
        <button disabled={busy || !verified || includeHistory && (!comparison?.fingerprint || !!comparison.issues?.length)} onClick={() => includeHistory
            ? run('enableHistory', { fingerprint: comparison?.fingerprint, excludedSaleIds: excluded, confirmed: true })
            : run('enable', { startMonth, excludedSaleIds: excluded, confirmed: true })} className="w-full rounded-2xl bg-primary-600 p-4 font-semibold text-white disabled:opacity-40">{includeHistory ? 'Включить с пересчётом' : `Включить с ${startMonth}`}</button>
      </>}
      {data && config && <>
        <SheetSection title="Прибыль за месяц" hint="Расчёт автоматический. Текущий месяц — по данным на сегодня.">
          <SheetField label="Месяц"><input aria-label="Расчётный месяц" type="month" min={config.startMonth} max={config.startMonth > currentMonth ? config.startMonth : currentMonth} disabled={config.startMonth > currentMonth} className={sheetInputClass} value={selectedMonth} onChange={e => { setMonth(e.target.value); setVerified(false); }}/></SheetField>
        </SheetSection>
        {report ? <div className="space-y-3 rounded-3xl bg-white p-4 dark:bg-slate-800">
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{report.status === 'CLOSED' ? 'Месяц рассчитан' : 'По данным на сегодня'}</p>
          <div className="flex flex-wrap justify-between gap-x-3 gap-y-1"><span>Прибыль по учёту</span><strong>{money(report.gross)}</strong></div>
          <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-sm"><span>Общие расходы</span><span>{money(report.costs)}</span></div>
          {report.carryIn > 0 && <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-sm"><span>Покрытие прошлого убытка</span><span>{money(report.carryIn)}</span></div>}
          <div className="flex justify-between border-t border-slate-100 pt-3 dark:border-slate-700"><span>К распределению</span><strong>{money(report.distributable)}</strong></div>
          {report.carryOut > 0 && <p className="text-sm text-amber-700 dark:text-amber-300">Непокрытый убыток: {money(report.carryOut)}. Следующая прибыль сначала покроет его.</p>}
          {!!report.issues?.length && <div role="alert" className="text-sm text-rose-600 dark:text-rose-300">{report.issues.map(issue => <p key={issue}>{issue}</p>)}</div>}
          {report.unallocated > 0 && <p role="alert" className="text-sm text-rose-600">Нет работающего капитала. Проверьте участников.</p>}
          {report.allocations.map(r => <div key={r.id} className="flex items-center justify-between gap-3 text-sm"><span className="min-w-0 break-words">{r.id === '__manager__' ? 'За управление' : data.investors.find(i => i.id === r.id)?.name || 'Участник'}</span><strong>{money(r.amount)}</strong></div>)}
          <details className="text-sm"><summary className="cursor-pointer py-2 text-primary-600">Из чего сложилась прибыль</summary><div className="max-h-64 space-y-2 overflow-y-auto">{report.sources.map(s => <div className="flex justify-between gap-3" key={`${s.saleId}:${s.paymentId}`}><span>{s.productName || 'Договор'} · {s.date.slice(0, 10)}</span><span>{money(s.amount)}</span></div>)}{report.costRows.map(e => <div className="flex justify-between gap-3" key={e.id}><span>{e.title}</span><span>−{money(e.amount)}</span></div>)}</div></details>
        </div> : <p className="px-4 text-sm text-slate-500">Расчёт начнётся с {config.startMonth}.</p>}
        <button type="button" disabled={busy} onClick={() => { setProfitBasis(null); begin('basis'); }} className="flex w-full items-center justify-between rounded-3xl bg-white px-4 py-3 text-left text-sm font-semibold dark:bg-slate-800">
          Настройки расчёта прибыли <span aria-hidden="true">›</span>
        </button>
        <SheetSection title="Участники">
          {data.investors.map(i => <button key={i.id} disabled={busy} onClick={() => select(i.id)} className="flex w-full items-center justify-between gap-3 border-b border-slate-100 p-4 text-left last:border-0 dark:border-slate-700"><span className="min-w-0 break-words"><strong className="block text-sm">{i.name}</strong><span className="text-xs text-slate-500 dark:text-slate-400">{poolProfitDisposition(data.account, i.id) === 'REINVEST' ? 'Прибыль: в капитал' : 'Прибыль: к выплате'}{!isPoolMemberActiveAt(i, Date.now()) ? ' · Вышел' : ''}</span></span><span className="shrink-0 text-right"><span className="block text-xs text-slate-500 dark:text-slate-400">Капитал</span><span className="block text-sm tabular-nums">{money(i.initialAmount)} ›</span></span></button>)}
          <button disabled={busy} onClick={() => { begin('add'); setName(''); setRate('50'); setMode('PAYABLE'); }} className="w-full p-4 text-primary-600">+ Добавить инвестора</button>
        </SheetSection>
        <button disabled={busy} onClick={() => { begin('adjustment'); setReason(''); }} className="px-4 text-sm text-primary-600">Корректировка</button>
        <button disabled={busy} onClick={() => begin('management')} className="px-4 text-sm text-primary-600">Доли за управление</button>
      </>}
    </div>
    </GlassSheet>
    </ModalParkContext.Provider>
    {data && config && operation && <GlassSheet key={operation} title={operation === 'capital' && activeInvestor ? activeInvestor.name : operationTitles[operation]}
        subtitle={investorAction ? activeInvestor?.name : account.name} onClose={back} cancelLabel="Назад"
        zIndex={10010} confirmClose={confirmLeave} fit="content">
      <div className="space-y-4 pb-3">
        {error && <p role="alert" className="rounded-2xl bg-rose-50 p-4 text-sm text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{error}</p>}
        {operation === 'basis' ? <SheetSection>
          <div className="space-y-3 px-4 py-3 text-sm">
            <p className="text-slate-500 dark:text-slate-400">{config.startMonth <= currentMonth ? `Сейчас: ${profitBasisLabels[currentBasis]}` : 'Месячный учёт ещё не начался'}</p>
            <label className="block">
              <span className="mb-2 block font-medium">Распределение с {basisMonth}</span>
              <select aria-label="Способ распределения прибыли" className={sheetInputClass} value={selectedBasis} onChange={e => setProfitBasis(e.target.value as PoolProfitBasis)}>
                <option value="MONTH">{profitBasisLabels.MONTH}</option>
                <option value="SCHEDULE_PERIOD">{profitBasisLabels.SCHEDULE_PERIOD}</option>
              </select>
            </label>
            <p className="text-xs text-slate-500 dark:text-slate-400">{selectedBasis === 'MONTH' ? 'Учитываются дни в месяце планового взноса.' : 'Учитываются дни между соседними датами графика.'}</p>
            <button disabled={busy || selectedBasis === savedBasis} onClick={() => run('profitBasis', { month: basisMonth, basis: selectedBasis })} className={saveClass}>Сохранить способ расчёта</button>
          </div>
        </SheetSection> : <SheetSection hint={operation === 'management' ? 'Проценты от управленческой части. Остаток остаётся владельцу.' : undefined}>
          {operation === 'capital' && <>
            {firstEntryDay && <button type="button" disabled={busy} onClick={editEntryDate}
                className="flex min-h-11 w-full items-center justify-between px-4 py-3 text-left text-sm text-slate-900 dark:text-slate-100">
              <span>Дата входа<span className="mt-1 block text-xs text-slate-500">{firstEntryDay.split('-').reverse().join('.')}</span></span>
              <span className="text-primary-600">Изменить ›</span>
            </button>}
            {investorId && data.balances?.investors[investorId] && <dl className="space-y-2 px-4 py-3 text-sm">
              {[
                ['Начислено', data.balances.investors[investorId].earned],
                ['Реинвестировано', data.balances.investors[investorId].reinvested],
                ['Получено инвестором', data.balances.investors[investorId].paid],
                ['К получению', data.balances.investors[investorId].available],
              ].map(([label, value]) => <div className="flex justify-between gap-3" key={label}><dt>{label}</dt><dd className="font-semibold">{money(Number(value))}</dd></div>)}
            </dl>}
            {(['deposit', 'withdraw', 'reinvest', 'terms', ...(!isPoolMemberActiveAt(activeInvestor || {}, Date.now()) ? ['reentry'] : [])] as Operation[]).map(action =>
              <button type="button" key={action} disabled={busy} onClick={() => {
                  if (action === 'terms') {
                      const terms = poolTermsAt(data.account, poolMonthStart(nextMonth));
                      setRate(String(terms?.members[investorId]?.rate ?? activeInvestor?.profitPercentage ?? 50));
                      setMode(poolProfitDisposition(data.account, investorId, poolMonthStart(nextMonth)));
                  }
                  begin(action);
              }} className="flex min-h-11 w-full items-center justify-between px-4 py-2.5 text-left text-sm font-medium text-slate-900 dark:text-slate-100">
                {operationTitles[action]} <span aria-hidden="true" className="text-slate-400">›</span>
              </button>)}
          </>}
          {operation === 'terms' && firstEntryDay && <button type="button" disabled={busy} className="px-4 py-2 text-sm font-semibold text-primary-600" onClick={editEntryDate}>Исправить дату входа</button>}
          {operation === 'entryDate' && <div className="space-y-3 p-4 text-sm">
            <SheetField label="Дата первого входа">
              <input aria-label="Дата первого входа" type="date" max={poolDay()} value={date} disabled={busy}
                onChange={e => { setDate(e.target.value); setEntryDateCorrection(null); }} className={sheetInputClass}/>
            </SheetField>
            <p className="text-xs text-slate-500 dark:text-slate-400">Дата поступления денег в кассу сохраняется.</p>
            <button type="button" disabled={busy || !date || date === firstEntryDay} onClick={() => void previewEntryDate()}
              className="min-h-11 rounded-xl bg-slate-100 px-4 font-semibold text-primary-600 disabled:opacity-40 dark:bg-slate-700">Проверить расчёт</button>
            {entryDateCorrection && <div className="space-y-3" aria-live="polite">
              <p className="text-slate-500 dark:text-slate-400">{entryDateCorrection.months.length
                ? `Разница за закрытые месяцы (${entryDateCorrection.months.join(', ')}) будет проведена в текущем месяце.`
                : 'Будет обновлён расчёт открытых месяцев.'}</p>
              <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 text-xs tabular-nums sm:text-sm">
                <span>Начислено</span><span className="text-right">Сейчас</span><span className="text-right">После</span>
                {entryDateCorrection.rows.map(row => <React.Fragment key={row.id}>
                  <span className="min-w-0 break-words">{row.name}
                    {!!row.closedDelta && <small className="block text-slate-500 dark:text-slate-400">За закрытые месяцы {row.closedDelta > 0 ? '+' : ''}{money(row.closedDelta)}</small>}
                    {row.availableAfter < 0 && <small className="block text-rose-600 dark:text-rose-400">К выводу {money(row.availableAfter)}</small>}
                  </span>
                  <span className="text-right">{money(row.before)}</span><strong className="text-right">{money(row.after)}</strong>
                </React.Fragment>)}
              </div>
              <button type="button" disabled={busy} className={saveClass}
                onClick={() => void run('correctEntryDate', { investorId, entryDate: date, confirmed: true, fingerprint: entryDateCorrection.fingerprint })}>Подтвердить исправление</button>
            </div>}
          </div>}
          {operation !== 'capital' && operation !== 'entryDate' && <>
            {operation === 'add' && <SheetField label="Имя"><input aria-label="Имя инвестора пула" value={name} onChange={e => setName(e.target.value)} className={sheetInputClass}/></SheetField>}
            {['add', 'deposit', 'withdraw', 'reinvest', 'reentry', 'adjustment'].includes(operation) && <SheetField label="Сумма"><input aria-label="Сумма операции пула" type="number" inputMode="decimal" min={operation === 'adjustment' ? undefined : 0} step="0.01" value={amount} onChange={e => setAmount(e.target.value)} className={sheetInputClass}/></SheetField>}
            {['add', 'deposit', 'withdraw', 'reentry', 'adjustment'].includes(operation) && <SheetField label={operation === 'add' ? 'Дата начала участия' : 'Дата'} hint="Пусто — сегодня"><input aria-label="Дата операции пула" type="date" max={poolDay()} value={date} onChange={e => setDate(e.target.value)} className={sheetInputClass}/></SheetField>}
            {['add', 'terms'].includes(operation) && <><SheetField label="Доля инвестора в прибыли"><input type="number" min="0" max="100" step="0.01" aria-label="Доля инвестора" value={rate} onChange={e => setRate(e.target.value)} className={sheetInputClass}/></SheetField><SheetField label="Прибыль" hint="По согласованным условиям"><select aria-label="Что делать с прибылью" value={mode} onChange={e => setMode(e.target.value)} className={sheetInputClass}><option value="PAYABLE">К получению</option><option value="REINVEST">Реинвестировать</option></select></SheetField></>}
            {operation === 'management' && data.investors.map(i => <SheetField key={i.id} label={i.name}><input aria-label={`За управление: ${i.name}`} type="number" min="0" max="100" value={management[i.id] || ''} onChange={e => setManagement(x => ({ ...x, [i.id]: e.target.value }))} className={sheetInputClass}/></SheetField>)}
            {['terms', 'management'].includes(operation) && <SheetField label="Новые проценты действуют с" hint="Со следующего месяца или позднее"><input aria-label="Месяц новых условий" type="month" min={nextPoolMonth(poolMonth(Date.now()))} value={effectiveMonth} onChange={e => operation === 'management' ? selectManagementMonth(e.target.value) : setEffectiveMonth(e.target.value)} className={sheetInputClass}/></SheetField>}
            {operation === 'adjustment' && <><SheetField label="Причина"><input aria-label="Причина корректировки" value={reason} onChange={e => setReason(e.target.value)} className={sheetInputClass}/></SheetField><p className="px-4 text-xs text-slate-500">Плюс увеличивает прибыль, минус уменьшает. Деньги в кассе не меняются.</p></>}
            {operation === 'reinvest' && <p className="px-4 text-xs text-slate-500">Из доступной прибыли. Повторного поступления в кассу нет.</p>}
            <div className="p-4"><button disabled={busy || (operation === 'terms' || operation === 'management') && !effectiveMonth} onClick={execute} className={saveClass}>{busy ? 'Сохранение…' : 'Сохранить'}</button></div>
          </>}
          {investorId && operation === 'capital' && <button disabled={busy} className="w-full p-4 text-sm text-rose-600" onClick={async () => { if (await appConfirm('Оформить выход инвестора? Сначала нужно вернуть вложенный капитал.'))
                void run('exit', { investorId }); }}>Оформить выход</button>}
        </SheetSection>}
      </div>
    </GlassSheet>}
    </>;
}
