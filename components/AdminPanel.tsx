
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

    // API Key Modal
    const [apiModalUser, setApiModalUser] = useState<User | null>(null);
    const [generatedKey, setGeneratedKey] = useState<string | null>(null);

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

    const handleOpenApiModal = (user: User) => {
        setApiModalUser(user);
        setGeneratedKey(user.apiKey || null);
    };

    const handleGenerateApiKey = async () => {
        if (!apiModalUser) return;
        if (!window.confirm("Сгенерировать новый API ключ? Старый перестанет работать.")) return;

        setActionLoading(true);
        try {
            const newKey = await api.adminGenerateUserApiKey(apiModalUser.id);
            setGeneratedKey(newKey);
            // Update local state
            setUsers(prev => prev.map(u => u.id === apiModalUser.id ? { ...u, apiKey: newKey } : u));
            alert("Ключ сгенерирован!");
        } catch (e) {
            alert("Ошибка генерации ключа");
        } finally {
            setActionLoading(false);
        }
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
                            <div className="flex gap-2 mt-4">
                                <button
                                    onClick={() => handleOpenModal(user)}
                                    className="flex-1 py-2 bg-slate-800 text-white rounded-lg text-sm font-bold hover:bg-slate-700 transition-colors flex items-center justify-center gap-2"
                                >
                                    <span className="text-yellow-400">{ICONS.Crown}</span> Тариф
                                </button>
                                <button
                                    onClick={() => handleOpenApiModal(user)}
                                    className="flex-1 py-2 bg-slate-100 text-slate-600 rounded-lg text-sm font-bold hover:bg-slate-200 transition-colors flex items-center justify-center gap-2"
                                >
                                    {ICONS.Settings} API
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* API Key Modal */}
            {apiModalUser && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in" onClick={() => setApiModalUser(null)}>
                    <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl p-6" onClick={e => e.stopPropagation()}>
                        <h3 className="text-xl font-bold text-slate-800 mb-1">API Доступ</h3>
                        <p className="text-sm text-slate-500 mb-4">Для пользователя: <span className="font-bold">{apiModalUser.name}</span></p>

                        <div className="space-y-4">
                            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Текущий API Ключ</label>
                                {generatedKey ? (
                                    <div className="flex items-center gap-2">
                                        <code className="flex-1 bg-white p-2 rounded border border-slate-200 text-xs font-mono break-all">
                                            {generatedKey}
                                        </code>
                                        <button
                                            onClick={() => { navigator.clipboard.writeText(generatedKey); alert("Скопировано!"); }}
                                            className="p-2 text-indigo-600 hover:bg-indigo-50 rounded"
                                        >
                                            {ICONS.File}
                                        </button>
                                    </div>
                                ) : (
                                    <p className="text-sm text-slate-400 italic">Ключ не сгенерирован</p>
                                )}
                            </div>

                            <div className="text-xs text-slate-500 space-y-1">
                                <p>🔑 Ключ дает полный доступ к данным пользователя через API.</p>
                                <p>⚠️ При перегенерации старый ключ перестанет работать.</p>
                            </div>

                            <button
                                onClick={handleGenerateApiKey}
                                disabled={actionLoading}
                                className="w-full py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {actionLoading ? 'Генерация...' : (generatedKey ? 'Перегенерировать ключ' : 'Сгенерировать ключ')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Manual Subscription Modal */}
           {/* Manual Subscription Modal */}
{selectedUser && (
    <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in"
        onClick={() => setSelectedUser(null)}
    >
        <div
            className="bg-white w-full max-w-sm rounded-2xl shadow-2xl p-6"
            onClick={e => e.stopPropagation()}
        >
            <h3 className="text-xl font-bold text-slate-800 mb-1">Управление тарифом</h3>
            <p className="text-sm text-slate-500 mb-4">
                Для пользователя: <span className="font-bold">{selectedUser.name}</span>
            </p>

            <div className="space-y-4">
                {/* Plan Selection */}
                <div>
                    <label className="block text-sm font-bold text-slate-700 mb-2">Выберите план</label>
                    <div className="grid grid-cols-3 gap-2">
                        {(['START', 'STANDARD', 'BUSINESS'] as SubscriptionPlan[]).map((p) => (
                            <button
                                key={p}
                                onClick={() => setPlan(p)}
                                className={`py-2.5 text-xs font-bold rounded-xl border-2 transition-all ${
                                    plan === p 
                                        ? 'border-indigo-600 bg-indigo-50 text-indigo-700 shadow-sm' 
                                        : 'border-slate-200 text-slate-500 hover:border-slate-300'
                                }`}
                            >
                                {p === 'START' && '🚀 '}
                                {p === 'STANDARD' && '⭐ '}
                                {p === 'BUSINESS' && '💼 '}
                                {p}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Period Selection */}
                <div>
                    <label className="block text-sm font-bold text-slate-700 mb-2">
                        Срок действия
                    </label>

                    {/* Quick select buttons */}
                    <div className="flex flex-wrap gap-2 mb-3">
                        {[1, 3, 6, 12].map(m => (
                            <button
                                key={m}
                                onClick={() => setMonths(m)}
                                className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-all ${
                                    months === m 
                                        ? 'bg-slate-800 text-white border-slate-800' 
                                        : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                                }`}
                            >
                                {m} мес.
                            </button>
                        ))}
                        <button
                            onClick={() => setMonths(999)}
                            className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-all ${
                                months === 999 
                                    ? 'bg-emerald-600 text-white border-emerald-600' 
                                    : 'bg-white text-emerald-600 border-emerald-200 hover:border-emerald-400'
                            }`}
                            title="Бессрочно"
                        >
                            ∞
                        </button>
                    </div>

                    {/* Custom input */}
                    <div className="flex items-center gap-2">
                        <input
                            type="number"
                            min="1"
                            max="120"
                            value={months === 999 ? '' : months}
                            onChange={(e) => {
                                const val = parseInt(e.target.value) || 1;
                                setMonths(Math.min(Math.max(val, 1), 120));
                            }}
                            placeholder="Другой срок"
                            disabled={months === 999}
                            className="..."
                        />
                        <span className="text-sm text-slate-500 whitespace-nowrap">
                            {months === 999 ? 'бессрочно' : 'мес.'}
                        </span>
                    </div>
                </div>

                {/* Expiration Preview */}
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                    <div className="flex items-center gap-2 text-sm">
                        <span className="text-slate-500">📅 Истекает:</span>
                        <span className="font-bold text-slate-800">
                            {months === 999
                                ? 'Не ограничено'
                                : new Date(Date.now() + months * 30 * 24 * 60 * 60 * 1000).toLocaleDateString('ru-RU', {
                                    day: 'numeric',
                                    month: 'long',
                                    year: 'numeric'
                                })
                            }
                        </span>
                    </div>
                </div>

                {/* Action Button */}
                <button
                    onClick={handleUpdateSubscription}
                    disabled={actionLoading}
                    className="w-full py-3 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                >
                    {actionLoading ? (
                        <>
                            <span className="animate-spin">⏳</span>
                            Сохранение...
                        </>
                    ) : (
                        <>
                            {ICONS.Check}
                            Активировать / Продлить
                        </>
                    )}
                </button>
            </div>
        </div>
    </div>
)}
        </div>
    );
};

export default AdminPanel;
