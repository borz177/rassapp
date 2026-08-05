import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Task, User } from '../types';
import { ICONS } from '../constants';

interface TasksProps {
  tasks: Task[];
  onSaveTask: (task: Task) => void;
  onDeleteTask: (taskId: string) => void;
  userId: string;
  employees?: User[];
  isEmployee?: boolean;
  // Заготовка задачи из договора или карточки клиента — окно откроется сразу заполненным
  draft?: Partial<Task> | null;
  onDraftConsumed?: () => void;
  onOpenCustomer?: (customerId: string) => void;
}

type TabKey = 'FAVORITES' | 'ACTIVE' | 'DONE';

const MONTHS_RU = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
                   'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

// «Сегодня» и «Завтра» читаются быстрее календарной даты — для списка дел это важнее точности
const formatDue = (iso: string, hasTime?: boolean) => {
  const date = new Date(iso);
  const today = startOfDay(new Date());
  const target = startOfDay(date);
  const diffDays = Math.round((target.getTime() - today.getTime()) / 86400000);

  let dayLabel: string;
  if (diffDays === 0) dayLabel = 'Сегодня';
  else if (diffDays === 1) dayLabel = 'Завтра';
  else if (diffDays === -1) dayLabel = 'Вчера';
  else dayLabel = `${date.getDate()} ${MONTHS_RU[date.getMonth()]}`;

  if (!hasTime) return dayLabel;
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${dayLabel}, ${hh}:${mm}`;
};

const isOverdue = (task: Task) => {
  if (!task.dueDate || task.isDone) return false;
  return new Date(task.dueDate).getTime() < Date.now();
};

// ─────────────────────────────────────────────────────────────────────────────
// Модальное окно создания/редактирования
// ─────────────────────────────────────────────────────────────────────────────
const TaskModal: React.FC<{
  task: Task | null;
  draft?: Partial<Task> | null;
  userId: string;
  employees: User[];
  canAssign: boolean;
  onClose: () => void;
  onSave: (task: Task) => void;
  onDelete?: (taskId: string) => void;
}> = ({ task, draft, userId, employees, canAssign, onClose, onSave, onDelete }) => {
  const base = task || draft || null;
  const [isClosing, setIsClosing] = useState(false);
  const [title, setTitle] = useState(base?.title || '');
  const [note, setNote] = useState(base?.note || '');
  const [isFavorite, setIsFavorite] = useState(!!base?.isFavorite);
  const [assigneeId, setAssigneeId] = useState(base?.assigneeId || '');
  const [showAssignee, setShowAssignee] = useState(!!base?.assigneeId);

  const initialDate = base?.dueDate ? new Date(base.dueDate) : null;
  const [dueDate, setDueDate] = useState(
    initialDate ? initialDate.toISOString().split('T')[0] : ''
  );
  const [dueTime, setDueTime] = useState(
    initialDate && base?.hasTime
      ? `${String(initialDate.getHours()).padStart(2, '0')}:${String(initialDate.getMinutes()).padStart(2, '0')}`
      : ''
  );

  // Дополнительные поля скрыты, пока не понадобятся — окно остаётся из одной строки
  const [showNote, setShowNote] = useState(!!base?.note);
  const [showDate, setShowDate] = useState(!!base?.dueDate);

  const titleRef = useRef<HTMLTextAreaElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  // Высота выехавшей клавиатуры: на неё поднимаем окно, чтобы поле ввода и кнопки
  // не оказались под ней. visualViewport — единственный способ узнать эту высоту,
  // обычный resize на мобильных о клавиатуре не сообщает.
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Курсор сразу в поле — окно открывается готовым к печати.
  // Без задержки: на iOS focus() срабатывает только пока «жив» жест пользователя,
  // а setTimeout эту связь рвёт и клавиатура не появляется.
  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
    const raf = requestAnimationFrame(() => titleRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const sync = () => {
      // Сколько экрана закрыто клавиатурой снизу
      const covered = window.innerHeight - vv.height - vv.offsetTop;
      setKeyboardOffset(Math.max(0, Math.round(covered)));
    };
    sync();
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    return () => {
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
    };
  }, []);

  useEffect(() => {
    if (showNote) noteRef.current?.focus();
  }, [showNote]);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(onClose, 260);
  };

  const handleSubmit = () => {
    const trimmed = title.trim();
    if (!trimmed) return;

    let iso: string | undefined;
    let hasTime = false;
    if (dueDate) {
      const [y, m, d] = dueDate.split('-').map(Number);
      if (dueTime) {
        const [hh, mm] = dueTime.split(':').map(Number);
        iso = new Date(y, m - 1, d, hh, mm).toISOString();
        hasTime = true;
      } else {
        // Без времени срок истекает в конце дня, иначе задача «просрочится» с утра
        iso = new Date(y, m - 1, d, 23, 59).toISOString();
      }
    }

    const assignee = employees.find(e => e.id === assigneeId);

    onSave({
      id: task?.id || `task_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      userId,
      title: trimmed,
      note: note.trim() || undefined,
      dueDate: iso,
      hasTime,
      isFavorite,
      isDone: task?.isDone || false,
      completedAt: task?.completedAt,
      createdAt: task?.createdAt || new Date().toISOString(),
      assigneeId: assigneeId || undefined,
      assigneeName: assignee?.name,
      customerId: base?.customerId,
      customerName: base?.customerName,
      saleId: base?.saleId,
    });
    handleClose();
  };

  // Enter отправляет, Shift+Enter — перенос строки
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const iconBtn = (active: boolean) =>
    `flex items-center justify-center w-10 h-10 rounded-xl transition-all ${
      active
        ? 'bg-indigo-600 text-white'
        : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600'
    }`;

  // Через портал в body: страница задач живёт внутри .page-push-layer, а это
  // position: fixed с z-index: 30 — он создаёт свой контекст наложения, и окно с любым
  // z-index оставалось бы под нижней навигацией (z-50) и внутри его overflow-y: auto.
  return createPortal(
    <div
      className={`fixed inset-0 z-[9999] flex items-end sm:items-center justify-center sm:p-4 bg-slate-900/60 backdrop-blur-sm ${
        isClosing ? 'animate-fade-out' : 'animate-modal-fade-in'
      }`}
      onClick={handleClose}
    >
      <div
        className={`bg-white dark:bg-slate-800 w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden ${
          keyboardOffset > 0 ? '' : 'safe-area-pb'
        } ${isClosing ? 'animate-slide-down-sheet' : 'animate-slide-up-sheet'}`}
        // Поднимаем окно ровно на высоту клавиатуры, чтобы поле и кнопки оставались видны.
        // Когда клавиатура закрыта, отступ снизу задаёт safe-area-pb (вырез на iPhone).
        style={keyboardOffset > 0 ? { marginBottom: keyboardOffset, transition: 'margin-bottom 0.18s ease-out' } : undefined}
        onClick={e => e.stopPropagation()}
      >
        <div className="p-5 space-y-3">
          <textarea
            ref={titleRef}
            rows={1}
            value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Что нужно сделать?"
            className="w-full text-base font-medium bg-transparent text-slate-800 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none resize-none"
          />

          {showNote && (
            <textarea
              ref={noteRef}
              rows={2}
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Дополнительная информация"
              className="w-full text-sm bg-slate-50 dark:bg-slate-900 rounded-xl p-3 text-slate-600 dark:text-slate-300 placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none resize-none animate-fade-in"
            />
          )}

          {showDate && (
            <div className="grid grid-cols-2 gap-2 animate-fade-in">
              <input
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                className="w-full p-2.5 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-600 rounded-xl text-slate-700 dark:text-slate-300 outline-none focus:border-indigo-300"
              />
              <input
                type="time"
                value={dueTime}
                onChange={e => setDueTime(e.target.value)}
                disabled={!dueDate}
                className="w-full p-2.5 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-600 rounded-xl text-slate-700 dark:text-slate-300 outline-none focus:border-indigo-300 disabled:opacity-40"
              />
            </div>
          )}

          {showAssignee && canAssign && (
            <select
              value={assigneeId}
              onChange={e => setAssigneeId(e.target.value)}
              className="w-full p-2.5 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-600 rounded-xl text-slate-700 dark:text-slate-300 outline-none focus:border-indigo-300 animate-fade-in"
            >
              <option value="">Оставить себе</option>
              {employees.map(emp => (
                <option key={emp.id} value={emp.id}>{emp.name}</option>
              ))}
            </select>
          )}

          {base?.customerName && (
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900 rounded-xl px-3 py-2">
              <span className="scale-75 origin-left">{ICONS.Customers}</span>
              <span className="truncate">{base.customerName}</span>
            </div>
          )}

          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowNote(v => !v)}
                className={iconBtn(showNote || !!note)}
                title="Дополнительная информация"
                aria-label="Дополнительная информация"
              >
                {ICONS.Note}
              </button>
              <button
                onClick={() => setShowDate(v => !v)}
                className={iconBtn(showDate || !!dueDate)}
                title="Дата и время"
                aria-label="Дата и время"
              >
                {ICONS.DateTime}
              </button>
              <button
                onClick={() => setIsFavorite(v => !v)}
                className={`${iconBtn(isFavorite)} ${isFavorite ? '!bg-amber-500' : ''}`}
                title="В избранное"
                aria-label="В избранное"
              >
                {isFavorite ? ICONS.StarFilled : ICONS.Star}
              </button>

              {/* Поручить сотруднику — только у менеджера и только если сотрудники есть */}
              {canAssign && employees.length > 0 && (
                <button
                  onClick={() => { setShowAssignee(v => !v); if (showAssignee) setAssigneeId(''); }}
                  className={iconBtn(showAssignee || !!assigneeId)}
                  title="Поручить сотруднику"
                  aria-label="Поручить сотруднику"
                >
                  {ICONS.Users}
                </button>
              )}
            </div>

            <button
              onClick={handleSubmit}
              disabled={!title.trim()}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-700 text-white text-sm font-bold hover:from-indigo-700 hover:to-indigo-800 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              {task ? 'Сохранить' : 'Добавить'}
            </button>
          </div>

          {task && onDelete && (
            <button
              onClick={() => setConfirmDelete(true)}
              className="w-full py-2.5 text-sm font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded-xl transition-all"
            >
              Удалить задачу
            </button>
          )}
        </div>
      </div>

      {/* Подтверждение удаления — поверх окна задачи */}
      {confirmDelete && task && onDelete && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-modal-fade-in"
          onClick={e => { e.stopPropagation(); setConfirmDelete(false); }}
        >
          <div
            className="bg-white dark:bg-slate-800 w-full max-w-xs rounded-3xl shadow-2xl p-5 text-center animate-dialog-in"
            onClick={e => e.stopPropagation()}
          >
            <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-rose-50 dark:bg-rose-900/30 flex items-center justify-center text-rose-600 dark:text-rose-400">
              {ICONS.Delete}
            </div>
            <h3 className="text-base font-bold text-slate-800 dark:text-white mb-1">Удалить задачу?</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-5 break-words line-clamp-3">
              {task.title}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmDelete(false)}
                className="flex-1 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-sm font-bold hover:bg-slate-200 dark:hover:bg-slate-600 transition-all"
              >
                Отмена
              </button>
              <button
                onClick={() => { onDelete(task.id); setConfirmDelete(false); handleClose(); }}
                className="flex-1 py-2.5 rounded-xl bg-rose-600 text-white text-sm font-bold hover:bg-rose-700 transition-all"
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Строка задачи
// ─────────────────────────────────────────────────────────────────────────────
const TaskRow: React.FC<{
  task: Task;
  onToggleDone: (task: Task) => void;
  onToggleFavorite: (task: Task) => void;
  onEdit: (task: Task) => void;
  onOpenCustomer?: (customerId: string) => void;
}> = ({ task, onToggleDone, onToggleFavorite, onEdit, onOpenCustomer }) => {
  const overdue = isOverdue(task);

  return (
    <div
      className="group flex items-start gap-3 p-3.5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 hover:border-indigo-200 dark:hover:border-slate-600 transition-all cursor-pointer"
      onClick={() => onEdit(task)}
    >
      <button
        onClick={e => { e.stopPropagation(); onToggleDone(task); }}
        className={`shrink-0 mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
          task.isDone
            ? 'bg-emerald-500 border-emerald-500 text-white'
            : 'border-slate-300 dark:border-slate-600 hover:border-indigo-500'
        }`}
        aria-label={task.isDone ? 'Вернуть в работу' : 'Отметить выполненной'}
      >
        {task.isDone && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </button>

      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium break-words ${
          task.isDone
            ? 'text-slate-400 dark:text-slate-500 line-through'
            : 'text-slate-800 dark:text-white'
        }`}>
          {task.title}
        </p>

        {task.note && (
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 break-words line-clamp-2">{task.note}</p>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
          {task.dueDate && (
            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${
              overdue ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400 dark:text-slate-500'
            }`}>
              <span className="scale-75 origin-left">{ICONS.Clock}</span>
              {formatDue(task.dueDate, task.hasTime)}
            </span>
          )}

          {task.assigneeName && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300">
              {task.assigneeName}
            </span>
          )}

          {task.customerName && (
            <button
              onClick={e => { e.stopPropagation(); onOpenCustomer?.(task.customerId!); }}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
            >
              <span className="scale-75 origin-left">{ICONS.Customers}</span>
              {task.customerName}
            </button>
          )}
        </div>
      </div>

      <button
        onClick={e => { e.stopPropagation(); onToggleFavorite(task); }}
        className={`shrink-0 p-1 rounded-lg transition-all ${
          task.isFavorite
            ? 'text-amber-500'
            : 'text-slate-300 dark:text-slate-600 hover:text-amber-400'
        }`}
        aria-label={task.isFavorite ? 'Убрать из избранного' : 'В избранное'}
      >
        {task.isFavorite ? ICONS.StarFilled : ICONS.Star}
      </button>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
const Tasks: React.FC<TasksProps> = ({
  tasks, onSaveTask, onDeleteTask, userId,
  employees = [], isEmployee = false, draft, onDraftConsumed, onOpenCustomer,
}) => {
  const [activeTab, setActiveTab] = useState<TabKey>('ACTIVE');
  const [modalTask, setModalTask] = useState<Task | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeDraft, setActiveDraft] = useState<Partial<Task> | null>(null);

  // Пришли из договора или карточки клиента — сразу открываем заполненное окно
  useEffect(() => {
    if (draft) {
      setModalTask(null);
      setActiveDraft(draft);
      setIsModalOpen(true);
      onDraftConsumed?.();
    }
  }, [draft]);

  const { favorites, active, done } = useMemo(() => {
    // Сначала со сроком (ближайшие первыми), затем без срока — новые сверху
    const byDue = (a: Task, b: Task) => {
      if (a.dueDate && b.dueDate) return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    };
    const notDone = tasks.filter(t => !t.isDone);
    return {
      favorites: notDone.filter(t => t.isFavorite).sort(byDue),
      active: [...notDone].sort(byDue),
      done: tasks
        .filter(t => t.isDone)
        .sort((a, b) => new Date(b.completedAt || b.createdAt).getTime() - new Date(a.completedAt || a.createdAt).getTime()),
    };
  }, [tasks]);

  const overdueCount = useMemo(() => active.filter(isOverdue).length, [active]);

  const handleToggleDone = (task: Task) => {
    onSaveTask({
      ...task,
      isDone: !task.isDone,
      completedAt: !task.isDone ? new Date().toISOString() : undefined,
    });
  };

  const handleToggleFavorite = (task: Task) => {
    onSaveTask({ ...task, isFavorite: !task.isFavorite });
  };

  const openNew = () => { setModalTask(null); setActiveDraft(null); setIsModalOpen(true); };
  const openEdit = (task: Task) => { setModalTask(task); setActiveDraft(null); setIsModalOpen(true); };

  const TABS: { key: TabKey; label: React.ReactNode; count: number; title: string }[] = [
    { key: 'FAVORITES', label: ICONS.Star, count: favorites.length, title: 'Избранные' },
    { key: 'ACTIVE', label: 'Мои задачи', count: active.length, title: 'Мои задачи' },
    { key: 'DONE', label: 'Выполненные', count: done.length, title: 'Выполненные' },
  ];

  const list = activeTab === 'FAVORITES' ? favorites : activeTab === 'DONE' ? done : active;

  const emptyText =
    activeTab === 'FAVORITES' ? { title: 'Нет избранных', hint: 'Отмечайте звёздочкой то, что важно не упустить' }
    : activeTab === 'DONE'    ? { title: 'Пока ничего не выполнено', hint: 'Отмеченные задачи появятся здесь' }
                              : { title: 'Задач нет', hint: 'Добавьте первую — кнопкой в правом верхнем углу' };

  return (
    <div className="space-y-5 animate-fade-in pb-24 w-full max-w-3xl mx-auto px-4">
      {/* Шапка */}
      <div className="flex justify-between items-center pt-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center text-white shadow-lg">
            {ICONS.Tasks}
          </div>
          <div>
            <h2 className="text-2xl font-bold bg-gradient-to-r from-slate-800 to-indigo-800 dark:from-white dark:to-indigo-400 bg-clip-text text-transparent">
              Задачи
            </h2>
            {overdueCount > 0 && (
              <p className="text-xs font-semibold text-rose-500 dark:text-rose-400">
                Просрочено: {overdueCount}
              </p>
            )}
          </div>
        </div>

        <button
          onClick={openNew}
          className="w-11 h-11 rounded-2xl bg-gradient-to-r from-indigo-600 to-indigo-700 text-white flex items-center justify-center shadow-lg shadow-indigo-200 dark:shadow-none hover:from-indigo-700 hover:to-indigo-800 active:scale-95 transition-all"
          aria-label="Новая задача"
          title="Новая задача"
        >
          {ICONS.Add}
        </button>
      </div>

      {/* Вкладки */}
      <div className="flex gap-2 p-1 bg-slate-100 dark:bg-slate-800 rounded-2xl">
        {TABS.map(({ key, label, count, title }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            title={title}
            className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold transition-all ${
              key === 'FAVORITES' ? 'px-3.5' : 'flex-1'
            } ${
              activeTab === key
                ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            <span className={key === 'FAVORITES' && activeTab === key ? 'text-amber-500' : ''}>{label}</span>
            {count > 0 && (
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                activeTab === key
                  ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300'
                  : 'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
              }`}>
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Список */}
      {list.length === 0 ? (
        <div className="bg-slate-50 dark:bg-slate-800/60 rounded-3xl p-10 text-center border-2 border-dashed border-slate-200 dark:border-slate-700">
          <div className="flex justify-center mb-3 text-slate-300 dark:text-slate-600">{ICONS.Tasks}</div>
          <h3 className="text-base font-bold text-slate-700 dark:text-slate-200 mb-1">{emptyText.title}</h3>
          <p className="text-sm text-slate-400 dark:text-slate-500">{emptyText.hint}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {list.map(task => (
            <TaskRow
              key={task.id}
              task={task}
              onToggleDone={handleToggleDone}
              onToggleFavorite={handleToggleFavorite}
              onEdit={openEdit}
              onOpenCustomer={onOpenCustomer}
            />
          ))}
        </div>
      )}

      {isModalOpen && (
        <TaskModal
          task={modalTask}
          draft={activeDraft}
          userId={userId}
          employees={employees}
          canAssign={!isEmployee}
          onClose={() => setIsModalOpen(false)}
          onSave={onSaveTask}
          onDelete={modalTask && !isEmployee ? onDeleteTask : undefined}
        />
      )}
    </div>
  );
};

export default Tasks;
