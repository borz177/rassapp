import React, { useEffect, useState } from 'react';
import GlassSheet, { SheetSection } from './GlassSheet';
import { api } from '../services/api';

const labels: Record<string,string> = {
  running: 'Начато в приложении — проверьте результат перед повтором', pending: 'Ждёт подтверждения', executing: 'Выполняется — проверьте результат перед повтором',
  done: 'Выполнено', failed: 'Не выполнено', stale: 'Данные изменились', uncertain: 'Нужна проверка результата',
  cancelled: 'Отменено до выполнения', undoing: 'Отмена выполняется', undone: 'Изменение отменено',
};
export default function AIAgentJournal({ onClose }: { onClose: () => void }) {
  const [actions, setActions] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    api.aiAssistant.journal().then(r => { if (active) setActions(r.actions); })
      .catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  return <GlassSheet title="Журнал действий агента" onClose={onClose} cancelLabel="Закрыть">
    <SheetSection hint="Последние 100 операций. Журнал сохраняется после перезапуска сервера и очистки чата.">
      {loading && <p className="p-4 text-slate-500">Загрузка…</p>}
      {error && <p role="alert" className="p-4 text-rose-600">{error}</p>}
      {!loading && !error && !actions.length && <p className="p-4 text-slate-500">Действий пока нет.</p>}
      {actions.map(a => <div key={a.id} className="p-4 border-b border-slate-200 dark:border-slate-700 last:border-0">
        <p className="text-sm font-semibold">{labels[a.status] || 'Нужна проверка'}</p>
        <p className="mt-1 text-sm">{a.summary || 'Операция учёта'}</p>
        {(a.undo_result?.text || a.result?.text) && <p className="mt-1 text-xs text-slate-500">{a.undo_result?.text || a.result?.text}</p>}
        {a.source === 'application' && <p className="mt-1 text-xs text-slate-500">Операция выполняется приложением; статус получен от приложения.</p>}
        <time className="mt-2 block text-xs text-slate-400">{new Date(a.created_at).toLocaleString('ru-RU')}</time>
      </div>)}
    </SheetSection>
  </GlassSheet>;
}
