import React, { useEffect, useState } from 'react';
import Auth from './Auth';
import { api } from '../services/api';

/**
 * Страница «Разрешить помощнику доступ к вашим данным».
 *
 * Сюда помощник (например, GPT в ChatGPT) приводит человека по адресу
 * /oauth/authorize?client_id=…&redirect_uri=…&scope=…&state=…&code_challenge=…
 * Человек видит, кто просит доступ, под каким аккаунтом он вошёл и что именно
 * будет разрешено. После «Разрешить» сервер выдаёт одноразовый код, и мы
 * возвращаем человека обратно к помощнику.
 *
 * Страница намеренно отдельная и без бокового меню: это не экран приложения,
 * а место, где принимают одно решение. Всё лишнее здесь мешает.
 */

type Info = {
  app: { name: string };
  scopes: { key: string; title: string }[];
  allowed: boolean;
  reason: string | null;
};

const OAuthConsent: React.FC = () => {
  const params = new URLSearchParams(window.location.search);
  const request = {
    client_id: params.get('client_id') || '',
    redirect_uri: params.get('redirect_uri') || '',
    scope: params.get('scope') || 'read',
    state: params.get('state') || '',
    code_challenge: params.get('code_challenge') || '',
    code_challenge_method: params.get('code_challenge_method') || '',
  };

  const [authed, setAuthed] = useState(() => !!localStorage.getItem('token'));
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!authed) return;
    if (!request.client_id || !request.redirect_uri) {
      setError('Ссылка неполная: помощник не передал, кто он и куда вернуться.');
      return;
    }
    api.oauthAuthorizeInfo(request)
      .then(setInfo)
      .catch(e => setError(e.message));
  }, [authed]);

  const decide = async (approve: boolean) => {
    setBusy(true); setError(null);
    try {
      if (!approve) {
        // Отказ возвращаем помощнику по правилам протокола: он должен понять,
        // что человек отказался, а не что всё сломалось.
        const url = new URL(request.redirect_uri);
        url.searchParams.set('error', 'access_denied');
        if (request.state) url.searchParams.set('state', request.state);
        window.location.href = url.toString();
        return;
      }
      const { redirectTo } = await api.oauthApprove(request);
      window.location.href = redirectTo;
    } catch (e: any) {
      setError(e.message || 'Не удалось подтвердить доступ');
      setBusy(false);
    }
  };

  if (!authed) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
        <div className="max-w-md mx-auto px-5 pt-8 pb-4 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Войдите в FinUchet, чтобы разрешить доступ помощнику
          </p>
        </div>
        <Auth onLogin={() => setAuthed(true)} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center px-5 py-10">
      <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm p-6 sm:p-8">
        <div className="text-2xl font-black bg-gradient-to-r from-indigo-600 to-teal-600 bg-clip-text text-transparent">
          FinUchet
        </div>

        {error ? (
          <>
            <h1 className="mt-5 text-xl font-bold text-slate-900 dark:text-white">Не получилось</h1>
            <p className="mt-2 text-[15px] text-slate-600 dark:text-slate-300 leading-relaxed">{error}</p>
            <a href="/app" className="mt-6 inline-block text-sm font-bold text-indigo-600 dark:text-indigo-400">
              Вернуться в приложение
            </a>
          </>
        ) : !info ? (
          <p className="mt-6 text-sm text-slate-500 dark:text-slate-400">Загрузка…</p>
        ) : !info.allowed ? (
          <>
            <h1 className="mt-5 text-xl font-bold text-slate-900 dark:text-white">Доступ закрыт</h1>
            <p className="mt-2 text-[15px] text-slate-600 dark:text-slate-300 leading-relaxed">{info.reason}</p>
            <a href="/app" className="mt-6 inline-block text-sm font-bold text-indigo-600 dark:text-indigo-400">
              Вернуться в приложение
            </a>
          </>
        ) : (
          <>
            <h1 className="mt-5 text-xl font-bold text-slate-900 dark:text-white">
              «{info.app.name}» просит доступ к вашим данным
            </h1>

            <ul className="mt-5 space-y-2.5">
              {info.scopes.map(s => (
                <li key={s.key} className="flex gap-2.5 text-[15px] text-slate-700 dark:text-slate-200">
                  <span className="text-indigo-600 dark:text-indigo-400 mt-0.5 shrink-0">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </span>
                  {s.title}
                </li>
              ))}
            </ul>

            <div className="mt-5 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-4 py-3">
              <p className="text-[13px] text-amber-800 dark:text-amber-300 leading-relaxed">
                Помощник увидит данные ваших покупателей — имена, телефоны, суммы договоров.
                Разрешайте только тому, кому доверяете. Отключить можно в любой момент:
                «Настройки → Интеграции → Подключённые приложения».
              </p>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                onClick={() => decide(true)} disabled={busy}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl py-3 transition-colors disabled:opacity-50"
              >
                {busy ? 'Подождите…' : 'Разрешить'}
              </button>
              <button
                onClick={() => decide(false)} disabled={busy}
                className="px-5 font-bold text-slate-500 dark:text-slate-400 disabled:opacity-50"
              >
                Отмена
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default OAuthConsent;
