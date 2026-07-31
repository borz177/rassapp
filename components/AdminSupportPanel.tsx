import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { api } from '../services/api';
import { ICONS } from '../constants';

interface AdminSupportPanelProps {
  onBack: () => void;
}

interface Ticket {
  id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  subject: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'CLOSED';
  priority: 'NORMAL' | 'MEDIUM' | 'HIGH';
  created_at: string;
  updated_at: string;
  assigned_admin_id?: string | null;
  unread_count: number;
  messages_count: number;
  last_message?: string | null;
  last_message_from_user?: boolean | null;
  last_message_at?: string | null;
}

interface Message {
  id: string;
  message: string;
  is_from_user: boolean;
  is_read: boolean;
  created_at: string;
}

interface Stats {
  total_tickets: number;
  open_tickets: number;
  in_progress_tickets: number;
  closed_tickets: number;
  high_priority: number;
  unread_messages: number;
}

const POLL_INTERVAL_MS = 15000;

// Быстрые ответы — типовые формулировки, чтобы не набирать одно и то же руками
const QUICK_REPLIES = [
  'Здравствуйте! Приняли обращение в работу, скоро вернёмся с ответом.',
  'Уточните, пожалуйста, на каком устройстве и в каком браузере воспроизводится проблема?',
  'Проблема исправлена, обновите страницу (Ctrl+F5) и проверьте, пожалуйста.',
  'Спасибо за обращение! Если вопрос решён — закрываем тикет.',
];

const STATUS_META: Record<Ticket['status'], { label: string; dot: string; chip: string }> = {
  OPEN: {
    label: 'Открыт',
    dot: 'bg-emerald-500',
    chip: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-900/50',
  },
  IN_PROGRESS: {
    label: 'В работе',
    dot: 'bg-blue-500',
    chip: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-900/50',
  },
  CLOSED: {
    label: 'Закрыт',
    dot: 'bg-slate-400',
    chip: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-700/50 dark:text-slate-300 dark:border-slate-600',
  },
};

const PRIORITY_META: Record<string, { label: string; chip: string }> = {
  HIGH: { label: 'Высокий', chip: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-900/50' },
  MEDIUM: { label: 'Средний', chip: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-900/50' },
  NORMAL: { label: 'Обычный', chip: 'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-700/50 dark:text-slate-300 dark:border-slate-600' },
};

const relativeTime = (dateStr?: string | null): string => {
  if (!dateStr) return '';
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'вчера';
  if (days < 7) return `${days} дн назад`;
  return new Date(dateStr).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
};

const dayLabel = (dateStr: string): string => {
  const date = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(date, today)) return 'Сегодня';
  if (sameDay(date, yesterday)) return 'Вчера';
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
};

const initials = (name?: string) => (name || '?').trim().charAt(0).toUpperCase();

const AdminSupportPanel: React.FC<AdminSupportPanelProps> = ({ onBack }) => {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');

  const [filterStatus, setFilterStatus] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const [showBroadcastForm, setShowBroadcastForm] = useState(false);
  const [broadcastData, setBroadcastData] = useState({ title: '', message: '', targetRole: '' });
  const [isSending, setIsSending] = useState(false);
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [showQuickReplies, setShowQuickReplies] = useState(false);

  const chatContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Держим актуальный выбранный тикет в ref, чтобы поллинг не зависел от замыкания
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedTicket?.id ?? null;

  // Debounce поиска, чтобы не дёргать сервер на каждое нажатие
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const loadData = useCallback(async (opts?: { silent?: boolean }) => {
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.set('status', filterStatus);
      if (filterPriority) params.set('priority', filterPriority);
      if (debouncedSearch) params.set('search', debouncedSearch);
      const qs = params.toString();

      const [ticketsRes, statsRes] = await Promise.all([
        api.get<Ticket[]>('/admin/support/tickets' + (qs ? `?${qs}` : '')),
        api.get<Stats>('/admin/support/stats'),
      ]);
      setTickets(ticketsRes);
      setStats(statsRes);

      // Синхронизируем шапку открытого тикета (статус/назначение могли измениться)
      const openId = selectedIdRef.current;
      if (openId) {
        const fresh = ticketsRes.find(t => t.id === openId);
        if (fresh) setSelectedTicket(prev => (prev ? { ...prev, ...fresh, unread_count: 0 } : prev));
      }
    } catch (error) {
      if (!opts?.silent) console.error('Failed to load admin support data:', error);
    } finally {
      setIsInitialLoading(false);
    }
  }, [filterStatus, filterPriority, debouncedSearch]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const loadMessages = useCallback(async (ticketId: string) => {
    const response = await api.get<Message[]>(`/support/tickets/${ticketId}/messages`);
    setMessages(response);
    return response;
  }, []);

  // Живое обновление: список + открытая переписка
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      loadData({ silent: true });
      const openId = selectedIdRef.current;
      if (openId) loadMessages(openId).catch(() => {});
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadData, loadMessages]);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages, selectedTicket?.id]);

  const openTicket = async (ticket: Ticket) => {
    // Счётчик гасим сразу в UI — сервер пометит сообщения прочитанными этим же запросом
    setSelectedTicket({ ...ticket, unread_count: 0 });
    setTickets(prev => prev.map(t => (t.id === ticket.id ? { ...t, unread_count: 0 } : t)));
    setStats(prev =>
      prev ? { ...prev, unread_messages: Math.max(0, Number(prev.unread_messages) - Number(ticket.unread_count || 0)) } : prev
    );
    setMessages([]);
    try {
      await loadMessages(ticket.id);
      setTimeout(() => inputRef.current?.focus(), 50);
    } catch (error) {
      console.error('Failed to load messages:', error);
    }
  };

  const sendMessage = async () => {
    const text = newMessage.trim();
    if (!text || !selectedTicket || isSending) return;

    setIsSending(true);
    // Оптимистично показываем сообщение, чтобы чат не «залипал» на время запроса
    const optimistic: Message = {
      id: `tmp_${Date.now()}`,
      message: text,
      is_from_user: false,
      is_read: false,
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, optimistic]);
    setNewMessage('');

    try {
      await api.post(`/admin/support/tickets/${selectedTicket.id}/messages`, { message: text });
      await loadMessages(selectedTicket.id);
      loadData({ silent: true });
    } catch (error) {
      console.error('Failed to send message:', error);
      setMessages(prev => prev.filter(m => m.id !== optimistic.id));
      setNewMessage(text);
      alert('Не удалось отправить сообщение');
    } finally {
      setIsSending(false);
    }
  };

  const changeStatus = async (ticket: Ticket, action: 'close' | 'reopen' | 'assign') => {
    try {
      if (action === 'close') await api.patch(`/support/tickets/${ticket.id}/close`);
      if (action === 'reopen') await api.patch(`/admin/support/tickets/${ticket.id}/reopen`);
      if (action === 'assign') await api.patch(`/admin/support/tickets/${ticket.id}/assign`);
      await loadData();
    } catch (error) {
      console.error('Failed to change ticket status:', error);
      alert('Не удалось изменить статус тикета');
    }
  };

  const deleteTicket = async (ticket: Ticket) => {
    if (!window.confirm(`Удалить тикет «${ticket.subject}» вместе со всей перепиской? Это необратимо.`)) return;
    try {
      await api.delete(`/admin/support/tickets/${ticket.id}`);
      if (selectedTicket?.id === ticket.id) setSelectedTicket(null);
      await loadData();
    } catch (error) {
      console.error('Failed to delete ticket:', error);
      alert('Не удалось удалить тикет');
    }
  };

  const sendBroadcast = async () => {
    if (!broadcastData.title.trim() || !broadcastData.message.trim()) {
      alert('Заполните заголовок и текст сообщения');
      return;
    }
    setIsBroadcasting(true);
    try {
      await api.post('/admin/support/broadcast', broadcastData);
      setShowBroadcastForm(false);
      setBroadcastData({ title: '', message: '', targetRole: '' });
      alert('Рассылка отправлена');
    } catch (error) {
      console.error('Failed to send broadcast:', error);
      alert('Не удалось отправить рассылку');
    } finally {
      setIsBroadcasting(false);
    }
  };

  // Группируем сообщения по дням для разделителей в переписке
  const messageGroups = useMemo(() => {
    const groups: { label: string; items: Message[] }[] = [];
    messages.forEach(msg => {
      const label = dayLabel(msg.created_at);
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.items.push(msg);
      else groups.push({ label, items: [msg] });
    });
    return groups;
  }, [messages]);

  const totalUnread = Number(stats?.unread_messages || 0);
  const hasActiveFilters = !!(filterStatus || filterPriority || debouncedSearch);

  const statCards = stats
    ? [
        { key: 'total', label: 'Всего', value: stats.total_tickets, cls: 'text-slate-800 dark:text-white', onClick: () => { setFilterStatus(''); setFilterPriority(''); } },
        { key: 'open', label: 'Открытые', value: stats.open_tickets, cls: 'text-emerald-600 dark:text-emerald-400', onClick: () => setFilterStatus('OPEN') },
        { key: 'progress', label: 'В работе', value: stats.in_progress_tickets, cls: 'text-blue-600 dark:text-blue-400', onClick: () => setFilterStatus('IN_PROGRESS') },
        { key: 'closed', label: 'Закрытые', value: stats.closed_tickets, cls: 'text-slate-500 dark:text-slate-400', onClick: () => setFilterStatus('CLOSED') },
        { key: 'high', label: 'Высокий приор.', value: stats.high_priority, cls: 'text-red-600 dark:text-red-400', onClick: () => setFilterPriority('HIGH') },
      ]
    : [];

  const renderTicketCard = (ticket: Ticket) => {
    const statusMeta = STATUS_META[ticket.status] || STATUS_META.OPEN;
    const isActive = selectedTicket?.id === ticket.id;
    const unread = Number(ticket.unread_count || 0);

    return (
      <button
        key={ticket.id}
        onClick={() => openTicket(ticket)}
        className={`w-full text-left p-3 rounded-xl border transition-colors ${
          isActive
            ? 'border-indigo-300 bg-indigo-50/70 dark:border-indigo-800 dark:bg-indigo-900/20'
            : unread > 0
              ? 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700/50'
              : 'border-slate-100 bg-white hover:bg-slate-50 dark:border-slate-700/60 dark:bg-slate-800/60 dark:hover:bg-slate-700/50'
        }`}
      >
        <div className="flex items-start gap-3">
          <div className="relative shrink-0">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 text-white flex items-center justify-center font-semibold text-sm">
              {initials(ticket.user_name)}
            </div>
            <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white dark:border-slate-800 ${statusMeta.dot}`} />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className={`truncate text-sm ${unread > 0 ? 'font-bold text-slate-900 dark:text-white' : 'font-medium text-slate-700 dark:text-slate-200'}`}>
                {ticket.user_name}
              </p>
              {ticket.priority === 'HIGH' && <span className="shrink-0 text-[10px]">🔥</span>}
              <span className="ml-auto shrink-0 text-[11px] text-slate-400 dark:text-slate-500">
                {relativeTime(ticket.last_message_at || ticket.updated_at)}
              </span>
            </div>

            <p className={`truncate text-sm mt-0.5 ${unread > 0 ? 'text-slate-800 dark:text-slate-100' : 'text-slate-600 dark:text-slate-300'}`}>
              {ticket.subject}
            </p>

            <div className="flex items-center gap-2 mt-1">
              <p className="truncate text-xs text-slate-400 dark:text-slate-500 flex-1">
                {ticket.last_message
                  ? `${ticket.last_message_from_user ? '' : 'Вы: '}${ticket.last_message}`
                  : 'Нет сообщений'}
              </p>
              {unread > 0 && (
                <span className="shrink-0 bg-red-500 text-white text-[11px] font-bold rounded-full min-w-[20px] h-5 px-1.5 flex items-center justify-center">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </div>
          </div>
        </div>
      </button>
    );
  };

  const renderChat = () => {
    if (!selectedTicket) {
      return (
        <div className="hidden lg:flex flex-1 items-center justify-center text-center p-8">
          <div>
            <div className="w-14 h-14 mx-auto rounded-2xl bg-slate-100 dark:bg-slate-700/50 text-slate-400 dark:text-slate-500 flex items-center justify-center mb-3">
              {ICONS.Chat}
            </div>
            <p className="font-medium text-slate-600 dark:text-slate-300">Выберите обращение</p>
            <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">Переписка откроется здесь</p>
          </div>
        </div>
      );
    }

    const statusMeta = STATUS_META[selectedTicket.status] || STATUS_META.OPEN;
    const priorityMeta = PRIORITY_META[selectedTicket.priority] || PRIORITY_META.NORMAL;
    const isClosed = selectedTicket.status === 'CLOSED';

    return (
      <div className="flex flex-col flex-1 min-h-0 bg-white dark:bg-slate-800">
        {/* Шапка переписки */}
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 shrink-0">
          <div className="flex items-start gap-3">
            <button
              onClick={() => setSelectedTicket(null)}
              className="lg:hidden p-2 -ml-2 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 shrink-0"
              aria-label="Назад к списку"
            >
              {ICONS.Back}
            </button>
            <div className="w-9 h-9 shrink-0 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 text-white flex items-center justify-center font-semibold text-sm">
              {initials(selectedTicket.user_name)}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="font-bold text-slate-900 dark:text-white truncate">{selectedTicket.subject}</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {selectedTicket.user_name} • {selectedTicket.user_email}
              </p>
            </div>
            <button
              onClick={() => setSelectedTicket(null)}
              className="hidden lg:flex p-2 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 shrink-0"
              aria-label="Закрыть переписку"
            >
              {ICONS.Close}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 mt-3">
            <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${statusMeta.chip}`}>{statusMeta.label}</span>
            <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${priorityMeta.chip}`}>
              Приоритет: {priorityMeta.label}
            </span>
            <span className="text-[11px] text-slate-400 dark:text-slate-500">
              Создан {new Date(selectedTicket.created_at).toLocaleDateString('ru-RU')}
            </span>

            <div className="ml-auto flex items-center gap-1.5">
              {!selectedTicket.assigned_admin_id && !isClosed && (
                <button
                  onClick={() => changeStatus(selectedTicket, 'assign')}
                  className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
                >
                  Взять в работу
                </button>
              )}
              {isClosed ? (
                <button
                  onClick={() => changeStatus(selectedTicket, 'reopen')}
                  className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-blue-200 dark:border-blue-900/50 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30"
                >
                  Переоткрыть
                </button>
              ) : (
                <button
                  onClick={() => changeStatus(selectedTicket, 'close')}
                  className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-emerald-200 dark:border-emerald-900/50 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/30"
                >
                  Решён
                </button>
              )}
              <button
                onClick={() => deleteTicket(selectedTicket)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30"
                aria-label="Удалить тикет"
              >
                {ICONS.Delete}
              </button>
            </div>
          </div>
        </div>

        {/* Сообщения */}
        <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50 dark:bg-slate-900/50">
          {messageGroups.length === 0 ? (
            <div className="text-center text-slate-400 dark:text-slate-500 text-sm py-8">Нет сообщений</div>
          ) : (
            messageGroups.map(group => (
              <div key={group.label} className="space-y-2">
                <div className="flex justify-center">
                  <span className="px-2.5 py-1 rounded-full bg-slate-200/70 dark:bg-slate-700/70 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    {group.label}
                  </span>
                </div>
                {group.items.map(msg => (
                  <div key={msg.id} className={`flex ${msg.is_from_user ? 'justify-start' : 'justify-end'}`}>
                    <div
                      className={`max-w-[85%] sm:max-w-[70%] px-3.5 py-2.5 rounded-2xl shadow-sm ${
                        msg.is_from_user
                          ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 rounded-bl-md'
                          : 'bg-indigo-600 text-white rounded-br-md'
                      }`}
                    >
                      <p className="text-sm break-words whitespace-pre-wrap leading-relaxed">{msg.message}</p>
                      <p className={`text-[10px] mt-1 text-right ${msg.is_from_user ? 'text-slate-400 dark:text-slate-400' : 'text-indigo-200'}`}>
                        {new Date(msg.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                        {!msg.is_from_user && (msg.is_read ? ' ✓✓' : ' ✓')}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>

        {/* Поле ответа */}
        <div className="p-3 border-t border-slate-200 dark:border-slate-700 shrink-0 safe-area-pb">
          {showQuickReplies && (
            <div className="mb-2 space-y-1.5 max-h-40 overflow-y-auto">
              {QUICK_REPLIES.map((reply, i) => (
                <button
                  key={i}
                  onClick={() => { setNewMessage(reply); setShowQuickReplies(false); inputRef.current?.focus(); }}
                  className="w-full text-left text-xs p-2 rounded-lg bg-slate-50 dark:bg-slate-700/50 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-100 dark:border-slate-700"
                >
                  {reply}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-end gap-2">
            <button
              onClick={() => setShowQuickReplies(v => !v)}
              className={`p-2.5 rounded-xl border shrink-0 transition-colors ${
                showQuickReplies
                  ? 'bg-indigo-50 border-indigo-200 text-indigo-600 dark:bg-indigo-900/30 dark:border-indigo-800 dark:text-indigo-400'
                  : 'border-slate-200 dark:border-slate-600 text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'
              }`}
              title="Быстрые ответы"
            >
              {ICONS.List}
            </button>
            <textarea
              ref={inputRef}
              value={newMessage}
              onChange={e => setNewMessage(e.target.value)}
              onKeyDown={e => {
                // Enter — отправить, Shift+Enter — перенос строки
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              rows={1}
              placeholder={isClosed ? 'Тикет закрыт — ответ переоткроет обсуждение' : 'Ответ пользователю... (Enter — отправить)'}
              className="flex-1 resize-none max-h-32 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:bg-white dark:focus:bg-slate-900"
              style={{ minHeight: '44px' }}
            />
            <button
              onClick={sendMessage}
              disabled={isSending || !newMessage.trim()}
              className="bg-indigo-600 text-white p-2.5 rounded-xl hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center"
              aria-label="Отправить"
            >
              {isSending ? (
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                ICONS.Send
              )}
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-[calc(100dvh-2rem)] lg:h-[calc(100dvh-5rem)]">
      {/* Шапка */}
      <div className="flex items-center gap-3 mb-4 shrink-0">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white p-2 -ml-2 rounded-lg"
        >
          {ICONS.Back}
          <span className="font-medium hidden sm:inline">Назад</span>
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white truncate">Поддержка</h1>
          {totalUnread > 0 && (
            <p className="text-xs text-red-600 dark:text-red-400 font-medium">
              {totalUnread} непрочитанных сообщений
            </p>
          )}
        </div>
        <button
          onClick={() => setShowBroadcastForm(true)}
          className="bg-purple-600 text-white px-3 sm:px-4 py-2.5 rounded-xl hover:bg-purple-700 flex items-center gap-2 font-medium shadow-sm shrink-0"
        >
          {ICONS.Megaphone}
          <span className="hidden sm:inline">Рассылка</span>
        </button>
      </div>

      {/* Статистика — кликабельная, работает как быстрый фильтр */}
      {stats && (
        <div className="grid grid-cols-3 lg:grid-cols-5 gap-2 mb-3 shrink-0">
          {statCards.map(card => (
            <button
              key={card.key}
              onClick={card.onClick}
              className="bg-white dark:bg-slate-800 px-3 py-2 rounded-xl border border-slate-100 dark:border-slate-700 text-left hover:border-indigo-200 dark:hover:border-indigo-800 transition-colors"
            >
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{card.label}</p>
              <p className={`text-lg font-bold ${card.cls}`}>{card.value}</p>
            </button>
          ))}
        </div>
      )}

      {/* Поиск и фильтры */}
      <div className="flex flex-col sm:flex-row gap-2 mb-3 shrink-0">
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">{ICONS.Search}</span>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск по теме, имени или email..."
            className="w-full pl-10 pr-9 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 dark:text-white text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              aria-label="Очистить поиск"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="flex-1 sm:flex-none px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 dark:text-white text-sm focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">Все статусы</option>
            <option value="OPEN">Открытые</option>
            <option value="IN_PROGRESS">В работе</option>
            <option value="CLOSED">Закрытые</option>
          </select>
          <select
            value={filterPriority}
            onChange={e => setFilterPriority(e.target.value)}
            className="flex-1 sm:flex-none px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 dark:text-white text-sm focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">Любой приоритет</option>
            <option value="HIGH">Высокий</option>
            <option value="MEDIUM">Средний</option>
            <option value="NORMAL">Обычный</option>
          </select>
        </div>
      </div>

      {/* Основная область: слева список, справа переписка (на десктопе) */}
      <div className="flex-1 min-h-0 flex gap-3 rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
        {/* Список тикетов */}
        <div
          className={`${selectedTicket ? 'hidden lg:flex' : 'flex'} flex-col w-full lg:w-[380px] lg:shrink-0 lg:border-r border-slate-200 dark:border-slate-700 min-h-0`}
        >
          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
            {isInitialLoading ? (
              <div className="p-8 text-center text-sm text-slate-400 dark:text-slate-500">Загрузка...</div>
            ) : tickets.length === 0 ? (
              <div className="p-8 text-center">
                <div className="w-12 h-12 mx-auto rounded-xl bg-slate-100 dark:bg-slate-700/50 text-slate-400 flex items-center justify-center mb-2">
                  {ICONS.Chat}
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {hasActiveFilters ? 'Ничего не найдено по фильтрам' : 'Обращений пока нет'}
                </p>
                {hasActiveFilters && (
                  <button
                    onClick={() => { setSearch(''); setFilterStatus(''); setFilterPriority(''); }}
                    className="mt-2 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                  >
                    Сбросить фильтры
                  </button>
                )}
              </div>
            ) : (
              tickets.map(renderTicketCard)
            )}
          </div>
        </div>

        {/* Переписка */}
        <div className={`${selectedTicket ? 'flex' : 'hidden lg:flex'} flex-col flex-1 min-h-0 -ml-3 lg:ml-0`}>
          {renderChat()}
        </div>
      </div>

      {/* Модалка рассылки */}
      {showBroadcastForm && (
        <div
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center z-[60] p-0 sm:p-4 animate-modal-fade-in"
          onClick={() => setShowBroadcastForm(false)}
        >
          <div
            className="bg-white dark:bg-slate-800 p-5 sm:p-6 rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto shadow-2xl animate-slide-up-sheet safe-area-pb"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 p-2 rounded-lg">
                {ICONS.Megaphone}
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">Массовая рассылка</h3>
            </div>

            <input
              type="text"
              value={broadcastData.title}
              onChange={e => setBroadcastData({ ...broadcastData, title: e.target.value })}
              placeholder="Заголовок"
              className="w-full px-4 py-3 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-xl mb-3 text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
            />

            <select
              value={broadcastData.targetRole}
              onChange={e => setBroadcastData({ ...broadcastData, targetRole: e.target.value })}
              className="w-full px-4 py-3 border border-slate-200 dark:border-slate-600 rounded-xl mb-3 text-sm focus:ring-2 focus:ring-purple-500 bg-white dark:bg-slate-900 dark:text-white"
            >
              <option value="">Все пользователи</option>
              <option value="manager">Менеджеры</option>
              <option value="employee">Сотрудники</option>
              <option value="investor">Инвесторы</option>
            </select>

            <textarea
              value={broadcastData.message}
              onChange={e => setBroadcastData({ ...broadcastData, message: e.target.value })}
              placeholder="Текст сообщения..."
              rows={4}
              className="w-full px-4 py-3 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-xl mb-4 text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500 resize-none"
            />

            <div className="flex gap-3">
              <button
                onClick={() => setShowBroadcastForm(false)}
                className="flex-1 px-4 py-3 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 font-medium"
              >
                Отмена
              </button>
              <button
                onClick={sendBroadcast}
                disabled={isBroadcasting}
                className="flex-1 px-4 py-3 bg-purple-600 text-white rounded-xl hover:bg-purple-700 disabled:opacity-50 font-medium shadow-sm"
              >
                {isBroadcasting ? 'Отправка...' : 'Отправить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminSupportPanel;
