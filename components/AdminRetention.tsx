import React, { useEffect, useMemo, useState } from 'react';
import Sheet from './Sheet';
import { api } from '../services/api';
import { formatRuPhone } from '../src/utils';
import { CHURN_REASON_LABELS } from '../src/churnReasons';

/**
 * «Удержание» — где пользователи отваливаются и почему.
 *
 * Сервер отдаёт по каждому владельцу аккаунта сырые факты (/api/admin/retention):
 * клиенты, договоры, платежи клиентов, оплаты подписки, когда заходил он сам и
 * его команда, обращения в поддержку, ответ на опрос. Всё остальное — группы,
 * воронка, когорты — считается здесь, чтобы правила были видны в одном месте.
 */

type RUser = {
  id: string; name: string; email: string; phone?: string | null; createdAt: string;
  subscription?: { plan: string; expiresAt: string } | null; blocked: boolean; referred: boolean;
  lastSeenAt?: string | null; lastPlatform?: string | null; teamSeenAt?: string | null; team: number;
  customers: number; sales: number; investors: number; sales30d: number;
  firstCustomerAt?: string | null; firstSaleAt?: string | null; lastWriteAt?: string | null;
  payments: number; lastPaymentAt?: string | null;
  paidCount: number; paidTotal: number; firstPaidAt?: string | null; lastPaidAt?: string | null;
  days30: number; daysTotal: number; tickets: number; lastTicketAt?: string | null;
  feedback?: { reason: string; details?: string | null; at: string } | null;
};

const DAY = 86400000;
const ts = (d?: string | null) => (d ? new Date(d).getTime() : 0);
const daysSince = (t: number) => (t ? Math.floor((Date.now() - t) / DAY) : Infinity);
const lastActive = (u: RUser) => Math.max(ts(u.lastSeenAt), ts(u.teamSeenAt), ts(u.lastWriteAt));
const expired = (u: RUser) => !u.subscription || ts(u.subscription.expiresAt) < Date.now();
const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString('ru-RU') : '—');
const ago = (t: number) => {
  const d = daysSince(t);
  if (d === Infinity) return 'не заходил';
  if (d === 0) return 'сегодня';
  if (d === 1) return 'вчера';
  if (d < 30) return `${d} дн. назад`;
  if (d < 365) return `${Math.floor(d / 30)} мес. назад`;
  return 'больше года назад';
};
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);


const PLATFORM_LABELS: Record<string, string> = {
  ios: 'iPhone', android: 'Android', mac: 'Mac', windows: 'Windows', web: 'сайт', 'mobile-web': 'сайт с телефона',
};

const PLAN_LABELS: Record<string, string> = {
  TRIAL: 'Пробный', START: 'Старт', STANDARD: 'Стандарт', BUSINESS: 'Бизнес', BUSINESS_PRO: 'Бизнес Pro',
};

// ── Группы ─────────────────────────────────────────────────────────────────
// Порядок — по тому, где человек остановился. Каждый попадает ровно в одну.
type SegmentId = 'paying' | 'fading' | 'lapsed' | 'trying' | 'paywall' | 'dropped' | 'stuck' | 'not_started' | 'new';
const SEGMENTS: { id: SegmentId; title: string; tone: string; dot: string; meaning: string; todo: string }[] = [
  { id: 'fading', title: 'Затухают', tone: 'text-amber-700 dark:text-amber-300', dot: 'bg-amber-500',
    meaning: 'Подписка оплачена, но 14+ дней никто не заходил и ничего не записывал.',
    todo: 'Это самые ценные: позвоните до конца подписки. Спросите, всё ли получается, нужна ли помощь.' },
  { id: 'lapsed', title: 'Не продлили', tone: 'text-rose-700 dark:text-rose-300', dot: 'bg-rose-500',
    meaning: 'Платили, но подписка закончилась и не продлена.',
    todo: 'Напишите лично: узнайте причину, предложите скидку на возвращение или помощь с переносом данных.' },
  { id: 'paywall', title: 'Упёрлись в оплату', tone: 'text-rose-700 dark:text-rose-300', dot: 'bg-fuchsia-500',
    meaning: 'Работали до конца пробного периода (договоры есть), но не оплатили.',
    todo: 'Им программа нужна — мешает цена или оплата. Напишите, предложите месяц «Старта» или продлите пробный на 7 дней.' },
  { id: 'trying', title: 'Пробуют сейчас', tone: 'text-indigo-700 dark:text-indigo-300', dot: 'bg-indigo-500',
    meaning: 'Пробный период, уже оформляют договоры и заходили за последнюю неделю.',
    todo: 'Горячие: за пару дней до конца пробного напомните о тарифе и спросите, всё ли понятно.' },
  { id: 'dropped', title: 'Бросили на пробном', tone: 'text-slate-700 dark:text-slate-300', dot: 'bg-slate-500',
    meaning: 'Оформили договоры, но перестали заходить задолго до конца пробного.',
    todo: 'Что-то не подошло. Спросите, чего не хватило — это прямые подсказки, что улучшать.' },
  { id: 'stuck', title: 'Застряли до договора', tone: 'text-slate-700 dark:text-slate-300', dot: 'bg-sky-500',
    meaning: 'Добавили клиента, но ни одного договора не оформили.',
    todo: 'Не поняли, как оформить договор. Пришлите ссылку на «Обучение» (rassrochka.pro/help#sale) или помогите голосом.' },
  { id: 'not_started', title: 'Не начали', tone: 'text-slate-700 dark:text-slate-300', dot: 'bg-slate-400',
    meaning: 'Зарегистрировались больше 3 дней назад и ничего не добавили.',
    todo: 'Короткое сообщение: «Помочь начать?» + ссылка на «Обучение». Большинство отваливается именно здесь.' },
  { id: 'new', title: 'Новые (до 3 дней)', tone: 'text-slate-700 dark:text-slate-300', dot: 'bg-emerald-400',
    meaning: 'Только зарегистрировались.',
    todo: 'Можно поприветствовать и предложить помощь с первым договором.' },
  { id: 'paying', title: 'Платят и работают', tone: 'text-emerald-700 dark:text-emerald-300', dot: 'bg-emerald-500',
    meaning: 'Подписка оплачена, заходили за последние 14 дней.',
    todo: 'Всё хорошо. Их можно спросить, что улучшить, и попросить отзыв или рекомендацию.' },
];

const segmentOf = (u: RUser): SegmentId => {
  const idle = daysSince(lastActive(u));
  const isExpired = expired(u);
  if (u.paidCount > 0) {
    if (isExpired) return 'lapsed';
    return idle >= 14 ? 'fading' : 'paying';
  }
  // Платных оплат нет — но тариф могли выдать вручную (не пробный и не истёк)
  if (!isExpired && u.subscription && u.subscription.plan !== 'TRIAL') return idle >= 14 ? 'fading' : 'paying';
  if (u.sales > 0) {
    const expiresAt = ts(u.subscription?.expiresAt);
    if (isExpired && lastActive(u) >= expiresAt - 3 * DAY) return 'paywall';
    if (!isExpired && idle < 7) return 'trying';
    return isExpired && idle < 7 ? 'paywall' : 'dropped';
  }
  if (u.customers > 0) return 'stuck';
  return daysSince(ts(u.createdAt)) < 3 ? 'new' : 'not_started';
};

const waLink = (u: RUser, text: string) => {
  const digits = String(u.phone || '').replace(/\D/g, '').replace(/^8(?=\d{10}$)/, '7');
  return digits.length >= 10 ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : null;
};
const messageFor = (seg: SegmentId, u: RUser) => {
  const hi = `Здравствуйте${u.name ? ', ' + u.name.split(' ')[0] : ''}! Это FinUchet (rassrochka.pro).`;
  switch (seg) {
    case 'not_started': case 'new': case 'stuck':
      return `${hi} Вы недавно зарегистрировались — помочь оформить первый договор? Короткая инструкция: https://rassrochka.pro/help`;
    case 'dropped': return `${hi} Вы пробовали программу — подскажите, пожалуйста, чего не хватило? Нам важно, сделаем лучше.`;
    case 'paywall': return `${hi} Пробный период закончился. Если нужно ещё время разобраться — продлим бесплатно на неделю.`;
    case 'lapsed': return `${hi} Подписка закончилась — всё ли было удобно? Если что-то мешало, расскажите, пожалуйста.`;
    case 'fading': return `${hi} Давно не видели вас в программе — всё ли получается? Если нужна помощь, напишите.`;
    case 'trying': return `${hi} Как вам программа? Если есть вопросы по договорам или платежам — помогу.`;
    default: return `${hi} Спасибо, что пользуетесь программой! Подскажите, что нам улучшить?`;
  }
};

interface Props {
  /** Открыть окно тарифа этого пользователя (оно живёт в AdminPanel) */
  onExtend?: (userId: string) => void;
}

const Card: React.FC<{ className?: string; children: React.ReactNode }> = ({ className = '', children }) => (
  <div className={`bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700 shadow-sm ${className}`}>{children}</div>
);

const AdminRetention: React.FC<Props> = ({ onExtend }) => {
  const [data, setData] = useState<{ trackingSince: string | null; users: RUser[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [segment, setSegment] = useState<SegmentId>('fading');
  const [query, setQuery] = useState('');
  const [cohort, setCohort] = useState<string>('all');
  const [detail, setDetail] = useState<RUser | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  const load = () => {
    setError(null);
    api.adminGetRetention().then(d => setData(d as any)).catch(e => setError(e.message || 'Ошибка загрузки'));
  };
  useEffect(load, []);

  const users = useMemo(() => (data?.users || []).filter(u => !u.blocked), [data]);
  const cohorts = useMemo(() => [...new Set(users.map(u => u.createdAt.slice(0, 7)))].sort().reverse(), [users]);
  const scoped = useMemo(() => (cohort === 'all' ? users : users.filter(u => u.createdAt.startsWith(cohort))), [users, cohort]);
  const bySegment = useMemo(() => {
    const m = new Map<SegmentId, RUser[]>(SEGMENTS.map(s => [s.id, []]));
    for (const u of scoped) m.get(segmentOf(u))!.push(u);
    for (const list of m.values()) list.sort((a, b) => lastActive(b) - lastActive(a));
    return m;
  }, [scoped]);

  if (error) return <Card className="p-6 text-center text-sm text-rose-600 dark:text-rose-400">{error} <button onClick={load} className="ml-2 underline">Повторить</button></Card>;
  if (!data) return <div className="text-center py-12 text-sm text-slate-400">Собираем данные…</div>;

  // ── Цифры ──────────────────────────────────────────────────────────────
  const n = scoped.length;
  const active7 = scoped.filter(u => daysSince(lastActive(u)) < 7).length;
  const active30 = scoped.filter(u => daysSince(lastActive(u)) < 30).length;
  const payingNow = scoped.filter(u => u.paidCount > 0 && !expired(u)).length;
  const everPaid = scoped.filter(u => u.paidCount > 0).length;
  const lapsed30 = scoped.filter(u => u.paidCount > 0 && expired(u) && daysSince(ts(u.subscription?.expiresAt)) < 30).length;
  const funnel = [
    { label: 'Зарегистрировались', v: n },
    { label: 'Добавили клиента', v: scoped.filter(u => u.customers > 0).length },
    { label: 'Оформили договор', v: scoped.filter(u => u.sales > 0).length },
    { label: 'Приняли платёж', v: scoped.filter(u => u.payments > 0).length },
    { label: '5+ договоров', v: scoped.filter(u => u.sales >= 5).length },
    { label: 'Оплатили подписку', v: everPaid },
    { label: 'Продлили', v: scoped.filter(u => u.paidCount >= 2).length },
  ];
  const reasons = Object.keys(CHURN_REASON_LABELS).map(k => ({ k, v: scoped.filter(u => u.feedback?.reason === k).length })).filter(r => r.v > 0).sort((a, b) => b.v - a.v);
  const comments = scoped.filter(u => u.feedback?.details).sort((a, b) => ts(b.feedback!.at) - ts(a.feedback!.at)).slice(0, 12);

  const seg = SEGMENTS.find(s => s.id === segment)!;
  const q = query.trim().toLowerCase();
  const list = (bySegment.get(segment) || []).filter(u => !q || `${u.name} ${u.email} ${u.phone || ''}`.toLowerCase().includes(q));

  return (
    <div className="space-y-4">
      {/* Период регистрации + памятка */}
      <div className="flex flex-wrap items-center gap-2">
        <select value={cohort} onChange={e => setCohort(e.target.value)}
                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-200">
          <option value="all">Все пользователи</option>
          {cohorts.map(c => <option key={c} value={c}>Зарегистрировались в {new Date(c + '-01').toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}</option>)}
        </select>
        <button onClick={() => setShowGuide(v => !v)}
                className="px-3 py-2 rounded-xl text-sm font-semibold bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300">
          {showGuide ? 'Скрыть памятку' : 'Что и как проверять'}
        </button>
        <button onClick={load} className="ml-auto px-3 py-2 rounded-xl text-sm text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700">Обновить</button>
      </div>

      {showGuide && (
        <Card className="p-5 text-sm leading-relaxed text-slate-600 dark:text-slate-300 space-y-2">
          <p className="font-bold text-slate-800 dark:text-white">Как пользоваться раз в неделю</p>
          <p><b>1. Воронка</b> — где больше всего теряете людей. Самый большой провал между соседними шагами — то, что чинить первым.</p>
          <p><b>2. «Затухают»</b> — звонить в первую очередь: уже платят, но перестали заходить. Удержать их проще, чем найти новых.</p>
          <p><b>3. «Упёрлись в оплату»</b> — программа нужна, мешает цена: предложите неделю пробного или «Старт».</p>
          <p><b>4. «Бросили на пробном» и «Застряли до договора»</b> — спросите, чего не хватило; ответы записывайте — это список доработок.</p>
          <p><b>5. «Почему уходят»</b> — ответы из опроса, который видят те, у кого закончилась подписка.</p>
          <p><b>6. Когорты</b> — сравнивайте месяцы: если после обновления доля «оформили договор» выросла, изменение сработало.</p>
          {data.trackingSince && <p className="text-xs text-slate-400">Посещения считаются с {fmtDate(data.trackingSince)}; до этого «последняя активность» — по последней записи данных.</p>}
        </Card>
      )}

      {/* Ключевые цифры */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { v: n, l: cohort === 'all' ? 'аккаунтов' : 'зарегистрировались', s: '' },
          { v: active7, l: 'активны за 7 дней', s: `${pct(active7, n)}%` },
          { v: active30, l: 'активны за 30 дней', s: `${pct(active30, n)}%` },
          { v: payingNow, l: 'платят сейчас', s: `оплачивали ${everPaid}` },
          { v: lapsed30, l: 'не продлили за 30 дней', s: lapsed30 ? 'стоит написать' : 'никто', warn: lapsed30 > 0 },
        ].map(c => (
          <Card key={c.l} className="p-4">
            <p className={`text-2xl font-bold tabular-nums ${c.warn ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white'}`}>{c.v}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{c.l}</p>
            {c.s && <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">{c.s}</p>}
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Воронка */}
        <Card className="p-5">
          <h3 className="font-bold text-slate-900 dark:text-white mb-1">Воронка</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">Сколько людей дошло до каждого шага и сколько потерялось по дороге</p>
          <div className="space-y-2.5">
            {funnel.map((f, i) => {
              const prev = i ? funnel[i - 1].v : f.v;
              const lost = prev - f.v;
              return (
                <div key={f.label}>
                  <div className="flex items-baseline justify-between text-sm mb-1">
                    <span className="text-slate-700 dark:text-slate-200">{f.label}</span>
                    <span className="tabular-nums">
                      <b className="text-slate-900 dark:text-white">{f.v}</b>
                      <span className="text-slate-400 ml-1.5">{pct(f.v, n)}%</span>
                      {i > 0 && lost > 0 && <span className="text-rose-500 ml-2 text-xs">−{lost}</span>}
                    </span>
                  </div>
                  <div className="h-2.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500" style={{ width: `${Math.max(2, pct(f.v, n))}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Почему уходят */}
        <Card className="p-5">
          <h3 className="font-bold text-slate-900 dark:text-white mb-1">Почему уходят</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">Ответы на опрос после окончания подписки</p>
          {reasons.length === 0 ? (
            <p className="text-sm text-slate-400">Ответов пока нет. Опрос появляется у тех, чья подписка закончилась, — первые ответы придут в ближайшие дни.</p>
          ) : (
            <div className="space-y-2.5">
              {reasons.map(r => (
                <div key={r.k}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-slate-700 dark:text-slate-200">{CHURN_REASON_LABELS[r.k]}</span>
                    <b className="tabular-nums text-slate-900 dark:text-white">{r.v}</b>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                    <div className="h-full rounded-full bg-rose-400" style={{ width: `${pct(r.v, reasons[0].v)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
          {comments.length > 0 && (
            <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-700 space-y-2 max-h-56 overflow-y-auto">
              {comments.map(u => (
                <button key={u.id} onClick={() => setDetail(u)} className="block w-full text-left text-sm">
                  <span className="text-slate-700 dark:text-slate-200">«{u.feedback!.details}»</span>
                  <span className="block text-[11px] text-slate-400">{u.name} · {CHURN_REASON_LABELS[u.feedback!.reason]} · {fmtDate(u.feedback!.at)}</span>
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Когорты */}
      {cohort === 'all' && (
        <Card className="overflow-hidden">
          <div className="p-5 pb-3">
            <h3 className="font-bold text-slate-900 dark:text-white">Когорты по месяцу регистрации</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">Какая доля каждого месяца дошла до договора, до оплаты и работает сейчас</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-700/40 text-left text-xs text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-5 py-2 font-semibold">Месяц</th>
                  <th className="px-3 py-2 font-semibold text-right">Пришли</th>
                  <th className="px-3 py-2 font-semibold text-right">Оформили договор</th>
                  <th className="px-3 py-2 font-semibold text-right">Оплатили</th>
                  <th className="px-5 py-2 font-semibold text-right">Активны за 30 дней</th>
                </tr>
              </thead>
              <tbody>
                {cohorts.slice(0, 12).map(c => {
                  const g = users.filter(u => u.createdAt.startsWith(c));
                  const cell = (v: number) => {
                    const p = pct(v, g.length);
                    return <td className="px-3 py-2 text-right tabular-nums"><span className={`inline-block min-w-[3.5rem] px-2 py-0.5 rounded-md ${p >= 50 ? 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : p >= 20 ? 'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}>{p}% <span className="opacity-60">· {v}</span></span></td>;
                  };
                  return (
                    <tr key={c} className="border-t border-slate-100 dark:border-slate-700">
                      <td className="px-5 py-2 text-slate-700 dark:text-slate-200 whitespace-nowrap">{new Date(c + '-01').toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-900 dark:text-white font-semibold">{g.length}</td>
                      {cell(g.filter(u => u.sales > 0).length)}
                      {cell(g.filter(u => u.paidCount > 0).length)}
                      {cell(g.filter(u => daysSince(lastActive(u)) < 30).length)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Группы */}
      <Card className="overflow-hidden">
        <div className="p-4 flex gap-2 overflow-x-auto no-scrollbar border-b border-slate-100 dark:border-slate-700">
          {SEGMENTS.map(s => {
            const count = bySegment.get(s.id)?.length || 0;
            return (
              <button key={s.id} onClick={() => setSegment(s.id)}
                      className={`shrink-0 flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-semibold transition ${
                        segment === s.id ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'}`}>
                <span className={`w-2 h-2 rounded-full ${s.dot}`} />
                {s.title}
                <span className="tabular-nums opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
        <div className="p-4 sm:p-5 space-y-3">
          <div className="rounded-xl bg-slate-50 dark:bg-slate-900/40 p-3.5 text-sm">
            <p className={`font-semibold ${seg.tone}`}>{seg.meaning}</p>
            <p className="text-slate-600 dark:text-slate-300 mt-1">Что делать: {seg.todo}</p>
          </div>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Поиск: имя, почта, телефон"
                 className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white outline-none focus:border-indigo-400" />
          {list.length === 0 ? (
            <p className="text-center text-sm text-slate-400 py-6">В этой группе никого</p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-700">
              {list.slice(0, 200).map(u => {
                const wa = waLink(u, messageFor(segment, u));
                const subExpired = expired(u);
                return (
                  <div key={u.id} className="py-3 flex flex-col sm:flex-row sm:items-center gap-3">
                    <button onClick={() => setDetail(u)} className="flex items-center gap-3 min-w-0 flex-1 text-left">
                      <span className="w-10 h-10 shrink-0 rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 text-white font-bold flex items-center justify-center">{(u.name || u.email).charAt(0).toUpperCase()}</span>
                      <span className="min-w-0">
                        <span className="block font-semibold text-slate-900 dark:text-white truncate">{u.name || 'Без имени'}</span>
                        <span className="block text-xs text-slate-500 dark:text-slate-400 truncate">{u.email}{u.phone ? ` · ${formatRuPhone(u.phone)}` : ''}</span>
                        <span className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                          <span>заходил: <b className="text-slate-700 dark:text-slate-200">{ago(lastActive(u))}</b>{u.lastPlatform ? ` · ${PLATFORM_LABELS[u.lastPlatform] || u.lastPlatform}` : ''}</span>
                          <span>клиентов {u.customers} · договоров {u.sales} · платежей {u.payments}</span>
                          <span>с {fmtDate(u.createdAt)}</span>
                          {u.subscription && <span className={subExpired ? 'text-rose-500' : ''}>{PLAN_LABELS[u.subscription.plan] || u.subscription.plan} {subExpired ? 'истёк' : 'до'} {fmtDate(u.subscription.expiresAt)}</span>}
                          {u.paidCount > 0 && <span className="text-emerald-600 dark:text-emerald-400">оплат {u.paidCount} · {Math.round(u.paidTotal).toLocaleString('ru-RU')} ₽</span>}
                          {u.tickets > 0 && <span>в поддержку: {u.tickets}</span>}
                          {u.feedback && <span className="text-rose-500">«{CHURN_REASON_LABELS[u.feedback.reason]}»</span>}
                        </span>
                      </span>
                    </button>
                    <div className="flex gap-2 shrink-0 sm:ml-auto">
                      {wa && <a href={wa} target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 text-white">WhatsApp</a>}
                      {u.phone && <a href={`tel:${String(u.phone).replace(/[^\d+]/g, '')}`} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200">Позвонить</a>}
                      <a href={`mailto:${u.email}`} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200">Почта</a>
                      {onExtend && <button onClick={() => onExtend(u.id)} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 text-white">Тариф</button>}
                    </div>
                  </div>
                );
              })}
              {list.length > 200 && <p className="pt-3 text-center text-xs text-slate-400">Показаны первые 200 — уточните поиском</p>}
            </div>
          )}
        </div>
      </Card>

      {detail && <UserTimeline user={detail} segment={SEGMENTS.find(s => s.id === segmentOf(detail))!} onClose={() => setDetail(null)} onExtend={onExtend} />}
    </div>
  );
};

// ── Карточка пользователя ───────────────────────────────────────────────────
const UserTimeline: React.FC<{ user: RUser; segment: typeof SEGMENTS[number]; onClose: () => void; onExtend?: (id: string) => void; preloaded?: any }> = ({ user: u, segment, onClose, onExtend, preloaded }) => {
  const [t, setT] = useState<any>(preloaded || null);
  useEffect(() => { if (!preloaded) api.adminGetUserTimeline(u.id).then(setT).catch(() => setT({ error: true })); }, [u.id, preloaded]);

  const daysAfter = (d?: string | null) => (d ? Math.max(0, Math.round((ts(d) - ts(u.createdAt)) / DAY)) : null);
  const steps = [
    { label: 'Регистрация', at: u.createdAt, note: '' },
    { label: 'Первый клиент', at: u.firstCustomerAt, note: daysAfter(u.firstCustomerAt) != null ? `через ${daysAfter(u.firstCustomerAt)} дн.` : '' },
    { label: 'Первый договор', at: u.firstSaleAt, note: daysAfter(u.firstSaleAt) != null ? `через ${daysAfter(u.firstSaleAt)} дн.` : '' },
    { label: 'Первая оплата подписки', at: u.firstPaidAt, note: daysAfter(u.firstPaidAt) != null ? `через ${daysAfter(u.firstPaidAt)} дн.` : '' },
    { label: 'Последняя активность', at: lastActive(u) ? new Date(lastActive(u)).toISOString() : null, note: ago(lastActive(u)) },
  ];
  // Сетка посещений за 90 дней
  const seen = new Set((t?.days || []).map((d: any) => d.day));
  const grid = Array.from({ length: 90 }, (_, i) => {
    const d = new Date(Date.now() - (89 - i) * DAY);
    const key = d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });
    return { key, on: seen.has(key) };
  });
  const maxMonth = Math.max(1, ...((t?.months || []).map((m: any) => m.sales)));

  return (
    <Sheet onClose={onClose} className="sm:max-w-2xl p-5 sm:p-6 max-h-[92vh] overflow-y-auto overscroll-contain">
      <div className="flex items-start gap-3">
        <span className="w-12 h-12 shrink-0 rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 text-white text-lg font-bold flex items-center justify-center">{(u.name || u.email).charAt(0).toUpperCase()}</span>
        <div className="min-w-0 flex-1">
          <h3 className="text-xl font-bold text-slate-900 dark:text-white truncate">{u.name || 'Без имени'}</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 truncate">{u.email}{u.phone ? ` · ${formatRuPhone(u.phone)}` : ''}</p>
          <p className={`text-sm font-semibold mt-1 ${segment.tone}`}>{segment.title}</p>
        </div>
        <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700">Закрыть</button>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mt-5">
        {[['клиентов', u.customers], ['договоров', u.sales], ['за 30 дн.', u.sales30d], ['платежей', u.payments], ['дней в мес.', u.days30], ['оплат', u.paidCount]].map(([l, v]) => (
          <div key={l as string} className="rounded-xl bg-slate-50 dark:bg-slate-900/40 p-2.5 text-center">
            <p className="text-lg font-bold tabular-nums text-slate-900 dark:text-white">{v as number}</p>
            <p className="text-[10px] text-slate-500 dark:text-slate-400">{l}</p>
          </div>
        ))}
      </div>

      <div className="mt-5">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">Путь</p>
        <ol className="relative border-l border-slate-200 dark:border-slate-700 ml-1.5 space-y-3">
          {steps.map(s => (
            <li key={s.label} className="pl-4 relative">
              <span className={`absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full ${s.at ? 'bg-indigo-500' : 'bg-slate-300 dark:bg-slate-600'}`} />
              <p className={`text-sm ${s.at ? 'text-slate-800 dark:text-slate-100' : 'text-slate-400'}`}>{s.label}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{s.at ? `${fmtDate(s.at)}${s.note ? ' · ' + s.note : ''}` : 'не было'}</p>
            </li>
          ))}
        </ol>
      </div>

      {!t ? <p className="text-sm text-slate-400 mt-5">Загружаем историю…</p> : t.error ? <p className="text-sm text-rose-500 mt-5">Историю загрузить не удалось</p> : (
        <>
          <div className="mt-5">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">Посещения за 90 дней{u.team ? ' (вместе с командой)' : ''}</p>
            <div className="grid grid-cols-[repeat(30,minmax(0,1fr))] gap-1">
              {grid.map(g => <span key={g.key} title={g.key} className={`aspect-square rounded-sm ${g.on ? 'bg-emerald-500' : 'bg-slate-100 dark:bg-slate-700'}`} />)}
            </div>
            <p className="text-[11px] text-slate-400 mt-1">Каждая клетка — день, зелёная — заходил. Учёт посещений идёт с момента обновления.</p>
          </div>

          {t.months.length > 0 && (
            <div className="mt-5">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">Договоры по месяцам</p>
              <div className="flex items-end gap-1.5 h-24">
                {t.months.slice(-12).map((m: any) => (
                  <div key={m.month} className="flex-1 max-w-[44px] flex flex-col items-center justify-end h-full" title={`${m.month}: договоров ${m.sales}, клиентов ${m.customers}`}>
                    <span className="text-[10px] tabular-nums text-slate-500">{m.sales || ''}</span>
                    <span className="w-full rounded-t bg-indigo-500" style={{ height: `${(m.sales / maxMonth) * 70}%`, minHeight: m.sales ? 3 : 0 }} />
                    <span className="text-[10px] text-slate-400 mt-1">{m.month.slice(5)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid sm:grid-cols-2 gap-4 mt-5">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">Оплаты подписки</p>
              {t.payments.length === 0 ? <p className="text-sm text-slate-400">Не платил</p> : t.payments.map((p: any, i: number) => (
                <p key={i} className={`text-sm ${p.refunded_at ? 'line-through text-slate-400' : 'text-slate-700 dark:text-slate-200'}`}>
                  {fmtDate(p.paid_at)} · {PLAN_LABELS[p.plan] || p.plan} · {p.months} мес. · {Number(p.amount).toLocaleString('ru-RU')} ₽
                </p>
              ))}
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">Поддержка</p>
              {t.tickets.length === 0 ? <p className="text-sm text-slate-400">Не обращался</p> : t.tickets.map((x: any) => (
                <p key={x.id} className="text-sm text-slate-700 dark:text-slate-200 truncate">{fmtDate(x.created_at)} · {x.subject}</p>
              ))}
            </div>
          </div>

          {t.team.length > 0 && (
            <div className="mt-5">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">Команда</p>
              {t.team.map((m: any) => (
                <p key={m.id} className="text-sm text-slate-700 dark:text-slate-200">
                  {m.name} · {m.role === 'employee' ? 'сотрудник' : 'инвестор'} · заходил {ago(ts(m.last_seen_at))}
                </p>
              ))}
            </div>
          )}

          {t.feedback.length > 0 && (
            <div className="mt-5 rounded-xl bg-rose-50 dark:bg-rose-500/10 p-3.5">
              <p className="text-xs font-bold uppercase tracking-wide text-rose-500 mb-1">Ответ на опрос</p>
              {t.feedback.map((f: any, i: number) => (
                <p key={i} className="text-sm text-slate-700 dark:text-slate-200">
                  <b>{CHURN_REASON_LABELS[f.reason] || f.reason}</b>{f.details ? ` — «${f.details}»` : ''} <span className="text-xs text-slate-400">{fmtDate(f.created_at)}</span>
                </p>
              ))}
            </div>
          )}
        </>
      )}

      <div className="mt-5 rounded-xl bg-slate-50 dark:bg-slate-900/40 p-3.5 text-sm text-slate-600 dark:text-slate-300">Что делать: {segment.todo}</div>
      <div className="flex flex-wrap gap-2 mt-4">
        {(() => { const wa = waLink(u, messageFor(segment.id, u)); return wa && <a href={wa} target="_blank" rel="noreferrer" className="px-4 py-2 rounded-xl text-sm font-bold bg-emerald-600 text-white">Написать в WhatsApp</a>; })()}
        <a href={`mailto:${u.email}`} className="px-4 py-2 rounded-xl text-sm font-bold bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200">Почта</a>
        {onExtend && <button onClick={() => { onClose(); onExtend(u.id); }} className="px-4 py-2 rounded-xl text-sm font-bold bg-indigo-600 text-white">Изменить тариф</button>}
      </div>
    </Sheet>
  );
};

/**
 * «История» пользователя из любого места админки (вкладка «Пользователи»):
 * по одному id грузит сводку и историю и показывает ту же карточку.
 */
export const UserHistory: React.FC<{ userId: string; onClose: () => void; onExtend?: (id: string) => void }> = ({ userId, onClose, onExtend }) => {
  const [t, setT] = useState<any>(null);
  useEffect(() => { api.adminGetUserTimeline(userId).then(setT).catch(() => setT({ error: true })); }, [userId]);
  if (!t || t.error || !t.summary) {
    return (
      <Sheet onClose={onClose} className="sm:max-w-md p-6">
        <p className="text-sm text-center text-slate-500 dark:text-slate-400 py-6">{t?.error || (t && !t.summary) ? 'Историю загрузить не удалось' : 'Загружаем историю…'}</p>
      </Sheet>
    );
  }
  return <UserTimeline user={t.summary} segment={SEGMENTS.find(s => s.id === segmentOf(t.summary))!} onClose={onClose} onExtend={onExtend} preloaded={t} />;
};

export default AdminRetention;
