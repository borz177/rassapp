import { Investor, Sale } from '../types';
import { revertCapitalChange } from './utils';

/**
 * Отмена ручного прихода — записи из «Прихода», которую человек сделал сам:
 *   • INVESTOR_DEPOSIT — «Пополнение от инвестора»: деньги в кассе и рост его капитала;
 *   • OTHER_INCOME — «Прочий приход»: только деньги в кассе.
 *
 * Не отменяются здесь:
 *   • платежи клиентов — у них своя отмена в карточке клиента (и график, и прибыль);
 *   • продажи товара за наличные — там ещё склад и закупка;
 *   • начальный вклад, вклад при повторном входе и при активации (system_deposit_*) —
 *     они привязаны к периоду участия и меняются в карточке инвестора.
 */
export type ManualIncomeKind = 'INVESTOR_DEPOSIT' | 'OTHER_INCOME';

export const manualIncomeKind = (sale: Sale, investors: Investor[]): ManualIncomeKind | null => {
  if (sale.type !== 'CASH') return null;
  if (Number(sale.buyPrice) > 0 || sale.productId) return null;
  const customerId = String(sale.customerId || '');
  if (customerId === 'system_income') return 'OTHER_INCOME';
  if (customerId.startsWith('system_')) return null;
  if (investors.some(i => i.id === customerId) || /^(u_)?inv_/.test(customerId)) return 'INVESTOR_DEPOSIT';
  return null;
};

export interface IncomeCancelPlan {
  kind: ManualIncomeKind;
  amount: number;
  /** Инвестор пополнения; null — инвестор уже удалён, меняется только касса. */
  investor: Investor | null;
  /**
   * Пополнение записано в журнал капитала — отменяется ровно оно, с его даты.
   * false — старая запись (до журнала) или пополнение вне периода участия: тогда
   * пополнение меняло только сумму «вложено» в карточке, её и уменьшаем. Но у
   * старых записей сумму могли потом исправить вручную, поэтому уменьшать её или
   * нет — решает человек.
   */
  fromJournal: boolean;
  capitalBefore: number;
  capitalAfter: number;
}

export const incomeCancelPlan = (sale: Sale, investors: Investor[]): IncomeCancelPlan | null => {
  const kind = manualIncomeKind(sale, investors);
  if (!kind) return null;
  const amount = Number(sale.downPayment ?? sale.totalAmount) || 0;
  if (kind === 'OTHER_INCOME') {
    return { kind, amount, investor: null, fromJournal: false, capitalBefore: 0, capitalAfter: 0 };
  }
  const investor = investors.find(i => i.id === sale.customerId) || null;
  if (!investor) return { kind, amount, investor: null, fromJournal: false, capitalBefore: 0, capitalAfter: 0 };
  const capitalBefore = Number(investor.initialAmount) || 0;
  const reverted = revertCapitalChange(investor, sale.id);
  return reverted
    ? { kind, amount, investor, fromJournal: true, capitalBefore, capitalAfter: Number(reverted.initialAmount) || 0 }
    : { kind, amount, investor, fromJournal: false, capitalBefore, capitalAfter: Math.max(0, capitalBefore - amount) };
};

/**
 * Инвестор после отмены пополнения. null — капитал не меняется (прочий приход,
 * инвестор удалён или человек решил не уменьшать капитал у старой записи).
 */
export const investorAfterIncomeCancel = (
  sale: Sale,
  investors: Investor[],
  reduceCapital: boolean
): Investor | null => {
  const plan = incomeCancelPlan(sale, investors);
  if (!plan || plan.kind !== 'INVESTOR_DEPOSIT' || !plan.investor) return null;
  if (plan.fromJournal) return revertCapitalChange(plan.investor, sale.id);
  if (!reduceCapital) return null;
  return { ...plan.investor, initialAmount: plan.capitalAfter };
};
