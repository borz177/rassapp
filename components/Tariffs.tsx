import React, { useState, useMemo, useEffect } from 'react';
import { ICONS } from '../constants';
import { api } from '../services/api';
import ModalPortal from './ModalPortal';
import { SubscriptionPlan, User, PlanLimits } from '../types';

const PLAN_NAMES: Record<string, string> = {
  TRIAL: 'Пробный',
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

  /**
   * Витрина тарифов.
   *
   * Одна спокойная палитра — белый и графит — вместо своего цвета у каждой
   * карточки: четыре разных фона спорили друг с другом, и глаз не понимал, что
   * здесь главное. «Популярный» выделен графитовой карточкой, старший тариф
   * «Бизнес Pro» — золотой: его узнают по цвету. Остальной цвет — только точка
   * статуса подписки.
   *
   * Кнопка стоит сразу под ценой, а не под списком возможностей: списки разной
   * длины, и кнопки внизу оказывались на разной высоте. Так все четыре кнопки на
   * одной линии, а сравнивать тарифы по цене удобнее.
   */
  const plans: {
    name: string;
    key: SubscriptionPlan;
    basePrice: number;
    tagline: string;
    /** Тариф, возможности которого входят целиком */
    includes?: string;
    features: string[];
    featured?: boolean;
    /** Старший тариф — золотая карточка */
    gold?: boolean;
    badge?: string;
  }[] = [
    {
      name: 'Старт',
      key: 'START',
      basePrice: 990,
      tagline: 'Чтобы начать вести учёт',
      features: [
        'Базовый учет продаж',
        '1 инвестор',
        'База клиентов (до 100)',
        'Учет расходов',
      ],
    },
    {
      name: 'Стандарт',
      key: 'STANDARD',
      basePrice: 1490,
      tagline: 'Для растущего дела',
      includes: 'Старт',
      features: [
        '5 инвесторов',
        'Печать договоров (PDF)',
        'База клиентов (до 1000)',
      ],
      featured: true,
      badge: 'Популярный',
    },
    {
      name: 'Бизнес',
      key: 'BUSINESS',
      basePrice: 1990,
      tagline: 'Для команды с сотрудниками',
      includes: 'Стандарт',
      features: [
        'Безлимит инвесторов',
        'Авто-напоминания WhatsApp',
        'Сотрудники и права доступа',
        'Приоритетная поддержка',
      ],
    },
    {
      name: 'Бизнес Pro',
      key: 'BUSINESS_PRO',
      basePrice: 2990,
      tagline: 'Магазин, склад и общая касса',
      gold: true,
      includes: 'Бизнес',
      features: [
        // Магазин — самое крупное из того, что добавляет тариф, поэтому
        // стоит первым: человек читает список сверху и редко дочитывает до конца.
        'Магазин: продажи за наличные и в долг, касса с корзиной и чеком',
        'Склад: товары с фото, остатки по нескольким складам',
        'Приход от поставщиков, перемещение, списание, инвентаризация',
        'Журнал документов и история по каждому товару',
        'Отчёт по рознице: выручка, маржа, залежавшийся товар',
        'Модуль «Партнеры» (поставщики)',
        'Учёт долгов по закупу',
        'Общая касса — несколько инвесторов на одном счёте',
        'Автоматическое распределение прибыли по вложению и % каждого инвестора',
      ],
    },
  ];

  const rub = (n: number) => n.toLocaleString('ru-RU');

  // 1 день, 2 дня, 5 дней, 21 день, 41 день, 111 дней
  const daysWord = (n: number) => {
    const m10 = Math.abs(n) % 10;
    const m100 = Math.abs(n) % 100;
    if (m10 === 1 && m100 !== 11) return 'день';
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'дня';
    return 'дней';
  };

  const scrollToPlans = () =>
    document.getElementById('tariff-plans')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const Tick = ({ className }: { className: string }) => (
    <svg className={`shrink-0 mt-[3px] ${className}`} width="14" height="14" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );

  const statusDot = subStatus.expired ? 'bg-rose-500' : subStatus.isWarning ? 'bg-amber-500' : 'bg-emerald-500';

  return (
    <div className="space-y-8 sm:space-y-10 animate-fade-in pb-20 relative">
      <header className="text-center max-w-2xl mx-auto pt-2 px-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400 dark:text-slate-500">
          Тарифы
        </p>
        <h2 className="mt-3 text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-white">
          Выберите план для вашего бизнеса
        </h2>
        <p className="mt-3 text-sm sm:text-base text-slate-500 dark:text-slate-400">
          Чем дольше срок — тем ниже цена за месяц.
        </p>
      </header>

      {/* Статус подписки — одной строкой, цвет только у точки */}
      {user?.subscription && (
        <div className="flex justify-center px-2">
          <div
            data-testid="subscription-status"
            className="inline-flex max-w-full items-center gap-3 rounded-full border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800/60 py-2 pl-4 pr-2 shadow-sm"
          >
            <span className={`h-2 w-2 shrink-0 rounded-full ${statusDot}`} />
            <p className="min-w-0 text-sm text-slate-600 dark:text-slate-300">
              {subStatus.expired ? (
                <>
                  Тариф <span className="font-semibold text-slate-900 dark:text-white">«{subStatus.planName}»</span> истёк
                </>
              ) : (
                <>
                  Тариф <span className="font-semibold text-slate-900 dark:text-white">«{subStatus.planName}»</span>
                  <span className="text-slate-400 dark:text-slate-500"> · </span>
                  осталось {subStatus.daysLeft} {daysWord(subStatus.daysLeft)}
                </>
              )}
            </p>
            {subStatus.expired || subStatus.isWarning ? (
              <button
                onClick={scrollToPlans}
                className="shrink-0 rounded-full bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
              >
                Продлить
              </button>
            ) : (
              <span className="w-2" />
            )}
          </div>
        </div>
      )}

      {/* Срок оплаты */}
      <div className="flex justify-center px-2">
        <div
          role="tablist"
          aria-label="Срок оплаты"
          className="grid w-full max-w-md grid-cols-4 gap-1 rounded-2xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800/60 p-1 shadow-sm"
        >
          {([1, 3, 6, 12] as const).map((m) => {
            const active = duration === m;
            const pct = Math.round(getDiscount(m) * 100);
            return (
              <button
                key={m}
                role="tab"
                aria-selected={active}
                onClick={() => setDuration(m)}
                className={`flex min-h-[46px] flex-col items-center justify-center rounded-xl px-1 text-sm font-semibold transition-colors ${
                  active
                    ? 'bg-slate-900 text-white shadow-sm dark:bg-white dark:text-slate-900'
                    : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                <span>{m} мес.</span>
                {pct > 0 && (
                  <span className={`text-[10px] font-medium leading-tight ${active ? 'opacity-60' : 'text-slate-400 dark:text-slate-500'}`}>
                    −{pct}%
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Тарифы */}
      <div id="tariff-plans" className="mx-auto grid max-w-7xl grid-cols-1 gap-4 px-2 md:grid-cols-2 xl:grid-cols-4 lg:gap-5 scroll-mt-6">
        {plans.map((plan) => {
          // Базовую цену берём с сервера, встроенная в массив — только запасной вариант.
          const basePrice = getBasePrice(plan.key, plan.basePrice);
          const monthlyPrice = calculatePrice(basePrice);
          const totalPrice = monthlyPrice * duration;

          // План совпадает с текущим и подписка активна / истекла
          const isCurrentPlan = !subStatus.expired && user?.subscription?.plan === plan.key;
          const isExpiredPlan = subStatus.expired && user?.subscription?.plan === plan.key;

          // Три вида карточки: обычная, графитовая («Популярный») и золотая
          // («Бизнес Pro» — старший тариф узнаётся по цвету, как и раньше).
          const look = plan.gold ? 'gold' : plan.featured ? 'dark' : 'plain';
          const tone = {
            plain: {
              card: 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200 hover:shadow-md dark:bg-slate-800/40 dark:text-white dark:ring-slate-700/70',
              muted: 'text-slate-500 dark:text-slate-400',
              pill: 'bg-slate-100 text-slate-700 dark:bg-slate-700/60 dark:text-slate-200',
              divider: 'bg-slate-100 dark:bg-slate-700/60',
              tick: 'text-slate-400 dark:text-slate-500',
              feature: 'text-slate-600 dark:text-slate-300',
            },
            dark: {
              card: 'bg-slate-900 text-white shadow-xl shadow-slate-900/10 ring-1 ring-slate-900 dark:bg-slate-800 dark:ring-slate-500/60',
              muted: 'text-slate-400',
              pill: 'bg-white/10 text-white ring-1 ring-inset ring-white/15',
              divider: 'bg-white/10',
              tick: 'text-white/50',
              feature: 'text-slate-200',
            },
            gold: {
              // Те же оттенки, что были у карточки раньше: светлее amber-500 белый текст хуже читается
              card: 'bg-gradient-to-br from-amber-600 to-amber-500 text-white shadow-xl shadow-amber-600/20 ring-1 ring-amber-500/60 dark:shadow-amber-900/30',
              muted: 'text-amber-50/85',
              pill: 'bg-white/20 text-white ring-1 ring-inset ring-white/30',
              divider: 'bg-white/25',
              tick: 'text-white/80',
              feature: 'text-white',
            },
          }[look];
          const muted = tone.muted;

          const badge = isCurrentPlan
            ? { label: 'Ваш тариф', dot: look === 'gold' ? 'bg-white' : 'bg-emerald-400' }
            : isExpiredPlan
              ? { label: 'Истёк', dot: look === 'gold' ? 'bg-white' : 'bg-amber-400' }
              : plan.badge
                ? { label: plan.badge, dot: '' }
                : null;

          const button = look === 'gold'
            ? 'bg-white text-amber-700 hover:bg-amber-50'
            : look === 'dark'
              ? 'bg-white text-slate-900 hover:bg-slate-100'
              : isCurrentPlan || isExpiredPlan
                ? 'bg-slate-900 text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200'
                : 'text-slate-900 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 dark:text-white dark:ring-slate-600 dark:hover:bg-slate-700/50';

          return (
            <article
              key={plan.key}
              data-testid={`plan-${plan.key}`}
              className={`relative flex flex-col rounded-3xl p-6 sm:p-7 transition-shadow ${tone.card}`}
            >
              <div className="flex min-h-[28px] items-center justify-between gap-3">
                <h3 className="text-lg font-semibold tracking-tight">{plan.name}</h3>
                {badge && (
                  <span
                    className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold ${tone.pill}`}
                  >
                    {badge.dot && <span className={`h-1.5 w-1.5 rounded-full ${badge.dot}`} />}
                    {badge.label}
                  </span>
                )}
              </div>
              <p className={`mt-1 text-sm ${muted}`}>{plan.tagline}</p>

              <div className="mt-6">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-4xl font-bold tracking-tight tabular-nums">{rub(monthlyPrice)}</span>
                  <span className={`text-sm font-medium ${muted}`}>₽ / мес</span>
                </div>
                <p className={`mt-1.5 min-h-[16px] text-xs tabular-nums ${muted}`}>
                  {duration > 1 ? (
                    <>
                      {basePrice > monthlyPrice && <span className="mr-1.5 line-through opacity-70">{rub(basePrice)} ₽</span>}
                      {rub(totalPrice)} ₽ за {duration} мес.
                    </>
                  ) : (
                    'Оплата за месяц'
                  )}
                </p>
              </div>

              {/* Продлевать активный тариф можно — кнопка доступна всегда */}
              <button
                onClick={() => handleSelectPlan(plan.name, plan.key, monthlyPrice, basePrice)}
                className={`mt-6 w-full rounded-xl py-3 text-sm font-semibold transition-colors ${button}`}
              >
                {isCurrentPlan || isExpiredPlan ? 'Продлить' : 'Выбрать'}
              </button>

              <div className={`my-6 h-px ${tone.divider}`} />

              {/* Подпись есть у всех карточек — списки начинаются на одной высоте */}
              <p className={`mb-3 text-xs font-medium ${muted}`}>
                {plan.includes ? `Всё из «${plan.includes}», а также:` : 'Что входит:'}
              </p>
              <ul className="space-y-3">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex gap-3 text-sm leading-snug">
                    <Tick className={tone.tick} />
                    <span className={tone.feature}>{feature}</span>
                  </li>
                ))}
              </ul>
            </article>
          );
        })}
      </div>

      <p className="flex items-center justify-center gap-2 px-4 text-center text-xs text-slate-400 dark:text-slate-500">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
             strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
          <rect x="4" y="11" width="16" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
        Оплата через защищённый шлюз ЮKassa. Тариф включается автоматически после оплаты.
      </p>

      {/* Confirmation Modal */}
      {confirmData && (
        <ModalPortal>
          <div className="fixed inset-0 z-modal flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in" onClick={() => !loading && setConfirmData(null)}>
              <div className="bg-white dark:bg-slate-800 w-full max-w-sm rounded-3xl shadow-2xl ring-1 ring-slate-200 dark:ring-slate-700 p-6 relative overflow-hidden" onClick={e => e.stopPropagation()}>

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
                          className="mt-0.5 w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-slate-900 focus:ring-slate-500"
                        />
                        <span className={`text-xs font-medium ${downgrade.hasCritical ? 'text-rose-900 dark:text-rose-300' : 'text-amber-900 dark:text-amber-300'}`}>
                          Я понимаю, что перечисленное отключится, и хочу перейти на этот тариф
                        </span>
                      </label>
                    </div>
                  )}

                  <div className="bg-slate-50 dark:bg-slate-900/40 p-4 rounded-2xl space-y-3 border border-slate-100 dark:border-slate-700 mb-6">
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
                          <span className="tabular-nums">{confirmData.monthlyPrice.toLocaleString('ru-RU')} ₽</span>
                      </div>
                      {confirmData.basePrice > confirmData.monthlyPrice && (
                          <div className="flex justify-between items-center text-xs text-slate-500 dark:text-slate-400 font-medium">
                              {/* Процент берём из тарифной сетки, а не пересчитываем обратно из цены:
                                  месячная цена округляется вверх (Math.ceil), и обратный расчёт давал
                                  дробь вида «4.94949494949495%» прямо в окне оплаты. */}
                              <span>Скидка ({getDiscount(duration) * 100}%)</span>
                              <span className="tabular-nums">−{(confirmData.basePrice * duration - confirmData.monthlyPrice * duration).toLocaleString('ru-RU')} ₽</span>
                          </div>
                      )}
                      <div className="flex justify-between items-end pt-2">
                          <span className="text-slate-800 dark:text-white font-bold">Итого к оплате:</span>
                          <span className="text-2xl font-bold tracking-tight tabular-nums text-slate-900 dark:text-white">{(confirmData.monthlyPrice * duration).toLocaleString('ru-RU')} ₽</span>
                      </div>
                  </div>

                  <div className="space-y-3">
                      <button
                          onClick={proceedToPayment}
                          // Кнопка неактивна, пока человек не подтвердил, что видел список потерь.
                          disabled={!!loading || (!!downgrade && !downgradeAccepted)}
                          className="w-full py-3.5 bg-slate-900 text-white dark:bg-white dark:text-slate-900 rounded-xl font-semibold hover:bg-slate-800 dark:hover:bg-slate-200 transition-colors flex justify-center items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                          {loading ? (
                              <>
                                  <svg className="animate-spin h-5 w-5 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
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
                      <span className="text-[10px] text-slate-400 dark:text-slate-500">Защищённый платёж · ЮKassa</span>
                  </div>
              </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
};

export default Tariffs;
