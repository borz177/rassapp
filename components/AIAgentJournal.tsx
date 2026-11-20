import React, { useEffect, useRef, useState } from 'react';
import GlassSheet, { SheetSection } from './GlassSheet';
import { api } from '../services/api';
import { appConfirm } from '../src/dialogs';
import { friendlyError } from '../src/friendlyError';

const labels: Record<string,string> = {
  running: 'Начато в приложении — проверьте результат перед повтором', pending: 'Ждёт подтверждения', executing: 'Выполняется — проверьте результат перед повтором',
  done: 'Выполнено', failed: 'Не выполнено', stale: 'Данные изменились', uncertain: 'Нужна проверка результата',
  cancelled: 'Отменено до выполнения', undoing: 'Отмена выполняется', undone: 'Изменение отменено',
  expired: 'Срок подтверждения истёк',
};
export default function AIAgentJournal({ onClose, onDataChanged }: { onClose: () => void; onDataChanged?: () => void }) {
  const [actions, setActions] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [undoing, setUndoing] = useState<string | null>(null);
  const lock = useRef(false), closing = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const undo = async (action: any) => {
    if (lock.current || closing.current) return;
    lock.current = true;
    try {
      if (!await appConfirm({ title: 'Отменить исправление графика?', message: 'Вернём план, который был до исправления.', confirmLabel: 'Отменить исправление', cancelLabel: 'Оставить' })) return;
      if (!mounted.current) return;
      setUndoing(action.id); setError('');
      const result = await api.aiAssistant.accountingAudit.repairAction(action.id, 'undo');
      if (mounted.current) setActions(items => items.map(a => a.id === action.id ? { ...a, status: 'undone', undoable: false, undo_result: result } : a));
      try { await onDataChanged?.(); }
      catch { if (mounted.current) setError('Отмена сохранена. Обновите данные приложения.'); }
    } catch (e) { if (mounted.current) setError(friendlyError(e)); }
    finally { lock.current = false; if (mounted.current) setUndoing(null); }
  };
  useEffect(() => {
    let active = true;
    api.aiAssistant.journal().then(r => { if (active) setActions(r.actions); })
      .catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  return <GlassSheet title="Журнал действий агента" onClose={onClose} confirmClose={() => { if (lock.current) return false; closing.current = true; return true; }} cancelLabel="Закрыть">
    <SheetSection hint="Последние 100 операций. Журнал сохраняется после перезапуска сервера и очистки чата.">
      {loading && <p className="p-4 text-slate-500">Загрузка…</p>}
      {error && <p role="alert" className="p-4 text-rose-600">{error}</p>}
      {!loading && !error && !actions.length && <p className="p-4 text-slate-500">Действий пока нет.</p>}
      {actions.map(a => <div key={a.id} className="p-4 border-b border-slate-200 dark:border-slate-700 last:border-0">
        <p className="text-sm font-semibold">{labels[a.status] || 'Нужна проверка'}</p>
        <p className="mt-1 text-sm">{a.summary || 'Операция учёта'}</p>
        {(a.undo_result?.text || a.result?.text) && <p className="mt-1 text-xs text-slate-500">{a.undo_result?.text || a.result?.text}</p>}
        {a.source === 'application' && <p className="mt-1 text-xs text-slate-500">Операция выполняется приложением; статус получен от приложения.</p>}
        {a.source === 'accounting' && a.status === 'done' && a.undoable && (!a.undoUntil || new Date(a.undoUntil).getTime() > Date.now()) && (
          <button type="button" disabled={!!undoing} onClick={() => undo(a)} className="mt-2 px-3 py-2 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-600 disabled:opacity-50">
            {undoing === a.id ? 'Отменяю…' : 'Отменить исправление'}
          </button>
        )}
        <time className="mt-2 block text-xs text-slate-400">{new Date(a.created_at).toLocaleString('ru-RU')}</time>
      </div>)}
    </SheetSection>
  </GlassSheet>;
}
