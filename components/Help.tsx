import React, { useEffect, useState } from 'react';
import { HELP_ARTICLES, HelpArticle } from '../src/helpArticles';

/**
 * «Обучение»: список тем → статья по шагам со снимками экрана.
 *
 * Самостоятельный экран — без данных приложения: тот же компонент показывает
 * и раздел в меню «Ещё», и открытую страницу rassrochka.pro/help, которую можно
 * отправить человеку ссылкой. Ссылка на статью — #<id> (rassrochka.pro/help#sale).
 */

interface HelpProps {
  /** Открыть сразу статью */
  initialArticle?: string;
  /** Кнопка «Написать в поддержку» — только в приложении */
  onSupport?: () => void;
  /** Публичная страница: своя шапка с названием и ссылкой на сайт */
  standalone?: boolean;
}

const articleFromHash = () => {
  if (typeof window === 'undefined') return null;
  const id = window.location.hash.replace('#', '');
  return HELP_ARTICLES.find(a => a.id === id) || null;
};

const Help: React.FC<HelpProps> = ({ initialArticle, onSupport, standalone }) => {
  const [article, setArticle] = useState<HelpArticle | null>(() =>
    (initialArticle && HELP_ARTICLES.find(a => a.id === initialArticle)) || (standalone ? articleFromHash() : null));
  const [zoom, setZoom] = useState<string | null>(null);

  // На публичной странице статья — в адресе: «назад» в браузере возвращает к списку
  useEffect(() => {
    if (!standalone) return;
    const onHash = () => setArticle(articleFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [standalone]);

  const open = (a: HelpArticle | null) => {
    if (standalone) window.location.hash = a ? a.id : '';
    setArticle(a);
    window.scrollTo(0, 0);
    document.querySelectorAll('.page-push-layer').forEach(l => { (l as HTMLElement).scrollTop = 0; });
  };

  return (
    <div className={`space-y-4 pb-24 ${standalone ? 'max-w-2xl mx-auto px-4 pt-6' : ''}`}>
      {standalone && (
        <a href="/" className="flex w-fit items-center gap-2 text-sm font-bold text-indigo-600 dark:text-indigo-400">
          FinUchet · rassrochka.pro
        </a>
      )}

      {!article ? (
        <>
          <div>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Обучение</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Коротко, по шагам и со снимками экрана</p>
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {HELP_ARTICLES.map((a, i) => (
              <button key={a.id} onClick={() => open(a)}
                      className="flex items-center gap-3.5 p-4 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 text-left active:scale-[0.99] hover:border-indigo-300 dark:hover:border-indigo-500/50 transition-all">
                <span className="w-11 h-11 shrink-0 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-xl" aria-hidden>{a.icon}</span>
                <span className="flex-1 min-w-0">
                  <span className="block font-semibold text-slate-900 dark:text-white">{i + 1}. {a.title}</span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">{a.summary}</span>
                </span>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" className="shrink-0 text-slate-300 dark:text-slate-600" aria-hidden><polyline points="9 18 15 12 9 6" /></svg>
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <button onClick={() => open(null)} className="inline-flex items-center gap-1 text-sm font-bold text-indigo-600 dark:text-indigo-400">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden><polyline points="15 18 9 12 15 6" /></svg>
            Все темы
          </button>
          <div className="flex items-center gap-3">
            <span className="text-3xl" aria-hidden>{article.icon}</span>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white leading-tight">{article.title}</h2>
          </div>

          <ol className="space-y-5">
            {article.steps.map((s, i) => (
              <li key={i} className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 p-4">
                <div className="flex gap-3">
                  <span className="w-7 h-7 shrink-0 rounded-full bg-indigo-600 text-white text-sm font-bold flex items-center justify-center">{i + 1}</span>
                  <div className="min-w-0 pt-0.5">
                    <p className="text-[15px] leading-snug text-slate-800 dark:text-slate-100">{s.text}</p>
                    {s.note && <p className="mt-1.5 text-xs leading-snug text-slate-500 dark:text-slate-400">{s.note}</p>}
                  </div>
                </div>
                {s.image && (
                  <button onClick={() => setZoom(s.image!)} className="mt-3.5 block mx-auto" aria-label="Открыть снимок крупно">
                    <img src={s.image} alt="" loading="lazy" width={270} height={584}
                         className="w-[240px] sm:w-[270px] h-auto rounded-[22px] border border-slate-200 dark:border-slate-700 shadow-md bg-slate-100 dark:bg-slate-900" />
                  </button>
                )}
              </li>
            ))}
          </ol>

          {(() => {
            const idx = HELP_ARTICLES.findIndex(a => a.id === article.id);
            const next = HELP_ARTICLES[idx + 1];
            return next && (
              <button onClick={() => open(next)}
                      className="w-full flex items-center justify-between gap-3 p-4 rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 text-left">
                <span>
                  <span className="block text-xs text-indigo-600/70 dark:text-indigo-300/70">Дальше</span>
                  <span className="block font-semibold text-indigo-700 dark:text-indigo-300">{next.icon} {next.title}</span>
                </span>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" className="text-indigo-400" aria-hidden><polyline points="9 18 15 12 9 6" /></svg>
              </button>
            );
          })()}
        </>
      )}

      {standalone && (
        <a href="/" className="block w-full text-center py-3.5 rounded-2xl bg-indigo-600 text-white font-bold">
          Начать пользоваться
        </a>
      )}

      {onSupport && (
        <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-600 p-4 text-center">
          <p className="text-sm text-slate-600 dark:text-slate-300">Не нашли ответ?</p>
          <button onClick={onSupport} className="mt-2 px-4 py-2 rounded-xl bg-slate-900 text-white dark:bg-white dark:text-slate-900 text-sm font-bold">
            Написать в поддержку
          </button>
        </div>
      )}

      {zoom && (
        <div className="fixed inset-0 z-modal-top bg-slate-950/90 flex items-center justify-center p-4" onClick={() => setZoom(null)}>
          <img src={zoom} alt="" className="max-h-full max-w-full rounded-2xl shadow-2xl" />
        </div>
      )}
    </div>
  );
};

export default Help;
