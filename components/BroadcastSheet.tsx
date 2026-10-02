import React, { useEffect, useState } from 'react';
import GlassSheet, { SheetSection, SheetField, SheetChoice, sheetInputClass } from './GlassSheet';
import { api } from '../services/api';
import { appAlert, appConfirm } from '../src/dialogs';

/**
 * Рассылка администратора: новая + отправленные.
 *
 * Раньше была только форма: что ушло, кому и сколько прочитали — не видно, а
 * ошибочную рассылку нельзя было убрать иначе как в базе.
 */

interface SentBroadcast {
  id: string;
  title: string;
  message: string;
  targetRole: string | null;
  isActive: boolean;
  createdAt: string;
  readCount: number;
  audience: number;
}

const ROLES: { value: string; label: string; hint: string }[] = [
  { value: '', label: 'Все пользователи', hint: 'Менеджеры, их сотрудники и инвесторы' },
  { value: 'manager', label: 'Менеджеры', hint: 'Владельцы аккаунтов' },
  { value: 'employee', label: 'Сотрудники', hint: '' },
  { value: 'investor', label: 'Инвесторы', hint: '' },
];
const roleLabel = (r: string | null) => ROLES.find(x => x.value === (r || ''))?.label || r || '';

const BroadcastSheet: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [targetRole, setTargetRole] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<SentBroadcast[] | null>(null);

  const load = () => api.get<SentBroadcast[]>('/admin/support/broadcasts')
    .then(setSent)
    .catch(() => setSent([]));
  useEffect(() => { load(); }, []);

  const dirty = title.trim() !== '' || message.trim() !== '';
  const canSend = title.trim() !== '' && message.trim() !== '' && !sending;

  const send = async () => {
    if (!canSend) return;
    const ok = await appConfirm({
      title: 'Отправить рассылку?',
      message: `Получатели: ${roleLabel(targetRole).toLowerCase()}. Тем, у кого включены push-уведомления, придёт push.`,
      confirmLabel: 'Отправить',
      cancelLabel: 'Отмена',
    });
    if (!ok) return;
    setSending(true);
    try {
      await api.post('/admin/support/broadcast', { title: title.trim(), message: message.trim(), targetRole });
      setTitle(''); setMessage(''); setTargetRole('');
      load();
    } catch {
      await appAlert({ title: 'Не отправлено', message: 'Проверьте связь и попробуйте ещё раз.' });
    } finally {
      setSending(false);
    }
  };

  const retract = async (b: SentBroadcast) => {
    const ok = await appConfirm({
      title: 'Отозвать рассылку?',
      message: `«${b.title}» пропадёт у всех получателей — и в поддержке, и в уведомлениях. Push, который уже пришёл, отозвать нельзя.`,
      confirmLabel: 'Отозвать',
      cancelLabel: 'Отмена',
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.post(`/admin/support/broadcasts/${encodeURIComponent(b.id)}/retract`);
      setSent(list => list?.map(x => x.id === b.id ? { ...x, isActive: false } : x) || null);
    } catch {
      await appAlert({ title: 'Не получилось', message: 'Проверьте связь и попробуйте ещё раз.' });
    }
  };

  return (
    <GlassSheet
      title="Рассылка"
      onClose={onClose}
      cancelLabel="Закрыть"
      action={{ label: sending ? 'Отправка…' : 'Отправить', onClick: send, disabled: !canSend }}
      confirmClose={() => !dirty || appConfirm({
        title: 'Закрыть без отправки?', message: 'Текст рассылки пропадёт.',
        confirmLabel: 'Закрыть', cancelLabel: 'Остаться', destructive: true,
      })}
    >
      <div className="space-y-6">
        <SheetSection title="Новая">
          <SheetField label="Заголовок">
            <input className={sheetInputClass} value={title} onChange={e => setTitle(e.target.value)}
                   placeholder="Например: Исправили ошибку «Нет токена»" maxLength={120} />
          </SheetField>
          <div className="px-4 py-3">
            <span className="block text-[13px] text-slate-500 dark:text-slate-400">Текст</span>
            <textarea
              className="mt-1 block w-full bg-transparent outline-none resize-y min-h-[160px] text-[16px] leading-snug text-slate-900 dark:text-white placeholder:text-slate-300 dark:placeholder:text-slate-600"
              value={message} onChange={e => setMessage(e.target.value)}
              placeholder="Переносы строк сохранятся — можно писать по пунктам."
            />
          </div>
        </SheetSection>

        <SheetSection title="Кому" hint="Увидят только те, кто был зарегистрирован на момент отправки.">
          {ROLES.map(r => (
            <SheetChoice key={r.value} selected={targetRole === r.value} label={r.label}
                         hint={r.hint || undefined} onSelect={() => setTargetRole(r.value)} />
          ))}
        </SheetSection>

        <SheetSection title="Отправленные">
          {sent === null ? (
            <p className="px-4 py-4 text-[15px] text-slate-400">Загрузка…</p>
          ) : sent.length === 0 ? (
            <p className="px-4 py-4 text-[15px] text-slate-400">Рассылок ещё не было.</p>
          ) : sent.map(b => (
            <div key={b.id} className={`px-4 py-3 ${b.isActive ? '' : 'opacity-50'}`}>
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-[15px] font-semibold text-slate-900 dark:text-white truncate">{b.title}</p>
                  <p className="text-[13px] text-slate-500 dark:text-slate-400 line-clamp-2 whitespace-pre-line">{b.message}</p>
                  <p className="mt-1 text-[12px] text-slate-400 dark:text-slate-500">
                    {new Date(b.createdAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    {' · '}{roleLabel(b.targetRole)}
                    {' · '}прочитали {b.readCount} из {b.audience}
                    {!b.isActive && ' · отозвана'}
                  </p>
                </div>
                {b.isActive && (
                  <button type="button" onClick={() => retract(b)}
                          className="shrink-0 text-[14px] font-medium text-rose-600 dark:text-rose-400 active:opacity-60 pt-0.5">
                    Отозвать
                  </button>
                )}
              </div>
            </div>
          ))}
        </SheetSection>
      </div>
    </GlassSheet>
  );
};

export default BroadcastSheet;
