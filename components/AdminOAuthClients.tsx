import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import { OAuthClientInfo } from '../types';

/**
 * Регистрация помощников, которые входят «Через FinUchet».
 *
 * Один помощник — одна запись: например, GPT в ChatGPT. Ему выдаётся пара
 * «идентификатор + секрет», которую вписывают в настройках помощника, и список
 * адресов возврата: туда и только туда мы отправляем человека после согласия.
 * Секрет показывается один раз — в базе от него только отпечаток.
 */
const AdminOAuthClients: React.FC = () => {
  const [clients, setClients] = useState<OAuthClientInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [uris, setUris] = useState('');
  const [fresh, setFresh] = useState<{ clientId: string; clientSecret: string } | null>(null);

  const load = async () => {
    try {
      setClients(await api.adminListOAuthClients());
    } catch (e: any) {
      setClients([]);
      setError(e.message);
    }
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    const list = uris.split('\n').map(u => u.trim()).filter(Boolean);
    if (!list.length) { setError('Укажите хотя бы один адрес возврата'); return; }
    setBusy(true); setError(null);
    try {
      const created = await api.adminCreateOAuthClient(name.trim() || 'Помощник', list);
      setFresh({ clientId: created.clientId, clientSecret: created.clientSecret });
      setName(''); setUris('');
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const disable = async (client: OAuthClientInfo) => {
    if (!window.confirm(`Отключить «${client.name}»? Все ${client.connections} подключений пользователей перестанут работать.`)) return;
    setBusy(true);
    try {
      await api.adminDisableOAuthClient(client.id);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
        <h3 className="font-bold text-slate-800 dark:text-white">Адреса для настроек помощника</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Их вписывают в конструкторе помощника при настройке входа.
        </p>
        <dl className="mt-3 space-y-2 text-sm">
          {[
            ['Страница входа', 'https://rassrochka.pro/oauth/authorize'],
            ['Обмен токенов', 'https://rassrochka.pro/api/oauth/token'],
            ['Описание API', 'https://rassrochka.pro/api/v1/openapi.json'],
            ['Права', 'read или read write'],
          ].map(([label, value]) => (
            <div key={label} className="flex flex-wrap items-center gap-2">
              <dt className="text-slate-500 dark:text-slate-400 w-36 shrink-0">{label}</dt>
              <dd className="font-mono text-[12.5px] text-slate-800 dark:text-slate-100 break-all">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {fresh && (
        <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-2xl p-5">
          <h3 className="font-bold text-emerald-800 dark:text-emerald-300">Помощник зарегистрирован</h3>
          <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-1">
            Секрет показан один раз — сохраните его сейчас.
          </p>
          <div className="mt-3 space-y-2">
            {[['client_id', fresh.clientId], ['client_secret', fresh.clientSecret]].map(([label, value]) => (
              <div key={label} className="flex items-center gap-2">
                <span className="text-xs text-emerald-700 dark:text-emerald-400 w-24 shrink-0">{label}</span>
                <code className="flex-1 bg-white dark:bg-slate-900 rounded-lg px-3 py-2 text-xs font-mono break-all border border-emerald-200 dark:border-emerald-800">
                  {value}
                </code>
                <button
                  onClick={() => { navigator.clipboard.writeText(value); }}
                  className="text-xs font-bold text-emerald-700 dark:text-emerald-400 shrink-0"
                >
                  Копировать
                </button>
              </div>
            ))}
          </div>
          <button onClick={() => setFresh(null)} className="mt-3 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline">
            Я сохранил
          </button>
        </div>
      )}

      {error && <p className="text-sm text-rose-600 bg-rose-50 dark:bg-rose-900/20 rounded-xl px-4 py-2.5">{error}</p>}

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
        <h3 className="font-bold text-slate-800 dark:text-white mb-3">Зарегистрированные помощники</h3>
        {clients === null ? (
          <p className="text-sm text-slate-500">Загрузка…</p>
        ) : clients.length === 0 ? (
          <p className="text-sm text-slate-400 italic">Пока ни одного.</p>
        ) : (
          <ul className="space-y-2">
            {clients.map(c => (
              <li key={c.id} className="flex items-start justify-between gap-3 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800 dark:text-white">
                    {c.name}{c.disabledAt && <span className="ml-2 text-xs font-normal text-rose-500">отключён</span>}
                  </p>
                  <p className="text-[11px] text-slate-400 break-all">
                    {c.id} · подключений: {c.connections}
                  </p>
                  <p className="text-[11px] text-slate-400 break-all">{c.redirectUris.join(', ')}</p>
                </div>
                {!c.disabledAt && (
                  <button onClick={() => disable(c)} disabled={busy}
                          className="text-xs font-bold text-rose-600 dark:text-rose-400 hover:underline disabled:opacity-50 shrink-0">
                    Отключить
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 space-y-3">
        <h3 className="font-bold text-slate-800 dark:text-white">Зарегистрировать помощника</h3>
        <div>
          <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">Название</label>
          <input
            value={name} onChange={e => setName(e.target.value)} maxLength={80}
            autoComplete="off" autoCorrect="off" spellCheck={false}
            placeholder="GPT в ChatGPT"
            className="w-full p-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-600 rounded-xl text-sm text-slate-700 dark:text-slate-200"
          />
          <p className="text-[11px] text-slate-400 mt-1">Его увидит пользователь на странице согласия.</p>
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">Адреса возврата</label>
          <textarea
            value={uris} onChange={e => setUris(e.target.value)} rows={3}
            spellCheck={false}
            placeholder="https://chatgpt.com/aip/g-…/oauth/callback"
            className="w-full p-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-600 rounded-xl text-sm font-mono text-slate-700 dark:text-slate-200"
          />
          <p className="text-[11px] text-slate-400 mt-1">
            По одному в строке, только https. Конструктор помощника показывает этот адрес после сохранения настроек входа.
          </p>
        </div>
        <button onClick={create} disabled={busy}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-xl py-2.5 transition-colors disabled:opacity-50">
          {busy ? 'Регистрируем…' : 'Зарегистрировать'}
        </button>
      </div>
    </div>
  );
};

export default AdminOAuthClients;
