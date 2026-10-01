import React, { useEffect, useRef, useState } from 'react';
import { PLAN_CATALOG, DURATION_DISCOUNTS } from '../src/planCatalog';

/**
 * Лендинг rassrochka.pro.
 *
 * Говорим только то, что приложение действительно умеет: прежняя версия
 * обещала «двухфакторную аутентификацию» и «тысячи компаний», которых нет, и
 * держала свои черновики политики и согласия — теперь ссылки ведут на
 * настоящие документы (/privacy, /offer, /agreement, /client-data).
 *
 * Цены — с сервера (/api/payment/pricing), описание тарифов — общее с экраном
 * «Тарифы» в приложении (src/planCatalog.ts).
 */

// 🎁 Переход в приложение с сохранением кода приглашения. Ссылка вида
// rassrochka.pro/?ref=КОД открывает лендинг, а «Войти» — это полная перезагрузка
// на /app, при которой параметр терялся бы вместе с приглашением.
const appHref = () => {
  try {
    const ref = new URLSearchParams(window.location.search).get('ref')
      || localStorage.getItem('pending_referral');
    return ref ? `/app?ref=${encodeURIComponent(ref)}` : '/app';
  } catch { return '/app'; }
};

const TRIAL_DAYS = 3; // как при регистрации на сервере (server/index.js)

const Icon: React.FC<{ d: React.ReactNode; size?: number; className?: string }> = ({ d, size = 22, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>{d}</svg>
);

const I = {
  contract: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M8 13h8M8 17h5" /></>,
  investors: <><path d="M3 3v18h18" /><path d="m7 15 4-4 3 3 5-6" /></>,
  whatsapp: <><path d="M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 21l2.1-5.4A8.4 8.4 0 1 1 21 11.5z" /><path d="M9 9.5c.3 1.6 1.9 3.6 4 4.3l1.2-1 1.8.8-.4 1.6c-3.4.4-7-3.3-6.8-6.4l1.5-.5.9 1.7z" /></>,
  wallet: <><path d="M20 7H5a2 2 0 0 1 0-4h13v4" /><path d="M3 5v14a2 2 0 0 0 2 2h15v-6" /><path d="M16 12h5v4h-5a2 2 0 0 1 0-4z" /></>,
  team: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" /></>,
  shop: <><path d="M3 9 4.5 4h15L21 9" /><path d="M4 9v11h16V9" /><path d="M3 9h18" /><path d="M9 20v-6h6v6" /></>,
  offline: <><path d="M2 8.8a15 15 0 0 1 20 0" /><path d="M5 12.5a10 10 0 0 1 14 0" /><path d="M8.5 16a5 5 0 0 1 7 0" /><path d="M12 19.5h.01" /></>,
  reports: <><path d="M18 20V10M12 20V4M6 20v-6" /></>,
  api: <><path d="m16 18 6-6-6-6" /><path d="m8 6-6 6 6 6" /></>,
  check: <path d="M20 6 9 17l-5-5" />,
  arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
  android: <><path d="M5 10h14v8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z" /><path d="M7.5 10a4.5 4.5 0 0 1 9 0" /><path d="m8 4.5 1.3 2M16 4.5l-1.3 2" /></>,
  windows: <><path d="M3 5.5 10.5 4.5v7H3z" /><path d="M13 4.1 21 3v8.5h-8z" /><path d="M3 13h7.5v7L3 19z" /><path d="M13 13h8v8l-8-1.1z" /></>,
  apple: <><path d="M15.5 3c.2 1.4-.4 2.6-1.2 3.4-.8.8-1.9 1.3-3 1.2-.1-1.3.5-2.6 1.3-3.3.8-.8 2-1.3 2.9-1.3z" /><path d="M19.5 16.6c-.5 1.2-.8 1.7-1.5 2.8-1 1.4-2.3 3.2-4 3.2-1.5 0-1.9-1-3.9-1s-2.5 1-4 1c-1.7 0-2.9-1.6-3.9-3.1C-.1 15.5.5 10 3.6 8.4c1.1-.6 2.4-.9 3.5-.9 1.6 0 2.6 1 3.9 1s2.1-1 3.9-1c1.4 0 2.9.8 3.9 2.1-3.4 1.9-2.8 6.6.7 7z" /></>,
  share: <><path d="M12 3v12" /><path d="m7 8 5-5 5 5" /><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" /></>,
  plus: <><rect x="4" y="4" width="16" height="16" rx="4" /><path d="M12 8v8M8 12h8" /></>,
  chevron: <path d="m6 9 6 6 6-6" />,
};

const FEATURES: { icon: React.ReactNode; title: string; text: string; tone: string; plan?: string }[] = [
  {
    icon: I.contract, tone: 'from-indigo-500 to-violet-500',
    title: 'Договоры и графики платежей',
    text: 'Первый взнос, срок и наценка — график считается сам. Просрочки видны сразу, платёж принимается в два касания, договор печатается в PDF.',
  },
  {
    icon: I.investors, tone: 'from-emerald-500 to-teal-500',
    title: 'Прибыль инвесторов — честно и сразу',
    text: 'У каждого инвестора свой счёт и процент. В общей кассе прибыль делится по вложенной сумме и проценту каждого — без таблиц и ручных расчётов.',
  },
  {
    icon: I.whatsapp, tone: 'from-green-500 to-emerald-500',
    title: 'Напоминания в WhatsApp',
    text: 'Клиенты получают напоминание о платеже автоматически — по шаблону, который вы настроите.',
  },
  {
    icon: I.wallet, tone: 'from-sky-500 to-indigo-500',
    title: 'Касса и расходы',
    text: 'Счета, приход, расход и переводы. Остаток по каждому счёту сходится с тем, что в кассе.',
  },
  {
    icon: I.team, tone: 'from-amber-500 to-orange-500', plan: 'Бизнес',
    title: 'Сотрудники и права',
    text: 'Отдельный вход для каждого, права на создание, правку и удаление. Видно, кто что оформил, — можно назначить премию от прибыли.',
  },
  {
    icon: I.shop, tone: 'from-fuchsia-500 to-pink-500', plan: 'Бизнес Pro',
    title: 'Магазин и склад',
    text: 'Продажи за наличные и в долг, касса с чеком, остатки по складам, приход от поставщиков и инвентаризация.',
  },
  {
    icon: I.offline, tone: 'from-slate-500 to-slate-700',
    title: 'Работает и без интернета',
    text: 'Записи сохраняются на устройстве и уходят на сервер, как только связь вернётся.',
  },
  {
    icon: I.reports, tone: 'from-rose-500 to-orange-500',
    title: 'Отчёты и выгрузка',
    text: 'Прибыль, долги и поступления за любой период. Выгрузка в Excel и резервная копия на почту.',
  },
  {
    icon: I.api, tone: 'from-cyan-500 to-blue-500', plan: 'Бизнес',
    title: 'API для интеграций',
    text: 'Подключите сайт, бота или 1С к своим данным по ключу — с документацией и примерами.',
  },
];

const STEPS = [
  { title: 'Зарегистрируйтесь', text: `Первые ${TRIAL_DAYS} дня — бесплатно. Карта не нужна.` },
  { title: 'Перенесите базу', text: 'Добавьте клиентов и договоры вручную или загрузите из Excel.' },
  { title: 'Принимайте платежи', text: 'Приложение напомнит клиентам, сведёт кассу и посчитает прибыль.' },
];

const SCREENS = [
  { id: 'dashboard', label: 'Главная', img: '/screens/dashboard.png', text: 'Долги, просрочки, поступления и касса — на одном экране.' },
  { id: 'contracts', label: 'Договоры', img: '/screens/contracts.png', text: 'Все договоры с остатком, статусом и ближайшим платежом.' },
  { id: 'customers', label: 'Клиенты', img: '/screens/customers.png', text: 'Карточка клиента: договоры, платежи, документы и заметки.' },
];

const FAQ = [
  {
    q: 'Нужна ли карта для пробного периода?',
    a: `Нет. Первые ${TRIAL_DAYS} дня бесплатно — регистрация только по email. Оплата понадобится, когда выберете тариф.`,
  },
  {
    q: 'Что будет, когда подписка закончится?',
    a: 'Все данные сохранятся. Пока подписка не продлена, нельзя оформлять договоры и проводить платежи — просматривать всё можно.',
  },
  {
    q: 'Можно ли работать без интернета?',
    a: 'Да. Записи сохраняются на устройстве и отправляются на сервер, как только связь вернётся.',
  },
  {
    q: 'Как работают сотрудники и инвесторы?',
    a: 'У каждого свой вход. Сотруднику вы задаёте права и счета, к которым он допущен. Инвестор видит только свои договоры и операции.',
  },
  {
    q: 'Как перенести данные из таблиц?',
    a: 'В настройках есть импорт из Excel: клиенты, договоры и инвесторы загружаются из файла.',
  },
  {
    q: 'Как оплатить и удалить аккаунт?',
    a: 'Оплата — картой через ЮKassa, тариф включается сразу. Удалить аккаунт со всеми данными можно в настройках в любой момент.',
  },
];

// Плавное появление блоков при прокрутке
const useReveal = () => {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
    if (typeof IntersectionObserver === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      els.forEach(el => el.classList.add('is-visible'));
      return;
    }
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('is-visible'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    els.forEach(el => io.observe(el));
    return () => io.disconnect();
  }, []);
};

const rub = (n: number) => n.toLocaleString('ru-RU');

export default function Landing() {
  const [scrolled, setScrolled] = useState(false);
  const [screen, setScreen] = useState(SCREENS[0].id);
  const [months, setMonths] = useState<1 | 3 | 6 | 12>(1);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [discounts, setDiscounts] = useState<Record<number, number>>(DURATION_DISCOUNTS);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const href = useRef(appHref()).current;

  useReveal();

  // Ссылка вида rassrochka.pro/#pricing: браузер ищет раздел до того, как React
  // его отрисовал, и остаётся вверху. Докручиваем сами, когда разметка готова.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id) return;
    const timer = setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }), 60);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Цены — с сервера: он же их и списывает. Не ответил — показываем каталог.
  useEffect(() => {
    fetch('/api/payment/pricing')
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (data?.prices) setPrices(data.prices);
        if (data?.discounts) setDiscounts(Object.fromEntries(Object.entries(data.discounts).map(([k, v]) => [Number(k), Number(v)])));
      })
      .catch(() => { /* остаются цены каталога */ });
  }, []);

  const current = SCREENS.find(s => s.id === screen) || SCREENS[0];

  return (
    <div className="landing min-h-screen bg-[#f7f8fb] dark:bg-[#0b1020] text-slate-900 dark:text-white antialiased selection:bg-indigo-200/70 dark:selection:bg-indigo-500/40">
      <style>{`
        .landing [data-reveal] { opacity: 0; transform: translateY(24px); transition: opacity .8s cubic-bezier(.2,.8,.2,1), transform .8s cubic-bezier(.2,.8,.2,1); }
        .landing [data-reveal].is-visible { opacity: 1; transform: none; }
        .landing [data-reveal-delay="1"] { transition-delay: .08s; } .landing [data-reveal-delay="2"] { transition-delay: .16s; }
        .landing [data-reveal-delay="3"] { transition-delay: .24s; } .landing [data-reveal-delay="4"] { transition-delay: .32s; }
        @keyframes landing-float { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-10px) } }
        .landing .float-a { animation: landing-float 7s ease-in-out infinite; }
        .landing .float-b { animation: landing-float 8s ease-in-out 1.2s infinite; }
        .landing .float-c { animation: landing-float 9s ease-in-out .6s infinite; }
        .landing .grid-bg { background-image: linear-gradient(rgba(99,102,241,.07) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,.07) 1px, transparent 1px); background-size: 44px 44px; mask-image: radial-gradient(ellipse at 50% 0%, black 30%, transparent 75%); -webkit-mask-image: radial-gradient(ellipse at 50% 0%, black 30%, transparent 75%); }
        .dark .landing .grid-bg { background-image: linear-gradient(rgba(148,163,184,.07) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,.07) 1px, transparent 1px); }
        @media (prefers-reduced-motion: reduce) { .landing .float-a, .landing .float-b, .landing .float-c { animation: none; } .landing [data-reveal] { transition: none; opacity: 1; transform: none; } }
      `}</style>

      {/* ── Шапка: стеклянная капсула, как панели в приложении ── */}
      <header className="fixed inset-x-0 top-0 z-50 px-3 sm:px-6" style={{ paddingTop: 'max(12px, env(safe-area-inset-top, 0px))' }}>
        <nav className={`mx-auto max-w-6xl flex items-center gap-2 h-14 pl-3 pr-2 rounded-2xl transition-all duration-300 ${
          scrolled
            ? 'bg-white/75 dark:bg-slate-900/70 backdrop-blur-xl ring-1 ring-slate-200/70 dark:ring-white/10 shadow-[0_8px_30px_-12px_rgba(15,23,42,.25)]'
            : 'bg-transparent'
        }`}>
          <a href="/" className="flex items-center gap-2.5 mr-auto">
            <img src="/icon-192.png" alt="" className="w-8 h-8 rounded-[10px] shadow-sm" />
            <span className="text-[17px] font-bold tracking-tight">FinUchet</span>
          </a>
          <div className="hidden md:flex items-center gap-1 text-[14px] font-medium text-slate-600 dark:text-slate-300">
            {[['#features', 'Возможности'], ['#how', 'Как начать'], ['#pricing', 'Тарифы'], ['#faq', 'Вопросы'], ['/api', 'API']].map(([to, label]) => (
              <a key={to} href={to} className="px-3 py-2 rounded-xl hover:text-slate-900 dark:hover:text-white hover:bg-slate-900/5 dark:hover:bg-white/5 transition-colors">{label}</a>
            ))}
          </div>
          <a href={href} className="px-3.5 py-2 text-[14px] font-semibold text-slate-700 dark:text-slate-200 rounded-xl hover:bg-slate-900/5 dark:hover:bg-white/5 transition-colors">Войти</a>
          <a href={href} className="hidden sm:inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-[14px] font-semibold shadow-sm hover:-translate-y-px active:translate-y-0 transition-transform">
            Попробовать бесплатно
          </a>
        </nav>
      </header>

      {/* ── Первый экран ── */}
      <section className="relative overflow-hidden pt-32 sm:pt-40 pb-16 sm:pb-24 px-5">
        <div className="absolute inset-0 grid-bg pointer-events-none" />
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[900px] h-[600px] rounded-full bg-gradient-to-br from-indigo-400/25 via-violet-400/15 to-sky-300/20 dark:from-indigo-600/25 dark:via-violet-600/15 dark:to-sky-500/10 blur-3xl pointer-events-none" />

        <div className="relative mx-auto max-w-6xl grid lg:grid-cols-[1.05fr_1fr] gap-14 lg:gap-10 items-center">
          <div className="text-center lg:text-left">
            <div data-reveal className="inline-flex items-center gap-2 h-8 pl-1.5 pr-3.5 rounded-full bg-white/80 dark:bg-white/5 ring-1 ring-slate-200 dark:ring-white/10 text-[13px] font-medium text-slate-600 dark:text-slate-300 backdrop-blur">
              <span className="px-2 py-0.5 rounded-full bg-indigo-600 text-white text-[11px] font-bold">Новое</span>
              Обновили дизайн и поиск
            </div>
            <h1 data-reveal data-reveal-delay="1" className="mt-6 text-[40px] leading-[1.05] sm:text-[60px] font-extrabold tracking-[-0.035em]">
              Рассрочка под контролем —{' '}
              <span className="bg-gradient-to-r from-indigo-600 via-violet-600 to-sky-500 bg-clip-text text-transparent">от договора до прибыли</span>
            </h1>
            <p data-reveal data-reveal-delay="2" className="mt-6 text-[17px] sm:text-[19px] leading-relaxed text-slate-600 dark:text-slate-300 max-w-xl mx-auto lg:mx-0">
              Договоры и графики платежей, напоминания клиентам в WhatsApp, касса и честный расчёт прибыли инвесторов — в одном приложении.
            </p>
            <div data-reveal data-reveal-delay="3" className="mt-9 flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
              <a href={href} className="group inline-flex items-center justify-center gap-2 h-13 px-7 py-3.5 rounded-2xl bg-indigo-600 text-white text-[16px] font-semibold shadow-[0_12px_30px_-10px_rgba(79,70,229,.7)] hover:bg-indigo-500 hover:-translate-y-0.5 active:translate-y-0 transition-all">
                Попробовать бесплатно
                <Icon d={I.arrow} size={18} className="group-hover:translate-x-0.5 transition-transform" />
              </a>
              <a href="#features" className="inline-flex items-center justify-center h-13 px-7 py-3.5 rounded-2xl bg-white/80 dark:bg-white/5 ring-1 ring-slate-200 dark:ring-white/10 text-[16px] font-semibold text-slate-800 dark:text-white hover:bg-white dark:hover:bg-white/10 backdrop-blur transition-colors">
                Возможности
              </a>
            </div>
            <p data-reveal data-reveal-delay="3" className="mt-4 text-[13px] text-slate-500 dark:text-slate-400">
              {TRIAL_DAYS} дня бесплатно · без карты · оплата только при выборе тарифа
            </p>

            <div data-reveal data-reveal-delay="4" className="mt-10 flex flex-wrap items-center gap-2 justify-center lg:justify-start text-[13px]">
              <span className="text-slate-400 dark:text-slate-500 mr-1">Приложение:</span>
              <a href="/downloads/finuchet.apk" download className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-xl bg-white/70 dark:bg-white/5 ring-1 ring-slate-200 dark:ring-white/10 font-semibold hover:bg-white dark:hover:bg-white/10 transition-colors">
                <Icon d={I.android} size={16} /> Android
              </a>
              <a href="/downloads/finuchet-setup.exe" download className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-xl bg-white/70 dark:bg-white/5 ring-1 ring-slate-200 dark:ring-white/10 font-semibold hover:bg-white dark:hover:bg-white/10 transition-colors">
                <Icon d={I.windows} size={16} /> Windows
              </a>
              <a href="#iphone" className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-xl bg-white/70 dark:bg-white/5 ring-1 ring-slate-200 dark:ring-white/10 font-semibold hover:bg-white dark:hover:bg-white/10 transition-colors">
                <Icon d={I.apple} size={16} /> iPhone
              </a>
            </div>
          </div>

          {/* Витрина: настоящий экран приложения и карточки-уведомления вокруг */}
          <div id="showcase" data-reveal data-reveal-delay="2" className="relative mx-auto w-full max-w-[560px] scroll-mt-28">
            <div className="relative rounded-[22px] bg-white/80 dark:bg-slate-800/70 ring-1 ring-slate-200/80 dark:ring-white/10 shadow-[0_40px_80px_-30px_rgba(30,41,59,.45)] backdrop-blur overflow-hidden">
              <div className="flex items-center gap-1.5 h-9 px-4 border-b border-slate-200/70 dark:border-white/10">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-400" /><span className="w-2.5 h-2.5 rounded-full bg-amber-400" /><span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                <span className="ml-3 h-5 flex-1 max-w-[220px] rounded-md bg-slate-100 dark:bg-white/5 text-[10px] text-slate-400 flex items-center px-2">rassrochka.pro</span>
              </div>
              <img src="/screens/dashboard.png" alt="Главный экран FinUchet" className="w-full aspect-[16/10] object-cover object-left-top" />
            </div>

            <div className="float-a absolute -left-2 sm:-left-10 top-[22%] flex items-center gap-2.5 sm:gap-3 pl-2.5 sm:pl-3 pr-3 sm:pr-4 py-2 sm:py-2.5 rounded-2xl bg-white/90 dark:bg-slate-800/90 ring-1 ring-slate-200/70 dark:ring-white/10 shadow-xl backdrop-blur">
              <span className="w-7 h-7 sm:w-9 sm:h-9 rounded-lg sm:rounded-xl bg-emerald-100 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 flex items-center justify-center"><Icon d={I.check} size={18} /></span>
              <span><span className="block text-[10px] sm:text-[12px] text-slate-500 dark:text-slate-400">Платёж принят</span><span className="block text-[12px] sm:text-[15px] font-bold">+12 500 ₽</span></span>
            </div>
            <div className="float-b absolute -right-2 sm:-right-8 bottom-[8%] sm:bottom-auto sm:top-[48%] flex items-center gap-2.5 sm:gap-3 pl-2.5 sm:pl-3 pr-3 sm:pr-4 py-2 sm:py-2.5 rounded-2xl bg-white/90 dark:bg-slate-800/90 ring-1 ring-slate-200/70 dark:ring-white/10 shadow-xl backdrop-blur">
              <span className="w-7 h-7 sm:w-9 sm:h-9 rounded-lg sm:rounded-xl bg-green-100 dark:bg-green-500/15 text-green-600 dark:text-green-300 flex items-center justify-center"><Icon d={I.whatsapp} size={18} /></span>
              <span><span className="block text-[10px] sm:text-[12px] text-slate-500 dark:text-slate-400">Напоминание отправлено</span><span className="block text-[12px] sm:text-[15px] font-bold">WhatsApp · завтра платёж</span></span>
            </div>
            <div className="float-c absolute left-6 sm:left-10 -bottom-6 hidden sm:flex items-center gap-2.5 sm:gap-3 pl-2.5 sm:pl-3 pr-3 sm:pr-4 py-2 sm:py-2.5 rounded-2xl bg-white/90 dark:bg-slate-800/90 ring-1 ring-slate-200/70 dark:ring-white/10 shadow-xl backdrop-blur">
              <span className="w-7 h-7 sm:w-9 sm:h-9 rounded-lg sm:rounded-xl bg-indigo-100 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 flex items-center justify-center"><Icon d={I.investors} size={18} /></span>
              <span><span className="block text-[10px] sm:text-[12px] text-slate-500 dark:text-slate-400">Прибыль инвестора за месяц</span><span className="block text-[12px] sm:text-[15px] font-bold">48 300 ₽</span></span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Возможности ── */}
      <section id="features" className="scroll-mt-24 px-5 py-20 sm:py-28">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-2xl mx-auto text-center">
            <p data-reveal className="text-[13px] font-semibold uppercase tracking-[0.18em] text-indigo-600 dark:text-indigo-400">Возможности</p>
            <h2 data-reveal data-reveal-delay="1" className="mt-3 text-[32px] sm:text-[44px] leading-tight font-extrabold tracking-[-0.03em]">Всё, что нужно бизнесу на рассрочке</h2>
            <p data-reveal data-reveal-delay="2" className="mt-4 text-[17px] text-slate-600 dark:text-slate-300">Вместо тетради, таблиц и памяти — один учёт, которому можно доверять.</p>
          </div>

          <div className="mt-14 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map((f, i) => (
              <div key={f.title} data-reveal data-reveal-delay={String((i % 3) + 1)}
                   className={`group relative rounded-3xl p-6 sm:p-7 bg-white dark:bg-white/[0.04] ring-1 ring-slate-200/80 dark:ring-white/10 hover:shadow-[0_24px_50px_-28px_rgba(30,41,59,.45)] hover:-translate-y-0.5 transition-all duration-300`}>
                <span className={`inline-flex w-11 h-11 rounded-2xl bg-gradient-to-br ${f.tone} text-white items-center justify-center shadow-sm`}>
                  <Icon d={f.icon} size={21} />
                </span>
                <h3 className="mt-5 text-[19px] font-bold tracking-tight">{f.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-slate-600 dark:text-slate-300">{f.text}</p>
                {f.plan && <p className="mt-4 text-[12px] font-medium text-slate-400 dark:text-slate-500">Тариф «{f.plan}»</p>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Экраны ── */}
      <section className="px-5 pb-20 sm:pb-28">
        <div className="mx-auto max-w-6xl rounded-[32px] bg-slate-900 dark:bg-white/[0.03] ring-1 ring-slate-900 dark:ring-white/10 text-white p-6 sm:p-10 lg:p-14 overflow-hidden relative">
          <div className="absolute -right-32 -top-32 w-96 h-96 rounded-full bg-indigo-500/30 blur-3xl pointer-events-none" />
          <div className="relative grid lg:grid-cols-[0.8fr_1.2fr] gap-10 items-center">
            <div>
              <p data-reveal className="text-[13px] font-semibold uppercase tracking-[0.18em] text-indigo-300">Интерфейс</p>
              <h2 data-reveal data-reveal-delay="1" className="mt-3 text-[30px] sm:text-[40px] leading-tight font-extrabold tracking-[-0.03em]">Понятно с первого дня</h2>
              <p data-reveal data-reveal-delay="2" className="mt-4 text-[16px] text-slate-300">{current.text}</p>
              <div data-reveal data-reveal-delay="3" className="mt-7 inline-grid grid-cols-3 gap-1 p-1 rounded-2xl bg-white/10 ring-1 ring-white/10">
                {SCREENS.map(s => (
                  <button key={s.id} type="button" onClick={() => setScreen(s.id)}
                          className={`h-10 px-4 rounded-xl text-[14px] font-semibold transition-all ${screen === s.id ? 'bg-white text-slate-900 shadow' : 'text-white/70 hover:text-white'}`}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            <div data-reveal data-reveal-delay="2" className="rounded-2xl overflow-hidden ring-1 ring-white/15 shadow-2xl bg-white">
              <img key={current.id} src={current.img} alt={current.label} className="w-full aspect-[16/10] object-cover object-left-top animate-modal-fade-in" />
            </div>
          </div>
        </div>
      </section>

      {/* ── Как начать ── */}
      <section id="how" className="scroll-mt-24 px-5 pb-20 sm:pb-28">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-2xl mx-auto text-center">
            <p data-reveal className="text-[13px] font-semibold uppercase tracking-[0.18em] text-indigo-600 dark:text-indigo-400">Как начать</p>
            <h2 data-reveal data-reveal-delay="1" className="mt-3 text-[32px] sm:text-[44px] leading-tight font-extrabold tracking-[-0.03em]">Три шага — и учёт работает</h2>
          </div>
          <div className="mt-14 grid md:grid-cols-3 gap-4">
            {STEPS.map((s, i) => (
              <div key={s.title} data-reveal data-reveal-delay={String(i + 1)} className="relative rounded-3xl p-7 bg-white dark:bg-white/[0.04] ring-1 ring-slate-200/80 dark:ring-white/10">
                <span className="text-[44px] font-extrabold leading-none bg-gradient-to-br from-indigo-600 to-sky-500 bg-clip-text text-transparent">{i + 1}</span>
                <h3 className="mt-4 text-[19px] font-bold tracking-tight">{s.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-slate-600 dark:text-slate-300">{s.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Тарифы ── */}
      <section id="pricing" className="scroll-mt-24 px-5 pb-20 sm:pb-28">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-2xl mx-auto text-center">
            <p data-reveal className="text-[13px] font-semibold uppercase tracking-[0.18em] text-indigo-600 dark:text-indigo-400">Тарифы</p>
            <h2 data-reveal data-reveal-delay="1" className="mt-3 text-[32px] sm:text-[44px] leading-tight font-extrabold tracking-[-0.03em]">Платите за то, чем пользуетесь</h2>
            <p data-reveal data-reveal-delay="2" className="mt-4 text-[17px] text-slate-600 dark:text-slate-300">Начните с {TRIAL_DAYS} бесплатных дней, затем выберите тариф. Чем дольше срок — тем ниже цена за месяц.</p>
            <div data-reveal data-reveal-delay="3" className="mt-8 inline-grid grid-cols-4 gap-1 p-1 rounded-2xl bg-white dark:bg-white/5 ring-1 ring-slate-200 dark:ring-white/10">
              {([1, 3, 6, 12] as const).map(m => {
                const pct = Math.round((discounts[m] || 0) * 100);
                return (
                  <button key={m} type="button" onClick={() => setMonths(m)}
                          className={`min-w-[72px] h-11 px-3 rounded-xl text-[14px] font-semibold transition-all flex flex-col items-center justify-center leading-tight ${
                            months === m ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow' : 'text-slate-600 dark:text-slate-300'
                          }`}>
                    {m} мес.
                    {pct > 0 && <span className={`text-[10px] font-medium ${months === m ? 'opacity-70' : 'text-emerald-600 dark:text-emerald-400'}`}>−{pct}%</span>}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-12 grid md:grid-cols-2 xl:grid-cols-4 gap-4">
            {PLAN_CATALOG.map((p, i) => {
              const base = prices[p.key] || p.basePrice;
              const monthly = Math.ceil(base * (1 - (discounts[months] || 0)));
              const dark = p.featured;
              return (
                <div key={p.key} data-reveal data-reveal-delay={String((i % 4) + 1)}
                     className={`relative flex flex-col rounded-3xl p-6 ${
                       dark
                         ? 'bg-slate-900 text-white ring-1 ring-slate-900 shadow-[0_30px_60px_-30px_rgba(15,23,42,.8)] dark:bg-indigo-600 dark:ring-indigo-500'
                         : p.gold
                           ? 'bg-gradient-to-b from-amber-50 to-white ring-1 ring-amber-200 dark:from-amber-500/10 dark:to-transparent dark:ring-amber-500/30'
                           : 'bg-white ring-1 ring-slate-200/80 dark:bg-white/[0.04] dark:ring-white/10'
                     }`}>
                  <div className="flex items-center justify-between">
                    <h3 className="text-[18px] font-bold">{p.name}</h3>
                    {p.badge && <span className="px-2.5 py-1 rounded-full bg-white/15 text-[11px] font-semibold">{p.badge}</span>}
                  </div>
                  <p className={`mt-1 text-[14px] ${dark ? 'text-white/70' : 'text-slate-500 dark:text-slate-400'}`}>{p.tagline}</p>
                  <div className="mt-6 flex items-baseline gap-1">
                    <span className="text-[38px] font-extrabold tracking-tight tabular-nums">{rub(monthly)}</span>
                    <span className={`text-[14px] font-medium ${dark ? 'text-white/70' : 'text-slate-500 dark:text-slate-400'}`}>₽ / мес</span>
                  </div>
                  <p className={`mt-1 min-h-[18px] text-[12px] tabular-nums ${dark ? 'text-white/60' : 'text-slate-400 dark:text-slate-500'}`}>
                    {months > 1 ? `${rub(monthly * months)} ₽ за ${months} мес.` : 'Оплата помесячно'}
                  </p>
                  <a href={href}
                     className={`mt-6 h-11 rounded-xl flex items-center justify-center text-[15px] font-semibold transition-colors ${
                       dark ? 'bg-white text-slate-900 hover:bg-slate-100' : 'bg-slate-900 text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200'
                     }`}>
                    Начать с пробного периода
                  </a>
                  <div className={`my-6 h-px ${dark ? 'bg-white/15' : 'bg-slate-200/80 dark:bg-white/10'}`} />
                  <p className={`mb-3 text-[12px] font-medium ${dark ? 'text-white/60' : 'text-slate-500 dark:text-slate-400'}`}>
                    {p.includes ? `Всё из «${p.includes}», а также:` : 'Что входит:'}
                  </p>
                  <ul className="space-y-2.5">
                    {p.features.map(f => (
                      <li key={f} className="flex gap-2.5 text-[14px] leading-snug">
                        <Icon d={I.check} size={16} className={`mt-[2px] shrink-0 ${dark ? 'text-emerald-300' : 'text-emerald-500'}`} />
                        <span className={dark ? 'text-white/90' : 'text-slate-700 dark:text-slate-200'}>{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
          <p className="mt-6 text-center text-[13px] text-slate-500 dark:text-slate-400">Оплата картой через ЮKassa. Тариф включается сразу после оплаты.</p>
        </div>
      </section>

      {/* ── iPhone ── */}
      <section id="iphone" className="scroll-mt-24 px-5 pb-20 sm:pb-28">
        <div className="mx-auto max-w-4xl rounded-[32px] p-8 sm:p-12 bg-gradient-to-br from-indigo-600 via-violet-600 to-indigo-700 text-white relative overflow-hidden shadow-[0_40px_80px_-40px_rgba(79,70,229,.8)]">
          <div className="absolute -right-24 -bottom-24 w-80 h-80 rounded-full bg-white/10 blur-2xl pointer-events-none" />
          <div className="relative grid sm:grid-cols-[1fr_auto] gap-8 items-center">
            <div>
              <span className="inline-flex w-11 h-11 rounded-2xl bg-white/15 items-center justify-center"><Icon d={I.apple} size={22} /></span>
              <h2 className="mt-5 text-[28px] sm:text-[34px] leading-tight font-extrabold tracking-[-0.03em]">На iPhone — как приложение</h2>
              <p className="mt-3 text-[16px] text-indigo-100">Откройте сайт в Safari и добавьте FinUchet на экран «Домой» — он запускается как обычное приложение, во весь экран.</p>
            </div>
            <ol className="space-y-3 text-[15px]">
              {[
                [I.share, 'Нажмите «Поделиться» в Safari'],
                [I.plus, 'Выберите «На экран „Домой“»'],
                [I.check, 'Откройте FinUchet с экрана'],
              ].map(([icon, text], i) => (
                <li key={i} className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-white/10 ring-1 ring-white/15 backdrop-blur">
                  <span className="w-8 h-8 rounded-xl bg-white text-indigo-600 flex items-center justify-center shrink-0"><Icon d={icon} size={17} /></span>
                  {text as string}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* ── Вопросы ── */}
      <section id="faq" className="scroll-mt-24 px-5 pb-20 sm:pb-28">
        <div className="mx-auto max-w-3xl">
          <div className="text-center">
            <p data-reveal className="text-[13px] font-semibold uppercase tracking-[0.18em] text-indigo-600 dark:text-indigo-400">Вопросы</p>
            <h2 data-reveal data-reveal-delay="1" className="mt-3 text-[32px] sm:text-[44px] leading-tight font-extrabold tracking-[-0.03em]">Частые вопросы</h2>
          </div>
          <div data-reveal data-reveal-delay="2" className="mt-12 rounded-3xl bg-white dark:bg-white/[0.04] ring-1 ring-slate-200/80 dark:ring-white/10 divide-y divide-slate-200/80 dark:divide-white/10 overflow-hidden">
            {FAQ.map((f, i) => {
              const open = openFaq === i;
              return (
                <div key={f.q}>
                  <button type="button" onClick={() => setOpenFaq(open ? null : i)} aria-expanded={open}
                          className="w-full flex items-center justify-between gap-4 px-6 py-5 text-left">
                    <span className="text-[16px] font-semibold">{f.q}</span>
                    <Icon d={I.chevron} size={20} className={`shrink-0 text-slate-400 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
                  </button>
                  <div className="grid transition-[grid-template-rows] duration-300 ease-out" style={{ gridTemplateRows: open ? '1fr' : '0fr' }}>
                    <div className="overflow-hidden">
                      <p className="px-6 pb-5 -mt-1 text-[15px] leading-relaxed text-slate-600 dark:text-slate-300">{f.a}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Финальный призыв ── */}
      <section className="px-5 pb-20 sm:pb-28">
        <div data-reveal className="mx-auto max-w-6xl rounded-[32px] p-10 sm:p-16 text-center bg-white dark:bg-white/[0.04] ring-1 ring-slate-200/80 dark:ring-white/10 relative overflow-hidden">
          <div className="absolute inset-0 grid-bg pointer-events-none" />
          <div className="relative">
            <h2 className="text-[32px] sm:text-[48px] leading-tight font-extrabold tracking-[-0.035em]">Наведите порядок в рассрочке</h2>
            <p className="mt-4 text-[17px] text-slate-600 dark:text-slate-300">{TRIAL_DAYS} дня бесплатно. Без карты. Данные — ваши: выгрузка в Excel в любой момент.</p>
            <a href={href} className="group mt-9 inline-flex items-center gap-2 h-13 px-8 py-4 rounded-2xl bg-indigo-600 text-white text-[16px] font-semibold shadow-[0_12px_30px_-10px_rgba(79,70,229,.7)] hover:bg-indigo-500 hover:-translate-y-0.5 transition-all">
              Попробовать бесплатно
              <Icon d={I.arrow} size={18} className="group-hover:translate-x-0.5 transition-transform" />
            </a>
          </div>
        </div>
      </section>

      {/* ── Подвал ── */}
      <footer className="px-5 pb-10" style={{ paddingBottom: 'max(40px, env(safe-area-inset-bottom, 0px))' }}>
        <div className="mx-auto max-w-6xl pt-10 border-t border-slate-200/80 dark:border-white/10 grid gap-8 sm:grid-cols-[1.2fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <img src="/icon-192.png" alt="" className="w-8 h-8 rounded-[10px]" />
              <span className="text-[17px] font-bold tracking-tight">FinUchet</span>
            </div>
            <p className="mt-3 text-[14px] text-slate-500 dark:text-slate-400 max-w-xs">Учёт рассрочки, кассы и прибыли инвесторов для небольшого бизнеса.</p>
          </div>
          <div className="text-[14px] space-y-2.5">
            <p className="font-semibold">Продукт</p>
            {[['#features', 'Возможности'], ['#pricing', 'Тарифы'], ['/api', 'API и документация'], [href, 'Войти']].map(([to, label]) => (
              <a key={label} href={to} className="block text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors">{label}</a>
            ))}
          </div>
          <div className="text-[14px] space-y-2.5">
            <p className="font-semibold">Документы</p>
            {[['/offer', 'Публичная оферта'], ['/privacy', 'Политика конфиденциальности'], ['/agreement', 'Согласие на обработку данных'], ['/client-data', 'Данные клиентов']].map(([to, label]) => (
              <a key={to} href={to} className="block text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors">{label}</a>
            ))}
          </div>
        </div>
        <p className="mx-auto max-w-6xl mt-10 text-[13px] text-slate-400 dark:text-slate-500">© {new Date().getFullYear()} FinUchet · rassrochka.pro</p>
      </footer>
    </div>
  );
}
