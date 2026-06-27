import React, { useState, useEffect, useRef } from 'react';
import { api } from '../services/api';
import { ICONS } from '../constants';

interface AdminSupportPanelProps {
  onBack: () => void;
}

const AdminSupportPanel: React.FC<AdminSupportPanelProps> = ({ onBack }) => {
  const [tickets, setTickets] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [selectedTicket, setSelectedTicket] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [showBroadcastForm, setShowBroadcastForm] = useState(false);
  const [broadcastData, setBroadcastData] = useState({ title: '', message: '', targetRole: '' });
  const [isLoading, setIsLoading] = useState(false);

  const chatContainerRef = useRef<HTMLDivElement>(null);

  const loadData = async () => {
    try {
      const [ticketsRes, statsRes] = await Promise.all([
        api.get('/admin/support/tickets' + (filterStatus ? `?status=${filterStatus}` : '')),
        api.get('/admin/support/stats')
      ]);
      setTickets(ticketsRes);
      setStats(statsRes);
    } catch (error) {
      console.error('Failed to load admin support data:', error);
    }
  };

  useEffect(() => {
    loadData();
  }, [filterStatus]);

  // Автопрокрутка чата к последнему сообщению
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages, selectedTicket]);

  const openTicket = async (ticket: any) => {
    setSelectedTicket(ticket);
    try {
      const response = await api.get(`/support/tickets/${ticket.id}/messages`);
      setMessages(response);
    } catch (error) {
      console.error('Failed to load messages:', error);
    }
  };

  const sendMessage = async () => {
    if (!newMessage.trim() || !selectedTicket) return;

    setIsLoading(true);
    try {
      await api.post(`/admin/support/tickets/${selectedTicket.id}/messages`, {
        message: newMessage
      });
      setNewMessage('');
      openTicket(selectedTicket);
      loadData();
    } catch (error) {
      console.error('Failed to send message:', error);
      alert('Ошибка отправки');
    } finally {
      setIsLoading(false);
    }
  };

  const assignTicket = async (ticketId: string) => {
    try {
      await api.patch(`/admin/support/tickets/${ticketId}/assign`);
      loadData();
      alert('Тикет назначен на вас');
    } catch (error) {
      console.error('Failed to assign ticket:', error);
    }
  };

  const sendBroadcast = async () => {
    if (!broadcastData.title || !broadcastData.message) {
      alert('Заполните все поля');
      return;
    }

    setIsLoading(true);
    try {
      await api.post('/admin/support/broadcast', broadcastData);
      setShowBroadcastForm(false);
      setBroadcastData({ title: '', message: '', targetRole: '' });
      alert('Рассылка отправлена!');
    } catch (error) {
      console.error('Failed to send broadcast:', error);
      alert('Ошибка рассылки');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 p-4 sm:p-6 pb-safe">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 sm:mb-6 gap-3">
        <button onClick={onBack} className="flex items-center gap-2 text-gray-600 hover:text-gray-800 active:opacity-70 min-h-[44px] px-2 py-2 rounded-lg">
          {ICONS.ArrowLeft}
          <span className="font-medium">Назад</span>
        </button>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Панель поддержки</h1>
        <button
          onClick={() => setShowBroadcastForm(true)}
          className="w-full sm:w-auto bg-purple-500 text-white px-4 py-2.5 rounded-xl hover:bg-purple-600 active:bg-purple-700 flex items-center justify-center gap-2 min-h-[44px] transition-colors font-medium shadow-sm"
        >
          {ICONS.Broadcast}
          <span>Рассылка</span>
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-4 sm:mb-6">
          <div className="bg-white p-3 sm:p-4 rounded-xl shadow-sm border border-gray-100">
            <p className="text-gray-500 text-xs sm:text-sm">Всего</p>
            <p className="text-xl sm:text-2xl font-bold">{stats.total_tickets}</p>
          </div>
          <div className="bg-green-50 p-3 sm:p-4 rounded-xl shadow-sm border border-green-100">
            <p className="text-green-600 text-xs sm:text-sm">Открытые</p>
            <p className="text-xl sm:text-2xl font-bold text-green-700">{stats.open_tickets}</p>
          </div>
          <div className="bg-blue-50 p-3 sm:p-4 rounded-xl shadow-sm border border-blue-100">
            <p className="text-blue-600 text-xs sm:text-sm">В работе</p>
            <p className="text-xl sm:text-2xl font-bold text-blue-700">{stats.in_progress_tickets}</p>
          </div>
          <div className="bg-gray-50 p-3 sm:p-4 rounded-xl shadow-sm border border-gray-100">
            <p className="text-gray-600 text-xs sm:text-sm">Закрытые</p>
            <p className="text-xl sm:text-2xl font-bold text-gray-700">{stats.closed_tickets}</p>
          </div>
          <div className="bg-red-50 p-3 sm:p-4 rounded-xl shadow-sm border border-red-100">
            <p className="text-red-600 text-xs sm:text-sm">Высокий приор.</p>
            <p className="text-xl sm:text-2xl font-bold text-red-700">{stats.high_priority}</p>
          </div>
        </div>
      )}

      {/* Filter */}
      <div className="mb-4">
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="w-full px-4 py-3 border border-gray-300 rounded-xl bg-white text-base focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-h-[44px] shadow-sm"
        >
          <option value="">Все статусы</option>
          <option value="OPEN">Открытые</option>
          <option value="IN_PROGRESS">В работе</option>
          <option value="CLOSED">Закрытые</option>
        </select>
      </div>

      {/* Main Content: List or Chat */}
      {!selectedTicket ? (
        <div className="space-y-3 flex-1">
          {tickets.length === 0 ? (
            <div className="text-center py-12 text-gray-500 bg-white rounded-xl shadow-sm border border-gray-100">
              Тикеты не найдены
            </div>
          ) : (
            tickets.map(ticket => (
              <div key={ticket.id} className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 active:scale-[0.99] transition-transform">
                <div className="flex justify-between items-start mb-2">
                  <div className="min-w-0 flex-1 mr-2">
                    <p className="font-semibold text-gray-900 truncate">{ticket.user_name}</p>
                    <p className="text-xs text-gray-500 truncate">{ticket.user_email}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium text-white ${
                      ticket.status === 'OPEN' ? 'bg-green-500' :
                      ticket.status === 'IN_PROGRESS' ? 'bg-blue-500' : 'bg-gray-500'
                    }`}>
                      {ticket.status === 'OPEN' ? 'Открыт' : ticket.status === 'IN_PROGRESS' ? 'В работе' : 'Закрыт'}
                    </span>
                    {ticket.priority === 'HIGH' && (
                      <span className="text-xs text-red-600 font-bold">🔥 Высокий</span>
                    )}
                  </div>
                </div>
                
                <p className="text-sm text-gray-700 mb-3 line-clamp-2">{ticket.subject}</p>
                
                <div className="flex items-center justify-between mt-2 pt-3 border-t border-gray-100">
                  <div className="flex items-center gap-3">
                    {ticket.unread_count > 0 && (
                      <span className="bg-red-500 text-white text-xs font-bold rounded-full min-w-[24px] h-6 px-1.5 flex items-center justify-center">
                        {ticket.unread_count}
                      </span>
                    )}
                    <span className="text-xs text-gray-400">
                      {new Date(ticket.created_at).toLocaleDateString('ru-RU')}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => assignTicket(ticket.id)}
                      className="px-3 py-2 text-sm text-green-700 bg-green-50 rounded-lg hover:bg-green-100 active:bg-green-200 min-h-[40px] font-medium"
                    >
                      Назначить
                    </button>
                    <button
                      onClick={() => openTicket(ticket)}
                      className="px-4 py-2 text-sm text-white bg-blue-500 rounded-lg hover:bg-blue-600 active:bg-blue-700 min-h-[40px] font-medium shadow-sm"
                    >
                      Открыть
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="flex flex-col bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden h-[calc(100dvh-14rem)] sm:h-[650px] max-h-[80vh]">
          <div className="p-3 sm:p-4 border-b flex justify-between items-center bg-gray-50">
            <div className="min-w-0 flex-1 mr-2">
              <h2 className="font-bold text-gray-900 truncate">{selectedTicket.subject}</h2>
              <p className="text-xs text-gray-500 truncate">{selectedTicket.user_name} • {selectedTicket.user_email}</p>
            </div>
            <button 
              onClick={() => setSelectedTicket(null)} 
              className="p-2 text-gray-500 hover:text-gray-700 rounded-full hover:bg-gray-200 active:bg-gray-300 min-h-[44px] min-w-[44px] flex items-center justify-center shrink-0"
            >
              {ICONS.Close}
            </button>
          </div>

          <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3 bg-gray-50">
            {messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.is_from_user ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] sm:max-w-[70%] p-3 rounded-2xl shadow-sm ${
                  msg.is_from_user ? 'bg-gray-200 text-gray-800' : 'bg-blue-500 text-white'
                }`}>
                  <p className="text-sm sm:text-base break-words leading-relaxed">{msg.message}</p>
                  <p className="text-[10px] sm:text-xs mt-1.5 opacity-70 text-right">
                    {new Date(msg.created_at).toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            ))}
            {messages.length === 0 && (
              <div className="text-center text-gray-400 text-sm py-4">Нет сообщений</div>
            )}
          </div>

          <div className="p-3 sm:p-4 border-t bg-white">
            <div className="flex gap-2">
              <input
                type="text"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !isLoading && sendMessage()}
                placeholder="Ответ пользователю..."
                className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-base focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-h-[44px] bg-gray-50 focus:bg-white transition-colors"
              />
              <button
                onClick={sendMessage}
                disabled={isLoading || !newMessage.trim()}
                className="bg-blue-500 text-white px-4 py-2.5 rounded-xl hover:bg-blue-600 active:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed min-w-[44px] min-h-[44px] font-medium shadow-sm flex items-center justify-center"
              >
                {isLoading ? '⏳' : '➤'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Broadcast Form Modal */}
      {showBroadcastForm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-white p-5 sm:p-6 rounded-2xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto shadow-2xl animate-slide-up sm:animate-none">
            <h3 className="text-lg font-bold mb-4 text-gray-900">Массовая рассылка</h3>

            <input
              type="text"
              value={broadcastData.title}
              onChange={(e) => setBroadcastData({...broadcastData, title: e.target.value})}
              placeholder="Заголовок"
              className="w-full px-4 py-3 border border-gray-300 rounded-xl mb-3 text-base focus:ring-2 focus:ring-purple-500 focus:border-purple-500 min-h-[44px]"
            />

            <select
              value={broadcastData.targetRole}
              onChange={(e) => setBroadcastData({...broadcastData, targetRole: e.target.value})}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl mb-3 text-base focus:ring-2 focus:ring-purple-500 focus:border-purple-500 min-h-[44px] bg-white"
            >
              <option value="">Все пользователи</option>
              <option value="manager">Менеджеры</option>
              <option value="employee">Сотрудники</option>
              <option value="investor">Инвесторы</option>
            </select>

            <textarea
              value={broadcastData.message}
              onChange={(e) => setBroadcastData({...broadcastData, message: e.target.value})}
              placeholder="Сообщение..."
              rows={4}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl mb-4 text-base focus:ring-2 focus:ring-purple-500 focus:border-purple-500 resize-none"
            />

            <div className="flex gap-3">
              <button
                onClick={() => setShowBroadcastForm(false)}
                className="flex-1 px-4 py-3 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 active:bg-gray-100 font-medium min-h-[44px]"
              >
                Отмена
              </button>
              <button
                onClick={sendBroadcast}
                disabled={isLoading}
                className="flex-1 px-4 py-3 bg-purple-500 text-white rounded-xl hover:bg-purple-600 active:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium min-h-[44px] shadow-sm"
              >
                {isLoading ? 'Отправка...' : 'Отправить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminSupportPanel;