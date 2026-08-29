import React, { useState, useMemo, useEffect } from 'react';
import { ICONS } from '../constants';
import { api } from '../services/api';
import ModalPortal from './ModalPortal';
import { SubscriptionPlan, User, PlanLimits } from '../types';

// ← Добавьте этот маппинг, если его нет в файле
const PLAN_NAMES: { START: string; BUSINESS: string; STANDARD: string; BUSINESS_PRO: string } = {
  START: 'Старт',
  STANDARD: 'Стандарт',
  BUSINESS: 'Бизнес',
  BUSINESS_PRO: 'Бизнес Pro'
};

interface TariffsProps {
    user?: User | null;
    /** Текущие объёмы — нужны, чтобы показать последствия понижения в конкретных числах. */
    investorsCount?: number;
    contractsCount?: number;
    employeesCount?: number;
}

// Названия возможностей для списка «что отключится». Порядок задаёт порядок в списке:
// сначала то, что бьёт по уже заведённым данным, потом просто отключаемые функции.
const FEATURE_LABELS: { key: keyof PlanLimits; label: string; note?: string }[] = [
  { key: 'investorPools', label: 'Общая касса — несколько инвесторов на одном счёте' },
  { key: 'suppliers', label: 'Модуль «Партнёры»: поставщики и долги по закупу' },
  { key: 'whatsapp', label: 'Авто-напоминания клиентам в WhatsApp' },
  { key: 'tasks', label: 'Поручения сотрудникам' },
  { key: 'ai', label: 'AI-помощник' },
  { key: 'notifications', label: 'Уведомления о платежах и договорах' },
];

const Tariffs: React.FC<TariffsProps> = ({ user, investorsCount = 0, contractsCount = 0, employeesCount = 0 }) => {
  const [duration, setDuration] = useState<1 | 3 | 6 | 12>(1);
  const [loading, setLoading] = useState<string | null>(null);
  const [confirmData, setConfirmData] = useState<{name: string, key: string, monthlyPrice: number, basePrice: number} | null>(null);
  // Осознанное согласие на потерю функций. Сбрасывается при каждом открытии окна.
  const [downgradeAccepted, setDowngradeAccepted] = useState(false);

  // 🔹 Вычисляем статус подписки
  const subStatus = useMemo(() => {
    if (!user?.subscription) return { daysLeft: 0, planName: 'Пробный', expired: true, isWarning: true };

    const now = new Date();
    const expires = new Date(user.subscription.expiresAt);
    const diffTime = expires.getTime() - now.getTime();
    const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    return {
        daysLeft,
        planName: PLAN_NAMES[user.subscription.plan] || user.subscription.plan,
        expired: diffTime < 0,
        isWarning: daysLeft <= 3 && daysLeft >= 0
    };
  }, [user]);

  // Значения на случай, если запрос цен не прошёл: страница тарифов не должна
  // ломаться из-за сетевой ошибки. Считает деньги всё равно сервер, поэтому
  // расхождение может дать только неверную витрину, но не неверное списание.
  const FALLBACK_DISCOUNTS: Record<number, number> = { 1: 0, 3: 0.03, 6: 0.05, 12: 0.10 };
  const [pricing, setPricing] = useState<{ prices: Record<string, number>; discounts: Record<string, number> } | null>(null);

  useEffect(() => {
    api.getPricing()
       .then(setPricing)
       .catch(() => { /* останемся на встроенных значениях */ });
  }, []);

  const getDiscount = (months: number) =>
    pricing?.discounts?.[months] ?? FALLBACK_DISCOUNTS[months] ?? 0;

  const getBasePrice = (planKey: string, fallback: number) =>
    pricing?.prices?.[planKey] ?? fallback;

  const calculatePrice = (basePrice: number) => {
    const discount = getDiscount(duration);
    const monthlyPrice = basePrice * (1 - discount);
    return Math.ceil(monthlyPrice);
  };

  const handleSelectPlan = (name: string, key: string, monthlyPrice: number, basePrice: number) => {
      setDowngradeAccepted(false);
      setConfirmData({ name, key, monthlyPrice, basePrice });
  };

  /**
   * Что человек теряет, переходя на выбранный тариф. Считается сравнением лимитов
   * текущего и нового плана — таблицу отдаёт сервер, поэтому список всегда совпадает
   * с тем, что реально применится после оплаты.
   */
  const downgrade = useMemo(() => {
    if (!confirmData || !pricing?.limits) return null;
    // У истёкшей подписки возможности уже урезаны до START (EXPIRED_FALLBACK_PLAN
    // в server/index.js), поэтому сравнивать надо с фактическим уровнем доступа,
    // а не с формально записанным тарифом — иначе человеку с истёкшим Бизнесом
    // показали бы «вы потеряете WhatsApp», хотя он потерял его ещё в день окончания.
    const currentPlan = subStatus.expired ? 'START' : (user?.subscription?.plan || 'TRIAL');

    // Пробный период показывает почти все возможности, поэтому переход на любой платный
    // тариф формально «понижение». Но это первая покупка, а не отказ от оплаченного —
    // список потерь на этом шаге только отпугивает. Что входит в тариф, видно на карточках.
    if (currentPlan === 'TRIAL') return null;

    const from = pricing.limits[currentPlan];
    const to = pricing.limits[confirmData.key];
    if (!from || !to || currentPlan === confirmData.key) return null;

    // Функции, которые были и пропадут.
    const lostFeatures = FEATURE_LABELS
      .filter(f => from[f.key] === true && to[f.key] !== true)
      .map(f => f.label);

    // Числовые лимиты: -1 означает «без ограничений», поэтому сравниваем аккуратно.
    const tighter = (a: number, b: number) => (a === -1 && b !== -1) || (a !== -1 && b !== -1 && b < a);
    const limitWarnings: { text: string; critical: boolean }[] = [];

    if (tighter(from.investors, to.investors)) {
      // Инвесторы сверх лимита не удаляются, а блокируются вместе со своими счетами
      // (getInvestorLimitState в server/index.js) — это самое болезненное последствие.
      const blocked = Math.max(0, investorsCount - to.investors);
      limitWarnings.push({
        critical: blocked > 0,
        text: blocked > 0
          ? `Инвесторы: останется ${to.investors} из ${investorsCount}. ${blocked} ${blocked === 1 ? 'инвестор будет заблокирован' : 'инвесторов будут заблокированы'} вместе со своими счетами — данные сохранятся, но работать с ними будет нельзя.`
          : `Лимит инвесторов: ${to.investors} (сейчас у вас ${investorsCount}).`
      });
    }

    if (tighter(from.contracts, to.contracts)) {
      const over = to.contracts !== -1 && contractsCount > to.contracts;
      limitWarnings.push({
        critical: over,
        text: over
          ? `Договоры: лимит станет ${to.contracts}, а у вас уже ${contractsCount}. Новые договоры создать будет нельзя, пока не закроете лишние.`
          : `Лимит договоров: ${to.contracts} (сейчас у вас ${contractsCount}).`
      });
    }

    if (tighter(from.employees, to.employees)) {
      const blocked = to.employees === 0 ? employeesCount : Math.max(0, employeesCount - to.employees);
      limitWarnings.push({
        critical: blocked > 0,
        text: blocked > 0
          ? `Сотрудники: доступ потеряют ${blocked} — они не смогут войти в приложение.`
          : 'Сотрудники: заводить новых будет нельзя.'
      });
    }

    if (lostFeatures.length === 0 && limitWarnings.length === 0) return null;
    return { lostFeatures, limitWarnings, hasCritical: limitWarnings.some(w => w.critical) };
  }, [confirmData, pricing, user, subStatus.expired, investorsCount, contractsCount, employeesCount]);

  const proceedToPayment = async () => {
    if (!confirmData) return;

    const { name } = confirmData;
    setLoading(name);

    const planKey: SubscriptionPlan = name === 'Старт' ? 'START' : name === 'Стандарт' ? 'STANDARD' : name === 'Бизнес Pro' ? 'BUSINESS_PRO' : 'BUSINESS';

    try {
      // Сумму не передаём — её считает сервер по plan + months (PLAN_PRICES в server/index.js).
      const data = await api.createPayment({
          // 🔹 Маркер ?payment=success — по нему App.tsx понимает, что нужно сразу
          // проверить подписку на сервере, не дожидаясь фоновой синхронизации.
          returnUrl: 'https://rassrochka.pro/?payment=success',
          plan: planKey,
          months: duration
      });

      if (data.confirmationUrl) {
        window.location.href = data.confirmationUrl;
      } else {
        alert("Ошибка инициализации платежа. Проверьте настройки сервера.");
        setLoading(null);
        setConfirmData(null);
      }
    } catch (error: any) {
      console.error("Payment Error:", error);
      alert(`Ошибка: ${error.message || 'Не удалось создать платеж'}`);
      setLoading(null);
      setConfirmData(null);
    }
  };

  const plans = [
    {
      name: "Старт",
      key: "START",
      basePrice: 990,
      features: [
        "Базовый учет продаж",
        "1 инвестор",
        "База клиентов (до 100)",
        "Учет расходов",
      ],
      color: "bg-slate-100 dark:bg-slate-700",
      textColor: "text-slate-800 dark:text-white",
      btnColor: "bg-slate-800",
      highlight: false
    },
    {
      name: "Стандарт",
      key: "STANDARD",
      basePrice: 1490,
      features: [
        "Все функции Старт",
        "5 инвесторов",
        "Печать договоров (PDF)",
        "База клиентов (до 1000)"
      ],
      color: "bg-indigo-50 dark:bg-indigo-950/40 border-2 border-indigo-500",
      textColor: "text-indigo-900 dark:text-indigo-300",
      btnColor: "bg-indigo-600",
      highlight: true,
      badge: "Популярный"
    },
    {
      name: "Бизнес",
      key: "BUSINESS",
      basePrice: 1990,
      features: [
        "Все функции Стандарт",
        "Безлимит инвесторов",
        "Авто-напоминания WhatsApp",
        "Сотрудники и права доступа",
        "Приоритетная поддержка"
      ],
      color: "bg-gradient-to-br from-slate-900 to-slate-800 text-white",
      textColor: "text-white",
      btnColor: "bg-white text-slate-900",
      highlight: false
    },
    {
      name: "Бизнес Pro",
      key: "BUSINESS_PRO",
      basePrice: 2990,
      features: [
        "Все функции Бизнес",
        // Магазин — самое крупное из того, что добавляет тариф, поэтому
        // стоит первым: человек читает список сверху и редко дочитывает до конца.
        "Магазин: продажи за наличные и в долг, касса с корзиной и чеком",
        "Склад: товары с фото, остатки по нескольким складам",
        "Приход от поставщиков, перемещение, списание, инвентаризация",
        "Журнал документов и история по каждому товару",
        "Отчёт по рознице: выручка, маржа, залежавшийся товар",
        "Модуль «Партнеры» (поставщики)",
        "Учёт долгов по закупу",
        "Общая касса — несколько инвесторов на одном счёте",
        "Автоматическое распределение прибыли по вложению и % каждого инвестора"
      ],
      color: "bg-gradient-to-br from-amber-600 to-amber-500 text-white",
      textColor: "text-white",
      btnColor: "bg-white text-amber-700",
      highlight: false
    }
  ];

  return (
    <div className="space-y-6 animate-fade-in pb-20 relative">
      <header className="text-center">
        <h2 className="text-3xl font-bold text-slate-800 dark:text-white">Тарифы</h2>
        <p className="text-slate-500 dark:text-slate-400 mt-2">Выберите подходящий план для вашего бизнеса</p>
      </header>

      {/* 🔹 Блок статуса текущей подписки */}
      {user?.subscription && (
        <div className={`max-w-2xl mx-auto px-2 p-4 rounded-2xl border-2 flex items-center gap-3 ${
          subStatus.expired
            ? 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-900/50 text-red-800 dark:text-red-400'
            : subStatus.isWarning
              ? 'bg-amber-50 dark:bg-amber-900/30 border-amber-200 dark:border-amber-900/50 text-amber-800 dark:text-amber-400'
              : 'bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200 dark:border-emerald-900/50 text-emerald-800 dark:text-emerald-400'
        }`}>
          <div className={`p-2 rounded-full ${
            subStatus.expired ? 'bg-red-100 dark:bg-red-900/50' : subStatus.isWarning ? 'bg-amber-100 dark:bg-amber-900/50' : 'bg-emerald-100 dark:bg-emerald-900/50'
          }`}>
            {subStatus.expired ? ICONS.Alert : subStatus.isWarning ? ICONS.Clock : ICONS.CheckCircle}
          </div>
          <div className="flex-1">
            <p className="font-bold text-sm">
              {subStatus.expired
                ? 'Подписка истекла'
                : subStatus.isWarning
                  ? `Внимание: осталось ${subStatus.daysLeft} дн.`
                  : `Активен тариф "${subStatus.planName}"`}
            </p>
            {!subStatus.expired && (
              <p className="text-xs opacity-80">
                До окончания: {subStatus.daysLeft} {subStatus.daysLeft === 1 ? 'день' : subStatus.daysLeft >= 2 && subStatus.daysLeft <= 4 ? 'дня' : 'дней'}
              </p>
            )}
          </div>
          {subStatus.expired && (
            <button
              onClick={() => document.querySelector('.grid')?.scrollIntoView({ behavior: 'smooth' })}
              className="px-4 py-2 bg-red-600 text-white text-sm font-bold rounded-xl hover:bg-red-700 transition"
            >
              Продлить
            </button>
          )}
        </div>
      )}

      {/* Duration Switcher */}
      <div className="flex justify-center">
        <div className="bg-white dark:bg-slate-800 p-1 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 inline-flex">
          {[1, 3, 6, 12].map((m) => (
            <button
              key={m}
              onClick={() => setDuration(m as any)}
              className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                duration === m
                  ? 'bg-slate-800 text-white shadow-md'
                  : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'
              }`}
            >
              {m} мес. {m > 1 && <span className="text-[10px] opacity-70">-{getDiscount(m)*100}%</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Plans Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-7xl mx-auto px-2">
        {plans.map((plan) => {
  // Базовую цену берём с сервера, встроенная в массив — только запасной вариант.
  const basePrice = getBasePrice(plan.key, plan.basePrice);
  const monthlyPrice = calculatePrice(basePrice);
  const totalPrice = monthlyPrice * duration;

  // 🔥 План совпадает с текущим И подписка активна
  const isCurrentPlan = !subStatus.expired && user?.subscription?.plan === plan.key;
  // 🔥 План совпадает, но подписка истекла
  const isExpiredPlan = subStatus.expired && user?.subscription?.plan === plan.key;
  // 🔥 План отличается от текущего (апгрейд/даунгрейд)
  const isDifferentPlan = user?.subscription?.plan !== plan.key;

  return (
    <div
      key={plan.name}
      className={`relative rounded-2xl p-6 shadow-xl transition-transform hover:scale-[1.02] flex flex-col ${plan.color} ${
        isCurrentPlan ? 'ring-4 ring-emerald-400 ring-offset-2' : 
        isExpiredPlan ? 'ring-2 ring-amber-400 ring-offset-1' : ''
      }`}
    >
      {plan.badge && !isCurrentPlan && !isExpiredPlan && (
        <div className="absolute top-0 right-0 bg-indigo-500 text-white text-xs font-bold px-3 py-1 rounded-bl-xl rounded-tr-xl">
          {plan.badge}
        </div>
      )}

      {isCurrentPlan && (
        <div className="absolute top-0 right-0 bg-emerald-500 text-white text-xs font-bold px-3 py-1 rounded-bl-xl rounded-tr-xl flex items-center gap-1">
          {ICONS.Check} Активен
        </div>
      )}

      {isExpiredPlan && (
        <div className="absolute top-0 right-0 bg-amber-500 text-white text-xs font-bold px-3 py-1 rounded-bl-xl rounded-tr-xl flex items-center gap-1">
          ⏳ Истёк
        </div>
      )}

      <h3 className={`text-xl font-bold mb-2 ${plan.highlight ? 'text-indigo-900' : plan.textColor}`}>
        {plan.name}
      </h3>

      <div className="mb-6">
        <span className={`text-4xl font-bold ${plan.highlight ? 'text-indigo-900' : plan.textColor}`}>
          {monthlyPrice} ₽
        </span>
        <span className={`text-sm opacity-70 ${plan.textColor}`}>/мес</span>
        {duration > 1 && (
           <p className={`text-xs mt-1 opacity-60 ${plan.textColor}`}>
             Оплата сразу: {totalPrice} ₽
           </p>
        )}
      </div>

      <ul className="space-y-3 mb-8 flex-1">
        {plan.features.map((feature, idx) => (
          <li key={idx} className="flex items-start gap-2 text-sm">
            <span className={plan.name === 'Бизнес' || plan.name === 'Бизнес Pro' ? 'text-white' : 'text-emerald-600'}>
              {ICONS.Check}
            </span>
            <span className={`${plan.name === 'Бизнес' ? 'text-slate-300' : plan.name === 'Бизнес Pro' ? 'text-amber-50' : 'text-slate-600 dark:text-slate-300'}`}>
              {feature}
            </span>
          </li>
        ))}
      </ul>

      {/* 🔥 Кнопка: доступна всегда, кроме случая, когда это другой план и он активен (опционально) */}
      <button
        onClick={() => handleSelectPlan(plan.name, plan.key, monthlyPrice, basePrice)}
        // ❌ Убрали disabled={isCurrentPlan} — теперь можно продлевать активный тариф
        className={`w-full py-4 rounded-xl font-bold transition-opacity ${
          isCurrentPlan 
            ? 'bg-emerald-600 text-white hover:bg-emerald-700' // активный план — зелёная кнопка
            : isExpiredPlan
              ? `${plan.btnColor} hover:opacity-90 ring-2 ring-amber-400`
              : `${plan.btnColor} hover:opacity-90`
        }`}
      >
        {isCurrentPlan 
          ? '🔄 Продлить' 
          : isExpiredPlan 
            ? '🔄 Продлить' 
            : 'Выбрать'
        }
      </button>
    </div>
  );
})}
      </div>

      <div className="text-center text-xs text-slate-400 dark:text-slate-500 mt-8">
        Оплата производится через безопасный шлюз ЮKassa. Активация происходит автоматически после подтверждения платежа.
      </div>

      {/* Confirmation Modal */}
      {confirmData && (
        <ModalPortal>
          <div className="fixed inset-0 z-modal flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in" onClick={() => !loading && setConfirmData(null)}>
              <div className="bg-white dark:bg-slate-800 w-full max-w-sm rounded-2xl shadow-2xl p-6 relative overflow-hidden" onClick={e => e.stopPropagation()}>

                  {/* Decorative Background Element */}
                  <div className="absolute -top-10 -right-10 w-32 h-32 bg-indigo-50 dark:bg-indigo-950/40 rounded-full opacity-50 pointer-events-none"></div>

                  <h3 className="text-xl font-bold text-slate-800 dark:text-white mb-1">Подтверждение заказа</h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">Проверьте детали перед оплатой</p>

                  {/* Понижение тарифа: показываем последствия ДО оплаты, а не после.
                      Возврат денег за уже оплаченный период не предусмотрен, поэтому
                      узнать о потере инвесторов постфактум — худший из возможных сценариев. */}
                  {downgrade && (
                    <div className={`mb-5 rounded-xl border p-4 ${
                      downgrade.hasCritical
                        ? 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900/50'
                        : 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900/50'
                    }`}>
                      <div className="flex items-start gap-2.5 mb-3">
                        <span className={`shrink-0 mt-0.5 ${downgrade.hasCritical ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400'}`}>
                          {ICONS.Alert}
                        </span>
                        <div className="min-w-0">
                          <p className={`font-bold text-sm ${downgrade.hasCritical ? 'text-rose-900 dark:text-rose-300' : 'text-amber-900 dark:text-amber-300'}`}>
                            Тариф ниже текущего
                          </p>
                          <p className={`text-xs ${downgrade.hasCritical ? 'text-rose-700 dark:text-rose-400' : 'text-amber-700 dark:text-amber-400'}`}>
                            После перехода на «{confirmData.name}» станет недоступно:
                          </p>
                        </div>
                      </div>

                      {downgrade.limitWarnings.length > 0 && (
                        <ul className="space-y-2 mb-3">
                          {downgrade.limitWarnings.map((w, i) => (
                            <li key={i} className={`flex items-start gap-2 text-xs leading-relaxed ${
                              w.critical
                                ? 'text-rose-800 dark:text-rose-300 font-medium'
                                : 'text-slate-600 dark:text-slate-400'
                            }`}>
                              <span className="shrink-0 mt-1.5 w-1.5 h-1.5 rounded-full bg-current opacity-60" />
                              <span>{w.text}</span>
                            </li>
                          ))}
                        </ul>
                      )}

                      {downgrade.lostFeatures.length > 0 && (
                        <ul className="space-y-1.5">
                          {downgrade.lostFeatures.map((f, i) => (
                            <li key={i} className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-400">
                              <span className="shrink-0 text-slate-400 dark:text-slate-500 font-bold leading-none mt-0.5">✕</span>
                              <span className="line-through decoration-slate-400/60">{f}</span>
                            </li>
                          ))}
                        </ul>
                      )}

                      <label className="flex items-start gap-2.5 mt-4 pt-3 border-t border-current/10 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={downgradeAccepted}
                          onChange={(e) => setDowngradeAccepted(e.target.checked)}
                          className="mt-0.5 w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className={`text-xs font-medium ${downgrade.hasCritical ? 'text-rose-900 dark:text-rose-300' : 'text-amber-900 dark:text-amber-300'}`}>
                          Я понимаю, что перечисленное отключится, и хочу перейти на этот тариф
                        </span>
                      </label>
                    </div>
                  )}

                  <div className="bg-slate-50 dark:bg-slate-700/50 p-4 rounded-xl space-y-3 border border-slate-100 dark:border-slate-700 mb-6">
                      <div className="flex justify-between items-center">
                          <span className="text-slate-500 dark:text-slate-400 text-sm">Тариф</span>
                          <span className="font-bold text-slate-800 dark:text-white">{confirmData.name}</span>
                      </div>
                      <div className="flex justify-between items-center">
                          <span className="text-slate-500 dark:text-slate-400 text-sm">Период</span>
                          <span className="font-medium text-slate-800 dark:text-white">{duration} мес.</span>
                      </div>
                      <div className="border-t border-slate-200 dark:border-slate-700 my-2"></div>
                      <div className="flex justify-between items-center text-xs text-slate-400 dark:text-slate-500">
                          <span>Цена за месяц</span>
                          <span>{confirmData.monthlyPrice} ₽</span>
                      </div>
                      {confirmData.basePrice > confirmData.monthlyPrice && (
                          <div className="flex justify-between items-center text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                              {/* Процент берём из тарифной сетки, а не пересчитываем обратно из цены:
                                  месячная цена округляется вверх (Math.ceil), и обратный расчёт давал
                                  дробь вида «4.94949494949495%» прямо в окне оплаты. */}
                              <span>Скидка ({getDiscount(duration) * 100}%)</span>
                              <span>-{(confirmData.basePrice * duration - confirmData.monthlyPrice * duration).toLocaleString()} ₽</span>
                          </div>
                      )}
                      <div className="flex justify-between items-end pt-2">
                          <span className="text-slate-800 dark:text-white font-bold">Итого к оплате:</span>
                          <span className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">{(confirmData.monthlyPrice * duration).toLocaleString()} ₽</span>
                      </div>
                  </div>

                  <div className="space-y-3">
                      <button
                          onClick={proceedToPayment}
                          // Кнопка неактивна, пока человек не подтвердил, что видел список потерь.
                          disabled={!!loading || (!!downgrade && !downgradeAccepted)}
                          className="w-full py-3.5 bg-indigo-600 text-white rounded-xl font-bold shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all flex justify-center items-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                      >
                          {loading ? (
                              <>
                                  <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                  </svg>
                                  Переход к оплате...
                              </>
                          ) : (
                              'Оплатить'
                          )}
                      </button>

                      <button
                          onClick={() => setConfirmData(null)}
                          disabled={!!loading}
                          className="w-full py-3 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-xl font-medium hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                      >
                          Отмена
                      </button>
                  </div>

                  <div className="mt-4 flex justify-center opacity-50">
                      <span className="text-[10px] text-slate-400 dark:text-slate-500">Безопасный платеж • SSL Encrypted</span>
                  </div>
              </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
};

export default Tariffs;
