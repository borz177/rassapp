/**
 * Импорт выгрузки FinPay (JSON: company, clients, installments, payments).
 *
 * Как поля FinPay ложатся на наши:
 *  - суммы в копейках (*_cents) → рубли;
 *  - платёж № 0 — первый взнос. Оплачен — это downPayment договора; не оплачен
 *    (или оплачен частично) — неоплаченная часть остаётся строкой графика на его дату;
 *  - платежи № 1…N — график; суммы раскладываем ровно (как при оформлении у нас),
 *    даты — как в FinPay;
 *  - каждое поступление (paid_amount > 0) — отдельная запись isRealPayment.
 *    Строки «covered» денег не несут: их закрыла переплата прошлого платежа;
 *  - cash_price — закуп (buyPrice).
 *
 * id записей выводятся из id FinPay (finpay_<uuid>), поэтому повторный импорт того
 * же файла не создаёт дублей — уже загруженное пропускается.
 */

import type { Customer, Expense, Payment, Sale } from '../types';
import { reconcileSalePaymentPlan } from './salePlan';
import { parseInputDate } from './saleMath';

export interface FinpayClient {
  id: string;
  full_name: string;
  passport?: { number?: string };
  contact_info?: { phones?: string[]; emails?: string[] };
}

export interface FinpayInstallment {
  id: string;
  installment_number: number;
  client_id: string;
  funding_account_id: string;
  product_name: string;
  total_price_cents: number;
  cash_price_cents: number;
  down_payment_cents: number;
  signing_date: string;
  installment_start_date?: string;
  status: string;
  paid_amount_cents: number;
  remaining_amount_cents: number;
  guarantors?: { full_name?: string; passport_number?: string; phones?: string[] }[];
}

export interface FinpayPayment {
  id: string;
  installment_id: string;
  payment_number: number;
  due_date: string;
  expected_amount_cents: number;
  paid_amount_cents: number;
  is_paid: boolean;
  status: string;
  paid_date?: string;
}

export interface FinpayExport {
  exported_at: string;
  version: number;
  company?: { id: string; name: string };
  clients: FinpayClient[];
  installments: FinpayInstallment[];
  payments: FinpayPayment[];
}

export const isFinpayExport = (data: any): data is FinpayExport =>
  !!data && typeof data === 'object'
  && Array.isArray(data.clients) && Array.isArray(data.installments) && Array.isArray(data.payments)
  && (data.installments.length === 0 || 'total_price_cents' in data.installments[0]);

const rub = (cents: number) => Math.round(Number(cents) || 0) / 100;
const fmt = (n: number) => `${n.toLocaleString('ru-RU')} ₽`;

/** Счёт, с которого FinPay финансировал договоры: для сопоставления с нашими счетами */
export interface FinpayFundingAccount {
  id: string;
  contracts: number;
  buyTotal: number;
  /** Несколько договоров для примера — по ним человек узнаёт счёт */
  sample: string[];
}

export interface FinpayAnalysis {
  companyName: string;
  exportedAt: string;
  clients: number;
  contracts: number;
  activeContracts: number;
  payments: number;
  receivedTotal: number;
  remainingTotal: number;
  fundingAccounts: FinpayFundingAccount[];
  warnings: string[];
}

const groupPayments = (data: FinpayExport) => {
  const byInst = new Map<string, FinpayPayment[]>();
  for (const p of data.payments) {
    const list = byInst.get(p.installment_id) || [];
    list.push(p);
    byInst.set(p.installment_id, list);
  }
  for (const list of byInst.values()) list.sort((a, b) => a.payment_number - b.payment_number);
  return byInst;
};

/** Что лежит в файле и на что обратить внимание — до записи */
export const analyzeFinpay = (data: FinpayExport): FinpayAnalysis => {
  const byInst = groupPayments(data);
  const clientIds = new Set(data.clients.map(c => c.id));
  const exportDay = (data.exported_at || '').slice(0, 10);
  const warnings: string[] = [];

  const funding = new Map<string, FinpayFundingAccount>();
  for (const i of data.installments) {
    const f = funding.get(i.funding_account_id) || { id: i.funding_account_id, contracts: 0, buyTotal: 0, sample: [] };
    f.contracts++;
    f.buyTotal += rub(i.cash_price_cents);
    if (f.sample.length < 3) f.sample.push(`№${i.installment_number} ${i.product_name}`);
    funding.set(i.funding_account_id, f);
  }

  const orphans = data.installments.filter(i => !clientIds.has(i.client_id)).length;
  if (orphans) warnings.push(`${orphans} договоров без клиента в файле — будут пропущены.`);

  const noPayments = data.installments.filter(i => !byInst.get(i.id)?.length).length;
  if (noPayments) warnings.push(`${noPayments} договоров без графика платежей — будут пропущены.`);

  const future = data.payments.filter(p => p.paid_amount_cents > 0 && p.paid_date && p.paid_date > exportDay).length;
  if (future) warnings.push(`${future} платежей отмечены оплаченными датой позже выгрузки (в файле дата стоит по графику) — запишем их датой выгрузки.`);

  const unpaidDp = data.installments.filter(i => {
    const z = byInst.get(i.id)?.find(p => p.payment_number === 0);
    return i.down_payment_cents > 0 && z && z.paid_amount_cents < i.down_payment_cents;
  });
  if (unpaidDp.length) warnings.push(`Первый взнос не внесён: ${unpaidDp.map(i => `№${i.installment_number}`).join(', ')} — он останется в графике как долг.`);

  const nums = new Map<number, number>();
  for (const i of data.installments) nums.set(i.installment_number, (nums.get(i.installment_number) || 0) + 1);
  const dupNums = [...nums.values()].filter(n => n > 1).length;
  if (dupNums) warnings.push(`${dupNums} номеров договоров повторяются в файле — номер сохраним в примечании, договоры не склеиваем.`);

  const names = new Map<string, number>();
  for (const c of data.clients) {
    const k = c.full_name.trim().toUpperCase();
    names.set(k, (names.get(k) || 0) + 1);
  }
  const dupNames = [...names.values()].filter(n => n > 1).length;
  if (dupNames) warnings.push(`${dupNames} ФИО встречаются дважды — это разные карточки в файле, перенесём обе.`);

  const withoutContracts = data.clients.filter(c => !data.installments.some(i => i.client_id === c.id)).length;
  if (withoutContracts) warnings.push(`${withoutContracts} клиентов без договоров — перенесём только карточки.`);

  const received = data.installments.reduce((s, i) => s + rub(i.paid_amount_cents), 0);
  const remaining = data.installments.reduce((s, i) => s + Math.max(0, rub(i.total_price_cents) - rub(i.paid_amount_cents)), 0);

  return {
    companyName: data.company?.name || 'FinUchet',
    exportedAt: data.exported_at,
    clients: data.clients.length,
    contracts: data.installments.length,
    activeContracts: data.installments.filter(i => i.status !== 'completed').length,
    payments: data.payments.filter(p => p.paid_amount_cents > 0).length,
    receivedTotal: Math.round(received * 100) / 100,
    remainingTotal: Math.round(remaining * 100) / 100,
    fundingAccounts: [...funding.values()].sort((a, b) => b.contracts - a.contracts),
    warnings,
  };
};

const customerId = (finpayId: string) => `finpay_${finpayId}`;
const saleId = (finpayId: string) => `finpay_${finpayId}`;

export interface FinpayBuildOptions {
  userId: string;
  /** funding_account_id FinPay → id нашего счёта */
  accountMap: Record<string, string>;
  /** Списывать закуп со счёта расходом «Себестоимость», как при оформлении договора */
  withPurchaseExpenses: boolean;
  importedAt?: string;
}

export interface FinpayBuildResult {
  customers: Customer[];
  sales: Sale[];
  expenses: Expense[];
  /** Наш остаток долга против остатка в FinPay — договоры, где разошлось больше рубля */
  mismatches: string[];
}

export const buildFinpayRecords = (data: FinpayExport, opts: FinpayBuildOptions): FinpayBuildResult => {
  const byInst = groupPayments(data);
  const clientsById = new Map(data.clients.map(c => [c.id, c]));
  const exportDay = (data.exported_at || new Date().toISOString()).slice(0, 10);
  const importedAt = opts.importedAt || new Date().toISOString();
  const day = (d: string) => parseInputDate(d).toISOString();

  const customers: Customer[] = data.clients.map(c => {
    const phones = (c.contact_info?.phones || []).map(p => String(p).trim()).filter(Boolean);
    const emails = (c.contact_info?.emails || []).map(e => String(e).trim()).filter(Boolean);
    const extra = [
      phones.length > 1 ? `Другие телефоны: ${phones.slice(1).join(', ')}` : '',
      emails.length > 1 ? `Другие e-mail: ${emails.slice(1).join(', ')}` : '',
    ].filter(Boolean);
    return {
      id: customerId(c.id),
      userId: opts.userId,
      createdByUserId: opts.userId,
      name: c.full_name.trim(),
      phone: phones[0] || '',
      email: emails[0] || '',
      passportNumber: c.passport?.number?.trim() || undefined,
      trustScore: 100,
      notes: ['Импорт FinUchet', ...extra].join('\n'),
    };
  });

  const sales: Sale[] = [];
  const expenses: Expense[] = [];
  const mismatches: string[] = [];

  for (const inst of data.installments) {
    const rows = byInst.get(inst.id) || [];
    if (!clientsById.has(inst.client_id) || rows.length === 0) continue;

    const id = saleId(inst.id);
    const accountId = opts.accountMap[inst.funding_account_id] || '';
    const total = rub(inst.total_price_cents);
    const dpRow = rows.find(p => p.payment_number === 0);
    const dpAgreed = rub(inst.down_payment_cents);
    // Первый взнос — сколько из него реально внесено; остаток взноса — долг по графику
    const dpPaid = dpRow ? Math.min(dpAgreed, rub(dpRow.paid_amount_cents)) : dpAgreed;
    const dpOverpaid = dpRow ? Math.max(0, rub(dpRow.paid_amount_cents) - dpAgreed) : 0;

    const slotRows = rows.filter(p => p.payment_number >= 1 || (p.payment_number === 0 && dpPaid < dpAgreed));
    const due = Math.max(0, total - dpPaid);
    const n = Math.max(1, slotRows.length);
    const base = Math.floor(due / n);
    const last = Math.round((due - base * (n - 1)) * 100) / 100;

    const plan: Payment[] = slotRows.map((p, idx) => ({
      id: `finpay_plan_${p.id}`,
      saleId: id,
      amount: idx === n - 1 ? last : base,
      date: day(p.due_date),
      isPaid: false,
      isRealPayment: false,
    }));

    const real: Payment[] = rows
      .map(p => {
        let amount = rub(p.paid_amount_cents);
        if (p.payment_number === 0) amount = dpPaid < dpAgreed ? 0 : dpOverpaid;
        if (!(amount > 0)) return null;
        const paidDay = (p.paid_date || p.due_date) > exportDay ? exportDay : (p.paid_date || p.due_date);
        return {
          id: `finpay_pay_${p.id}`,
          saleId: id,
          amount,
          date: day(paidDay),
          actualDate: day(paidDay),
          isPaid: true,
          isRealPayment: true,
          importedAt,
          recordedByUserId: opts.userId,
          note: p.paid_date && p.paid_date !== paidDay
            ? `Импорт: платёж №${p.payment_number}, оплачен ${p.paid_date}`
            : `Импорт: платёж №${p.payment_number}`,
        } as Payment;
      })
      .filter((p): p is Payment => !!p);

    const guarantors = (inst.guarantors || []).filter(g => g.full_name?.trim());
    const g0 = guarantors[0];
    const notes = [
      `Импорт FinUchet, договор №${inst.installment_number}`,
      ...guarantors.slice(1).map(g => `Поручитель: ${g.full_name}${g.phones?.length ? `, ${g.phones.join(', ')}` : ''}`),
    ].join('\n');

    const firstDue = slotRows[0]?.due_date || inst.installment_start_date || inst.signing_date;
    let sale: Sale = {
      id,
      userId: opts.userId,
      createdByUserId: opts.userId,
      type: 'INSTALLMENT',
      customerId: customerId(inst.client_id),
      productName: inst.product_name.trim() || 'Товар',
      buyPrice: rub(inst.cash_price_cents),
      accountId,
      totalAmount: total,
      downPayment: dpPaid,
      remainingAmount: due,
      interestRate: 0,
      installments: n,
      startDate: day(inst.signing_date),
      paymentDay: parseInputDate(firstDue).getDate(),
      status: 'ACTIVE',
      guarantorName: g0?.full_name?.trim() || undefined,
      guarantorPhone: g0?.phones?.[0] || undefined,
      paymentPlan: [...real, ...plan].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
      notes,
    };
    sale = reconcileSalePaymentPlan(sale);
    sale.status = sale.remainingAmount <= 0.01 ? 'COMPLETED' : 'ACTIVE';
    sales.push(sale);

    const finpayRemaining = Math.max(0, total - rub(inst.paid_amount_cents));
    if (Math.abs(finpayRemaining - sale.remainingAmount) > 1) {
      mismatches.push(`№${inst.installment_number} ${inst.product_name}: у нас долг ${fmt(sale.remainingAmount)}, в файле ${fmt(finpayRemaining)}`);
    }

    if (opts.withPurchaseExpenses && sale.buyPrice > 0 && accountId) {
      // Тот же id, что у расхода закупа при оформлении (handleSaveSale): удаление договора уберёт и его
      expenses.push({
        id: `exp_sale_${id}`,
        userId: opts.userId,
        createdByUserId: opts.userId,
        accountId,
        title: `Закуп: ${sale.productName}`,
        amount: sale.buyPrice,
        category: 'Себестоимость',
        date: sale.startDate,
      });
    }
  }

  return { customers, sales, expenses, mismatches };
};
