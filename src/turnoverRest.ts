import type { Account, Expense, Investor, RetailSale, Sale } from '../types';
import { hasUnassignedExpenseSource } from './expenseAccounting';
import { computeAccountBalances, retailCashIn, saleMoneyIn } from './utils';

export interface TurnoverRestEntry {
  id: string;
  title: string;
  description: string;
  amount: number;
  kind: 'initial' | 'income' | 'expense' | 'capital' | 'contract' | 'retail' | 'balance' | 'rounding';
  review: boolean;
  accountId?: string;
  date?: string;
  sourceId?: string;
  sourceType?: 'sale' | 'expense' | 'account' | 'investor' | 'retail';
  /** Слагаемые влияния записи на остаток — со знаками. */
  parts?: { label: string; amount: number }[];
}
export interface TurnoverRestDetails {
  explained: number;
  difference: number;
  entries: TurnoverRestEntry[];
}
const round = (n: number) => Math.round(n * 100) / 100;

/** Разбор остатка по исходным записям. Прибыль и капитал передаёт основной
 * расчёт: повторной формулы распределения между инвесторами здесь нет. */
export const turnoverRestDetails = ({ accounts, accountIds, accountBalances, sales, expenses, investors, retailSales = [],
  profitBySale, expenseDeductions, capitalBy, rest,
}: {
  accounts: Account[]; accountIds: string[]; accountBalances: Record<string, number>;
  sales: Sale[]; expenses: Expense[]; investors: Investor[]; retailSales?: RetailSale[];
  profitBySale: Map<Sale, number>; expenseDeductions: Map<Expense, number>;
  capitalBy: Map<string, number>; rest: number;
}): TurnoverRestDetails => {
  const ids = new Set(accountIds), investorIds = new Set(investors.map(i => i.id));
  const entries: TurnoverRestEntry[] = [];
  const add = (entry: TurnoverRestEntry) => { if (Math.abs(entry.amount) >= 0.000001) entries.push(entry); };
  const expenseImpact = (e: Expense) => (e.isRefund === true ? 0 : -(Number(e.amount) || 0)) + (expenseDeductions.get(e) || 0);
  const consumed = new Set<Expense>();
  const scopedExpenses = expenses.filter(e => ids.has(e.accountId));
  const linked = new Map<string, Expense[]>();
  const purchaseOwners = new Map<string, string>();
  for (const s of sales) {
    if (!ids.has(s.accountId)) continue;
    purchaseOwners.set(`exp_sale_${s.id}\0${s.accountId}`, s.id);
    purchaseOwners.set(`exp_sale_${s.id}__${s.accountId}\0${s.accountId}`, s.id);
  }
  for (const e of scopedExpenses) {
    // Только явная связь. Совпадение суммы или названия не доказывает закуп.
    const saleId = e.saleId || purchaseOwners.get(`${e.id}\0${e.accountId}`);
    if (saleId) { const key = `${saleId}\0${e.accountId}`; linked.set(key, [...(linked.get(key) || []), e]); }
  }
  for (const a of accounts.filter(a => ids.has(a.id))) add({
    id: `initial:${a.id}`, kind:'initial', title:'Начальный остаток', description:a.name,
    amount:Number(a.initialBalance) || 0, accountId:a.id, sourceId:a.id, sourceType:'account', review:false,
  });
  for (const sale of sales) {
    if (!ids.has(sale.accountId)) continue;
    const receipts = saleMoneyIn(sale).reduce((n,p) => n + p.amount,0);
    const customer = !String(sale.customerId).startsWith('system_') && !investorIds.has(sale.customerId);
    if (!customer) {
      add({id:`income:${sale.id}:${sale.accountId}`,kind:'income',title:sale.productName || 'Поступление',
        description:'Поступление на счёт. Само по себе не подтверждает, что деньги принадлежат владельцу.',
        amount:receipts,accountId:sale.accountId,date:sale.startDate,sourceId:sale.id,sourceType:'sale',review:false});
      continue;
    }
    const purchases = linked.get(`${sale.id}\0${sale.accountId}`) || [];
    purchases.forEach(e => consumed.add(e));
    const remaining = Math.max(0,Number(sale.remainingAmount) || 0), profit = profitBySale.get(sale) || 0;
    const purchaseImpact = purchases.reduce((n,e) => n + expenseImpact(e),0);
    const impact = receipts + remaining - profit + purchaseImpact;
    const fromStock = !!sale.productId || !!sale.stockItems?.length;
    const external = !!sale.supplierId || fromStock;
    const reason = external
      ? fromStock ? 'Товар взят со склада: его оплата учитывается отдельными складскими расходами.' : 'Закуп у поставщика: обязательства перед ним проверяются в разделе поставщиков.'
      : !purchases.length ? 'Связанный расход закупа не найден. Это может быть начальный договор или неполная связь записей; проверьте источник закупа.'
      : 'Возврат закупа по договору отличается от связанных расходов. Проверьте закуп, скидки и остаток долга.';
    const parts = [{label:'Получено по договору',amount:receipts},{label:'Остаток долга',amount:remaining},
      {label:'Полученная и ожидаемая прибыль',amount:-profit},...purchases.map(e=>({label:e.title || 'Связанный расход',amount:expenseImpact(e)}))];
    add({id:`contract:${sale.id}:${sale.accountId}`,kind:'contract',title:sale.productName || 'Договор',description:reason,
      amount:impact,accountId:sale.accountId,date:sale.startDate,sourceId:sale.id,sourceType:'sale',review:!external,parts});
  }
  for (const e of scopedExpenses) {
    if (consumed.has(e)) continue;
    const cash = e.isRefund === true ? 0 : -(Number(e.amount) || 0), profit = expenseDeductions.get(e) || 0;
    add({id:`expense:${e.id}`,kind:'expense',title:e.title || 'Расход',
      description:hasUnassignedExpenseSource(e) ? `Способ учёта не указан.${e.description ? ` ${e.description}` : ''}` : e.description || (e.managerPayoutSource === 'CAPITAL' ? 'Изъятие капитала владельцем.' : 'Уменьшает остаток в части, которая не списана с прибыли.'),
      amount:cash + profit,accountId:e.accountId,date:e.date,sourceId:e.id,sourceType:'expense',review:false,
      parts:[{label:'Изменение денег на счёте',amount:cash},{label:'Уменьшение обязательств по прибыли',amount:profit}]});
  }
  for (const r of retailSales) {
    if (r.isCancelled) continue;
    const base = ids.has(r.accountId) ? retailCashIn(r) : 0;
    if (base) add({id:`retail:${r.id}`,kind:'retail',title:r.returnOf ? 'Возврат по чеку' : 'Наличная продажа',description:r.docNumber ? `Чек №${r.docNumber}` : 'Движение денег магазина.',amount:base,accountId:r.accountId,date:r.date,sourceId:r.id,sourceType:'retail',review:false});
    for (const p of r.payments || []) if (ids.has(p.accountId)) add({id:`retail-payment:${r.id}:${p.id}`,kind:'retail',title:'Оплата долга по чеку',description:r.docNumber ? `Чек №${r.docNumber}` : 'Поступление по наличной продаже.',amount:p.amount,accountId:p.accountId,date:p.date,sourceId:r.id,sourceType:'retail',review:false});
  }
  for (const [id,capital] of capitalBy) add({id:`capital:${id}`,kind:'capital',title:investors.find(i=>i.id===id)?.name || 'Инвестор',
    description:'Внешний капитал вычитается из остатка: он уже показан отдельно во вложениях инвесторов. Это расчётная строка, не расход.',
    amount:-capital,sourceId:id,sourceType:'investor',review:false});
  const calculatedCash = computeAccountBalances(accounts,sales,expenses,retailSales);
  for (const id of ids) add({id:`balance:${id}`,kind:'balance',title:'Денежный остаток требует сверки',description:'Остаток счёта не совпал с начальным остатком и доступными операциями.',
    amount:(accountBalances[id] || 0) - (calculatedCash[id] || 0),accountId:id,review:true});
  const rawSum = entries.reduce((n,e)=>n+e.amount,0);
  entries.forEach(e=>{e.amount=round(e.amount);e.parts?.forEach(p=>{p.amount=round(p.amount);});});
  const gap = round(rest - entries.reduce((n,e)=>n+e.amount,0));
  if (gap) add({id:'rounding',kind:Math.abs(rest-rawSum)<0.03?'rounding':'balance',title:Math.abs(rest-rawSum)<0.03?'Округление до копеек':'Несопоставленная часть расчёта',description:'Разница между итогом и суммой подробных строк.',amount:gap,review:Math.abs(rest-rawSum)>=0.03});
  const visible = entries.filter(e=>e.amount!==0);
  const explained = round(visible.filter(e=>!e.review).reduce((n,e)=>n+e.amount,0));
  return {explained,difference:round(rest-explained),entries:visible};
};
