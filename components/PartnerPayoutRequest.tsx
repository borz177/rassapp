import React, { useState } from 'react';
import { api } from '../services/api';
import type { PartnerPayoutRequest as RequestRow } from '../types';

const money = (v: string | number | null | undefined) =>
  Number(v || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });

interface Props {
  /** Сколько начислено и ещё не выплачено */
  pending: number;
  /** Порог вывода — приходит с сервера, своего числа здесь нет */
  minPayout: number;
  requests: RequestRow[];
  /** Перечитать сводку после действия */
  onChanged: () => void;
}

const METHODS = ['Перевод по СБП', 'На карту', 'Другое'];

const STATUS_LABEL: Record<RequestRow['status'], string> = {
  pending: 'на рассмотрении',
  paid: 'выплачено',
  rejected: 'отказано',
  cancelled: 'отменена',
};

/**
 * Заявка партнёра на вывод вознаграждения.
 *
 * Партнёр не проводит перевод сам — он просит. Поэтому здесь не «Вывести», а
 * заявка: деньги отправляет человек, и между просьбой и переводом всегда есть
 * пауза. Показывать «выведено» в момент нажатия значило бы обещать то, чего ещё
 * не случилось.
 *
 * Порог берётся с сервера: там же он и проверяется, и разъехаться два числа не
 * могут — иначе кнопка выглядела бы доступной, а запрос возвращал отказ.
 */
const PartnerPayoutRequestBlock: React.FC<Props> = ({ pending, minPayout, requests, onChanged }) => {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState(METHODS[0]);
  const [details, setDetails] = useState('');
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = requests.find(r => r.status === 'pending');
  const history = requests.filter(r => r.status !== 'pending');
  const enough = pending >= minPayout;

  const startNew = () => {
    // Подставляем всё доступное: чаще всего выводят целиком, а поправить проще,
    // чем набирать сумму с нуля.
    setAmount(String(Math.floor(pending)));
    setDetails('');
    setComment('');
    setError(null);
    setOpen(true);
  };

  const submit = async () => {
    const value = Number(String(amount).replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) { setError('Укажите сумму'); return; }
    if (value < minPayout) { setError(`Минимальная сумма вывода — ${money(minPayout)} ₽`); return; }
    if (value > pending) { setError(`К выводу доступно ${money(pending)} ₽`); return; }
    if (!details.trim()) { setError('Укажите, куда перевести деньги'); return; }

    setSending(true);
    setError(null);
    try {
      await api.requestPartnerPayout({ amount: value, method, details: details.trim(), comment: comment.trim() });
      setOpen(false);
      onChanged();
    } catch (e: any) {
      setError(e?.message || 'Не удалось отправить заявку');
    } finally {
      setSending(false);
    }
  };

  const cancel = async (id: string) => {
    setSending(true);
    try {
      await api.cancelPartnerPayout(id);
      onChanged();
    } catch (e: any) {
      setError(e?.message || 'Не удалось отменить заявку');
    } finally {
      setSending(false);
    }
  };

  const input = 'w-full p-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none';

  return (
    <div className="space-y-3">
      {/* Пока заявка на рассмотрении, новую заводить нельзя: две заявки на одни
          и те же деньги — верный способ получить двойной перевод. */}
      {active ? (
        <div className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-bold text-amber-800 dark:text-amber-300">
                Заявка на {money(active.amount)} ₽ отправлена
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                {shortDate(active.created_at)} · {[active.method, active.details].filter(Boolean).join(' · ')}
              </p>
              <p className="text-xs text-amber-700/80 dark:text-amber-400/80 mt-1">
                Деньги переводит человек, поэтому ответ приходит не мгновенно.
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={sending}
            onClick={() => cancel(active.id)}
            className="mt-3 w-full py-2.5 rounded-xl bg-white dark:bg-slate-800 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 text-sm font-bold disabled:opacity-50"
          >
            Отменить заявку
          </button>
        </div>
      ) : open ? (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 space-y-3">
          <h4 className="font-bold text-slate-800 dark:text-white">Вывод вознаграждения</h4>

          <div>
            <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Сумма, ₽</label>
            <input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" className={input} />
            <p className="text-[11px] text-slate-400 mt-1">
              Доступно {money(pending)} ₽, минимум {money(minPayout)} ₽
            </p>
          </div>

          <div>
            <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Способ</label>
            <div className="flex gap-2 flex-wrap">
              {METHODS.map(m => (
                <button key={m} type="button" onClick={() => setMethod(m)}
                        className={`px-3 py-1.5 rounded-full text-xs font-bold ${
                          method === m
                            ? 'bg-indigo-600 text-white'
                            : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                        }`}>
                  {m}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Куда перевести</label>
            <input value={details} onChange={e => setDetails(e.target.value)}
                   placeholder="Телефон для СБП или номер карты" className={input} />
          </div>

          <div>
            <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Комментарий (необязательно)</label>
            <input value={comment} onChange={e => setComment(e.target.value)} className={input} />
          </div>

          {error && (
            <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
              {error}
            </div>
          )}

          <div className="flex gap-2">
            <button type="button" disabled={sending} onClick={() => setOpen(false)}
                    className="flex-1 py-3 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-200 font-bold text-sm disabled:opacity-50">
              Отмена
            </button>
            <button type="button" disabled={sending} onClick={submit}
                    className="flex-[1.4] py-3 rounded-xl bg-emerald-600 text-white font-bold text-sm disabled:opacity-50 active:scale-95 transition-transform">
              {sending ? 'Отправляем…' : 'Отправить заявку'}
            </button>
          </div>
        </div>
      ) : (
        <>
          <button
            type="button"
            disabled={!enough}
            onClick={startNew}
            className="w-full py-3 rounded-2xl bg-emerald-600 text-white font-bold disabled:bg-slate-200 dark:disabled:bg-slate-700 disabled:text-slate-400 dark:disabled:text-slate-500 active:scale-[0.98] transition-transform"
          >
            Вывести вознаграждение
          </button>
          {/* Недоступную кнопку объясняем: иначе она читается как поломка. */}
          {!enough && (
            <p className="text-xs text-slate-500 dark:text-slate-400 text-center">
              Вывод возможен от {money(minPayout)} ₽ — сейчас накоплено {money(pending)} ₽
            </p>
          )}
        </>
      )}

      {error && !open && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
          {error}
        </div>
      )}

      {history.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700">
            <h4 className="text-sm font-bold text-slate-700 dark:text-slate-200">Заявки на вывод</h4>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-700">
            {history.map(r => (
              <div key={r.id} className="px-4 py-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800 dark:text-white">{money(r.amount)} ₽</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {shortDate(r.created_at)}
                    {r.method ? ` · ${r.method}` : ''}
                  </p>
                  {/* Причина отказа — то единственное, ради чего сюда вернутся. */}
                  {r.status === 'rejected' && r.reject_reason && (
                    <p className="text-[11px] text-rose-500 mt-0.5">{r.reject_reason}</p>
                  )}
                </div>
                <span className={`text-[10px] font-bold shrink-0 ${
                  r.status === 'paid' ? 'text-emerald-600 dark:text-emerald-400'
                    : r.status === 'rejected' ? 'text-rose-500'
                    : 'text-slate-400 dark:text-slate-500'
                }`}>
                  {STATUS_LABEL[r.status]}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default PartnerPayoutRequestBlock;
