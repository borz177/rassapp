import React, { useEffect, useMemo, useState } from 'react';
import { api, type AdminWhatsAppReport, type AdminWhatsAppRow } from '../services/api';
import { friendlyError } from '../src/friendlyError';
import { appConfirm } from '../src/dialogs';

/**
 * Кто подключил WhatsApp: способ (встроенный или Green API), номер, на связи
 * ли сейчас, сколько ушло сегодня и за неделю, последняя ошибка. Отсюда видно,
 * у кого номер отвалился или упёрся в лимит, — раньше это узнавали, только
 * когда клиент жаловался, что напоминания не пришли.
 */

const PLAN_NAMES: Record<string, string> = {
  TRIAL: 'Пробный', START: 'Старт', STANDARD: 'Стандарт', BUSINESS: 'Бизнес', BUSINESS_PRO: 'Бизнес Pro',
};

const formatPhone = (digits: string | null) =>
  !digits ? '—'
    : /^7\d{10}$/.test(digits)
      ? `+7 ${digits.slice(1, 4)} ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9)}`
      : `+${digits}`;

const dateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

const date = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—';

const statusOf = (r: AdminWhatsAppRow): { label: string; tone: string } => {
  if (!r.enabled) return { label: 'Выключен', tone: 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300' };
  if (r.provider === 'greenapi') return { label: 'Green API', tone: 'bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300' };
  if (!r.live) return { label: 'Нет ответа', tone: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' };
  if (r.live.loggedIn) return { label: 'На связи', tone: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' };
  return { label: 'Отключился', tone: 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300' };
};

const Stat: React.FC<{ label: string; value: React.ReactNode; tone?: string }> = ({ label, value, tone }) => (
  <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-4">
    <div className="text-xs font-bold text-slate-400 uppercase tracking-wide">{label}</div>
    <div className={`mt-1 text-2xl font-bold ${tone || 'text-slate-800 dark:text-white'}`}>{value}</div>
  </div>
);

const AdminWhatsApp: React.FC = () => {
  const [report, setReport] = useState<AdminWhatsAppReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'builtin' | 'greenapi' | 'problems'>('all');
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try { setReport(await api.adminGetWhatsApp()); }
    catch (e) { setError(friendlyError(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const rows = report?.rows || [];
  const totals = useMemo(() => {
    const builtin = rows.filter(r => r.provider === 'builtin' && r.enabled);
    return {
      connected: rows.filter(r => r.enabled).length,
      builtin: builtin.length,
      online: builtin.filter(r => r.live?.loggedIn).length,
      green: rows.filter(r => r.provider === 'greenapi' && r.enabled).length,
      sentToday: rows.reduce((s, r) => s + r.today.sent, 0),
      failedToday: rows.reduce((s, r) => s + r.today.failed, 0),
    };
  }, [rows]);

  const isProblem = (r: AdminWhatsAppRow) =>
    (r.provider === 'builtin' && r.enabled && !r.live?.loggedIn)
    || r.today.failed > 0
    || (!!r.quota && r.quota.left === 0);

  const shown = rows.filter(r =>
    filter === 'all' ? true : filter === 'problems' ? isProblem(r) : r.provider === filter);

  const disconnect = async (r: AdminWhatsAppRow) => {
    if (!await appConfirm({
      title: `Отключить WhatsApp у ${r.name || r.email}?`,
      message: 'Номер отвяжется от сервиса, напоминания перестанут уходить. Пользователь сможет подключить его снова.',
      confirmLabel: 'Отключить', destructive: true,
    })) return;
    setBusy(r.userId);
    try { await api.adminDisconnectWhatsApp(r.userId); await load(); }
    catch (e) { setError(friendlyError(e)); }
    finally { setBusy(null); }
  };

  return (
    <div className="space-y-4">
      {/* Состояние самого сервиса встроенного WhatsApp */}
      {report && (
        <div className={`rounded-2xl px-4 py-3 text-sm border ${
          !report.service.available
            ? 'bg-slate-50 border-slate-200 text-slate-600 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300'
            : report.service.reachable
              ? 'bg-emerald-50 border-emerald-100 text-emerald-800 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:text-emerald-300'
              : 'bg-rose-50 border-rose-100 text-rose-700 dark:bg-rose-500/10 dark:border-rose-500/20 dark:text-rose-300'
        }`}>
          {!report.service.available ? 'Встроенный WhatsApp не настроен на сервере'
            : report.service.reachable ? `WhatsApp-сервис работает · сессий: ${report.service.sessions ?? '—'}`
              : 'WhatsApp-сервис не отвечает — встроенные подключения не отправляют сообщения'}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat label="Подключено" value={totals.connected} />
        <Stat label="Встроенный" value={`${totals.online}/${totals.builtin}`} tone={totals.online < totals.builtin ? 'text-amber-600 dark:text-amber-400' : undefined} />
        <Stat label="Green API" value={totals.green} />
        <Stat label="Отправлено сегодня" value={totals.sentToday} tone="text-emerald-600 dark:text-emerald-400" />
        <Stat label="Ошибок сегодня" value={totals.failedToday} tone={totals.failedToday ? 'text-rose-600 dark:text-rose-400' : undefined} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {([
          ['all', 'Все'], ['builtin', 'Встроенный'], ['greenapi', 'Green API'], ['problems', 'С проблемами'],
        ] as const).map(([id, label]) => (
          <button key={id} onClick={() => setFilter(id)}
                  className={`px-3.5 py-2 rounded-full text-xs font-bold transition-colors ${
                    filter === id ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                  }`}>
            {label}
          </button>
        ))}
        <button onClick={load} disabled={loading}
                className="ml-auto px-3.5 py-2 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300 disabled:opacity-50">
          {loading ? 'Загрузка…' : 'Обновить'}
        </button>
      </div>

      {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs font-bold uppercase tracking-wide text-slate-400 border-b border-slate-100 dark:border-slate-700">
              <th className="px-4 py-3">Пользователь</th>
              <th className="px-4 py-3">Способ / номер</th>
              <th className="px-4 py-3">Статус</th>
              <th className="px-4 py-3">Сегодня</th>
              <th className="px-4 py-3">7 дней</th>
              <th className="px-4 py-3">Последняя отправка</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {shown.map(r => {
              const st = statusOf(r);
              return (
                <tr key={r.userId} className="align-top">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-800 dark:text-white">{r.name || '—'}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">{r.email}</div>
                    <div className="text-xs text-slate-400">{r.plan ? PLAN_NAMES[r.plan] || r.plan : '—'}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-700 dark:text-slate-200">{r.provider === 'builtin' ? 'Встроенный' : 'Green API'}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                      {r.provider === 'builtin' ? formatPhone(r.phone) : r.idInstance ? `инстанс ${r.idInstance}` : '—'}
                    </div>
                    {r.since && <div className="text-xs text-slate-400">с {date(r.since)}</div>}
                    {r.reminderTime && <div className="text-xs text-slate-400">рассылка в {r.reminderTime}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-bold ${st.tone}`}>{st.label}</span>
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    <div className="text-slate-700 dark:text-slate-200">
                      {r.today.sent}{r.quota ? <span className="text-slate-400"> / {r.quota.limit}</span> : null}
                    </div>
                    {(r.today.failed > 0 || r.today.skipped > 0) && (
                      <div className="text-xs text-slate-400">
                        {r.today.failed > 0 && <span className="text-rose-600 dark:text-rose-400">ошибок {r.today.failed}</span>}
                        {r.today.failed > 0 && r.today.skipped > 0 && ' · '}
                        {r.today.skipped > 0 && <span>пропущено {r.today.skipped}</span>}
                      </div>
                    )}
                    {r.quota && r.quota.left === 0 && <div className="text-xs text-amber-600 dark:text-amber-400">лимит исчерпан</div>}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    <div className="text-slate-700 dark:text-slate-200">{r.week.sent}</div>
                    {r.week.failed > 0 && <div className="text-xs text-rose-600 dark:text-rose-400">ошибок {r.week.failed}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-slate-700 dark:text-slate-200 tabular-nums">{dateTime(r.lastAt)}</div>
                    {r.lastError && <div className="text-xs text-rose-600 dark:text-rose-400 max-w-[220px] truncate" title={r.lastError}>{r.lastError}</div>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {r.provider === 'builtin' && r.enabled && (
                      <button onClick={() => disconnect(r)} disabled={busy === r.userId}
                              className="text-xs font-bold text-rose-600 dark:text-rose-400 hover:underline disabled:opacity-50">
                        {busy === r.userId ? '…' : 'Отключить'}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {!loading && shown.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">Никого нет</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AdminWhatsApp;
