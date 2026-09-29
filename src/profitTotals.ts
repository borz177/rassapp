import { Customer, Sale } from '../types';
import { saleProfitMargin } from './utils';

/**
 * Прибыль за всё время: итог и его разбор по договорам.
 *
 * Карточки «Всего ожидается» и «Всего получено» на главной показывают одно
 * число, и до сих пор считались прямо на месте. Чтобы открыть за ними детали,
 * нужен тот же счёт построчно — а две копии одной формулы разошлись бы при
 * первой же правке, и в деталях сумма не сошлась бы с карточкой. Поэтому счёт
 * один: карточка берёт итог, окно деталей — строки, из которых он сложен.
 *
 * Внимание: это не про текущий месяц. Помесячные карточки и их окно живут
 * в Dashboard отдельно и считают только платежи месяца.
 */

export interface ProfitTotalRow {
  saleId: string;
  customerId: string;
  customerName: string;
  productName: string;
  /** Деньги: уже полученные по договору или ещё ожидаемые */
  amount: number;
  /** Прибыль внутри этих денег */
  profit: number;
  /** Доля закрытия договора, 0..1 — сколько денег по нему уже получено */
  progress: number;
  startDate: string;
  status: Sale['status'];
}

export interface ProfitTotals {
  /** Итог для карточки «Всего получено» */
  receivedProfit: number;
  /** Итог для карточки «Всего ожидается» */
  expectedProfit: number;
  received: ProfitTotalRow[];
  expected: ProfitTotalRow[];
}

export interface ProfitTotalsOptions {
  /** Выбранный счёт на главной. Пусто — считаем по всем */
  selectedAccountId?: string | null;
  /** Настройка «прибыль только с платежей»: первый взнос её не несёт */
  profitFromPaymentsOnly?: boolean;
}

const kopeks = (n: number) => Math.round(n * 100) / 100;

export const profitTotals = (
  sales: Sale[],
  customers: Customer[],
  { selectedAccountId, profitFromPaymentsOnly = false }: ProfitTotalsOptions = {}
): ProfitTotals => {
  const filteredSales = selectedAccountId
    ? (sales || []).filter(s => s.accountId === selectedAccountId)
    : (sales || []);

  const nameOf = (customerId: string) =>
    customers?.find(c => c.id === customerId)?.name || 'Неизвестно';

  let receivedProfit = 0;
  let expectedProfit = 0;
  const received: ProfitTotalRow[] = [];
  const expected: ProfitTotalRow[] = [];

  filteredSales.forEach(sale => {
    // Служебные договоры — это движения капитала инвесторов, а не продажи
    if (sale.customerId.startsWith('system_')) return;
    if (!sale.buyPrice || sale.buyPrice <= 0) return;

    const profitMargin = saleProfitMargin(sale, profitFromPaymentsOnly);

    // Фактически полученное по договору: первый взнос плюс закрытые платежи
    const collectedPayments = sale.downPayment + (sale.paymentPlan || [])
      .filter(p => p.isPaid && p.isRealPayment !== false)
      .reduce((sum, p) => sum + p.amount, 0);

    // С настройкой «только с платежей» взнос прибыли не даёт — вычитаем его
    const profitBearing = collectedPayments
      - (profitFromPaymentsOnly ? Math.min(sale.downPayment, collectedPayments) : 0);
    // Копим итог из тех же округлённых значений, что показываем строками:
    // иначе на длинном списке итог карточки и сумма строк расходятся на рубли,
    // и человек справедливо решит, что где-то ошибка.
    const gotProfit = kopeks(profitBearing * profitMargin);
    receivedProfit += gotProfit;

    const progress = sale.totalAmount > 0
      ? Math.min(1, collectedPayments / sale.totalAmount)
      : 0;

    // Строку заводим на всё, что вносит вклад в итог, — включая переплату и
    // убыточный договор с отрицательной прибылью. Пропустить их значило бы
    // показать список, который не складывается в сумму на карточке.
    if (profitBearing !== 0) {
      received.push({
        saleId: sale.id,
        customerId: sale.customerId,
        customerName: nameOf(sale.customerId),
        productName: sale.productName,
        amount: kopeks(profitBearing),
        profit: gotProfit,
        progress,
        startDate: sale.startDate,
        status: sale.status,
      });
    }

    // Ожидается — всё, что по действующему договору ещё не получено
    if (sale.status === 'ACTIVE' || sale.status === 'DRAFT') {
      const expectedRemaining = sale.totalAmount - collectedPayments;
      const waitingProfit = kopeks(expectedRemaining * profitMargin);
      expectedProfit += waitingProfit;

      if (expectedRemaining !== 0) {
        expected.push({
          saleId: sale.id,
          customerId: sale.customerId,
          customerName: nameOf(sale.customerId),
          productName: sale.productName,
          amount: kopeks(expectedRemaining),
          profit: waitingProfit,
          progress,
          startDate: sale.startDate,
          status: sale.status,
        });
      }
    }
  });

  // Крупные договоры сверху: с них и начинают разбираться
  const byProfit = (a: ProfitTotalRow, b: ProfitTotalRow) => b.profit - a.profit;

  return {
    receivedProfit: kopeks(receivedProfit),
    expectedProfit: kopeks(expectedProfit),
    received: received.sort(byProfit),
    expected: expected.sort(byProfit),
  };
};
