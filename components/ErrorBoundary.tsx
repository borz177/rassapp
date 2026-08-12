import React from 'react';

// Ошибка при отрисовке в React 19 уничтожает всё дерево компонентов — на экране остаётся
// пустая белая страница без единой подсказки. Границы ошибок в приложении не было вообще,
// поэтому ЛЮБОЙ сбой рендера выглядел как «приложение зависло».
//
// Отдельно обрабатывается самая частая причина: не загрузился отложенный кусок кода.
// Механика такая. Приложение открыто на прошлой сборке. Выкатывается новая — имена файлов
// меняются, старые с сервера исчезают, а service worker (registerType: 'autoUpdate' плюс
// skipWaiting/clientsClaim/cleanupOutdatedCaches) немедленно перехватывает управление и
// чистит прежний кэш. Страница при этом продолжает работать на СТАРОМ коде, и при открытии
// любого экрана с ленивой загрузкой (Калькулятор, Админка, Импорт, Приглашения) запрашивает
// файл, которого уже нет ни на сервере, ни в кэше. Обычная перезагрузка забирает свежий
// index.html и всё чинит — поэтому здесь она выполняется автоматически, один раз.

interface Props { children: React.ReactNode }
interface State { error: Error | null }

// Признаки «не удалось подгрузить кусок кода» у разных браузеров
const isChunkLoadError = (error: Error): boolean => {
  const msg = `${error?.name || ''} ${error?.message || ''}`;
  return /ChunkLoadError|Loading chunk|Importing a module script failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Unable to preload/i.test(msg);
};

// Ключ в sessionStorage, а не в localStorage: защита от петли перезагрузок должна жить
// только в этой вкладке и сама исчезать после её закрытия.
const RELOAD_GUARD_KEY = 'finuchet_chunk_reload_at';
const RELOAD_GUARD_MS = 30000;

class ErrorBoundary extends React.Component<Props, State> {
  // В проекте не установлен @types/react, поэтому дженерики React.Component не
  // раскрываются и this.props остаётся нетипизированным. `declare` объявляет тип,
  // ничего не добавляя в сам класс.
  declare props: Props;
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('❌ Сбой отрисовки:', error, info?.componentStack);

    if (isChunkLoadError(error)) {
      let lastReload = 0;
      try { lastReload = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) || 0); } catch { /* нет доступа */ }

      // Перезагружаемся только если недавно этого не делали — иначе при настоящей
      // поломке сборки страница уйдёт в бесконечный цикл перезагрузок.
      if (Date.now() - lastReload > RELOAD_GUARD_MS) {
        try { sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now())); } catch { /* нет доступа */ }
        console.warn('🔄 Обновилась версия приложения — перезагружаем страницу');
        window.location.reload();
      }
    }
  }

  handleReload = () => {
    window.location.reload();
  };

  // Крайний случай: перезагрузка не помогла. Сбрасываем кэш и service worker,
  // чтобы страница гарантированно взяла свежие файлы.
  handleHardReset = async () => {
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
    } catch (e) {
      console.error('Не удалось очистить кэш:', e);
    }
    // Данные пользователя (IndexedDB, localStorage) НЕ трогаем: несинхронизированные
    // договоры и платежи лежат именно там, и потерять их из-за сбоя отрисовки нельзя.
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const chunkIssue = isChunkLoadError(error);

    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '24px', background: '#0f172a', color: '#e2e8f0',
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
      }}>
        <div style={{ maxWidth: 380, textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>{chunkIssue ? '🔄' : '⚠️'}</div>

          <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 8px' }}>
            {chunkIssue ? 'Приложение обновилось' : 'Что-то пошло не так'}
          </h1>

          <p style={{ fontSize: 14, lineHeight: 1.5, color: '#94a3b8', margin: '0 0 24px' }}>
            {chunkIssue
              ? 'Вышла новая версия. Нажмите «Перезагрузить», чтобы продолжить работу.'
              : 'Не удалось отобразить страницу. Ваши данные в безопасности — они сохранены на устройстве и на сервере.'}
          </p>

          <button
            onClick={this.handleReload}
            style={{
              width: '100%', padding: '14px', border: 0, borderRadius: 12,
              background: '#4f46e5', color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer',
            }}
          >
            Перезагрузить
          </button>

          <button
            onClick={this.handleHardReset}
            style={{
              width: '100%', padding: '12px', marginTop: 10, border: 0, borderRadius: 12,
              background: 'transparent', color: '#64748b', fontSize: 13, cursor: 'pointer',
            }}
          >
            Не помогает — очистить кэш и перезагрузить
          </button>

          {/* Текст ошибки нужен, чтобы человек мог переслать его в поддержку */}
          <details style={{ marginTop: 20, textAlign: 'left' }}>
            <summary style={{ fontSize: 12, color: '#475569', cursor: 'pointer' }}>Подробности</summary>
            <pre style={{
              marginTop: 8, padding: 10, background: '#1e293b', borderRadius: 8,
              fontSize: 11, color: '#94a3b8', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              maxHeight: 160, overflow: 'auto',
            }}>
              {error.name}: {error.message}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
