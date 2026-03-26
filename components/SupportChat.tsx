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
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Загрузка данных
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
    const interval = setInterval(loadData, 30000); // Обновление каждые 30 сек
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Открыть тикет
  const openTicket = async (ticket: Ticket) => {
    setSelectedTicket(ticket);
    try {
      const response = await api.get(`/support/tickets/${ticket.id}/messages`);
      setMessages(response);
      loadData(); // Обновить счётчик непрочитанных
    } catch (error) {
      console.error('Failed to load messages:', error);
    }
  };

  // Отправить сообщение
  const sendMessage = async () => {
    if (!newMessage.trim() || !selectedTicket) return;

    setIsLoading(true);
    try {
      await api.post(`/support/tickets/${selectedTicket.id}/messages`, {
        message: newMessage
      });
      setNewMessage('');
      loadData();
      openTicket(selectedTicket); // Обновить сообщения
    } catch (error) {
      console.error('Failed to send message:', error);
      alert('Ошибка отправки сообщения');
    } finally {
      setIsLoading(false);
    }
  };

  // Создать новый тикет
  const createTicket = async () => {
    if (!newTicketSubject.trim() || !newTicketMessage.trim()) {
      alert('Заполните все поля');
      return;
    }

    setIsLoading(true);
    try {
      const response = await api.post('/support/tickets', {
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

  // Закрыть тикет
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

  // Отметить broadcast как прочитанный
  const markBroadcastRead = async (broadcastId: string) => {
    try {
      await api.post(`/support/broadcast/${broadcastId}/read`);
      loadData();
    } catch (error) {
      console.error('Failed to mark broadcast read:', error);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'OPEN': return 'bg-green-500';
      case 'IN_PROGRESS': return 'bg-blue-500';
      case 'CLOSED': return 'bg-gray-500';
      default: return 'bg-gray-500';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'HIGH': return 'text-red-500';
      case 'MEDIUM': return 'text-orange-500';
      default: return 'text-gray-500';
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center z-50">
      <div className="bg-white w-full sm:w-[600px] h-[90vh] sm:h-[700px] rounded-t-2xl sm:rounded-2xl flex flex-col shadow-2xl">
        {/* Header */}
        <div className="p-4 border-b flex items-center justify-between bg-blue-500 text-white rounded-t-2xl">
          <div className="flex items-center gap-3">
            {ICONS.Chat}
            <h2 className="text-lg font-bold">Техподдержка</h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-full">
            {ICONS.Close}
          </button>
        </div>

        {/* Broadcast Messages */}
        {broadcasts.length > 0 && (
          <div className="p-4 bg-yellow-50 border-b">
            <h3 className="font-semibold text-yellow-800 mb-2">📢 Важные уведомления</h3>
            {broadcasts.map(broadcast => (
              <div key={broadcast.id} className="bg-white p-3 rounded-lg mb-2 border border-yellow-200">
                <div className="flex justify-between items-start">
                  <h4 className="font-semibold text-yellow-900">{broadcast.title}</h4>
                  <button
                    onClick={() => markBroadcastRead(broadcast.id)}
                    className="text-xs text-yellow-600 hover:underline"
                  >
                    ✕
                  </button>
                </div>
                <p className="text-sm text-gray-700 mt-1">{broadcast.message}</p>
                <p className="text-xs text-gray-500 mt-2">
                  {new Date(broadcast.created_at).toLocaleDateString('ru-RU')}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Tickets List */}
          {!selectedTicket && (
            <div className="flex-1 overflow-y-auto p-4">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-semibold text-gray-700">Мои обращения</h3>
                <button
                  onClick={() => setShowNewTicketForm(true)}
                  className="bg-blue-500 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-600 flex items-center gap-2"
                >
                  {ICONS.Add}
                  Новый тикет
                </button>
              </div>

              {tickets.length === 0 ? (
                <div className="text-center text-gray-500 py-8">
                  <p>У вас нет активных обращений</p>
                  <p className="text-sm">Создайте новый тикет для связи с поддержкой</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {tickets.map(ticket => (
                    <button
                      key={ticket.id}
                      onClick={() => openTicket(ticket)}
                      className="w-full text-left p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors border relative"
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className="font-semibold text-gray-800">{ticket.subject}</h4>
                          <p className="text-sm text-gray-500 mt-1">
                            {new Date(ticket.created_at).toLocaleDateString('ru-RU')}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-1 rounded text-xs text-white ${getStatusColor(ticket.status)}`}>
                            {ticket.status === 'OPEN' ? 'Открыт' : ticket.status === 'IN_PROGRESS' ? 'В работе' : 'Закрыт'}
                          </span>
                          {ticket.unreadCount > 0 && (
                            <span className="bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                              {ticket.unreadCount}
                            </span>
                          )}
                        </div>
                      </div>
                      <span className={`text-xs ${getPriorityColor(ticket.priority)}`}>
                        {ticket.priority === 'HIGH' ? '🔴 Высокий' : ticket.priority === 'MEDIUM' ? '🟠 Средний' : '⚪ Обычный'}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Chat View */}
          {selectedTicket && (
            <div className="flex-1 flex flex-col">
              {/* Chat Header */}
              <div className="p-4 border-b flex items-center justify-between">
                <button onClick={() => setSelectedTicket(null)} className="text-blue-500 flex items-center gap-2">
                  {ICONS.ArrowLeft}
                  Назад
                </button>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-1 rounded text-xs text-white ${getStatusColor(selectedTicket.status)}`}>
                    {selectedTicket.status}
                  </span>
                  <button onClick={closeTicket} className="text-gray-500 hover:text-red-500 text-sm">
                    Закрыть
                  </button>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
                {messages.map(msg => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.is_from_user ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[80%] p-3 rounded-2xl ${
                        msg.is_from_user
                          ? 'bg-blue-500 text-white rounded-br-none'
                          : 'bg-white text-gray-800 rounded-bl-none shadow'
                      }`}
                    >
                      <p className="text-sm">{msg.message}</p>
                      <p className={`text-xs mt-1 ${msg.is_from_user ? 'text-blue-100' : 'text-gray-400'}`}>
                        {new Date(msg.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              {/* Input */}
              <div className="p-4 border-t bg-white">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                    placeholder="Введите сообщение..."
                    className="flex-1 px-4 py-3 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                    disabled={isLoading || selectedTicket.status === 'CLOSED'}
                  />
                  <button
                    onClick={sendMessage}
                    disabled={isLoading || !newMessage.trim() || selectedTicket.status === 'CLOSED'}
                    className="bg-blue-500 text-white px-6 py-3 rounded-xl hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {ICONS.Send}
                  </button>
                </div>
                {selectedTicket.status === 'CLOSED' && (
                  <p className="text-xs text-gray-500 mt-2 text-center">
                    Тикет закрыт. Создайте новый для продолжения общения.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* New Ticket Form Modal */}
        {showNewTicketForm && (
          <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center rounded-2xl">
            <div className="bg-white p-6 rounded-2xl w-[90%] max-w-md">
              <h3 className="text-lg font-bold mb-4">Новое обращение</h3>

              <input
                type="text"
                value={newTicketSubject}
                onChange={(e) => setNewTicketSubject(e.target.value)}
                placeholder="Тема"
                className="w-full px-4 py-3 border rounded-xl mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />

              <select
                value={newTicketPriority}
                onChange={(e) => setNewTicketPriority(e.target.value)}
                className="w-full px-4 py-3 border rounded-xl mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="NORMAL">⚪ Обычный</option>
                <option value="MEDIUM">🟠 Средний</option>
                <option value="HIGH">🔴 Высокий</option>
              </select>

              <textarea
                value={newTicketMessage}
                onChange={(e) => setNewTicketMessage(e.target.value)}
                placeholder="Опишите проблему..."
                rows={4}
                className="w-full px-4 py-3 border rounded-xl mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />

              <div className="flex gap-2">
                <button
                  onClick={() => setShowNewTicketForm(false)}
                  className="flex-1 px-4 py-3 border rounded-xl hover:bg-gray-50"
                >
                  Отмена
                </button>
                <button
                  onClick={createTicket}
                  disabled={isLoading}
                  className="flex-1 px-4 py-3 bg-blue-500 text-white rounded-xl hover:bg-blue-600 disabled:opacity-50"
                >
                  {isLoading ? 'Отправка...' : 'Создать'}
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