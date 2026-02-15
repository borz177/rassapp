
import React, { useState, useEffect } from 'react';
import { User, SubscriptionPlan } from '../types';
import { ICONS } from '../constants';
import { api } from '../services/api';

const AdminPanel: React.FC = () => {
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    // Modal State
    const [selectedUser, setSelectedUser] = useState<User | null>(null);
    const [plan, setPlan] = useState<SubscriptionPlan>('STANDARD');
    const [months, setMonths] = useState(1);
    const [actionLoading, setActionLoading] = useState(false);

    useEffect(() => {
        loadUsers();
    }, []);

    const loadUsers = async () => {
        setLoading(true);
        try {
            const data = await api.adminGetUsers();
            setUsers(data);
        } catch (e) {
            console.error(e);
            alert("Ошибка загрузки пользователей");
        } finally {
            setLoading(false);
        }
    };

    const handleOpenModal = (user: User) => {
        setSelectedUser(user);
        setPlan(user.subscription?.plan || 'START');
        setMonths(1);
    };

    const handleUpdateSubscription = async () => {
        if (!selectedUser) return;
        setActionLoading(true);
        try {
            await api.adminSetSubscription(selectedUser.id, plan, months);
            alert("Тариф обновлен!");
            setSelectedUser(null);
            loadUsers(); // Refresh list
        } catch (e) {
            alert("Ошибка обновления");
        } finally {
            setActionLoading(false);
        }
    };

    const filteredUsers = users.filter(u =>
        u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        u.email.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const getStatusColor = (user: User) => {
        if (!user.subscription) return 'bg-slate-100 text-slate-500';
        const isExpired = new Date(user.subscription.expiresAt) < new Date();
        if (isExpired) return 'bg-red-100 text-red-600';

        switch(user.subscription.plan) {
            case 'BUSINESS': return 'bg-purple-100 text-purple-700';
            case 'STANDARD': return 'bg-indigo-100 text-indigo-700';
            default: return 'bg-emerald-100 text-emerald-700';
        }
    };

    return (
        <div className="space-y-6 animate-fade-in pb-20">
            <header className="flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800">Панель Администратора</h2>
                    <p className="text-slate-500 text-sm">Управление пользователями</p>
                </div>
                <button onClick={loadUsers} className="p-2 bg-slate-100 rounded-full hover:bg-slate-200">
                    {ICONS.Refresh}
                </button>
            </header>

            {/* Search */}
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
                <input
                    type="text"
                    placeholder="Поиск по имени или email..."
                    className="w-full p-3 border border-slate-200 rounded-lg outline-none"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                />
            </div>

            {loading ? (
                <div className="text-center py-10">Загрузка...</div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {filteredUsers.map(user => (
                        <div key={user.id} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm relative overflow-hidden group">
                            {/* Role Badge */}
                            <div className="absolute top-0 right-0 px-3 py-1 bg-slate-100 rounded-bl-lg text-xs font-bold uppercase text-slate-500">
                                {user.role}
                            </div>

                            <div className="flex items-start gap-4">
                                <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg text-white ${user.role === 'admin' ? 'bg-red-500' : 'bg-slate-800'}`}>
                                    {user.name.charAt(0).toUpperCase()}
                                </div>
                                <div>
                                    <h3 className="font-bold text-slate-800 text-lg truncate w-40">{user.name}</h3>
                                    <p className="text-xs text-slate-500 truncate w-48">{user.email}</p>
                                    <p className="text-xs text-slate-400 mt-1">Рег: {new Date(user.id.includes('_') ? parseInt(user.id.split('_')[1] || '0') : 0).toLocaleDateString()}</p>
                                </div>
                            </div>

                            {/* Stats */}
                            <div className="grid grid-cols-2 gap-2 mt-4 pt-4 border-t border-slate-50">
                                <div className="bg-indigo-50 p-2 rounded-lg text-center">
                                    <span className="text-xs text-indigo-400 block uppercase font-bold">Договоры</span>
                                    <span className="text-xl font-bold text-indigo-700">{user.salesCount || 0}</span>
                                </div>
                                <div className={`p-2 rounded-lg text-center ${getStatusColor(user)}`}>
                                    <span className="text-xs opacity-70 block uppercase font-bold">Тариф</span>
                                    <span className="text-sm font-bold truncate">
                                        {user.subscription?.plan || 'NONE'}
                                    </span>
                                </div>
                            </div>

                            {user.subscription && (
                                <p className="text-[10px] text-center mt-1 text-slate-400">
                                    Истекает: {new Date(user.subscription.expiresAt).toLocaleDateString()}
                                </p>
                            )}

                            {/* Actions */}
                            <button
                                onClick={() => handleOpenModal(user)}
                                className="w-full mt-4 py-2 bg-slate-800 text-white rounded-lg text-sm font-bold hover:bg-slate-700 transition-colors flex items-center justify-center gap-2"
                            >
                                <span className="text-yellow-400">{ICONS.Crown}</span> Управление тарифом
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* Manual Subscription Modal */}
            {selectedUser && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in" onClick={() => setSelectedUser(null)}>
                    <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl p-6" onClick={e => e.stopPropagation()}>
                        <h3 className="text-xl font-bold text-slate-800 mb-1">Управление тарифом</h3>
                        <p className="text-sm text-slate-500 mb-4">Для пользователя: <span className="font-bold">{selectedUser.name}</span></p>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-1">Выберите план</label>
                                <div className="grid grid-cols-3 gap-2">
                                    {['START', 'STANDARD', 'BUSINESS'].map((p) => (
                                        <button
                                            key={p}
                                            onClick={() => setPlan(p as SubscriptionPlan)}
                                            className={`py-2 text-xs font-bold rounded-lg border-2 ${plan === p ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-500'}`}
                                        >
                                            {p}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-1">Срок действия (мес.)</label>
                                <div className="flex gap-2">
                                    {[1, 3, 6, 12, 100].map(m => (
                                        <button
                                            key={m}
                                            onClick={() => setMonths(m)}
                                            className={`flex-1 py-2 text-xs font-bold rounded-lg border ${months === m ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200'}`}
                                        >
                                            {m === 100 ? '∞' : m}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <button
                                onClick={handleUpdateSubscription}
                                disabled={actionLoading}
                                className="w-full py-3 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 disabled:opacity-50"
                            >
                                {actionLoading ? 'Сохранение...' : 'Активировать / Продлить'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminPanel;
