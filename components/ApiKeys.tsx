import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import { ApiKeyInfo, ApiKeyScope, OAuthConnection } from '../types';

/**
 * API-ключи: выдача, права и отзыв.
 *
 * Ключ показывается ровно один раз — сразу после создания. В базе у нас только
 * хеш, и восстановить ключ нельзя даже администратору: это и есть главная
 * защита, если база когда-нибудь утечёт. Поэтому созданный ключ показан крупно,
 * с кнопкой копирования и прямым предупреждением.
 */

const fmtDate = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
};

const SCOPE_LABEL: Record<string, string> = { read: 'чтение', write: 'запись' };

const ApiKeys: React.FC<{ allowed: boolean; onUpgrade?: () => void }> = ({ allowed, onUpgrade }) => {
  const [keys, setKeys] = useState<ApiKeyInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [canWrite, setCanWrite] = useState(false);
  const [fresh, setFresh] = useState<{ key: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);
  // Помощники, которым человек разрешил доступ входом «Через FinUchet».
  // Живут рядом с ключами: и то и другое — доступ к своим данным снаружи.
  const [connections, setConnections] = useState<OAuthConnection[]>([]);

  useEffect(() => {
    if (!allowed) { setKeys([]); return; }
    let alive = true;
    api.listApiKeys()
      .then(list => { if (alive) setKeys(list); })
      .catch(e => { if (alive) { setKeys([]); setError(e.message); } });
    api.listOAuthConnections()
      .then(list => { if (alive) setConnections(list); })
      .catch(() => { /* подключений может не быть вовсе — это не ошибка экрана */ });
    return () => { alive = false; };
  }, [allowed]);

  const create = async () => {
    setBusy(true); setError(null);
    try {
      const scopes: ApiKeyScope[] = canWrite ? ['read', 'write'] : ['read'];
      const made = await api.createApiKey(name.trim() || 'Ключ', scopes);
      setFresh({ key: made.key, name: made.name });
      setKeys(await api.listApiKeys());
      setCreating(false); setName(''); setCanWrite(false);
    } catch (e: any) {
      setError(e.message || 'Не удалось создать ключ');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (item: ApiKeyInfo) => {
    if (!window.confirm(`Отозвать ключ «${item.name}»? Всё, что им пользуется, сразу перестанет работать.`)) return;
    setBusy(true); setError(null);
    try {
      await api.revokeApiKey(item.id);
      setKeys(await api.listApiKeys());
    } catch (e: any) {
      setError(e.message || 'Не удалось отозвать ключ');
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (item: OAuthConnection) => {
    if (!window.confirm(`Отключить «${item.app}»? Помощник сразу потеряет доступ к вашим данным.`)) return;
    setBusy(true); setError(null);
    try {
      await api.revokeOAuthConnection(item.id);
      setConnections(await api.listOAuthConnections());
    } catch (e: any) {
      setError(e.message || 'Не удалось отключить');
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!fresh) return;
    try {
      await navigator.clipboard.writeText(fresh.key);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* буфер закрыт настройками браузера — ключ и так виден целиком */ }
  };

  const active = (keys || []).filter(k => !k.revokedAt);
  const revoked = (keys || []).filter(k => k.revokedAt);

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700">
      <div className="p-5 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-indigo-500 flex items-center justify-center text-white">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m21 2-9.6 9.6" /><circle cx="7.5" cy="15.5" r="5.5" /><path d="m21 2-2 2" /><path d="m15.5 7.5 3 3" />
            </svg>
          </div>
          <div>
            <h3 className="font-bold text-slate-800 dark:text-white">API-ключи</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">Для сайта, бота или 1С — свои данные по ключу</p>
          </div>
        </div>
        <a
          href="/api" target="_blank" rel="noreferrer"
          className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline shrink-0 pt-1"
        >
          Документация
        </a>
      </div>

      {!allowed ? (
        <div className="px-5 pb-5">
          <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-4 py-3">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Доступно на тарифах Бизнес и Бизнес Pro</p>
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
              По ключу можно завести клиента с сайта, принять платёж из бота или выгрузить договоры в 1С.
            </p>
            {onUpgrade && (
              <button onClick={onUpgrade} className="mt-3 text-xs font-bold text-white bg-amber-500 hover:bg-amber-600 rounded-lg px-3 py-2 transition-colors">
                Посмотреть тарифы
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="px-5 pb-5 space-y-3">
          {fresh && (
            <div className="rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 p-4">
              <p className="text-sm font-bold text-emerald-800 dark:text-emerald-300">Ключ «{fresh.name}» создан</p>
              <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-1">
                Скопируйте его сейчас: больше он нигде не покажется — в базе хранится только отпечаток.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <code className="flex-1 text-xs font-mono break-all bg-white dark:bg-slate-900 rounded-lg px-3 py-2 border border-emerald-200 dark:border-emerald-800 text-slate-800 dark:text-slate-100">
                  {fresh.key}
                </code>
                <button onClick={copy} className="shrink-0 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg px-3 py-2 transition-colors">
                  {copied ? 'Скопировано' : 'Копировать'}
                </button>
              </div>
              <button onClick={() => setFresh(null)} className="mt-3 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline">
                Я сохранил ключ
              </button>
            </div>
          )}

          {error && (
            <p className="text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 rounded-lg px-3 py-2">{error}</p>
          )}

          {keys === null ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Загрузка…</p>
          ) : active.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Ключей пока нет.</p>
          ) : (
            <ul className="space-y-2">
              {active.map(k => (
                <li key={k.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800 dark:text-white truncate">{k.name}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {k.prefix}… · {k.scopes.map(s => SCOPE_LABEL[s] || s).join(' и ')}
                      {fmtDate(k.lastUsedAt) ? ` · последний запрос ${fmtDate(k.lastUsedAt)}` : ' · ещё не использовался'}
                    </p>
                  </div>
                  <button
                    onClick={() => revoke(k)} disabled={busy}
                    className="shrink-0 text-xs font-bold text-rose-600 dark:text-rose-400 hover:underline disabled:opacity-50"
                  >
                    Отозвать
                  </button>
                </li>
              ))}
            </ul>
          )}

          {revoked.length > 0 && (
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              Отозвано ключей: {revoked.length}. Они больше не работают.
            </p>
          )}

          {connections.length > 0 && (
            <div className="pt-1">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">Подключённые помощники</p>
              <ul className="space-y-2">
                {connections.map(c => (
                  <li key={c.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-800 dark:text-white truncate">{c.app}</p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {c.scopes.map(sc => SCOPE_LABEL[sc] || sc).join(' и ')}
                        {fmtDate(c.lastUsedAt) ? ` · последний запрос ${fmtDate(c.lastUsedAt)}` : ' · ещё не обращался'}
                      </p>
                    </div>
                    <button
                      onClick={() => disconnect(c)} disabled={busy}
                      className="shrink-0 text-xs font-bold text-rose-600 dark:text-rose-400 hover:underline disabled:opacity-50"
                    >
                      Отключить
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {creating ? (
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Название</label>
                <input
                  value={name} onChange={e => setName(e.target.value)} maxLength={60}
                  placeholder="Например: сайт или бот"
                  className="mt-1 w-full p-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-600 rounded-xl text-sm text-slate-700 dark:text-slate-200"
                />
                <p className="text-[11px] text-slate-400 mt-1">Название видно только вам — по нему понятно, что отзывать.</p>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Права</label>
                <div className="mt-1 space-y-2">
                  {[
                    { write: false, title: 'Только чтение', hint: 'Выгрузка договоров, платежей и остатков. Ничего изменить нельзя.' },
                    { write: true, title: 'Чтение и запись', hint: 'Плюс создание клиентов, договоров, платежей и расходов.' },
                  ].map(opt => (
                    <button
                      key={String(opt.write)} type="button" onClick={() => setCanWrite(opt.write)}
                      className={`w-full text-left rounded-xl border px-3 py-2.5 transition-colors ${
                        canWrite === opt.write
                          ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-900/20'
                          : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'
                      }`}
                    >
                      <p className="text-sm font-semibold text-slate-800 dark:text-white">{opt.title}</p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">{opt.hint}</p>
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={create} disabled={busy}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-xl py-2.5 transition-colors disabled:opacity-50"
                >
                  {busy ? 'Создаём…' : 'Создать ключ'}
                </button>
                <button
                  onClick={() => { setCreating(false); setError(null); }}
                  className="px-4 text-sm font-bold text-slate-500 dark:text-slate-400"
                >
                  Отмена
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setCreating(true)}
              className="w-full border border-dashed border-slate-300 dark:border-slate-600 rounded-xl py-2.5 text-sm font-bold text-slate-600 dark:text-slate-300 hover:border-indigo-400 hover:text-indigo-600 transition-colors"
            >
              Создать ключ
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default ApiKeys;
