import React, { useEffect, useMemo, useState } from 'react';
import type { CalculatorCategory, DownDiscount, TermRate } from '../types';
import { applyDownDiscount, calcInstallment, rateFor, scheduleDates } from '../src/calcMath';

/**
 * Публичный калькулятор рассрочки — страница, которую продавец отправляет
 * клиенту (/calc/Компания?cfg=…).
 *
 * Загружается отдельно от приложения (publicCalcEntry.tsx): клиенту не нужен
 * весь учёт, а нужна быстро открывшаяся страница. Поэтому здесь нет ни api.ts,
 * ни общего состояния приложения — один запрос настроек и чистый расчёт
 * (src/calcMath.ts, тот же, что у калькулятора продавца).
 *
 * Правила продавца — округление и «наценка на остаток» — клиенту не
 * показываются: он видит итоговые суммы, посчитанные по ним.
 */

interface Config {
  defaultRate: number;
  termRates: TermRate[];
  categories: CalculatorCategory[];
  roundStep: number;
  roundDir: 'up' | 'down';
  markupOnRemainder: boolean;
  downDiscounts: DownDiscount[];
  sellerPhone?: string;
}

const apiBase = () => {
  if (import.meta.env.DEV && import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL as string;
  const { hostname, protocol } = window.location;
  if (hostname === 'localhost' || hostname.startsWith('192.168.')) {
    return `${protocol}//${hostname === 'localhost' ? '127.0.0.1' : hostname}:5000/api`;
  }
  return '/api';
};

const money = (n: number) => Math.round(n).toLocaleString('ru-RU');
const payment = (n: number) => Number.isInteger(n)
  ? n.toLocaleString('ru-RU')
  : n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const digits = (s: string) => Number(s.replace(/\D/g, '')) || 0;
const MONTHS_RU = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const fmtDay = (d: Date) => `${d.getDate()} ${MONTHS_RU[d.getMonth()]} ${d.getFullYear()}`;
const monthsWord = (n: number) => n % 10 === 1 && n % 100 !== 11 ? 'месяц'
  : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'месяца' : 'месяцев';

/** Ссылки старого вида без cfg: ставка и правила прямо в адресе */
const legacyConfig = (q: URLSearchParams): Config => {
  let rules: TermRate[] = [];
  try {
    const full = q.get('rules');
    const short = q.get('l');
    if (full) rules = JSON.parse(decodeURIComponent(full));
    else if (short) rules = short.split(',').map(p => { const [m, r] = p.split(':').map(Number); return { months: m, rate: r }; })
      .filter(r => !isNaN(r.months) && !isNaN(r.rate));
  } catch { /* битый адрес — базовая ставка */ }
  return {
    defaultRate: parseFloat(q.get('r') || q.get('rate') || '30') || 30,
    termRates: rules, categories: [], roundStep: 100, roundDir: 'up', markupOnRemainder: false, downDiscounts: [],
  };
};

const Slider: React.FC<{ value: number; min: number; max: number; step: number; onChange: (v: number) => void; label: string }> =
  ({ value, min, max, step, onChange, label }) => {
    const pct = max > min ? Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100)) : 0;
    return (
      <input type="range" aria-label={label} min={min} max={max} step={step} value={Math.min(Math.max(value, min), max)}
             onChange={e => onChange(Number(e.target.value))}
             className="pc-range w-full mt-3"
             style={{ background: `linear-gradient(to right, #4f46e5 ${pct}%, #e2e8f0 ${pct}%)` }} />
    );
  };

const PublicCalculator: React.FC = () => {
  const q = useMemo(() => new URLSearchParams(window.location.search), []);
  const company = useMemo(() => {
    const path = window.location.pathname;
    if (path.startsWith('/calc/')) {
      const part = path.split('/')[2];
      if (part) { try { return decodeURIComponent(part); } catch { return part; } }
    }
    return q.get('c') || q.get('company') || '';
  }, [q]);

  const [config, setConfig] = useState<Config | null>(null);
  const [failed, setFailed] = useState(false);
  const [catId, setCatId] = useState<string>('');
  const [priceStr, setPriceStr] = useState('');
  const [downStr, setDownStr] = useState('');
  const [months, setMonths] = useState(0);
  const [showSchedule, setShowSchedule] = useState(false);

  useEffect(() => {
    document.title = company ? `Рассрочка — ${company}` : 'Калькулятор рассрочки';
    const cfg = q.get('cfg');
    if (!cfg) { setConfig(legacyConfig(q)); return; }
    fetch(`${apiBase()}/calculator-configs/${encodeURIComponent(cfg)}`)
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((c: any) => setConfig({
        defaultRate: Number(c.defaultRate) || 0,
        termRates: c.termRates || [],
        categories: c.categories || [],
        roundStep: Number(c.roundStep) || 0,
        roundDir: c.roundDir === 'down' ? 'down' : 'up',
        markupOnRemainder: !!c.markupOnRemainder,
        downDiscounts: c.downDiscounts || [],
        sellerPhone: c.sellerPhone || undefined,
      }))
      .catch(() => { setFailed(true); setConfig(legacyConfig(q)); });
  }, [q, company]);

  const category = config?.categories.find(c => c.id === catId) || config?.categories[0];
  const rates = category?.rates?.length ? category.rates : (config?.termRates || []);
  const fallbackRate = category?.defaultRate ?? config?.defaultRate ?? 0;
  const terms = useMemo(() => {
    const list = Array.from(new Set<number>(rates.map(r => Number(r.months)))).sort((a, b) => a - b);
    return list.length ? list : [3, 6, 9, 12];
  }, [rates]);

  // Срок — первый доступный, пока клиент не выбрал свой; при смене категории
  // выбранный срок сохраняем, если он есть и в новой
  useEffect(() => {
    if (!terms.includes(months)) setMonths(terms[Math.min(1, terms.length - 1)] ?? terms[0]);
  }, [terms]); // eslint-disable-line react-hooks/exhaustive-deps

  const price = digits(priceStr);
  const down = Math.min(digits(downStr), price);
  const baseRate = rateFor(months, rates, fallbackRate);
  // Взнос снижает наценку — по правилам продавца
  const disc = applyDownDiscount(baseRate, price, down, config?.downDiscounts);
  const rate = disc.rate;
  const result = useMemo(() => calcInstallment({
    price, down, months, rate,
    roundStep: config?.roundStep, roundDir: config?.roundDir, markupOnRemainder: config?.markupOnRemainder,
  }), [price, down, months, rate, config]);
  const has = price > 0 && months > 0;
  const dates = useMemo(() => scheduleDates(new Date(), months), [months]);
  const priceMax = Math.max(300000, Math.ceil(price * 1.5 / 50000) * 50000);
  const downPct = price > 0 ? Math.round(down / price * 100) : 0;

  const phone = config?.sellerPhone?.replace(/\D/g, '') || '';
  const waText = has
    ? [
        'Здравствуйте! Хочу оформить рассрочку.',
        category ? `Категория: ${category.name}` : '',
        `Стоимость товара: ${money(price)} ₽`,
        down > 0 ? `Первый взнос: ${money(down)} ₽` : '',
        `Срок: ${months} мес., платёж ${payment(result.monthly)} ₽ в месяц`,
      ].filter(Boolean).join('\n')
    : 'Здравствуйте! Хочу узнать подробнее о рассрочке.';
  const fmtPhone = phone.length === 11 ? phone.replace(/(\d)(\d{3})(\d{3})(\d{2})(\d{2})/, '+$1 ($2) $3-$4-$5') : phone;

  const field = 'w-full bg-slate-50 border border-slate-200 rounded-2xl pl-4 pr-10 py-3.5 text-2xl font-bold text-slate-900 outline-none focus:border-indigo-500 focus:bg-white transition-colors tabular-nums';

  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-50 via-slate-50 to-white text-slate-900">
      <div className="max-w-md mx-auto px-4 pt-6 pb-10">
        {/* Шапка */}
        <header className="mb-5">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white flex items-center justify-center font-bold text-lg shadow-md shadow-indigo-500/30">
              {(company || 'Р').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="font-bold text-slate-900 truncate">{company || 'Рассрочка'}</p>
              <p className="text-xs text-slate-500">Калькулятор рассрочки</p>
            </div>
          </div>
          <h1 className="mt-5 text-[28px] leading-tight font-extrabold tracking-tight">Рассчитайте платёж</h1>
          <p className="text-slate-500 mt-1">Без банков и скрытых платежей — все суммы сразу.</p>
        </header>

        {!config ? (
          <div className="space-y-3 animate-pulse">
            <div className="h-12 rounded-2xl bg-slate-200/70" />
            <div className="h-40 rounded-3xl bg-slate-200/70" />
            <div className="h-36 rounded-3xl bg-slate-200/70" />
          </div>
        ) : (
          <>
            {/* Категории */}
            {config.categories.length > 1 && (
              <div className="-mx-4 px-4 mb-3 flex gap-2 overflow-x-auto pb-1" role="radiogroup" aria-label="Категория товара">
                {config.categories.map(c => {
                  const on = (category?.id || '') === c.id;
                  return (
                    <button key={c.id} type="button" role="radio" aria-checked={on} onClick={() => setCatId(c.id)}
                            className={`shrink-0 px-4 py-2 rounded-full text-sm font-semibold transition-all ${on
                              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/30'
                              : 'bg-white text-slate-600 border border-slate-200 hover:border-indigo-300'}`}>
                      {c.name}
                    </button>
                  );
                })}
              </div>
            )}
            {category?.note && (
              <div className="mb-3 flex gap-2.5 items-start rounded-2xl bg-indigo-50 border border-indigo-100 px-4 py-3 text-sm text-indigo-900">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5 text-indigo-500" aria-hidden><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
                <span className="whitespace-pre-line">{category.note}</span>
              </div>
            )}

            {/* Ввод */}
            <section className="bg-white rounded-3xl shadow-sm border border-slate-100 p-5 space-y-6">
              <div>
                <label className="text-sm font-semibold text-slate-500" htmlFor="pc-price">Стоимость товара</label>
                <div className="relative mt-1.5">
                  <input id="pc-price" inputMode="numeric" autoComplete="off" placeholder="0" className={field}
                         value={price ? price.toLocaleString('ru-RU') : ''} onChange={e => setPriceStr(e.target.value)} />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xl font-bold text-slate-400">₽</span>
                </div>
                <Slider label="Стоимость товара" value={price} min={0} max={priceMax} step={1000} onChange={v => setPriceStr(String(v))} />
              </div>

              <div>
                <div className="flex items-baseline justify-between">
                  <label className="text-sm font-semibold text-slate-500" htmlFor="pc-down">Первый взнос</label>
                  {price > 0 && down > 0 && <span className="text-xs font-semibold text-indigo-600">{downPct}% от цены</span>}
                </div>
                <div className="relative mt-1.5">
                  <input id="pc-down" inputMode="numeric" autoComplete="off" placeholder="0" className={field}
                         value={down ? down.toLocaleString('ru-RU') : ''} onChange={e => setDownStr(e.target.value)} />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xl font-bold text-slate-400">₽</span>
                </div>
                <Slider label="Первый взнос" value={down} min={0} max={Math.max(0, Math.round(price * 0.9))} step={500} onChange={v => setDownStr(String(v))} />
                {price > 0 && disc.minus > 0 && (
                  <p className="mt-2 text-xs text-emerald-600 font-semibold">✓ За взнос от {disc.rule?.fromPercent}% наценка ниже</p>
                )}
                {price > 0 && disc.next && (
                  <button type="button" onClick={() => setDownStr(String(down + disc.next!.needMore))}
                          className="mt-2 block text-left text-xs text-indigo-600 font-medium hover:underline">
                    Добавьте к взносу {money(disc.next.needMore)} ₽ (до {disc.next.fromPercent}%) — наценка станет ниже
                  </button>
                )}
                {!disc.next && disc.minus === 0 && config.markupOnRemainder && price > 0 && (
                  <p className="mt-2 text-xs text-emerald-600 font-medium">Чем больше взнос, тем меньше наценка</p>
                )}
              </div>

              <div>
                <p className="text-sm font-semibold text-slate-500">Срок рассрочки</p>
                <div className="mt-2 grid grid-cols-4 gap-2">
                  {terms.map(m => (
                    <button key={m} type="button" onClick={() => setMonths(m)}
                            className={`py-2.5 rounded-xl text-sm font-bold transition-all ${months === m
                              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/30'
                              : 'bg-slate-50 text-slate-700 border border-slate-200 hover:border-indigo-300'}`}>
                      {m} мес
                    </button>
                  ))}
                </div>
              </div>
            </section>

            {/* Итог */}
            <section className="mt-4 rounded-3xl p-5 text-white bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 shadow-xl shadow-slate-900/20">
              <p className="text-sm text-slate-300">Ежемесячный платёж</p>
              <p className="mt-1 text-[40px] leading-none font-extrabold tracking-tight tabular-nums">
                {has ? payment(result.monthly) : '—'} <span className="text-2xl text-slate-400">₽</span>
              </p>
              {has && <p className="mt-2 text-sm text-slate-300">{months} {monthsWord(months)}</p>}
              <div className="mt-5 grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-white/10 p-3">
                  <p className="text-xs text-slate-300">Наценка</p>
                  <p className="text-lg font-bold tabular-nums">{has ? `${money(result.totalPayable - price)} ₽` : '—'}</p>
                </div>
                <div className="rounded-2xl bg-emerald-400/15 p-3">
                  <p className="text-xs text-emerald-200">Всего к оплате</p>
                  <p className="text-lg font-bold text-emerald-300 tabular-nums">{has ? `${money(result.totalPayable)} ₽` : '—'}</p>
                </div>
              </div>
              {has && down > 0 && (
                <p className="mt-3 text-xs text-slate-300">Из них первый взнос {money(down)} ₽ — при оформлении</p>
              )}
            </section>

            {/* График */}
            {has && (
              <section className="mt-4 bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
                <button type="button" onClick={() => setShowSchedule(v => !v)}
                        className="w-full flex items-center justify-between px-5 py-4 font-semibold">
                  <span>График платежей</span>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`text-slate-400 transition-transform ${showSchedule ? 'rotate-180' : ''}`} aria-hidden><polyline points="6 9 12 15 18 9" /></svg>
                </button>
                {showSchedule && (
                  <div className="border-t border-slate-100 divide-y divide-slate-100">
                    {down > 0 && (
                      <div className="flex justify-between px-5 py-3 text-sm">
                        <span className="text-amber-600 font-semibold">Первый взнос · сегодня</span>
                        <span className="font-bold tabular-nums">{money(down)} ₽</span>
                      </div>
                    )}
                    {dates.map((d, i) => (
                      <div key={i} className="flex justify-between px-5 py-3 text-sm">
                        <span className="text-slate-600"><span className="inline-block w-6 text-slate-400">{i + 1}</span>{fmtDay(d)}</span>
                        <span className="font-bold tabular-nums">{payment(result.monthly)} ₽</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* Связаться */}
            <div className="mt-5 space-y-2.5">
              {phone ? (
                <>
                  <a href={`https://wa.me/${phone}?text=${encodeURIComponent(waText)}`} target="_blank" rel="noopener noreferrer"
                     className="w-full py-4 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white font-bold flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/25 transition active:scale-[0.98]">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.5 2 12.04 2Zm5.8 14.06c-.24.68-1.42 1.3-1.95 1.35-.5.05-1.13.22-3.8-.79-3.2-1.26-5.26-4.53-5.42-4.74-.16-.21-1.29-1.72-1.29-3.28s.82-2.33 1.11-2.65c.29-.32.63-.4.84-.4l.6.01c.19.01.45-.07.71.54.26.63.88 2.18.96 2.34.08.16.13.34.03.55-.1.21-.16.34-.32.53-.16.18-.33.41-.48.55-.16.16-.32.33-.14.65.19.32.83 1.37 1.78 2.22 1.23 1.09 2.26 1.43 2.58 1.59.32.16.5.13.69-.08.18-.21.79-.92 1-1.24.21-.32.42-.26.71-.16.29.11 1.83.86 2.14 1.02.32.16.53.24.6.37.08.13.08.76-.16 1.44Z"/></svg>
                    {has ? 'Оформить в WhatsApp' : 'Написать в WhatsApp'}
                  </a>
                  <a href={`tel:+${phone}`}
                     className="w-full py-3.5 rounded-2xl bg-white border border-slate-200 text-slate-800 font-semibold flex items-center justify-center gap-2 hover:bg-slate-50 transition active:scale-[0.98]">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
                    Позвонить {fmtPhone}
                  </a>
                </>
              ) : null}
            </div>

            <p className="mt-6 text-center text-xs text-slate-400 leading-relaxed">
              {failed ? 'Не удалось загрузить актуальные условия — расчёт приблизительный. ' : ''}
              Расчёт предварительный. Точные условия — при оформлении{company ? ` в «${company}»` : ''}.
            </p>
          </>
        )}
      </div>
    </div>
  );
};

export default PublicCalculator;
