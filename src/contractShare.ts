import type { Customer, Sale } from '../types';
import { formatCurrency, normalizePhoneForWhatsApp } from './utils';

export const CONTRACT_SHARE_DEFAULTS = {
  number: true,
  date: true,
  product: false,
  total: false,
  downPayment: false,
  monthly: false,
  paymentDay: false,
  remaining: false,
  manager: false,
  customer: true,
  birth: true,
  phone: false,
  overdue: false,
};
export type ContractSharePrefs = typeof CONTRACT_SHARE_DEFAULTS;
export type ContractShareField = keyof ContractSharePrefs;
export interface ContractShareData {
  sale: Sale;
  contractNo: string;
  customer?: Customer;
  managerPhone?: string;
  remaining: number;
  overdue: number;
}
const line = (v?: string) =>
  String(v || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const dayParts = (value?: string): { year: number; month: number; day: number } | null => {
  if (!value) return null;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  const [year, month, day] = d
    .toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' })
    .split('-')
    .map(Number);
  return { year, month, day };
};
export const shareDate = (value?: string) => {
  const d = dayParts(value);
  return d ? `${String(d.day).padStart(2, '0')}.${String(d.month).padStart(2, '0')}.${d.year}` : '';
};
export const normalizeContractSharePrefs = (value: unknown): ContractSharePrefs => {
  const obj = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return Object.fromEntries(
    Object.entries(CONTRACT_SHARE_DEFAULTS).map(([key, fallback]) => [
      key,
      typeof obj[key] === 'boolean' ? obj[key] : fallback,
    ])
  ) as ContractSharePrefs;
};

/** Только сохранённые плановые суммы. Реальные оплаты и остаток долга — не месячный платёж. */
export const contractShareSchedule = (sale: Sale) => {
  const plan = sale.paymentPlan || [];
  const modern = plan.filter((p) => p.isRealPayment === false);
  const slots = (modern.length ? modern : plan.filter((p) => p.isRealPayment == null && !p.isPaid))
    .slice()
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const valid =
    slots.length > 0 &&
    slots.every((p) => p.amount != null && Number.isFinite(Number(p.amount)) && Number(p.amount) > 0);
  const amounts = slots.map((p) => Number(p.amount));
  const variable = valid && amounts.slice(0, -1).some((n) => Math.abs(n - amounts[0]) > 0.011);
  const monthly = valid && !variable ? amounts[0] : null;
  const last = monthly != null && Math.abs(amounts.at(-1)! - monthly) > 0.011 ? amounts.at(-1)! : null;
  const dates = slots.map((p) => dayParts(p.date));
  const explicitDay = Number(sale.paymentDay);
  let paymentDay: number | null =
    Number.isInteger(explicitDay) && explicitDay >= 1 && explicitDay <= 31 ? explicitDay : null;
  if (paymentDay == null && dates.length && dates.every(Boolean)) {
    const candidate = Math.max(...dates.map((d) => d!.day));
    // 31-е в коротком месяце переносится на его последний день.
    if (
      dates.every(
        (d) => d!.day === Math.min(candidate, new Date(Date.UTC(d!.year, d!.month, 0)).getUTCDate())
      )
    )
      paymentDay = candidate;
  }
  return { monthly, last, variable, paymentDay, single: slots.length === 1 };
};

export function contractShareText(
  data: ContractShareData,
  prefs: ContractSharePrefs,
  showCents?: boolean
): string {
  const { sale, customer } = data,
    schedule = contractShareSchedule(sale);
  const cash = (n: number) => `${formatCurrency(n, showCents)} ₽`;
  const money = (n: number) => `*${cash(n)}*`;
  const validMoney = (n: unknown) => n != null && n !== '' && Number.isFinite(Number(n)) && Number(n) >= 0;
  const date = prefs.date ? shareDate(sale.startDate) : '';
  const title =
    sale.status === 'DRAFT'
      ? sale.type === 'CASH'
        ? '📝 Черновик продажи'
        : '📝 Черновик рассрочки'
      : sale.type === 'CASH'
      ? '✅ Оформлена продажа'
      : sale.status === 'COMPLETED'
      ? data.remaining <= 0
        ? '✅ Рассрочка погашена'
        : '📄 Архивный договор рассрочки'
      : '✅ Оформлена рассрочка';
  const header = [
    title,
    [
      prefs.number && line(data.contractNo) ? `Договор № *${line(data.contractNo).replace(/\*/g, '')}*` : '',
      date ? `от ${date}` : '',
    ]
      .filter(Boolean)
      .join(' '),
  ]
    .filter(Boolean)
    .join('\n');
  const who = [
    prefs.customer && customer?.name ? `👤 Клиент: ${line(customer.name)}` : '',
    prefs.birth && shareDate(customer?.birthDate) ? `Дата рождения: ${shareDate(customer?.birthDate)}` : '',
    prefs.phone && customer?.phone ? `☎️ Телефон клиента: ${line(customer.phone)}` : '',
    prefs.product && sale.productName ? `📦 Товар: ${line(sale.productName)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const amounts = [
    prefs.total && validMoney(sale.totalAmount) ? `💳 Сумма договора: ${money(sale.totalAmount)}` : '',
    prefs.downPayment && sale.type !== 'CASH' && validMoney(sale.downPayment)
      ? `💵 Первоначальный взнос: ${money(sale.downPayment)}`
      : '',
    prefs.monthly && sale.type !== 'CASH'
      ? schedule.monthly != null
        ? [
            `📆 ${schedule.single ? 'Платёж по графику' : 'Ежемесячный платёж'}: ${money(schedule.monthly)}`,
            schedule.last != null && cash(schedule.last) !== cash(schedule.monthly)
              ? `Последний платёж: ${money(schedule.last)}`
              : '',
          ]
            .filter(Boolean)
            .join('\n')
        : schedule.variable
        ? '📆 Платежи: *по индивидуальному графику*'
        : ''
      : '',
    prefs.paymentDay && sale.type !== 'CASH' && schedule.paymentDay != null
      ? `🗓 Оплата: *${schedule.paymentDay}-го числа* каждого месяца`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
  const debt = [
    prefs.remaining && validMoney(data.remaining) ? `📊 Остаток долга: ${money(data.remaining)}` : '',
    prefs.overdue && validMoney(data.overdue) && data.overdue > 0
      ? `⚠️ Просрочено: ${money(data.overdue)}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
  const managerPhone = normalizePhoneForWhatsApp(data.managerPhone);
  const manager =
    prefs.manager && managerPhone ? `📞 Связь с менеджером:\nhttps://wa.me/${managerPhone}` : '';
  return [header, who, amounts, debt, manager].filter(Boolean).join('\n\n');
}
