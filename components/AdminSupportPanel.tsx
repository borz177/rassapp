import React, { useState, useEffect } from 'react';
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
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <button onClick={onBack} className="flex items-center gap-2 text-gray-600 hover:text-gray-800">
          {ICONS.ArrowLeft}
          Назад
        </button>
        <h1 className="text-2xl font-bold">Панель поддержки</h1>
        <button
          onClick={() => setShowBroadcastForm(true)}
          className="bg-purple-500 text-white px-4 py-2 rounded-lg hover:bg-purple-600 flex items-center gap-2"
        >
          {ICONS.Broadcast}
          Рассылка
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <div className="bg-white p-4 rounded-xl shadow">
            <p className="text-gray-500 text-sm">Всего тикетов</p>
            <p className="text-2xl font-bold">{stats.total_tickets}</p>
          </div>
          <div className="bg-green-50 p-4 rounded-xl shadow">
            <p className="text-green-600 text-sm">Открытые</p>
            <p className="text-2xl font-bold text-green-700">{stats.open_tickets}</p>
          </div>
          <div className="bg-blue-50 p-4 rounded-xl shadow">
            <p className="text-blue-600 text-sm">В работе</p>
            <p className="text-2xl font-bold text-blue-700">{stats.in_progress_tickets}</p>
          </div>
          <div className="bg-gray-50 p-4 rounded-xl shadow">
            <p className="text-gray-600 text-sm">Закрытые</p>
            <p className="text-2xl font-bold text-gray-700">{stats.closed_tickets}</p>
          </div>
          <div className="bg-red-50 p-4 rounded-xl shadow">
            <p className="text-red-600 text-sm">Высокий приоритет</p>
            <p className="text-2xl font-bold text-red-700">{stats.high_priority}</p>
          </div>
        </div>
      )}

      {/* Filter */}
      <div className="mb-4">
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="px-4 py-2 border rounded-lg"
        >
          <option value="">Все статусы</option>
          <option value="OPEN">Открытые</option>
          <option value="IN_PROGRESS">В работе</option>
          <option value="CLOSED">Закрытые</option>
        </select>
      </div>

      {/* Tickets List or Chat */}
      {!selectedTicket ? (
        <div className="bg-white rounded-xl shadow overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="p-4 text-left">Пользователь</th>
                <th className="p-4 text-left">Тема</th>
                <th className="p-4 text-left">Статус</th>
                <th className="p-4 text-left">Приоритет</th>
                <th className="p-4 text-left">Непрочитанные</th>
                <th className="p-4 text-left">Действия</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map(ticket => (
                <tr key={ticket.id} className="border-t hover:bg-gray-50">
                  <td className="p-4">
                    <p className="font-semibold">{ticket.user_name}</p>
                    <p className="text-sm text-gray-500">{ticket.user_email}</p>
                  </td>
                  <td className="p-4">{ticket.subject}</td>
                  <td className="p-4">
                    <span className={`px-2 py-1 rounded text-xs text-white ${
                      ticket.status === 'OPEN' ? 'bg-green-500' :
                      ticket.status === 'IN_PROGRESS' ? 'bg-blue-500' : 'bg-gray-500'
                    }`}>
                      {ticket.status}
                    </span>
                  </td>
                  <td className="p-4">
                    <span className={ticket.priority === 'HIGH' ? 'text-red-500 font-bold' : ''}>
                      {ticket.priority}
                    </span>
                  </td>
                  <td className="p-4">
                    {ticket.unread_count > 0 && (
                      <span className="bg-red-500 text-white text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center">
                        {ticket.unread_count}
                      </span>
                    )}
                  </td>
                  <td className="p-4">
                    <button
                      onClick={() => openTicket(ticket)}
                      className="text-blue-500 hover:underline mr-2"
                    >
                      Открыть
                    </button>
                    <button
                      onClick={() => assignTicket(ticket.id)}
                      className="text-green-500 hover:underline"
                    >
                      Назначить
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow">
          <div className="p-4 border-b flex justify-between items-center">
            <div>
              <h2 className="font-bold">{selectedTicket.subject}</h2>
              <p className="text-sm text-gray-500">{selectedTicket.user_name} ({selectedTicket.user_email})</p>
            </div>
            <button onClick={() => setSelectedTicket(null)} className="text-gray-500 hover:text-gray-700">
              {ICONS.Close}
            </button>
          </div>

          <div className="h-96 overflow-y-auto p-4 space-y-4 bg-gray-50">
            {messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.is_from_user ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] p-3 rounded-2xl ${
                  msg.is_from_user ? 'bg-gray-200' : 'bg-blue-500 text-white'
                }`}>
                  <p>{msg.message}</p>
                  <p className="text-xs mt-1 opacity-70">
                    {new Date(msg.created_at).toLocaleString('ru-RU')}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="p-4 border-t flex gap-2">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
              placeholder="Ответ пользователю..."
              className="flex-1 px-4 py-2 border rounded-lg"
            />
            <button
              onClick={sendMessage}
              disabled={isLoading}
              className="bg-blue-500 text-white px-6 py-2 rounded-lg hover:bg-blue-600 disabled:opacity-50"
            >
              Отправить
            </button>
          </div>
        </div>
      )}

      {/* Broadcast Form Modal */}
      {showBroadcastForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-2xl w-[90%] max-w-md">
            <h3 className="text-lg font-bold mb-4">Массовая рассылка</h3>

            <input
              type="text"
              value={broadcastData.title}
              onChange={(e) => setBroadcastData({...broadcastData, title: e.target.value})}
              placeholder="Заголовок"
              className="w-full px-4 py-3 border rounded-xl mb-3"
            />

            <select
              value={broadcastData.targetRole}
              onChange={(e) => setBroadcastData({...broadcastData, targetRole: e.target.value})}
              className="w-full px-4 py-3 border rounded-xl mb-3"
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
              className="w-full px-4 py-3 border rounded-xl mb-4"
            />

            <div className="flex gap-2">
              <button
                onClick={() => setShowBroadcastForm(false)}
                className="flex-1 px-4 py-3 border rounded-xl"
              >
                Отмена
              </button>
              <button
                onClick={sendBroadcast}
                disabled={isLoading}
                className="flex-1 px-4 py-3 bg-purple-500 text-white rounded-xl disabled:opacity-50"
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