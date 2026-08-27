import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import type { AdminPayment } from '../types';

const money = (v: string | number) =>
  Number(v || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });

/**
 * Журнал оплат и чеки НПД.
 *
 * Кассовый чек по 54-ФЗ здесь не выпускается: самозанятый ККТ не применяет.
 * Его документ — чек НПД из «Мой налог», выписывается там вручную. Сюда
 * приложили номер и ссылку — человеку ушло письмо с чеком.
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

  const load = async () => {
    setLoading(true);
    try {
      setRows(await api.adminGetPayments());
      setError(null);
    } catch (e: any) {
      setError(e.message || 'Не удалось загрузить оплаты');
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
      setError(e.message || 'Не удалось сохранить чек');
    } finally {
      setSaving(false);
    }
  };

  const visible = onlyWithout ? rows.filter(r => !r.receipt_url && !r.receipt_number) : rows;

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Письмо о поступлении оплаты уходит автоматически. Чек НПД выписывается в «Мой налог»,
          сюда прикладывается его ссылка — и человеку уходит второе письмо, уже с чеком.
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
                {(p.receipt_number || p.receipt_url) && (
                  <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-0.5">
                    чек {p.receipt_number || ''} {p.receipt_url ? '· ссылка есть' : ''}
                  </p>
                )}
              </div>
              <button
                onClick={() => {
                  setTarget(p);
                  setNumber(p.receipt_number || '');
                  setUrl(p.receipt_url || '');
                }}
                className="px-4 py-2 rounded-xl bg-indigo-600 text-white font-bold text-sm shrink-0"
              >
                {p.receipt_url || p.receipt_number ? 'Изменить чек' : 'Приложить чек'}
              </button>
            </div>
          ))}
        </div>
      )}

      {target && (
        <div className="fixed inset-0 z-modal flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm"
             onClick={() => setTarget(null)}>
          <div className="bg-white dark:bg-slate-800 w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 space-y-3"
               onClick={e => e.stopPropagation()}>
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
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminPayments;
