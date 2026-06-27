import React, { useState, useEffect, useRef } from 'react';
import { api } from '../services/api';
import { ICONS } from '../constants';

interface SupportChatProps {
  user: any;
  onClose: () => void;
  onUnreadChange: (count: number) => void;
}

interface Ticket {
  id: string;
  subject: string;
  status: string;
  priority: string;
  unreadCount: number;
  created_at: string;
  updated_at: string;
}

interface Message {
  id: string;
  message: string;
  is_from_user: boolean;
  created_at: string;
}

interface Broadcast {
  id: string;
  title: string;
  message: string;
  created_at: string;
}

const SupportChat: React.FC<SupportChatProps> = ({ user, onClose, onUnreadChange }) => {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [showNewTicketForm, setShowNewTicketForm] = useState(false);
  const [newTicketSubject, setNewTicketSubject] = useState('');
  const [newTicketMessage, setNewTicketMessage] = useState('');
  const [newTicketPriority, setNewTicketPriority] = useState('NORMAL');
  const [isLoading, setIsLoading] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Определение мобильного устройства
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 640 || /Android|iPhone|iPad/i.test(navigator.userAgent));
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Блокировка скролла фона при открытом модалке
  useEffect(() => {
    if (showNewTicketForm || selectedTicket) {
      document.body.style.overflow = 'hidden';
      // Фокус на первое поле формы
      setTimeout(() => {
        (showNewTicketForm ? textareaRef.current : inputRef.current)?.focus();
      }, 100);
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [showNewTicketForm, selectedTicket]);

  // Авто-скролл к новым сообщениям + учёт клавиатуры
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  // Сброс непрочитанных при открытии чата
  useEffect(() => {
    onUnreadChange(0);
  }, []);

  const loadData = async () => {
    try {
      const response = await api.get('/support/tickets');
      setTickets(response.tickets);
      setBroadcasts(response.broadcasts);
      onUnreadChange(response.totalUnread);
    } catch (error) {
      console.error('Failed to load support data:', error);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, []);

  const openTicket = async (ticket: Ticket) => {
    setSelectedTicket(ticket);
    try {
      const response = await api.get(`/support/tickets/${ticket.id}/messages`);
      setMessages(response);
      loadData();
    } catch (error) {
      console.error('Failed to load messages:', error);
    }
  };

  const sendMessage = async () => {
    if (!newMessage.trim() || !selectedTicket) return;
    setIsLoading(true);
    try {
      await api.post(`/support/tickets/${selectedTicket.id}/messages`, { message: newMessage });
      setNewMessage('');
      loadData();
      openTicket(selectedTicket);
    } catch (error) {
      console.error('Failed to send message:', error);
      alert('Ошибка отправки сообщения');
    } finally {
      setIsLoading(false);
    }
  };

  // ✅ Обработка Enter на мобильных (без отправки формы)
  const handleKeyPress = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const createTicket = async () => {
    if (!newTicketSubject.trim() || !newTicketMessage.trim()) {
      alert('Заполните все поля');
      return;
    }
    setIsLoading(true);
    try {
      await api.post('/support/tickets', {
        subject: newTicketSubject,
        message: newTicketMessage,
        priority: newTicketPriority
      });
      setShowNewTicketForm(false);
      setNewTicketSubject('');
      setNewTicketMessage('');
      setNewTicketPriority('NORMAL');
      loadData();
      alert('Тикет создан!');
    } catch (error) {
      console.error('Failed to create ticket:', error);
      alert('Ошибка создания тикета');
    } finally {
      setIsLoading(false);
    }
  };

  const closeTicket = async () => {
    if (!selectedTicket) return;
    if (!window.confirm('Закрыть этот тикет?')) return;
    try {
      await api.patch(`/support/tickets/${selectedTicket.id}/close`);
      setSelectedTicket(null);
      loadData();
    } catch (error) {
      console.error('Failed to close ticket:', error);
    }
  };

  const markBroadcastRead = async (broadcastId: string) => {
    try {
      await api.post(`/support/broadcast/${broadcastId}/read`);
      loadData();
    } catch (error) {
      console.error('Failed to mark broadcast read:', error);
    }
  };

  // ✅ Улучшенные цветовые утилиты
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'OPEN': return 'bg-emerald-500';
      case 'IN_PROGRESS': return 'bg-blue-500';
      case 'CLOSED': return 'bg-gray-400';
      default: return 'bg-gray-400';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'HIGH': return 'text-red-600 font-semibold';
      case 'MEDIUM': return 'text-orange-600';
      default: return 'text-gray-500';
    }
  };

  // ✅ Компактный хелпер для даты
  const formatDate = (date: string) => new Date(date).toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
  });

  return (
    <div 
      className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 safe-area-inset"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      {/* ✅ Адаптивный контейнер с учётом safe area для iPhone */}
      <div 
        className="bg-white w-full sm:w-[600px] h-[92vh] sm:h-[700px] 
                   rounded-t-3xl sm:rounded-2xl flex flex-col shadow-2xl
                   pb-safe"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b flex items-center justify-between bg-gradient-to-r from-blue-600 to-blue-500 text-white rounded-t-3xl sm:rounded-2xl shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-xl">{ICONS.Chat}</span>
            <h2 className="text-lg font-bold truncate">Техподдержка</h2>
          </div>
          {/* ✅ Увеличенная кнопка закрытия для пальца */}
          <button 
            onClick={onClose} 
            className="p-3 hover:bg-white/20 rounded-full transition active:scale-95"
            aria-label="Закрыть"
          >
            {ICONS.Close}
          </button>
        </div>

        {/* Broadcast Messages */}
        {broadcasts.length > 0 && !selectedTicket && (
          <div className="p-4 bg-amber-50 border-b shrink-0 max-h-32 overflow-y-auto">
            <h3 className="font-semibold text-amber-800 mb-2 text-sm">📢 Важно</h3>
            {broadcasts.slice(0, 2).map(broadcast => (
              <div key={broadcast.id} className="bg-white p-3 rounded-xl mb-2 border border-amber-200">
                <div className="flex justify-between items-start gap-2">
                  <h4 className="font-semibold text-amber-900 text-sm truncate">{broadcast.title}</h4>
                  <button
                    onClick={() => markBroadcastRead(broadcast.id)}
                    className="text-amber-600 hover:text-amber-800 text-lg leading-none shrink-0"
                  >✕</button>
                </div>
                <p className="text-sm text-gray-700 mt-1 line-clamp-2">{broadcast.message}</p>
              </div>
            ))}
          </div>
        )}

        {/* Content Area */}
        <div className="flex-1 flex overflow-hidden">
          
          {/* 🎫 Список тикетов */}
          {!selectedTicket && (
            <div className="flex-1 overflow-y-auto p-4">
              <div className="flex justify-between items-center mb-4 gap-3">
                <h3 className="font-semibold text-gray-700">Мои обращения</h3>
                {/* ✅ Большая кнопка для мобильного */}
                <button
                  onClick={() => setShowNewTicketForm(true)}
                  className="bg-blue-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium 
                           hover:bg-blue-700 active:scale-95 transition flex items-center gap-1.5
                           min-h-[44px] min-w-[44px]"
                >
                  {ICONS.Add}
                  <span className="hidden sm:inline">Новый</span>
                </button>
              </div>

              {tickets.length === 0 ? (
                <div className="text-center text-gray-500 py-12 px-6">
                  <p className="text-lg mb-2">Нет обращений</p>
                  <p className="text-sm">Нажмите «Новый», чтобы создать тикет</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {tickets.map(ticket => (
                    <button
                      key={ticket.id}
                      onClick={() => openTicket(ticket)}
                      className="w-full text-left p-4 bg-gray-50 rounded-2xl 
                               hover:bg-gray-100 active:bg-gray-200 transition 
                               border border-gray-100 min-h-[72px]"
                    >
                      <div className="flex justify-between items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <h4 className="font-semibold text-gray-800 truncate">{ticket.subject}</h4>
                          <p className="text-xs text-gray-500 mt-0.5">{formatDate(ticket.created_at)}</p>
                        </div>
                        <div className="flex flex-col items-end gap-1.5 shrink-0">
                          <span className={`px-2.5 py-1 rounded-full text-[11px] font-medium text-white ${getStatusColor(ticket.status)}`}>
                            {ticket.status === 'OPEN' ? 'Открыт' : ticket.status === 'IN_PROGRESS' ? 'В работе' : 'Закрыт'}
                          </span>
                          {ticket.unreadCount > 0 && (
                            <span className="bg-red-500 text-white text-[11px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
                              {ticket.unreadCount}
                            </span>
                          )}
                        </div>
                      </div>
                      <span className={`text-[11px] mt-2 block ${getPriorityColor(ticket.priority)}`}>
                        {ticket.priority === 'HIGH' ? '🔴 Высокий' : ticket.priority === 'MEDIUM' ? '🟠 Средний' : '⚪ Обычный'}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 💬 Чат */}
          {selectedTicket && (
            <div className="flex-1 flex flex-col">
              {/* Chat Header */}
              <div className="p-4 border-b flex items-center justify-between bg-white shrink-0">
                <button 
                  onClick={() => setSelectedTicket(null)} 
                  className="text-blue-600 flex items-center gap-2 py-2 px-3 rounded-xl 
                           active:bg-blue-50 transition min-h-[44px]"
                >
                  {ICONS.ArrowLeft}
                  <span className="font-medium">Назад</span>
                </button>
                <div className="flex items-center gap-2">
                  <span className={`px-2.5 py-1 rounded-full text-[11px] font-medium text-white ${getStatusColor(selectedTicket.status)}`}>
                    {selectedTicket.status === 'OPEN' ? 'Открыт' : selectedTicket.status === 'IN_PROGRESS' ? 'В работе' : 'Закрыт'}
                  </span>
                  {selectedTicket.status !== 'CLOSED' && (
                    <button 
                      onClick={closeTicket} 
                      className="text-gray-500 hover:text-red-600 text-sm py-2 px-3 min-h-[44px]"
                    >
                      Закрыть
                    </button>
                  )}
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
                {messages.map(msg => (
                  <div key={msg.id} className={`flex ${msg.is_from_user ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[85%] sm:max-w-[75%] p-3.5 rounded-2xl ${
                        msg.is_from_user
                          ? 'bg-blue-600 text-white rounded-br-md'
                          : 'bg-white text-gray-800 rounded-bl-md shadow-sm border border-gray-100'
                      }`}
                    >
                      <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{msg.message}</p>
                      <p className={`text-[11px] mt-1.5 ${msg.is_from_user ? 'text-blue-100' : 'text-gray-400'}`}>
                        {new Date(msg.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              {/* ✅ Input Area с учётом клавиатуры */}
              <div className="p-3 sm:p-4 border-t bg-white shrink-0 pb-[env(safe-area-inset-bottom,16px)]">
                <div className="flex gap-2 items-end">
                  <input
                    ref={inputRef}
                    type="text"
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onKeyDown={handleKeyPress}
                    placeholder="Сообщение..."
                    className="flex-1 px-4 py-3.5 border border-gray-200 rounded-2xl 
                             focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                             text-[15px] min-h-[48px] max-h-32"
                    disabled={isLoading || selectedTicket.status === 'CLOSED'}
                  />
                  <button
                    onClick={sendMessage}
                    disabled={isLoading || !newMessage.trim() || selectedTicket.status === 'CLOSED'}
                    className="bg-blue-600 text-white p-3.5 rounded-2xl 
                             hover:bg-blue-700 active:scale-95 transition 
                             disabled:opacity-40 disabled:active:scale-100
                             min-w-[48px] min-h-[48px] flex items-center justify-center"
                    aria-label="Отправить"
                  >
                    {isLoading ? (
                      <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      ICONS.Send
                    )}
                  </button>
                </div>
                {selectedTicket.status === 'CLOSED' && (
                  <p className="text-[12px] text-gray-500 mt-2 text-center bg-gray-50 py-2 rounded-lg">
                    Тикет закрыт. Создайте новый для продолжения.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ✅ Новая форма тикета — не overlay, а bottom sheet на мобильном */}
        {showNewTicketForm && (
          <div 
            className={`absolute inset-0 bg-black/40 flex ${isMobile ? 'items-end' : 'items-center'} justify-center rounded-t-3xl sm:rounded-2xl z-10`}
            onClick={() => setShowNewTicketForm(false)}
          >
            <div 
              className={`bg-white ${isMobile ? 'w-full rounded-t-3xl pb-safe' : 'w-[90%] max-w-md rounded-2xl'} 
                        p-5 sm:p-6 max-h-[85vh] overflow-y-auto`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-between items-center mb-5">
                <h3 className="text-lg font-bold">Новое обращение</h3>
                <button 
                  onClick={() => setShowNewTicketForm(false)}
                  className="p-2 hover:bg-gray-100 rounded-full min-w-[44px] min-h-[44px]"
                >
                  {ICONS.Close}
                </button>
              </div>

              <input
                type="text"
                value={newTicketSubject}
                onChange={(e) => setNewTicketSubject(e.target.value)}
                placeholder="Тема *"
                className="w-full px-4 py-3.5 border border-gray-200 rounded-xl mb-3 
                         focus:outline-none focus:ring-2 focus:ring-blue-500 text-[15px] min-h-[48px]"
                autoFocus
              />

              <select
                value={newTicketPriority}
                onChange={(e) => setNewTicketPriority(e.target.value)}
                className="w-full px-4 py-3.5 border border-gray-200 rounded-xl mb-3 
                         focus:outline-none focus:ring-2 focus:ring-blue-500 text-[15px] min-h-[48px] bg-white"
              >
                <option value="NORMAL">⚪ Обычный приоритет</option>
                <option value="MEDIUM">🟠 Средний приоритет</option>
                <option value="HIGH">🔴 Высокий приоритет</option>
              </select>

              <textarea
                ref={textareaRef}
                value={newTicketMessage}
                onChange={(e) => setNewTicketMessage(e.target.value)}
                placeholder="Опишите проблему подробно... *"
                rows={4}
                className="w-full px-4 py-3.5 border border-gray-200 rounded-xl mb-5 
                         focus:outline-none focus:ring-2 focus:ring-blue-500 text-[15px] resize-none"
              />

              <div className="flex gap-3">
                <button
                  onClick={() => setShowNewTicketForm(false)}
                  className="flex-1 px-4 py-3.5 border border-gray-200 rounded-xl 
                           hover:bg-gray-50 active:bg-gray-100 transition font-medium min-h-[48px]"
                >
                  Отмена
                </button>
                <button
                  onClick={createTicket}
                  disabled={isLoading}
                  className="flex-1 px-4 py-3.5 bg-blue-600 text-white rounded-xl 
                           hover:bg-blue-700 active:scale-95 transition font-medium 
                           disabled:opacity-50 disabled:active:scale-100 min-h-[48px]"
                >
                  {isLoading ? 'Отправка...' : 'Создать тикет'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SupportChat;