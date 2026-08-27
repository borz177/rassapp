import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import type { PartnerRow, User } from '../types';

const money = (v: string | number | null | undefined) =>
  Number(v || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';

/**
 * Бизнес-партнёры: условия и выплаты.
 *
 * Партнёрство надстроено над существующей реферальной связью (users.referred_by):
 * отдельного механизма привязки клиентов не заводили. Реферальная программа с
 * днями работает независимо и здесь не участвует.
 */
const AdminPartners: React.FC<{ users: User[] }> = ({ users }) => {
  const [rows, setRows] = useState<PartnerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Форма назначения
  const [pickedUserId, setPickedUserId] = useState('');
  const [percent, setPercent] = useState('20');
  const [termMonths, setTermMonths] = useState('');

  // Форма выплаты
  const [payoutFor, setPayoutFor] = useState<PartnerRow | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('СБП');
  const [payReceipt, setPayReceipt] = useState('');
  const [payNote, setPayNote] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      setRows(await api.adminGetPartners());
      setError(null);
    } catch (e: any) {
      setError(e.message || 'Не удалось загрузить партнёров');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const savePartner = async (userId: string, enabled: boolean, pct?: string, term?: string) => {
    setSaving(true);
    try {
      await api.adminSetPartner(userId, {
        enabled,
        percent: pct ? Number(pct) : undefined,
        // Пусто — бессрочно. Именно null, а не 0: ноль означал бы «срок вышел сразу».
        termMonths: term === undefined || term === '' ? null : Number(term),
      });
      await load();
      setPickedUserId('');
      setError(null);
    } catch (e: any) {
      setError(e.message || 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  const submitPayout = async () => {
    if (!payoutFor) return;
    setSaving(true);
    try {
      await api.adminPayPartner(payoutFor.id, {
        amount: Number(payAmount),
        method: payMethod || undefined,
        receipt: payReceipt || undefined,
        note: payNote || undefined,
      });
      setPayoutFor(null);
      setPayAmount(''); setPayReceipt(''); setPayNote('');
      await load();
      setError(null);
    } catch (e: any) {
      setError(e.message || 'Не удалось записать выплату');
    } finally {
      setSaving(false);
    }
  };

  const alreadyPartner = new Set(rows.filter(r => r.partner_percent).map(r => r.id));
  const candidates = users.filter(u => u.role === 'manager' && !alreadyPartner.has(u.id));

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/20 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      {/* Назначение партнёра */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 sm:p-5">
        <h3 className="font-bold text-slate-800 dark:text-white mb-1">Сделать бизнес-партнёром</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
          Процент начисляется с каждой оплаты клиентов, зарегистрированных по его реферальной ссылке.
          Начисления идут только с оплат после включения — прошлые платежи не пересчитываются.
        </p>
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto]">
          <select
            value={pickedUserId}
            onChange={e => setPickedUserId(e.target.value)}
            className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-200"
          >
            <option value="">Выберите пользователя…</option>
            {candidates.map(u => (
              <option key={u.id} value={u.id}>{u.name} · {u.email}</option>
            ))}
          </select>
          <input
            type="number" min="1" max="100" value={percent}
            onChange={e => setPercent(e.target.value)}
            placeholder="Процент"
            className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-200"
          />
          <input
            type="number" min="1" value={termMonths}
            onChange={e => setTermMonths(e.target.value)}
            placeholder="Срок, мес. (пусто — бессрочно)"
            className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-200"
          />
          <button
            disabled={!pickedUserId || saving}
            onClick={() => savePartner(pickedUserId, true, percent, termMonths)}
            className="px-5 py-2.5 rounded-xl bg-indigo-600 text-white font-bold text-sm disabled:opacity-50"
          >
            Включить
          </button>
        </div>
        <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">
          Срок считается от даты регистрации клиента, а не от платежа — иначе он обнулялся бы с каждым продлением.
        </p>
      </div>

      {/* Список партнёров */}
      {loading ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Загрузка…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Партнёров пока нет.</p>
      ) : (
        <div className="space-y-3">
          {rows.map(r => {
            const active = !!r.partner_percent;
            return (
              <div key={r.id} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="font-bold text-slate-800 dark:text-white truncate">{r.name}</h4>
                      {!active && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400">
                          выключен
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{r.email}</p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {active ? `${Number(r.partner_percent)}%` : 'процент снят'} ·
                      {' '}с {formatDate(r.partner_since)} ·
                      {' '}{r.partner_term_months ? `${r.partner_term_months} мес.` : 'бессрочно'} ·
                      {' '}клиентов: {Number(r.clients)}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-slate-400 dark:text-slate-500 uppercase font-bold tracking-wider">К выплате</p>
                    <p className="text-2xl font-extrabold text-slate-900 dark:text-white leading-none">
                      {money(r.pending)} <span className="text-base text-slate-400">₽</span>
                    </p>
                    <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                      заработано {money(r.earned)} · выплачено {money(r.paid)}
                    </p>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    disabled={Number(r.pending) <= 0}
                    onClick={() => { setPayoutFor(r); setPayAmount(String(Number(r.pending))); }}
                    className="px-4 py-2 rounded-xl bg-emerald-600 text-white font-bold text-sm disabled:opacity-40"
                  >
                    Отметить выплату
                  </button>
                  {active ? (
                    <button
                      onClick={() => savePartner(r.id, false)}
                      className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold text-sm"
                    >
                      Выключить
                    </button>
                  ) : (
                    <button
                      onClick={() => savePartner(r.id, true, percent, termMonths)}
                      className="px-4 py-2 rounded-xl bg-indigo-600 text-white font-bold text-sm"
                    >
                      Включить снова
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Окно выплаты */}
      {payoutFor && (
        <div className="fixed inset-0 z-modal flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm"
             onClick={() => setPayoutFor(null)}>
          <div className="bg-white dark:bg-slate-800 w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 space-y-3"
               onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-slate-800 dark:text-white">Выплата — {payoutFor.name}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Деньги переводятся вне системы. Здесь фиксируется факт: сумма, способ и номер чека —
              единственное подтверждение, что перевод был за услугу.
            </p>
            <input
              type="number" step="0.01" value={payAmount} onChange={e => setPayAmount(e.target.value)}
              placeholder="Сумма"
              className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-200"
            />
            <input
              value={payMethod} onChange={e => setPayMethod(e.target.value)} placeholder="Способ (СБП, карта…)"
              className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-200"
            />
            <input
              value={payReceipt} onChange={e => setPayReceipt(e.target.value)} placeholder="Номер чека самозанятого"
              className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-200"
            />
            <input
              value={payNote} onChange={e => setPayNote(e.target.value)} placeholder="Комментарий"
              className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-200"
            />
            <div className="flex gap-2 pt-1">
              <button onClick={() => setPayoutFor(null)}
                      className="flex-1 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold text-sm">
                Отмена
              </button>
              <button disabled={saving || !payAmount} onClick={submitPayout}
                      className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white font-bold text-sm disabled:opacity-50">
                Записать
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminPartners;
