/**
 * Слияние отложенного сохранения инвестора с тем, что уже на сервере.
 *
 * Сохранение без связи ложится в очередь целиком — весь объект инвестора. Раньше
 * при отправке он просто записывался поверх серверной версии: если за это время
 * инвестора меняли с другого устройства (пополнение, возврат, правка), эти
 * изменения молча пропадали. Так у одного пользователя сохранение суточной
 * давности вернуло капитал к старому значению.
 *
 * Теперь в очереди хранится и версия, от которой сделано изменение (base), и при
 * отправке применяется только сама разница между base и отложенной версией
 * (mine) — поверх текущей серверной (theirs):
 *   • обычные поля — берём из mine, только если mine их менял;
 *   • initialAmount и суммы периодов — как прибавку: сервер + (mine − base);
 *   • периоды участия — по id: добавленные, удалённые и изменённые в mine;
 *   • журнал капитала периода — по id записей: добавленные и удалённые в mine.
 */

type Obj = Record<string, any>;

const same = (a: any, b: any) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const num = (v: any) => Number(v) || 0;
const shift = (theirs: any, mine: any, base: any) => Math.max(0, num(theirs) + num(mine) - num(base));

// Обычные поля: что mine поменял относительно base — то и переносим поверх theirs
const mergeFields = (base: Obj, mine: Obj, theirs: Obj, skip: string[]): Obj => {
  const out: Obj = { ...theirs };
  for (const key of new Set([...Object.keys(base), ...Object.keys(mine)])) {
    if (skip.includes(key) || same(base[key], mine[key])) continue;
    if (key in mine) out[key] = mine[key];
    else delete out[key];
  }
  return out;
};

const mergeJournal = (base: Obj[] = [], mine: Obj[] = [], theirs: Obj[] = []): Obj[] => {
  const baseIds = new Set(base.map(c => c.id));
  const mineIds = new Set(mine.map(c => c.id));
  const removed = new Set([...baseIds].filter(id => !mineIds.has(id)));
  const out = theirs.filter(c => !removed.has(c.id));
  const have = new Set(out.map(c => c.id));
  for (const c of mine) if (!baseIds.has(c.id) && !have.has(c.id)) out.push(c);
  return out;
};

const mergePeriod = (base: Obj | undefined, mine: Obj, theirs: Obj): Obj => {
  if (!base) return mine; // один и тот же новый период с двух сторон — берём отложенный
  const out = mergeFields(base, mine, theirs, ['initialAmount', 'capitalChanges']);
  out.initialAmount = shift(theirs.initialAmount, mine.initialAmount, base.initialAmount);
  const journal = mergeJournal(base.capitalChanges, mine.capitalChanges, theirs.capitalChanges);
  if (journal.length || theirs.capitalChanges || mine.capitalChanges) out.capitalChanges = journal;
  return out;
};

const legacyPeriod = (inv: Obj): Obj => ({
  id: 'legacy', joinedDate: inv.joinedDate, leftPoolDate: inv.leftPoolDate, initialAmount: inv.initialAmount,
});

const mergePeriods = (baseInvestor: Obj, theirsInvestor: Obj, mine: Obj[] | undefined, theirs: Obj[] | undefined): Obj[] | undefined => {
  if (!mine && !theirs) return undefined;
  const base: Obj[] = baseInvestor.investmentPeriods || [];
  const b = new Map(base.map(p => [p.id, p]));
  // У инвестора без периодов первое изменение капитала создаёт период 'legacy' из
  // верхних полей (см. applyCapitalChange) — на каждом устройстве свой. Его исходная
  // версия — те самые верхние поля base, иначе пополнения с другого устройства пропали бы.
  if (!base.length) b.set('legacy', legacyPeriod(baseInvestor));
  const m = new Map((mine || []).map(p => [p.id, p]));
  const out: Obj[] = [];
  const baseIds = new Set(base.map(p => p.id));
  for (const t of theirs || []) {
    if (baseIds.has(t.id) && !m.has(t.id)) continue;       // mine удалил период
    const mp = m.get(t.id);
    out.push(mp ? mergePeriod(b.get(t.id), mp, t) : t);
  }
  const have = new Set(out.map(p => p.id));
  for (const mp of mine || []) {
    // Новый в mine период. Если он был в base, но его нет на сервере — там его удалили: не возвращаем
    if (have.has(mp.id) || baseIds.has(mp.id)) continue;
    // Период 'legacy' появился в mine, а на сервере периодов нет (там меняли только
    // верхние поля) — сумма периода должна учесть и серверную правку
    if (mp.id === 'legacy' && !(theirs || []).length && b.has('legacy')) {
      out.push(mergePeriod(b.get('legacy'), mp, legacyPeriod(theirsInvestor)));
    } else {
      out.push(mp);
    }
  }
  return out;
};

/** Инвестор для отправки: изменения отложенной версии поверх серверной. */
export const mergeInvestor = (base: Obj | null | undefined, mine: Obj, theirs: Obj | null | undefined): Obj => {
  if (!theirs) return mine;          // на сервере его нет — отправляем как есть
  if (!base) return mine;            // не знаем, от чего менялось, — прежнее поведение
  if (same(base, theirs)) return mine; // на сервере ничего не менялось
  const out = mergeFields(base, mine, theirs, ['initialAmount', 'investmentPeriods']);
  out.initialAmount = shift(theirs.initialAmount, mine.initialAmount, base.initialAmount);
  const periods = mergePeriods(base, theirs, mine.investmentPeriods, theirs.investmentPeriods);
  if (periods) out.investmentPeriods = periods;
  return out;
};
