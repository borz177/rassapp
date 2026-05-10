// components/AdminPanel.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { User, SubscriptionPlan } from '../types';
import { ICONS } from '../constants';
import { api } from '../services/api';

// 🔹 Конфигурация лимитов тарифов
const PLAN_LIMITS: Record<SubscriptionPlan, { 
  contracts: number; 
  investors: number; 
  employees: number;
  whatsapp: boolean;
  ai: boolean;
}> = {
  TRIAL: { contracts: 10, investors: 0, employees: 0, whatsapp: false, ai: true },
  START: { contracts: 100, investors: 1, employees: 0, whatsapp: false, ai: false },
  STANDARD: { contracts: 500, investors: 5, employees: 2, whatsapp: true, ai: false },
  BUSINESS: { contracts: -1, investors: -1, employees: -1, whatsapp: true, ai: true }, // -1 = безлимит
};

const AdminPanel: React.FC = () => {
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [activeTab, setActiveTab] = useState<'users' | 'stats' | 'logs'>('users');

    // Modal State
    const [selectedUser, setSelectedUser] = useState<User | null>(null);
    const [plan, setPlan] = useState<SubscriptionPlan>('STANDARD');
    const [months, setMonths] = useState(1);
    const [actionLoading, setActionLoading] = useState(false);
    const [inputValue, setInputValue] = useState('');
    const [isCustom, setIsCustom] = useState(false);
    const [validationError, setValidationError] = useState<string | null>(null);

    // API Key Modal
    const [apiModalUser, setApiModalUser] = useState<User | null>(null);
    const [generatedKey, setGeneratedKey] = useState<string | null>(null);

    // Статистика
    const [systemStats, setSystemStats] = useState<{
        totalUsers: number;
        activeSubscriptions: number;
        totalContracts: number;
    }>({ totalUsers: 0, activeSubscriptions: 0, totalContracts: 0 });

    useEffect(() => {
        loadUsers();
        loadSystemStats();
    }, []);

    const loadSystemStats = async () => {
        try {
            const stats = await api.adminGetStats();
            setSystemStats(stats);
        } catch (e) {
            console.error('Failed to load stats', e);
        }
    };

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

    // 🔹 Валидация при смене тарифа
    const validatePlanChange = (user: User, newPlan: SubscriptionPlan): string | null => {
        const limits = PLAN_LIMITS[newPlan];
        const userContracts = user.salesCount || 0;
        const userInvestors = 0; // Нужно загружать отдельно

        if (limits.contracts !== -1 && userContracts > limits.contracts) {
            return `⚠️ У пользователя ${userContracts} договоров, а лимит тарифа "${newPlan}" — ${limits.contracts}. Сначала нужно удалить лишние договоры.`;
        }
        return null;
    };

    const handleOpenModal = (user: User) => {
        setSelectedUser(user);
        setPlan(user.subscription?.plan || 'START');
        setMonths(1);
        setInputValue('');
        setIsCustom(false);
        setValidationError(null);
    };

    const handlePlanChange = (newPlan: SubscriptionPlan) => {
        if (selectedUser) {
            const error = validatePlanChange(selectedUser, newPlan);
            if (error) {
                setValidationError(error);
            } else {
                setValidationError(null);
            }
        }
        setPlan(newPlan);
    };

    const handleUpdateSubscription = async () => {
        if (!selectedUser) return;
        
        // Финальная валидация
        if (validationError) {
            if (!window.confirm(`${validationError}\n\nПродолжить принудительно?`)) {
                return;
            }
        }

        setActionLoading(true);
        try {
            await api.adminSetSubscription(selectedUser.id, plan, months);
            alert("✅ Тариф обновлен!");
            setSelectedUser(null);
            loadUsers();
            loadSystemStats();
        } catch (e: any) {
            alert(`❌ Ошибка: ${e.message || 'Не удалось обновить тариф'}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleGenerateApiKey = async () => {
        if (!apiModalUser) return;
        if (!window.confirm("Сгенерировать новый API ключ? Старый перестанет работать.")) return;

        setActionLoading(true);
        try {
            const newKey = await api.adminGenerateUserApiKey(apiModalUser.id);
            setGeneratedKey(newKey);
            setUsers(prev => prev.map(u => 
                u.id === apiModalUser.id ? { ...u, apiKey: newKey } : u
            ));
            alert("✅ Ключ сгенерирован!");
        } catch (e) {
            alert("❌ Ошибка генерации ключа");
        } finally {
            setActionLoading(false);
        }
    };

    const handleBlockUser = async (user: User, block: boolean) => {
        if (!window.confirm(`${block ? 'Заблокировать' : 'Разблокировать'} пользователя ${user.name}?`)) return;
        try {
            await api.adminSetUserStatus(user.id, { blocked: block });
            loadUsers();
            alert(`✅ Пользователь ${block ? 'заблокирован' : 'разблокирован'}`);
        } catch (e) {
            alert('❌ Ошибка');
        }
    };

    const handleResetUserPassword = async (user: User) => {
        const newPassword = prompt('Введите новый пароль:') || '';
        if (!newPassword) return;
        if (!window.confirm(`Сбросить пароль для ${user.name}?`)) return;
        
        try {
            await api.adminResetUserPassword(user.id, newPassword);
            alert(`✅ Пароль изменён. Новый: ${newPassword}`);
        } catch (e) {
            alert('❌ Ошибка сброса пароля');
        }
    };

    const filteredUsers = useMemo(() => {
        return users.filter(u =>
            u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            u.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
            u.id.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [users, searchTerm]);

    const getPlanBadge = (plan: SubscriptionPlan) => {
        const styles: Record<SubscriptionPlan, string> = {
            TRIAL: 'bg-gray-100 text-gray-700',
            START: 'bg-emerald-100 text-emerald-700',
            STANDARD: 'bg-indigo-100 text-indigo-700',
            BUSINESS: 'bg-purple-100 text-purple-700',
        };
        const labels: Record<SubscriptionPlan, string> = {
            TRIAL: '🧪 Тест',
            START: '🚀 Старт',
            STANDARD: '⭐ Стандарт',
            BUSINESS: '💼 Бизнес',
        };
        return <span className={`px-2 py-1 rounded text-xs font-bold ${styles[plan]}`}>{labels[plan]}</span>;
    };

    const getStatusColor = (user: User) => {
        if (!user.subscription) return 'bg-slate-100 text-slate-500';
        const isExpired = new Date(user.subscription.expiresAt) < new Date();
        if (isExpired) return 'bg-red-100 text-red-600';
        const styles: Record<SubscriptionPlan, string> = {
            TRIAL: 'bg-gray-100 text-gray-600',
            START: 'bg-emerald-100 text-emerald-700',
            STANDARD: 'bg-indigo-100 text-indigo-700',
            BUSINESS: 'bg-purple-100 text-purple-700',
        };
        return styles[user.subscription.plan] || 'bg-slate-100 text-slate-500';
    };

    // 🔹 Прогресс использования лимита договоров
    const getContractUsage = (user: User) => {
        const plan = user.subscription?.plan || 'TRIAL';
        const limit = PLAN_LIMITS[plan].contracts;
        const used = user.salesCount || 0;
        if (limit === -1) return { percent: 0, unlimited: true };
        return { percent: Math.min(100, (used / limit) * 100), unlimited: false, used, limit };
    };

    return (
        <div className="space-y-6 animate-fade-in pb-20">
            {/* Header */}
            <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800">🛡️ Панель Администратора</h2>
                    <p className="text-slate-500 text-sm">Управление пользователями и тарифами</p>
                </div>
                <div className="flex gap-2">
                    <button onClick={loadUsers} className="p-2 bg-slate-100 rounded-lg hover:bg-slate-200 transition" title="Обновить">
                        {ICONS.Refresh}
                    </button>
                    <button onClick={loadSystemStats} className="p-2 bg-indigo-100 text-indigo-600 rounded-lg hover:bg-indigo-200 transition" title="Статистика">
                        {ICONS.Dashboard}
                    </button>
                </div>
            </header>

            {/* System Stats Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                    <div className="text-sm text-slate-500">Всего пользователей</div>
                    <div className="text-2xl font-bold text-slate-800">{systemStats.totalUsers}</div>
                </div>
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                    <div className="text-sm text-slate-500">Активные подписки</div>
                    <div className="text-2xl font-bold text-emerald-600">{systemStats.activeSubscriptions}</div>
                </div>
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                    <div className="text-sm text-slate-500">Всего договоров</div>
                    <div className="text-2xl font-bold text-indigo-600">{systemStats.totalContracts}</div>
                </div>
            </div>

            {/* Search */}
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
                <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">{ICONS.Search}</span>
                    <input
                        type="text"
                        placeholder="Поиск по имени, email или ID..."
                        className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-lg outline-none focus:border-indigo-500 transition"
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                    />
                </div>
            </div>

            {/* Users Grid */}
            {loading ? (
                <div className="text-center py-10">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto mb-3"></div>
                    <span className="text-slate-500">Загрузка пользователей...</span>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {filteredUsers.map(user => {
                        const usage = getContractUsage(user);
                        const isExpired = user.subscription && new Date(user.subscription.expiresAt) < new Date();
                        
                        return (
                            <div key={user.id} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition relative overflow-hidden group">
                                {/* Role Badge */}
                                <div className="absolute top-0 right-0 px-3 py-1 bg-slate-100 rounded-bl-lg text-xs font-bold uppercase text-slate-500">
                                    {user.role === 'admin' && '👑'}
                                    {user.role === 'manager' && '💼'}
                                    {user.role === 'investor' && '📊'}
                                    {user.role === 'employee' && '👤'}
                                    {' '}{user.role}
                                </div>

                                <div className="flex items-start gap-4">
                                    <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg text-white flex-shrink-0 ${
                                        user.role === 'admin' ? 'bg-gradient-to-br from-red-500 to-pink-500' : 
                                        user.role === 'manager' ? 'bg-gradient-to-br from-indigo-500 to-blue-500' :
                                        'bg-gradient-to-br from-slate-500 to-slate-700'
                                    }`}>
                                        {user.name.charAt(0).toUpperCase()}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h3 className="font-bold text-slate-800 text-lg truncate">{user.name}</h3>
                                        <p className="text-xs text-slate-500 truncate">{user.email}</p>
                                        {user.phone && <p className="text-xs text-slate-400">{user.phone}</p>}
                                    </div>
                                </div>

                                {/* Subscription Info */}
                                <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs text-slate-500">Тариф</span>
                                        {user.subscription ? (
                                            <div className="flex items-center gap-2">
                                                {getPlanBadge(user.subscription.plan)}
                                                {isExpired && <span className="text-xs text-red-500 font-medium">⚠️ истёк</span>}
                                            </div>
                                        ) : (
                                            <span className="text-xs text-slate-400">Нет</span>
                                        )}
                                    </div>

                                    {user.subscription && (
                                        <div className="text-xs text-slate-500">
                                            <span>Действует до: </span>
                                            <span className={isExpired ? 'text-red-600 font-medium' : 'text-slate-700'}>
                                                {new Date(user.subscription.expiresAt).toLocaleDateString('ru-RU')}
                                            </span>
                                        </div>
                                    )}

                                    {/* Contract Usage Progress */}
                                    {!usage.unlimited && (
                                        <div>
                                            <div className="flex justify-between text-xs mb-1">
                                                <span className="text-slate-500">Договоры</span>
                                                <span className={`font-medium ${usage.percent >= 90 ? 'text-red-600' : usage.percent >= 70 ? 'text-amber-600' : 'text-slate-700'}`}>
                                                    {usage.used} / {usage.limit}
                                                </span>
                                            </div>
                                            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                                <div 
                                                    className={`h-full rounded-full transition-all ${
                                                        usage.percent >= 90 ? 'bg-red-500' : 
                                                        usage.percent >= 70 ? 'bg-amber-500' : 'bg-indigo-500'
                                                    }`}
                                                    style={{ width: `${usage.percent}%` }}
                                                />
                                            </div>
                                        </div>
                                    )}
                                    {usage.unlimited && (
                                        <div className="text-xs text-emerald-600 font-medium">♾️ Безлимитные договоры</div>
                                    )}
                                </div>

                                {/* Actions */}
                                <div className="flex gap-2 mt-4 pt-4 border-t border-slate-100">
                                    <button
                                        onClick={() => handleOpenModal(user)}
                                        className="flex-1 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition flex items-center justify-center gap-1.5"
                                    >
                                        {ICONS.Crown} Тариф
                                    </button>
                                    <button
                                        onClick={() => setApiModalUser(user)}
                                        className="flex-1 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-200 transition flex items-center justify-center gap-1.5"
                                    >
                                        {ICONS.Key} API
                                    </button>
                                    <button
                                        onClick={() => handleResetUserPassword(user)}
                                        className="p-2 bg-amber-100 text-amber-700 rounded-lg hover:bg-amber-200 transition"
                                        title="Сброс пароля"
                                    >
                                        {ICONS.Settings}
                                    </button>
                                </div>

                                {/* Block/Unblock */}
                                <button
                                    onClick={() => handleBlockUser(user, !user.blocked)}
                                    className={`mt-2 w-full py-1.5 text-xs font-medium rounded-lg border transition ${
                                        user.blocked 
                                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100' 
                                            : 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'
                                    }`}
                                >
                                    {user.blocked ? '🔓 Разблокировать' : '🔒 Заблокировать'}
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Empty State */}
            {!loading && filteredUsers.length === 0 && (
                <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
                    <div className="text-4xl mb-3">🔍</div>
                    <p className="text-slate-500">Пользователи не найдены</p>
                    <button onClick={() => setSearchTerm('')} className="mt-2 text-indigo-600 hover:underline text-sm">
                        Сбросить поиск
                    </button>
                </div>
            )}

            {/* 🔹 Modal: Управление тарифом */}
            {selectedUser && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in" onClick={() => setSelectedUser(null)}>
                    <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                        <div className="flex items-start justify-between mb-4">
                            <div>
                                <h3 className="text-xl font-bold text-slate-800">📋 Управление тарифом</h3>
                                <p className="text-sm text-slate-500">{selectedUser.name} • {selectedUser.email}</p>
                            </div>
                            <button onClick={() => setSelectedUser(null)} className="p-2 hover:bg-slate-100 rounded-lg">{ICONS.Close}</button>
                        </div>

                        {/* Validation Error */}
                        {validationError && (
                            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-sm flex gap-2">
                                <span>⚠️</span>
                                <span>{validationError}</span>
                            </div>
                        )}

                        <div className="space-y-5">
                            {/* Plan Selection */}
                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-3">Тарифный план</label>
                                <div className="grid grid-cols-2 gap-2">
                                    {(['TRIAL', 'START', 'STANDARD', 'BUSINESS'] as SubscriptionPlan[]).map((p) => {
                                        const limits = PLAN_LIMITS[p];
                                        return (
                                            <button
                                                key={p}
                                                onClick={() => handlePlanChange(p)}
                                                className={`p-3 text-left rounded-xl border-2 transition-all ${
                                                    plan === p 
                                                        ? 'border-indigo-600 bg-indigo-50 ring-2 ring-indigo-200' 
                                                        : 'border-slate-200 hover:border-slate-300'
                                                }`}
                                            >
                                                <div className="font-bold text-slate-800">{p === 'TRIAL' ? '🧪 TRIAL' : p === 'START' ? '🚀 START' : p === 'STANDARD' ? '⭐ STANDARD' : '💼 BUSINESS'}</div>
                                                <div className="text-xs text-slate-500 mt-1">
                                                    Договоры: {limits.contracts === -1 ? '∞' : limits.contracts}<br/>
                                                    Инвесторы: {limits.investors === -1 ? '∞' : limits.investors}
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Period Selection */}
                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-3">Срок действия</label>
                                <div className="flex flex-wrap gap-2 mb-3">
                                    {[1, 3, 6, 12].map(m => (
                                        <button key={m} onClick={() => { setMonths(m); setInputValue(''); setIsCustom(false); }}
                                            className={`px-4 py-2 text-sm font-medium rounded-lg border transition ${
                                                months === m && !isCustom ? 'bg-slate-800 text-white border-slate-800' : 'bg-white border-slate-200 hover:border-slate-400'
                                            }`}>
                                            {m} мес.
                                        </button>
                                    ))}
                                    <button onClick={() => { setMonths(999); setInputValue(''); setIsCustom(false); }}
                                        className={`px-4 py-2 text-sm font-medium rounded-lg border transition ${
                                            months === 999 && !isCustom ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-emerald-600 border-emerald-200 hover:border-emerald-400'
                                        }`} title="Бессрочно">∞</button>
                                </div>
                                <div className="flex items-center gap-2">
                                    <input type="number" min="1" max="120" value={isCustom ? inputValue : ''}
                                        onChange={(e) => { setInputValue(e.target.value); setIsCustom(true); const v = parseInt(e.target.value); if (v > 0) setMonths(Math.min(v, 120)); }}
                                        placeholder="Свой срок" disabled={months === 999}
                                        className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-indigo-500 disabled:bg-slate-50"/>
                                    <span className="text-sm text-slate-500">{months === 999 ? '∞' : 'мес.'}</span>
                                </div>
                            </div>

                            {/* Expiration Preview */}
                            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                                <div className="flex items-center gap-2 text-sm">
                                    <span className="text-slate-500">📅 Будет действовать до:</span>
                                    <span className="font-bold text-slate-800">
                                        {months === 999 ? 'Не ограничено' : new Date(Date.now() + months * 30 * 24 * 60 * 60 * 1000).toLocaleDateString('ru-RU')}
                                    </span>
                                </div>
                            </div>

                            {/* Action Button */}
                            <button onClick={handleUpdateSubscription} disabled={actionLoading}
                                className="w-full py-3 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 disabled:opacity-50 transition flex items-center justify-center gap-2">
                                {actionLoading ? <><span className="animate-spin">⏳</span> Сохранение...</> : '✅ Применить изменения'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 🔹 Modal: API Key */}
            {apiModalUser && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in" onClick={() => setApiModalUser(null)}>
                    <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl p-6" onClick={e => e.stopPropagation()}>
                        <div className="flex items-start justify-between mb-4">
                            <div>
                                <h3 className="text-xl font-bold text-slate-800">🔑 API Доступ</h3>
                                <p className="text-sm text-slate-500">{apiModalUser.name}</p>
                            </div>
                            <button onClick={() => setApiModalUser(null)} className="p-2 hover:bg-slate-100 rounded-lg">{ICONS.Close}</button>
                        </div>

                        <div className="space-y-4">
                            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">API Ключ</label>
                                {generatedKey || apiModalUser.apiKey ? (
                                    <div className="flex items-center gap-2">
                                        <code className="flex-1 bg-white p-2 rounded border border-slate-200 text-xs font-mono break-all">
                                            {generatedKey || apiModalUser.apiKey}
                                        </code>
                                        <button onClick={() => { navigator.clipboard.writeText(generatedKey || apiModalUser.apiKey!); alert("📋 Скопировано!"); }} 
                                            className="p-2 text-indigo-600 hover:bg-indigo-50 rounded">{ICONS.Copy}</button>
                                    </div>
                                ) : (
                                    <p className="text-sm text-slate-400 italic">Ключ не сгенерирован</p>
                                )}
                            </div>

                            <div className="text-xs text-slate-500 space-y-1 bg-amber-50 p-3 rounded-lg border border-amber-200">
                                <p>🔑 Ключ даёт полный доступ к данным пользователя</p>
                                <p>⚠️ При перегенерации старый ключ перестанет работать</p>
                            </div>

                            <button onClick={handleGenerateApiKey} disabled={actionLoading}
                                className="w-full py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition">
                                {actionLoading ? 'Генерация...' : (generatedKey || apiModalUser.apiKey ? '🔄 Перегенерировать' : '✨ Сгенерировать ключ')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminPanel;