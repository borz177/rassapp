import React, { useEffect, useState } from 'react';
import Sheet from './Sheet';
import { friendlyError } from '../src/friendlyError';
import { api } from '../services/api';
import { appConfirm } from '../src/dialogs';
import type { AdminPayment, NpdStatus } from '../types';

const money = (v: string | number) =>
  Number(v || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });

const formatPhone = (d: string | null) =>
  d && /^7\d{10}$/.test(d) ? `+7 ${d.slice(1, 4)} ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9)}` : d || '';

/** Подпись состояния чека у оплаты */
const receiptBadge = (p: AdminPayment): { text: string; tone: string } | null => {
  if (p.refunded_at) return { text: 'возврат', tone: 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300' };
  switch (p.receipt_status) {
    case 'issued': return { text: p.receipt_auto ? 'чек выбит автоматически' : 'чек есть', tone: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' };
    case 'canceled': return { text: 'чек аннулирован', tone: 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300' };
    case 'unknown': return { text: 'проверьте в «Мой налог»', tone: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' };
    case 'error': return { text: 'ошибка, повторим', tone: 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300' };
    case 'issuing': return { text: 'выбивается…', tone: 'bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300' };
  }
  if (p.receipt_number || p.receipt_url) return { text: 'чек есть', tone: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' };
  return null;
};

/**
 * Подключение «Мой налог»: вход по СМС, выключатель автоматики, доход за год
 * к лимиту самозанятого. Пароль от «Мой налог» не вводится и не хранится.
 */
const NpdCard: React.FC<{ status: NpdStatus | null; onChange: (s: NpdStatus) => void; onError: (m: string | null) => void }> = ({ status, onChange, onError }) => {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [relogin, setRelogin] = useState(false);
  const run = async (fn: () => Promise<any>) => {
    setBusy(true); onError(null);
    try { await fn(); onChange(await api.adminNpd()); }
    catch (e: any) { onError(friendlyError(e, 'Ошибка «Мой налог»')); }
    finally { setBusy(false); }
  };
  if (!status) return null;

  const showLogin = !status.connected || status.needsLogin || relogin;
  const yearPct = Math.min(100, Math.round((status.yearIncome / status.yearLimit) * 100));
  const input = 'w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-200';

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-bold text-slate-800 dark:text-white">Чеки в «Мой налог»</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {status.connected
              ? `Подключён: ИНН ${status.inn || '—'} · ${formatPhone(status.phone)}`
              : 'Чек выбивается сам после каждой оплаты, ссылка уходит человеку в письме'}
          </p>
        </div>
        {status.connected && !showLogin && (
          <label className="flex items-center gap-2 shrink-0 cursor-pointer">
            <span className="text-xs font-bold text-slate-600 dark:text-slate-300">Автоматически</span>
            <input type="checkbox" className="sr-only peer" checked={status.enabled} disabled={busy}
                   onChange={e => run(() => api.adminNpd('/enabled', { enabled: e.target.checked }))} />
            <span className="relative w-11 h-6 rounded-full bg-slate-200 dark:bg-slate-600 peer-checked:bg-emerald-500 transition-colors after:absolute after:top-0.5 after:left-0.5 after:w-5 after:h-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-5" />
          </label>
        )}
      </div>

      {status.needsLogin && (
        <p className="text-xs rounded-xl bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300 px-3 py-2">
          «Мой налог» просит войти заново — пока чеки не выбиваются. Войдите по коду из СМС.
        </p>
      )}
      {status.connected && status.enabled && !status.needsLogin && (
        <p className="text-xs text-emerald-700 dark:text-emerald-400">
          Включено{status.enabledSince ? ` с ${new Date(status.enabledSince).toLocaleDateString('ru-RU')}` : ''}: чеки выбиваются для оплат после включения.
          Более ранние — кнопкой «Выбить чек» у оплаты.
        </p>
      )}
      {status.lastError && (
        <p className="text-[11px] text-rose-600 dark:text-rose-400">Последняя ошибка: {status.lastError}</p>
      )}

      {showLogin && (
        <div className="space-y-2">
          {!status.codeSentTo ? (
            <div className="flex gap-2">
              <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Телефон из «Мой налог»" inputMode="tel" className={input} />
              <button disabled={busy || !phone} onClick={() => run(() => api.adminNpd('/sms/start', { phone }))}
                      className="px-4 rounded-xl bg-indigo-600 text-white font-bold text-sm shrink-0 disabled:opacity-50">
                Получить код
              </button>
            </div>
          ) : (
            <div className="space-y-1.5">
              <p className="text-xs text-slate-500 dark:text-slate-400">Код отправлен на {formatPhone(status.codeSentTo)}</p>
              <div className="flex gap-2">
                <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="Код из СМС"
                       inputMode="numeric" autoComplete="one-time-code" className={input} />
                <button disabled={busy || code.length < 4} onClick={() => run(async () => { await api.adminNpd('/sms/verify', { code }); setCode(''); setRelogin(false); })}
                        className="px-4 rounded-xl bg-indigo-600 text-white font-bold text-sm shrink-0 disabled:opacity-50">
                  Войти
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div>
        <div className="flex justify-between text-[11px] text-slate-500 dark:text-slate-400">
          <span>Доход за год через приложение</span>
          <span className="tabular-nums">{Math.round(status.yearIncome).toLocaleString('ru-RU')} из {status.yearLimit.toLocaleString('ru-RU')} ₽</span>
        </div>
        <div className="mt-1 h-1.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
          <div className={`h-full rounded-full ${yearPct >= 85 ? 'bg-rose-500' : yearPct >= 65 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${yearPct}%` }} />
        </div>
      </div>

      {status.connected && !showLogin && (
        <div className="flex gap-3 text-xs font-bold">
          <button onClick={() => setRelogin(true)} className="text-indigo-600 dark:text-indigo-400">Войти заново</button>
          <button disabled={busy} onClick={async () => {
            if (await appConfirm({ title: 'Отключить «Мой налог»?', message: 'Чеки перестанут выбиваться автоматически. Уже выбитые останутся.', confirmLabel: 'Отключить', destructive: true }))
              run(() => api.adminNpd('/disconnect', {}));
          }} className="text-rose-600 dark:text-rose-400">Отключить</button>
        </div>
      )}
    </div>
  );
};

/**
 * Журнал оплат и чеки НПД.
 *
 * Кассовый чек по 54-ФЗ здесь не выпускается: самозанятый ККТ не применяет.
 * Его документ — чек НПД из «Мой налог». С подключённым «Мой налог» он
 * выбивается сам (server/moyNalog.js); без него — вручную, а сюда прикладывают
 * номер и ссылку, и человеку уходит письмо с чеком.
 */
const AdminPayments: React.FC = () => {
  const [rows, setRows] = useState<AdminPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [onlyWithout, setOnlyWithout] = useState(true);

  const [target, setTarget] = useState<AdminPayment | null>(null);
  const [number, setNumber] = useState('');
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);

  const [npd, setNpd] = useState<NpdStatus | null>(null);
  const [acting, setActing] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [list, st] = await Promise.all([api.adminGetPayments(), api.adminNpd().catch(() => null)]);
      setRows(list);
      setNpd(st);
      setError(null);
    } catch (e: any) {
      setError(friendlyError(e, 'Не удалось загрузить оплаты'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const attach = async () => {
    if (!target) return;
    setSaving(true);
    try {
      const res = await api.adminAttachReceipt(target.id, { number, url });
      setTarget(null); setNumber(''); setUrl('');
      await load();
      setError(res.sent ? null : 'Чек сохранён, но письмо отправить не удалось');
    } catch (e: any) {
      setError(friendlyError(e, 'Не удалось сохранить чек'));
    } finally {
      setSaving(false);
    }
  };

  const issue = async (p: AdminPayment) => {
    setActing(p.id); setError(null);
    try {
      const r = await api.adminNpdPayment(p.id, 'npd-issue');
      await load();
      if (!r.sent) setError('Чек выбит, но письмо отправить не удалось');
    } catch (e: any) { setError(friendlyError(e, 'Не удалось выбить чек')); await load(); }
    finally { setActing(null); }
  };

  const cancel = async (p: AdminPayment) => {
    const ok = await appConfirm({
      title: 'Аннулировать чек?',
      message: `${money(p.amount)} ₽ · ${p.user_email || ''}. Причина: «Чек сформирован ошибочно». При возврате денег чек аннулируется сам.`,
      confirmLabel: 'Аннулировать', destructive: true,
    });
    if (!ok) return;
    setActing(p.id); setError(null);
    try { await api.adminNpdPayment(p.id, 'npd-cancel', { reason: 'Чек сформирован ошибочно' }); await load(); }
    catch (e: any) { setError(friendlyError(e, 'Не удалось аннулировать чек')); }
    finally { setActing(null); }
  };

  const npdReady = !!npd?.connected && !npd.needsLogin;
  const visible = onlyWithout
    ? rows.filter(r => !r.refunded_at && (r.receipt_status === 'canceled' || r.receipt_status === 'unknown' || (!r.receipt_url && !r.receipt_number)))
    : rows;

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
          {error}
        </div>
      )}

      <NpdCard status={npd} onChange={setNpd} onError={setError} />

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {npd?.enabled
            ? 'Чек выбивается сам, письмо об оплате уходит уже с ним. Чек нужен до 9-го числа следующего месяца.'
            : 'Письмо о поступлении оплаты уходит автоматически. Чек — кнопкой «Выбить чек» или вручную из «Мой налог»: человеку уйдёт письмо с ним.'}
        </p>
        <label className="flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-slate-300 shrink-0">
          <input type="checkbox" checked={onlyWithout} onChange={e => setOnlyWithout(e.target.checked)} />
          Только без чека
        </label>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Загрузка…</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {onlyWithout ? 'Все оплаты с чеками.' : 'Оплат пока нет.'}
        </p>
      ) : (
        <div className="space-y-2">
          {visible.map(p => (
            <div key={p.id} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-bold text-slate-800 dark:text-white truncate">
                  {p.user_name || '—'} <span className="font-normal text-slate-500 dark:text-slate-400">{p.user_email}</span>
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {dateTime(p.paid_at)} · {p.plan}, {p.months} мес. · {money(p.amount)} ₽
                </p>
                {(() => {
                  const b = receiptBadge(p);
                  return (b || p.receipt_url) && (
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                      {b && <span className={`px-2 py-0.5 rounded-full font-bold ${b.tone}`}>{b.text}</span>}
                      {p.receipt_url && p.receipt_status !== 'canceled' && (
                        <a href={p.receipt_url} target="_blank" rel="noreferrer" className="font-bold text-indigo-600 dark:text-indigo-400">открыть чек</a>
                      )}
                    </p>
                  );
                })()}
                {p.receipt_error && (p.receipt_status === 'error' || p.receipt_status === 'unknown') && (
                  <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-0.5 truncate max-w-[420px]" title={p.receipt_error}>{p.receipt_error}</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {npdReady && !p.refunded_at && !p.receipt_number && p.receipt_status !== 'issuing' && (
                  <button disabled={acting === p.id} onClick={() => issue(p)}
                          className="px-4 py-2 rounded-xl bg-emerald-600 text-white font-bold text-sm disabled:opacity-50">
                    {acting === p.id ? 'Выбиваем…' : 'Выбить чек'}
                  </button>
                )}
                {npdReady && p.receipt_status === 'issued' && p.receipt_number && (
                  <button disabled={acting === p.id} onClick={() => cancel(p)}
                          className="px-3 py-2 rounded-xl text-rose-600 dark:text-rose-400 font-bold text-sm disabled:opacity-50">
                    Аннулировать
                  </button>
                )}
                <button
                  onClick={() => {
                    setTarget(p);
                    setNumber(p.receipt_number || '');
                    setUrl(p.receipt_url || '');
                  }}
                  className={`px-4 py-2 rounded-xl font-bold text-sm ${npdReady ? 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200' : 'bg-indigo-600 text-white'}`}
                >
                  {p.receipt_url || p.receipt_number ? 'Изменить чек' : 'Приложить вручную'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {target && (
        <Sheet onClose={() => setTarget(null)} className="sm:max-w-md p-5 space-y-3">
            <h3 className="font-bold text-slate-800 dark:text-white">Чек НПД</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {target.user_email} · {money(target.amount)} ₽ · {dateTime(target.paid_at)}
            </p>
            <input
              value={number} onChange={e => setNumber(e.target.value)} placeholder="Номер чека"
              className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-200"
            />
            <input
              value={url} onChange={e => setUrl(e.target.value)} placeholder="Ссылка на чек из «Мой налог»"
              className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-200"
            />
            <div className="flex gap-2 pt-1">
              <button onClick={() => setTarget(null)}
                      className="flex-1 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold text-sm">
                Отмена
              </button>
              <button disabled={saving || (!number && !url)} onClick={attach}
                      className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white font-bold text-sm disabled:opacity-50">
                Сохранить и отправить
              </button>
            </div>
          </Sheet>
      )}
    </div>
  );
};

export default AdminPayments;
