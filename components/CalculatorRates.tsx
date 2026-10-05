import React, { useMemo, useState } from 'react';
import type { CalculatorCategory, DownDiscount, TermRate } from '../types';

/**
 * Ставки калькулятора — таблицей: строки — сроки, столбцы — «Общие» и категории
 * товара. В ячейке — наценка за весь срок, %. Пустая ячейка — срок в этой
 * категории не предлагается (клиент его не увидит). Категория без единой
 * ставки работает по общим.
 *
 * Так все условия видны сразу и правятся прямо в ячейке — раньше это были
 * отдельные списки «срок → ставка» для каждой категории, и сравнить их можно
 * было только листая.
 */

interface Props {
  defaultRate: string;
  setDefaultRate: (v: string) => void;
  termRates: TermRate[];
  setTermRates: (v: TermRate[]) => void;
  categories: CalculatorCategory[];
  setCategories: (v: CalculatorCategory[]) => void;
  downDiscounts: DownDiscount[];
  setDownDiscounts: (v: DownDiscount[]) => void;
  dirty: boolean;
  onSave: () => void;
  onCopyLink: () => void;
  linkBusy?: boolean;
  /** Адрес ссылки: rassrochka.pro/c/<linkSlug> */
  linkSlug: string;
  setLinkSlug: (v: string) => void;
}

const QUICK_TERMS = [3, 4, 6, 9, 10, 12, 18, 24];

const upsert = (list: TermRate[], months: number, raw: string): TermRate[] => {
  const v = raw.replace(',', '.').trim();
  const rest = list.filter(r => r.months !== months);
  if (v === '' || isNaN(Number(v))) return rest;
  return [...rest, { months, rate: Number(v) }].sort((a, b) => a.months - b.months);
};

const CalculatorRates: React.FC<Props> = ({
  defaultRate, setDefaultRate, termRates, setTermRates, categories, setCategories,
  downDiscounts, setDownDiscounts, dirty, onSave, onCopyLink, linkBusy, linkSlug, setLinkSlug,
}) => {
  // Добавленные, но ещё не заполненные сроки — иначе пустая строка тут же исчезла бы
  const [extraTerms, setExtraTerms] = useState<number[]>([]);
  const [customTerm, setCustomTerm] = useState('');
  const [openCat, setOpenCat] = useState<string | null>(null);

  const terms = useMemo(() => Array.from(new Set<number>([
    ...termRates.map(r => r.months),
    ...categories.flatMap(c => c.rates.map(r => r.months)),
    ...extraTerms,
  ])).sort((a, b) => a - b), [termRates, categories, extraTerms]);

  const addTerm = (m: number) => {
    if (!(m >= 1 && m <= 60) || terms.includes(m)) return;
    setExtraTerms(prev => [...prev, m]);
  };
  const removeTerm = (m: number) => {
    setExtraTerms(prev => prev.filter(x => x !== m));
    setTermRates(termRates.filter(r => r.months !== m));
    setCategories(categories.map(c => ({ ...c, rates: c.rates.filter(r => r.months !== m) })));
  };
  const addCategory = () => {
    const id = Math.random().toString(36).slice(2, 10);
    setCategories([...categories, { id, name: '', rates: [] }]);
    setOpenCat(id);
  };
  const patchCat = (id: string, patch: Partial<CalculatorCategory>) =>
    setCategories(categories.map(c => (c.id === id ? { ...c, ...patch } : c)));
  const removeCat = (id: string) => {
    setCategories(categories.filter(c => c.id !== id));
    if (openCat === id) setOpenCat(null);
  };

  const cell = 'w-full min-w-[64px] h-10 rounded-xl text-center font-bold tabular-nums outline-none transition-colors border';
  const filled = 'bg-indigo-50 dark:bg-indigo-950/50 border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-200 focus:border-indigo-500';
  const empty = 'bg-slate-50 dark:bg-slate-900/60 border-dashed border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 placeholder:text-slate-300 dark:placeholder:text-slate-600 focus:border-indigo-400 focus:border-solid';

  return (
    <section className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden">
      {/* Шапка */}
      <div className="p-5 pb-4">
        <h3 className="text-lg font-bold text-slate-800 dark:text-white">Ставки</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Наценка за весь срок, %</p>

        {/* Ссылка для клиента — по названию компании: rassrochka.pro/c/rassrochka-plyus */}
        <div className="mt-4 p-3 rounded-2xl bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/50">
          <p className="text-[11px] font-bold uppercase tracking-wider text-indigo-500 dark:text-indigo-300 mb-2">Ссылка для клиента</p>
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0 flex items-center h-11 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 focus-within:border-indigo-400 px-3 text-sm">
              <span className="shrink-0 text-slate-400 text-[13px]">rassrochka.pro/c/</span>
              <input value={linkSlug} placeholder="из названия компании" aria-label="Адрес ссылки"
                     onChange={e => setLinkSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40))}
                     className="flex-1 min-w-0 bg-transparent outline-none font-semibold text-slate-800 dark:text-white placeholder:font-normal placeholder:text-slate-300 dark:placeholder:text-slate-600" />
            </div>
            <button type="button" onClick={onCopyLink} disabled={linkBusy}
                    title="Скопировать ссылку" aria-label="Скопировать ссылку"
                    className="shrink-0 h-11 px-3 sm:px-3.5 rounded-xl bg-indigo-600 text-white text-sm font-bold flex items-center gap-1.5 active:scale-95 transition disabled:opacity-50">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
              <span className="hidden sm:inline">Копировать</span>
            </button>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5">Латиницей, цифры и дефис. Ссылка постоянная — новые ставки клиенты видят по ней сразу.</p>
        </div>
      </div>

      {/* Таблица ставок */}
      <div className="overflow-x-auto px-5">
        <table className="w-full border-separate" style={{ borderSpacing: '0 6px' }}>
          <thead>
            <tr>
              <th className="pr-2 text-left text-[11px] font-bold uppercase tracking-wider text-slate-400 w-[88px]">Срок</th>
              <th className="px-1 text-center text-[12px] font-bold text-slate-600 dark:text-slate-300">Общие</th>
              {categories.map(c => (
                <th key={c.id} className="px-1 text-center">
                  <button type="button" onClick={() => setOpenCat(openCat === c.id ? null : c.id)}
                          className={`max-w-[120px] truncate text-[12px] font-bold px-2 py-1 rounded-lg transition-colors ${openCat === c.id
                            ? 'bg-indigo-600 text-white'
                            : 'text-indigo-600 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/40'}`}
                          title="Название и примечание">
                    {c.name.trim() || 'Без названия'} ✎
                  </button>
                </th>
              ))}
              <th className="pl-1 w-10">
                <button type="button" onClick={addCategory} title="Добавить категорию"
                        className="w-9 h-9 rounded-xl border border-dashed border-indigo-300 dark:border-indigo-700 text-indigo-600 dark:text-indigo-300 text-lg font-bold hover:bg-indigo-50 dark:hover:bg-indigo-900/40">+</button>
              </th>
            </tr>
          </thead>
          <tbody>
            {terms.map(m => (
              <tr key={m} className="group">
                <td className="pr-2">
                  <div className="flex items-center gap-1">
                    <span className="text-sm font-bold text-slate-700 dark:text-slate-200 whitespace-nowrap">{m} мес</span>
                    <button type="button" onClick={() => removeTerm(m)} title={`Убрать срок ${m} мес`}
                            className="w-6 h-6 rounded-md text-slate-300 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/30 opacity-60 group-hover:opacity-100">×</button>
                  </div>
                </td>
                <td className="px-1">
                  {(() => {
                    const v = termRates.find(r => r.months === m)?.rate;
                    return <input inputMode="decimal" aria-label={`Общие, ${m} мес`} placeholder="—"
                                  value={v ?? ''} onChange={e => setTermRates(upsert(termRates, m, e.target.value))}
                                  className={`${cell} ${v !== undefined ? filled : empty}`} />;
                  })()}
                </td>
                {categories.map(c => {
                  const v = c.rates.find(r => r.months === m)?.rate;
                  return (
                    <td key={c.id} className="px-1">
                      <input inputMode="decimal" aria-label={`${c.name || 'Категория'}, ${m} мес`} placeholder="—"
                             value={v ?? ''} onChange={e => patchCat(c.id, { rates: upsert(c.rates, m, e.target.value) })}
                             className={`${cell} ${v !== undefined ? filled : empty}`} />
                    </td>
                  );
                })}
                <td />
              </tr>
            ))}
            {terms.length === 0 && (
              <tr><td colSpan={categories.length + 3} className="py-4 text-center text-sm text-slate-400">Добавьте сроки кнопками ниже</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Добавить срок */}
      <div className="px-5 pt-2 pb-4">
        <p className="text-[11px] text-slate-400 mb-3">Пустая ячейка «—» — срок в этой категории не предлагается.</p>
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">Добавить срок</p>
        <div className="flex flex-wrap gap-1.5 items-center">
          {QUICK_TERMS.filter(m => !terms.includes(m)).map(m => (
            <button key={m} type="button" onClick={() => addTerm(m)}
                    className="px-3 py-1.5 rounded-full text-xs font-bold bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300 hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-indigo-900/40 active:scale-95 transition">
              + {m} мес
            </button>
          ))}
          <form className="flex items-center gap-1" onSubmit={e => { e.preventDefault(); addTerm(parseInt(customTerm)); setCustomTerm(''); }}>
            <input inputMode="numeric" value={customTerm} onChange={e => setCustomTerm(e.target.value.replace(/\D/g, ''))}
                   placeholder="другой" className="w-20 h-8 px-2.5 rounded-full text-xs font-bold bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 outline-none focus:border-indigo-400 text-slate-700 dark:text-slate-200" />
            {customTerm && <button type="submit" className="h-8 px-3 rounded-full text-xs font-bold bg-indigo-600 text-white">Добавить</button>}
          </form>
        </div>
      </div>

      {/* Категория: название и примечание для клиента */}
      {openCat && (() => {
        const c = categories.find(x => x.id === openCat);
        if (!c) return null;
        return (
          <div className="mx-5 mb-4 p-4 rounded-2xl bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/50 space-y-2.5">
            <div className="flex items-center gap-2">
              <input autoFocus value={c.name} maxLength={40} placeholder="Название: Телефоны, Мебель…"
                     onChange={e => patchCat(c.id, { name: e.target.value })}
                     className="flex-1 min-w-0 h-11 px-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 outline-none focus:border-indigo-400 font-semibold text-slate-800 dark:text-white" />
              <button type="button" onClick={() => removeCat(c.id)}
                      className="shrink-0 h-11 px-3 rounded-xl text-sm font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/30">Удалить</button>
            </div>
            <textarea rows={2} maxLength={300} value={c.note || ''} onChange={e => patchCat(c.id, { note: e.target.value })}
                      placeholder="Примечание для клиента: «Без поручителя до 100 000 ₽»"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 outline-none focus:border-indigo-400 text-sm text-slate-700 dark:text-slate-200 resize-none" />
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {c.rates.length ? 'Клиент увидит только сроки, заполненные в этом столбце.' : 'Столбец пуст — категория работает по общим ставкам.'}
            </p>
          </div>
        );
      })()}

      {/* Взнос снижает наценку */}
      <div className="mx-5 mb-4 p-4 rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/40">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-800 dark:text-white">Взнос снижает наценку</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Для всех сроков и категорий. Действует самое выгодное подходящее правило</p>
          </div>
          <button type="button" onClick={() => {
                    const last = [...downDiscounts].sort((a, b) => b.fromPercent - a.fromPercent)[0];
                    setDownDiscounts([...downDiscounts, { fromPercent: Math.min(90, (last?.fromPercent || 0) + 10), minus: (last?.minus || 0) + 2 }]);
                  }}
                  className="shrink-0 px-3 py-1.5 rounded-full text-xs font-bold bg-emerald-600 text-white active:scale-95 transition">+ Правило</button>
        </div>
        {downDiscounts.length > 0 ? (
          <div className="mt-3 space-y-2">
            <div className="grid grid-cols-[1fr_auto_1fr_28px] gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 px-1">
              <span>Взнос от</span><span /><span>Наценка меньше на</span><span />
            </div>
            {downDiscounts.map((r, i) => {
              const set = (patch: Partial<DownDiscount>) => setDownDiscounts(downDiscounts.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              const num = (v: string) => Number(v.replace(/[^\d.,]/g, '').replace(',', '.')) || 0;
              const box = 'w-full h-10 pl-3 pr-7 rounded-xl font-bold tabular-nums bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800 outline-none focus:border-emerald-500 text-slate-800 dark:text-white';
              return (
                <div key={i} className="grid grid-cols-[1fr_auto_1fr_28px] gap-2 items-center">
                  <span className="relative">
                    <input inputMode="decimal" aria-label="Взнос от, %" value={r.fromPercent || ''} onChange={e => set({ fromPercent: num(e.target.value) })} className={box} />
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">%</span>
                  </span>
                  <span className="text-emerald-600 font-bold">→</span>
                  <span className="relative">
                    <input inputMode="decimal" aria-label="Наценка меньше на, %" value={r.minus || ''} onChange={e => set({ minus: num(e.target.value) })} className={box} />
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">−%</span>
                  </span>
                  <button type="button" onClick={() => setDownDiscounts(downDiscounts.filter((_, j) => j !== i))}
                          className="w-7 h-7 rounded-md text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/30" aria-label="Удалить правило">×</button>
                </div>
              );
            })}
            <p className="text-[11px] text-emerald-700 dark:text-emerald-400 pt-1">
              Пример: ставка 25%, товар 100 000 ₽, взнос 20 000 ₽ (20%) — {(() => {
                const hit = [...downDiscounts].filter(r => r.fromPercent <= 20 && r.minus > 0).sort((a, b) => b.fromPercent - a.fromPercent)[0];
                return hit ? `наценка ${Math.max(0, 25 - hit.minus)}% вместо 25%` : 'правило не срабатывает';
              })()}
            </p>
          </div>
        ) : (
          <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">Сейчас наценка от взноса не зависит. Пример правила: «взнос от 20% — наценка меньше на 5%».</p>
        )}
      </div>

      {/* Для сроков вне таблицы — калькулятор продавца, любой срок */}
      <div className="mx-5 mb-5 flex items-center justify-between gap-3 p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-900/50">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Для остальных сроков</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">Если срока нет в таблице — в вашем расчёте</p>
        </div>
        <div className="relative shrink-0">
          <input inputMode="decimal" value={defaultRate} onChange={e => setDefaultRate(e.target.value.replace(',', '.'))}
                 className="w-20 h-10 pr-6 rounded-xl text-center font-bold tabular-nums bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none focus:border-indigo-400 text-slate-800 dark:text-white" />
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">%</span>
        </div>
      </div>

      {/* Сохранить — только когда есть что */}
      {dirty && (
        <div className="px-5 pb-5">
          <button type="button" onClick={onSave}
                  className="w-full py-3.5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow-lg shadow-indigo-500/25 active:scale-[0.98] transition">
            Сохранить ставки
          </button>
        </div>
      )}
    </section>
  );
};

export default CalculatorRates;
