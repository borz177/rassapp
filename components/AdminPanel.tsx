// components/AdminPanel.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { User, SubscriptionPlan } from '../types';
import { addMonthsClamped } from '../src/utils';
import { ICONS } from '../constants';
import { api } from '../services/api';

// 🔹 Конфигурация лимитов тарифов
const PLAN_LIMITS: Record<SubscriptionPlan, {
  contracts: number;
  investors: number;
  employees: number;
  whatsapp: boolean;
  ai: boolean;
  suppliers: boolean;
}> = {
  TRIAL: { contracts: 10, investors: 0, employees: 0, whatsapp: false, ai: true, suppliers: false },
  START: { contracts: 100, investors: 1, employees: 0, whatsapp: false, ai: false, suppliers: false },
  STANDARD: { contracts: 500, investors: 5, employees: 0, whatsapp: true, ai: false, suppliers: false },
  BUSINESS: { contracts: -1, investors: -1, employees: -1, whatsapp: true, ai: true, suppliers: false }, // -1 = безлимит
  BUSINESS_PRO: { contracts: -1, investors: -1, employees: -1, whatsapp: true, ai: true, suppliers: true },
};

type SubscriptionFilter = 'all' | 'active' | 'expired' | 'none';
type DurationUnit = 'days' | 'months';

// 🔹 Иконки и подписи для событий журнала (вкладка "Логи")
const AUDIT_ACTION_ICONS: Record<string, React.ReactNode> = {
    SET_SUBSCRIPTION: ICONS.Crown,
    GENERATE_API_KEY: ICONS.Key,
    BLOCK_USER: ICONS.ShieldAlert,
    UNBLOCK_USER: ICONS.CheckCircle,
    RESET_PASSWORD: ICONS.Settings,
};

const formatAuditAction = (entry: { action: string; details: any }): string => {
    const { action, details } = entry;
    switch (action) {
        case 'SET_SUBSCRIPTION': {
            if (!details) return 'изменил тариф';
            const period = details.unit === 'unlimited' ? 'бессрочно' : `${details.amount} ${details.unit === 'days' ? 'дн.' : 'мес.'}`;
            return `установил тариф ${details.plan} на ${period}`;
        }
        case 'GENERATE_API_KEY': return 'перегенерировал API-ключ';
        case 'BLOCK_USER': return 'заблокировал пользователя';
        case 'UNBLOCK_USER': return 'разблокировал пользователя';
        case 'RESET_PASSWORD': return 'сбросил пароль';
        default: return action;
    }
};

interface AuditLogEntry {
    id: string;
    action: string;
    details: any;
    createdAt: string;
    adminName: string;
    adminEmail?: string;
    targetName?: string;
    targetEmail?: string;
}

const AdminPanel: React.FC = () => {
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [subscriptionFilter, setSubscriptionFilter] = useState<SubscriptionFilter>('all'); // 🔹 Новый фильтр
    const [activeTab, setActiveTab] = useState<'users' | 'stats' | 'referrals' | 'logs'>('users');
    // 🎁 Реферальная программа
    const [referrals, setReferrals] = useState<any>(null);
    const [referralsLoading, setReferralsLoading] = useState(false);

    // Modal State
    const [selectedUser, setSelectedUser] = useState<User | null>(null);
    const [plan, setPlan] = useState<SubscriptionPlan>('STANDARD');
    const [durationUnit, setDurationUnit] = useState<DurationUnit>('months');
    const [durationAmount, setDurationAmount] = useState(1);
    const [isUnlimited, setIsUnlimited] = useState(false);
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
        planBreakdown: Record<string, number>;
        expiringSoon: number;
        newUsersLast7Days: number;
    }>({ totalUsers: 0, activeSubscriptions: 0, totalContracts: 0, planBreakdown: {}, expiringSoon: 0, newUsersLast7Days: 0 });

    // Журнал действий
    const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
    const [auditLoading, setAuditLoading] = useState(false);
    const [auditLoaded, setAuditLoaded] = useState(false);

    useEffect(() => {
        loadUsers();
        loadSystemStats();
    }, []);

    useEffect(() => {
        if (activeTab === 'logs' && !auditLoaded) {
            loadAuditLog();
        }
        // Данные тяжёлые (до 300 пар), грузим только при открытии вкладки
        if (activeTab === 'referrals' && !referrals && !referralsLoading) {
            setReferralsLoading(true);
            api.adminGetReferrals()
               .then(setReferrals)
               .catch(e => console.error('Referrals load error:', e))
               .finally(() => setReferralsLoading(false));
        }
    }, [activeTab, auditLoaded, referrals, referralsLoading]);

    const loadAuditLog = async () => {
        setAuditLoading(true);
        try {
            const data = await api.adminGetAuditLog(150);
            setAuditLog(data);
            setAuditLoaded(true);
        } catch (err) {
            console.error('Failed to load audit log:', err);
        } finally {
            setAuditLoading(false);
        }
    };

  const loadSystemStats = async () => {
    try {
        const stats = await api.adminGetStats();
        setSystemStats(stats);
    } catch (err) {
        console.error('Failed to load stats:', err);
        // Устанавливаем дефолтные значения
        setSystemStats({ totalUsers: 0, activeSubscriptions: 0, totalContracts: 0, planBreakdown: {}, expiringSoon: 0, newUsersLast7Days: 0 });
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
        setDurationUnit('months');
        setDurationAmount(1);
        setIsUnlimited(false);
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
            await api.adminSetSubscription(selectedUser.id, plan, { unit: durationUnit, amount: durationAmount, unlimited: isUnlimited });
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

    // Для handleBlockUser (примерно строка 153):
const handleBlockUser = async (user: User, block: boolean) => {
    if (!window.confirm(`${block ? 'Заблокировать' : 'Разблокировать'} пользователя ${user.name}?`)) return;
    try {
        await api.adminSetUserStatus(user.id, { blocked: block });
        loadUsers(); // Обновить список
        alert(`✅ Пользователь ${block ? 'заблокирован' : 'разблокирован'}`);
    } catch (err) {
        console.error('Block user error:', err);
        alert('❌ Ошибка при обновлении статуса');
    }
};

// Для handleResetUserPassword (примерно строка 167):
const handleResetUserPassword = async (user: User) => {
    const newPassword = prompt('Введите новый пароль (минимум 6 символов):');
    if (!newPassword) return;
    if (newPassword.length < 6) {
        alert('Пароль слишком короткий!');
        return;
    }
    if (!window.confirm(`Сбросить пароль для ${user.name}?`)) return;

    try {
        await api.adminResetUserPassword(user.id, newPassword);
        alert(`✅ Пароль изменён!\nНовый пароль: ${newPassword}`);
    } catch (err) {
        console.error('Reset password error:', err);
        alert('❌ Ошибка сброса пароля');
    }
};

    const filteredUsers = useMemo(() => {
        return users.filter(u => {
            // Поиск по тексту
            const matchesSearch = 
                u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                u.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
                u.id.toLowerCase().includes(searchTerm.toLowerCase());
            
            if (!matchesSearch) return false;

            // 🔹 Фильтр по подписке
            if (subscriptionFilter === 'all') return true;
            
            if (subscriptionFilter === 'none') {
                return !u.subscription;
            }
            
            if (!u.subscription) return false;
            
            const isExpired = new Date(u.subscription.expiresAt) < new Date();
            
            if (subscriptionFilter === 'active') {
                return !isExpired;
            }
            
            if (subscriptionFilter === 'expired') {
                return isExpired;
            }
            
            return true;
        });
    }, [users, searchTerm, subscriptionFilter]);

    // 🔹 Подписки, истекающие в ближайшие 3 дня (для вкладки "Статистика")
    const expiringSoonUsers = useMemo(() => {
        const now = new Date();
        const soon = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
        return users
            .filter(u => u.subscription && new Date(u.subscription.expiresAt) >= now && new Date(u.subscription.expiresAt) <= soon)
            .sort((a, b) => new Date(a.subscription!.expiresAt).getTime() - new Date(b.subscription!.expiresAt).getTime());
    }, [users]);

    const getPlanBadge = (plan: SubscriptionPlan) => {
        const styles: Record<SubscriptionPlan, string> = {
            TRIAL: 'bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-300',
            START: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400',
            STANDARD: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400',
            BUSINESS: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400',
            BUSINESS_PRO: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400',
        };
        const labels: Record<SubscriptionPlan, string> = {
            TRIAL: '🧪 Тест',
            START: '🚀 Старт',
            STANDARD: '⭐ Стандарт',
            BUSINESS: '💼 Бизнес',
            BUSINESS_PRO: '👑 Бизнес Pro',
        };
        return <span className={`px-2 py-1 rounded text-xs font-bold ${styles[plan]}`}>{labels[plan]}</span>;
    };

    const getStatusColor = (user: User) => {
        if (!user.subscription) return 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400';
        const isExpired = new Date(user.subscription.expiresAt) < new Date();
        if (isExpired) return 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400';
        const styles: Record<SubscriptionPlan, string> = {
            TRIAL: 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300',
            START: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400',
            STANDARD: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400',
            BUSINESS: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400',
            BUSINESS_PRO: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400',
        };
        return styles[user.subscription.plan] || 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400';
    };

    // 🔹 Прогресс использования лимита договоров
// 🔹 Прогресс использования лимита договоров
const getContractUsage = (user: User): {
    percent: number;
    unlimited: boolean;
    used: number;
    limit: number;
} => {
    const plan = user.subscription?.plan || 'TRIAL';
    const limit = PLAN_LIMITS[plan]?.contracts ?? 100; // Безопасное получение
    const used = user.salesCount || 0;

    if (limit === -1) {
        return { percent: 0, unlimited: true, used: 0, limit: 0 };
    }

    return {
        percent: Math.min(100, (used / limit) * 100),
        unlimited: false,
        used,
        limit
    };
};
    return (
        <div className="space-y-6 animate-fade-in pb-20">
            {/* Header */}
            <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800 dark:text-white">🛡️ Панель Администратора</h2>
                    <p className="text-slate-500 dark:text-slate-400 text-sm">Управление пользователями и тарифами</p>
                </div>
                <div className="flex gap-2">
                    <button onClick={loadUsers} className="p-2 bg-slate-100 dark:bg-slate-700 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 transition" title="Обновить">
                        {ICONS.Refresh}
                    </button>
                    <button onClick={loadSystemStats} className="p-2 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-lg hover:bg-indigo-200 dark:hover:bg-indigo-900/50 transition" title="Статистика">
                        {ICONS.Dashboard}
                    </button>
                </div>
            </header>

            {/* System Stats Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
                    <div className="text-sm text-slate-500 dark:text-slate-400">Всего пользователей</div>
                    <div className="text-2xl font-bold text-slate-800 dark:text-white">{systemStats.totalUsers}</div>
                </div>
              <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
                    <div className="text-sm text-slate-500 dark:text-slate-400">Активные подписки</div>
                    <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{systemStats.activeSubscriptions}</div>
                </div>
                <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
                    <div className="text-sm text-slate-500 dark:text-slate-400">Всего договоров</div>
                    <div className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">{systemStats.totalContracts}</div>
                </div>
                <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
                    <div className="text-sm text-slate-500 dark:text-slate-400">Истекают ≤3 дн.</div>
                    <div className={`text-2xl font-bold ${systemStats.expiringSoon > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-800 dark:text-white'}`}>{systemStats.expiringSoon}</div>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 border-b border-slate-200 dark:border-slate-700">
                {([
                    { id: 'users', label: '👥 Пользователи' },
                    { id: 'stats', label: '📊 Статистика' },
                    { id: 'referrals', label: '🎁 Рефералы' },
                    { id: 'logs', label: '📜 Логи' },
                ] as const).map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`px-4 py-2.5 text-sm font-bold border-b-2 -mb-px transition ${
                            activeTab === tab.id
                                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                        }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {activeTab === 'users' && (
            <>
            {/* Search & Filter */}
            <div className="bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border border-slate-100 dark:border-slate-700 space-y-3">
                <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">{ICONS.Search}</span>
                    <input
                        type="text"
                        placeholder="Поиск по имени, email или ID..."
                        className="w-full pl-10 pr-4 py-3 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-lg outline-none focus:border-indigo-500 transition"
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                    />
                </div>

                {/* 🔹 Фильтр по подписке */}
                <div className="flex flex-wrap gap-2">
                    <button
                        onClick={() => setSubscriptionFilter('all')}
                        className={`px-4 py-2 text-sm font-medium rounded-lg border transition ${
                            subscriptionFilter === 'all'
                                ? 'bg-slate-800 text-white border-slate-800'
                                : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 hover:border-slate-400 dark:hover:border-slate-500'
                        }`}
                    >
                        Все
                    </button>
                    <button
                        onClick={() => setSubscriptionFilter('active')}
                        className={`px-4 py-2 text-sm font-medium rounded-lg border transition ${
                            subscriptionFilter === 'active'
                                ? 'bg-emerald-600 text-white border-emerald-600'
                                : 'bg-white dark:bg-slate-800 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900/50 hover:border-emerald-400 dark:hover:border-emerald-700'
                        }`}
                    >
                        ✅ Активные
                    </button>
                    <button
                        onClick={() => setSubscriptionFilter('expired')}
                        className={`px-4 py-2 text-sm font-medium rounded-lg border transition ${
                            subscriptionFilter === 'expired'
                                ? 'bg-red-600 text-white border-red-600'
                                : 'bg-white dark:bg-slate-800 text-red-600 dark:text-red-400 border-red-200 dark:border-red-900/50 hover:border-red-400 dark:hover:border-red-700'
                        }`}
                    >
                        ⚠️ Истёкшие
                    </button>
                    <button
                        onClick={() => setSubscriptionFilter('none')}
                        className={`px-4 py-2 text-sm font-medium rounded-lg border transition ${
                            subscriptionFilter === 'none'
                                ? 'bg-slate-600 text-white border-slate-600'
                                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600 hover:border-slate-400 dark:hover:border-slate-500'
                        }`}
                    >
                        ❌ Без подписки
                    </button>
                </div>
            </div>

            {/* Users Grid */}
            {loading ? (
                <div className="text-center py-10">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto mb-3"></div>
                    <span className="text-slate-500 dark:text-slate-400">Загрузка пользователей...</span>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {filteredUsers.map(user => {
                        const usage = getContractUsage(user);
                        const isExpired = user.subscription && new Date(user.subscription.expiresAt) < new Date();
                        
                        return (
                            <div key={user.id} className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md transition relative overflow-hidden group">
                                {/* Role Badge */}
                                <div className="absolute top-0 right-0 px-3 py-1 bg-slate-100 dark:bg-slate-700 rounded-bl-lg text-xs font-bold uppercase text-slate-500 dark:text-slate-400">
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
                                        <h3 className="font-bold text-slate-800 dark:text-white text-lg truncate">{user.name}</h3>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{user.email}</p>
                                        {user.phone && <p className="text-xs text-slate-400">{user.phone}</p>}
                                    </div>
                                </div>

                                {/* Subscription Info */}
                                <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-700 space-y-3">
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs text-slate-500 dark:text-slate-400">Тариф</span>
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
                                        <div className="text-xs text-slate-500 dark:text-slate-400">
                                            <span>Действует до: </span>
                                            <span className={isExpired ? 'text-red-600 dark:text-red-400 font-medium' : 'text-slate-700 dark:text-slate-300'}>
                                                {new Date(user.subscription.expiresAt).toLocaleDateString('ru-RU')}
                                            </span>
                                        </div>
                                    )}

                                    {/* Contract Usage Progress */}
                                    {!usage.unlimited && (
                                        <div>
                                            <div className="flex justify-between text-xs mb-1">
                                                <span className="text-slate-500 dark:text-slate-400">Договоры</span>
                                                <span className={`font-medium ${usage.percent >= 90 ? 'text-red-600 dark:text-red-400' : usage.percent >= 70 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-700 dark:text-slate-300'}`}>
                                                    {usage.used} / {usage.limit}
                                                </span>
                                            </div>
                                            <div className="h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
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
                                <div className="flex gap-2 mt-4 pt-4 border-t border-slate-100 dark:border-slate-700">
                                    <button
                                        onClick={() => handleOpenModal(user)}
                                        className="flex-1 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition flex items-center justify-center gap-1.5"
                                    >
                                        {ICONS.Crown} Тариф
                                    </button>
                                    <button
                                        onClick={() => setApiModalUser(user)}
                                        className="flex-1 py-2 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-sm font-medium hover:bg-slate-200 dark:hover:bg-slate-600 transition flex items-center justify-center gap-1.5"
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
                <div className="text-center py-12 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
                    <div className="text-4xl mb-3">🔍</div>
                    <p className="text-slate-500 dark:text-slate-400">Пользователи не найдены</p>
                    <button onClick={() => { setSearchTerm(''); setSubscriptionFilter('all'); }} className="mt-2 text-indigo-600 hover:underline text-sm">
                        Сбросить фильтры
                    </button>
                </div>
            )}
            </>
            )}

            {activeTab === 'stats' && (
                <div className="space-y-4">
                    <div className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
                        <h3 className="font-bold text-slate-800 dark:text-white mb-4">Распределение по тарифам</h3>
                        {Object.keys(systemStats.planBreakdown).length === 0 ? (
                            <p className="text-sm text-slate-400">Нет активных подписок</p>
                        ) : (
                            <div className="space-y-3">
                                {(['TRIAL', 'START', 'STANDARD', 'BUSINESS', 'BUSINESS_PRO'] as SubscriptionPlan[])
                                    .filter(p => systemStats.planBreakdown[p])
                                    .map(p => {
                                        const count = systemStats.planBreakdown[p] || 0;
                                        const max: number = (['TRIAL', 'START', 'STANDARD', 'BUSINESS', 'BUSINESS_PRO'] as SubscriptionPlan[])
                                            .reduce((m, key) => Math.max(m, systemStats.planBreakdown[key] || 0), 1);
                                        return (
                                            <div key={p}>
                                                <div className="flex justify-between text-xs mb-1">
                                                    <span className="font-medium text-slate-600 dark:text-slate-300">{p}</span>
                                                    <span className="text-slate-500 dark:text-slate-400">{count}</span>
                                                </div>
                                                <div className="h-2.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                                                    <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${(count / max) * 100}%` }} />
                                                </div>
                                            </div>
                                        );
                                    })}
                            </div>
                        )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
                            <div className="text-sm text-slate-500 dark:text-slate-400 mb-1">Новых пользователей за 7 дней</div>
                            <div className="text-3xl font-bold text-slate-800 dark:text-white">{systemStats.newUsersLast7Days}</div>
                        </div>
                        <div className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
                            <div className="text-sm text-slate-500 dark:text-slate-400 mb-1">Подписки, истекающие в ближайшие 3 дня</div>
                            <div className={`text-3xl font-bold ${systemStats.expiringSoon > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-800 dark:text-white'}`}>{systemStats.expiringSoon}</div>
                        </div>
                    </div>

                    <div className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
                        <h3 className="font-bold text-slate-800 dark:text-white mb-4">Скоро истекают</h3>
                        {expiringSoonUsers.length === 0 ? (
                            <p className="text-sm text-slate-400">Нет подписок, истекающих в ближайшие 3 дня</p>
                        ) : (
                            <div className="divide-y divide-slate-100 dark:divide-slate-700">
                                {expiringSoonUsers.map(u => (
                                    <div key={u.id} className="py-2.5 flex items-center justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="font-medium text-sm text-slate-800 dark:text-white truncate">{u.name}</div>
                                            <div className="text-xs text-slate-400 truncate">{u.email}</div>
                                        </div>
                                        <div className="flex items-center gap-2 flex-shrink-0">
                                            {u.subscription && getPlanBadge(u.subscription.plan)}
                                            <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                                                до {new Date(u.subscription!.expiresAt).toLocaleDateString('ru-RU')}
                                            </span>
                                            <button onClick={() => handleOpenModal(u)} className="text-xs px-2 py-1 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition">Продлить</button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {activeTab === 'referrals' && (
                <div className="space-y-4">
                    {referralsLoading && (
                        <p className="text-center text-slate-400 dark:text-slate-500 py-8 text-sm">Загружаем…</p>
                    )}

                    {referrals && (
                        <>
                            {/* Сводка */}
                            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                                {[
                                    { v: referrals.summary.referrers_total, l: 'приглашали' },
                                    { v: referrals.summary.invited_total, l: 'приглашено всего' },
                                    { v: referrals.summary.rewarded_total, l: 'дошли до оплаты', accent: 'emerald' },
                                    { v: `${referrals.summary.conversion}%`, l: 'конверсия', accent: 'indigo' },
                                    { v: referrals.summary.daysGranted, l: 'дней выдано', accent: 'amber' },
                                ].map(c => (
                                    <div key={c.l} className={`rounded-xl p-3 text-center border ${
                                        c.accent === 'emerald' ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-100 dark:border-emerald-900/40'
                                        : c.accent === 'indigo' ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-100 dark:border-indigo-900/40'
                                        : c.accent === 'amber' ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-100 dark:border-amber-900/40'
                                        : 'bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700'
                                    }`}>
                                        <p className="text-xl font-bold text-slate-800 dark:text-white">{c.v}</p>
                                        <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 leading-tight">{c.l}</p>
                                    </div>
                                ))}
                            </div>

                            {/* Отклонённые — признак попыток накрутки, стоит видеть отдельно */}
                            {referrals.summary.rejected_total > 0 && (
                                <div className="bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-900/40 rounded-xl p-3 flex gap-2 items-start">
                                    <span className="text-rose-500 shrink-0">⛔</span>
                                    <p className="text-xs text-rose-800 dark:text-rose-300">
                                        Отклонено начислений: <b>{referrals.summary.rejected_total}</b> — совпал телефон
                                        или почта пригласившего и приглашённого (попытка привести самого себя).
                                    </p>
                                </div>
                            )}

                            {/* Кто сколько привёл */}
                            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 overflow-hidden">
                                <h3 className="font-bold text-slate-800 dark:text-white p-4 pb-2">Кто приглашает</h3>
                                {referrals.top.length === 0 ? (
                                    <p className="text-sm text-slate-400 dark:text-slate-500 px-4 pb-4">Пока никто никого не пригласил</p>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="min-w-full text-sm">
                                            <thead className="bg-slate-50 dark:bg-slate-700/50 text-left">
                                                <tr>
                                                    <th className="px-4 py-2 font-semibold text-slate-600 dark:text-slate-300">Пользователь</th>
                                                    <th className="px-3 py-2 font-semibold text-slate-600 dark:text-slate-300">Код</th>
                                                    <th className="px-3 py-2 font-semibold text-slate-600 dark:text-slate-300 text-center">Привёл</th>
                                                    <th className="px-3 py-2 font-semibold text-slate-600 dark:text-slate-300 text-center">Оплатили</th>
                                                    <th className="px-4 py-2 font-semibold text-slate-600 dark:text-slate-300 text-center">Дней</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {referrals.top.map((r: any) => (
                                                    <tr key={r.id} className="border-t border-slate-100 dark:border-slate-700">
                                                        <td className="px-4 py-2.5">
                                                            <p className="font-medium text-slate-800 dark:text-white">{r.name}</p>
                                                            <p className="text-[11px] text-slate-400 dark:text-slate-500">{r.email}</p>
                                                        </td>
                                                        <td className="px-3 py-2.5 font-mono text-[11px] text-slate-500 dark:text-slate-400">{r.referral_code}</td>
                                                        <td className="px-3 py-2.5 text-center text-slate-600 dark:text-slate-300">{r.invited}</td>
                                                        <td className="px-3 py-2.5 text-center font-bold text-emerald-600 dark:text-emerald-400">{r.paid}</td>
                                                        <td className="px-4 py-2.5 text-center text-slate-600 dark:text-slate-300">
                                                            {r.paid * referrals.summary.rewardDays}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>

                            {/* Кто кого привёл */}
                            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 overflow-hidden">
                                <h3 className="font-bold text-slate-800 dark:text-white p-4 pb-2">
                                    Кто кого привёл
                                    <span className="text-xs font-normal text-slate-400 dark:text-slate-500 ml-2">
                                        последние {referrals.pairs.length}
                                    </span>
                                </h3>
                                {referrals.pairs.length === 0 ? (
                                    <p className="text-sm text-slate-400 dark:text-slate-500 px-4 pb-4">Приглашений пока нет</p>
                                ) : (
                                    <div className="divide-y divide-slate-100 dark:divide-slate-700">
                                        {referrals.pairs.map((p: any) => (
                                            <div key={p.id} className="px-4 py-3 flex items-center justify-between gap-3">
                                                <div className="min-w-0">
                                                    <p className="text-sm text-slate-800 dark:text-white truncate">
                                                        <span className="text-slate-400 dark:text-slate-500">{p.referrer_name}</span>
                                                        <span className="mx-1.5 text-slate-300 dark:text-slate-600">→</span>
                                                        <span className="font-medium">{p.name}</span>
                                                    </p>
                                                    <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate">
                                                        {p.email} · {new Date(p.created_at).toLocaleDateString('ru-RU')}
                                                        {p.plan ? ` · ${p.plan}` : ''}
                                                    </p>
                                                </div>
                                                <span className={`text-[10px] font-bold px-2 py-1 rounded-full shrink-0 ${
                                                    p.referral_reward_granted
                                                        ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
                                                        : p.referral_rewarded_at
                                                            ? 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400'
                                                            : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
                                                }`}>
                                                    {p.referral_reward_granted ? 'оплатил' : p.referral_rewarded_at ? 'отклонён' : 'не оплатил'}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>
            )}

            {activeTab === 'logs' && (
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
                    <div className="p-4 flex items-center justify-between border-b border-slate-100 dark:border-slate-700">
                        <h3 className="font-bold text-slate-800 dark:text-white">Журнал действий администратора</h3>
                        <button onClick={loadAuditLog} className="p-2 bg-slate-100 dark:bg-slate-700 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 transition" title="Обновить">
                            {ICONS.Refresh}
                        </button>
                    </div>
                    {auditLoading ? (
                        <div className="text-center py-10">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto mb-3"></div>
                            <span className="text-slate-500 dark:text-slate-400">Загрузка журнала...</span>
                        </div>
                    ) : auditLog.length === 0 ? (
                        <div className="text-center py-10 text-slate-400 text-sm">Действий пока не зафиксировано</div>
                    ) : (
                        <div className="divide-y divide-slate-100 dark:divide-slate-700 max-h-[70vh] overflow-y-auto">
                            {auditLog.map(entry => (
                                <div key={entry.id} className="p-4 flex items-start gap-3">
                                    <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 flex-shrink-0">
                                        {AUDIT_ACTION_ICONS[entry.action] || ICONS.History}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm text-slate-800 dark:text-white">
                                            <span className="font-bold">{entry.adminName}</span> — {formatAuditAction(entry)}
                                        </p>
                                        {entry.targetName && (
                                            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                                                Пользователь: {entry.targetName} {entry.targetEmail ? `(${entry.targetEmail})` : ''}
                                            </p>
                                        )}
                                        <p className="text-xs text-slate-400 mt-0.5">{new Date(entry.createdAt).toLocaleString('ru-RU')}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* 🔹 Modal: Управление тарифом */}
            {selectedUser && (
                <div className="fixed inset-0 z-modal flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in" onClick={() => setSelectedUser(null)}>
                    <div className="bg-white dark:bg-slate-800 w-full max-w-md rounded-2xl shadow-2xl p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                        <div className="flex items-start justify-between mb-4">
                            <div>
                                <h3 className="text-xl font-bold text-slate-800 dark:text-white">📋 Управление тарифом</h3>
                                <p className="text-sm text-slate-500 dark:text-slate-400">{selectedUser.name} • {selectedUser.email}</p>
                            </div>
                            <button onClick={() => setSelectedUser(null)} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg">{ICONS.Close}</button>
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
                                <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-3">Тарифный план</label>
                                <div className="grid grid-cols-2 gap-2">
                                    {(['TRIAL', 'START', 'STANDARD', 'BUSINESS', 'BUSINESS_PRO'] as SubscriptionPlan[]).map((p) => {
                                        const limits = PLAN_LIMITS[p];
                                        return (
                                            <button
                                                key={p}
                                                onClick={() => handlePlanChange(p)}
                                                className={`p-3 text-left rounded-xl border-2 transition-all ${
                                                    plan === p
                                                        ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950/40 ring-2 ring-indigo-200 dark:ring-indigo-900/50'
                                                        : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                                                }`}
                                            >
                                                <div className="font-bold text-slate-800 dark:text-white">{p === 'TRIAL' ? '🧪 TRIAL' : p === 'START' ? '🚀 START' : p === 'STANDARD' ? '⭐ STANDARD' : p === 'BUSINESS' ? '💼 BUSINESS' : '👑 BUSINESS PRO'}</div>
                                                <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
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
                                <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-3">Срок действия</label>

                                {/* Unit switcher: дни / месяцы */}
                                <div className="inline-flex mb-3 bg-slate-100 dark:bg-slate-900 rounded-lg p-1">
                                    <button
                                        onClick={() => { setDurationUnit('days'); setDurationAmount(7); setInputValue(''); setIsCustom(false); setIsUnlimited(false); }}
                                        className={`px-4 py-1.5 text-sm font-medium rounded-md transition ${
                                            durationUnit === 'days' && !isUnlimited ? 'bg-white dark:bg-slate-700 shadow text-slate-800 dark:text-white' : 'text-slate-500 dark:text-slate-400'
                                        }`}
                                    >
                                        Дни
                                    </button>
                                    <button
                                        onClick={() => { setDurationUnit('months'); setDurationAmount(1); setInputValue(''); setIsCustom(false); setIsUnlimited(false); }}
                                        className={`px-4 py-1.5 text-sm font-medium rounded-md transition ${
                                            durationUnit === 'months' && !isUnlimited ? 'bg-white dark:bg-slate-700 shadow text-slate-800 dark:text-white' : 'text-slate-500 dark:text-slate-400'
                                        }`}
                                    >
                                        Месяцы
                                    </button>
                                </div>

                                <div className="flex flex-wrap gap-2 mb-3">
                                    {(durationUnit === 'days' ? [3, 7, 14, 30, 90] : [1, 3, 6, 12]).map(v => (
                                        <button key={v} onClick={() => { setDurationAmount(v); setInputValue(''); setIsCustom(false); setIsUnlimited(false); }}
                                            className={`px-4 py-2 text-sm font-medium rounded-lg border transition ${
                                                durationAmount === v && !isCustom && !isUnlimited ? 'bg-slate-800 text-white border-slate-800' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 hover:border-slate-400 dark:hover:border-slate-500'
                                            }`}>
                                            {v} {durationUnit === 'days' ? 'дн.' : 'мес.'}
                                        </button>
                                    ))}
                                    <button onClick={() => { setIsUnlimited(true); setInputValue(''); setIsCustom(false); }}
                                        className={`px-4 py-2 text-sm font-medium rounded-lg border transition ${
                                            isUnlimited ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white dark:bg-slate-800 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900/50 hover:border-emerald-400 dark:hover:border-emerald-700'
                                        }`} title="Бессрочно">∞</button>
                                </div>
                                <div className="flex items-center gap-2">
                                    <input type="number" min="1" max={durationUnit === 'days' ? 3650 : 120} value={isCustom ? inputValue : ''}
                                        onChange={(e) => {
                                            setInputValue(e.target.value);
                                            setIsCustom(true);
                                            setIsUnlimited(false);
                                            const v = parseInt(e.target.value);
                                            const max = durationUnit === 'days' ? 3650 : 120;
                                            if (v > 0) setDurationAmount(Math.min(v, max));
                                        }}
                                        placeholder="Свой срок" disabled={isUnlimited}
                                        className="flex-1 px-3 py-2 text-sm border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-lg outline-none focus:border-indigo-500 disabled:bg-slate-50 dark:disabled:bg-slate-800"/>
                                    <span className="text-sm text-slate-500 dark:text-slate-400">{isUnlimited ? '∞' : durationUnit === 'days' ? 'дн.' : 'мес.'}</span>
                                </div>
                            </div>

                            {/* Expiration Preview */}
                            <div className="bg-slate-50 dark:bg-slate-900/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                                <div className="flex items-center gap-2 text-sm">
                                    <span className="text-slate-500 dark:text-slate-400">📅 Будет действовать до:</span>
                                    <span className="font-bold text-slate-800 dark:text-white">
                                        {isUnlimited ? 'Не ограничено' : (() => {
                                            // Тот же расчёт, что применит сервер (addMonthsClamped),
                                            // иначе предпросмотр показывал бы не ту дату на 29-31 числе.
                                            let d = new Date();
                                            if (durationUnit === 'days') d.setDate(d.getDate() + durationAmount);
                                            else d = addMonthsClamped(d, durationAmount);
                                            return d.toLocaleDateString('ru-RU');
                                        })()}
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
                <div className="fixed inset-0 z-modal flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in" onClick={() => setApiModalUser(null)}>
                    <div className="bg-white dark:bg-slate-800 w-full max-w-md rounded-2xl shadow-2xl p-6" onClick={e => e.stopPropagation()}>
                        <div className="flex items-start justify-between mb-4">
                            <div>
                                <h3 className="text-xl font-bold text-slate-800 dark:text-white">🔑 API Доступ</h3>
                                <p className="text-sm text-slate-500 dark:text-slate-400">{apiModalUser.name}</p>
                            </div>
                            <button onClick={() => setApiModalUser(null)} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg">{ICONS.Close}</button>
                        </div>

                        <div className="space-y-4">
                            <div className="bg-slate-50 dark:bg-slate-900/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-2">API Ключ</label>
                                {generatedKey || apiModalUser.apiKey ? (
                                    <div className="flex items-center gap-2">
                                        <code className="flex-1 bg-white dark:bg-slate-800 p-2 rounded border border-slate-200 dark:border-slate-600 text-xs font-mono break-all">
                                            {generatedKey || apiModalUser.apiKey}
                                        </code>
                                        <button onClick={() => { navigator.clipboard.writeText(generatedKey || apiModalUser.apiKey!); alert("📋 Скопировано!"); }}
                                            className="p-2 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded">{ICONS.Copy}</button>
                                    </div>
                                ) : (
                                    <p className="text-sm text-slate-400 italic">Ключ не сгенерирован</p>
                                )}
                            </div>

                            <div className="text-xs text-slate-500 dark:text-slate-400 space-y-1 bg-amber-50 dark:bg-amber-900/30 p-3 rounded-lg border border-amber-200 dark:border-amber-900/50">
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