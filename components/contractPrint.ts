/**
 * Печать договора — одна на все экраны.
 *
 * Правила внутри тонкие: какие строки графика показывать, чем заменять
 * плановый месяц после частичной оплаты, как считать накопительный остаток.
 * Пока функция жила внутри экрана «Договоры», напечатать договор из карточки
 * клиента можно было только копией — а две копии таких правил неизбежно
 * разошлись бы. Поэтому она здесь, и оба экрана зовут её.
 */

import { Sale, Customer, User, AppSettings, Payment } from '../types';
import { buildContractHtml, resolveContractTemplate } from '../src/contractTemplates';
import { contractNumbers, escapeHtml, formatDate, getSellerPhone, formatRuPhone } from '../src/utils';
import { contractDocumentTitle } from '../src/contractPdf';
import { openPrintPreview } from './PrintPreview';

export interface PrintContractContext {
  sale: Sale;
  /** Все договоры — по ним считается номер, он зависит от порядка оформления */
  sales: Sale[];
  customers: Customer[];
  appSettings?: AppSettings;
  user?: User | null;
  /** Вторая печатная форма доступна со «Стандарта» */
  contractTemplatesAllowed?: boolean;
}

export const printContract = ({
  sale, sales, customers, appSettings, user, contractTemplatesAllowed,
}: PrintContractContext) => {
  const numbers = contractNumbers(sales || []);
  const customer = customers.find(c => c.id === sale.customerId);
  const companyName = appSettings?.companyName || "Компания";
  // То же правило, что при оформлении и приходе: один договор — один телефон продавца
  const sellerPhone = formatRuPhone(getSellerPhone(user, appSettings));
  const hasGuarantor = !!sale.guarantorName;

  // 🔒 Одна таблица "График платежей": плановая дата месяца показывается ТОЛЬКО пока по этому
  // месяцу не прошло ни одной реальной оплаты. Как только на месяц пришли деньги — даже
  // частично — его плановая строка ЗАМЕНЯЕТСЯ строкой(-ами) с ФАКТИЧЕСКИМИ датами и суммами
  // платежей, а каждая последующая доплата по этому же месяцу добавляется своей строкой на
  // свою дату. Так в графике не остаётся ни пустого дубля рядом с оплатой, ни "потерянных"
  // плановых месяцев.
  // 🔒 ВАЖНО: сколько месяцев уже задето деньгами, считаем от ОБЩЕЙ суммы реальных платежей
  // (surplus), а не доверяем сохранённому флагу isPaid планового слота — на практике он бывает
  // неактуален (например, платёж импортирован/добавлен без пересчёта reconcileSalePaymentPlan).
  // "Остаток" — НАКОПИТЕЛЬНЫЙ остаток долга по договору, уменьшается только на реальных платежах.
  // 🔒 Классификация записей — ТОЧНО ТА ЖЕ, что на экране договора (CustomerDetails.tsx):
  // поступление  = p.isPaid && p.isRealPayment !== false
  // плановый долг = !p.isPaid && p.isRealPayment !== true
  // Ключевой момент — `isRealPayment !== false`, а не `=== true`: у старых записей поля
  // isRealPayment нет вообще, и строгая проверка `=== true` их отбрасывала. Из-за этого в
  // печатном договоре пропадали реально полученные платежи (экран показывал 5 поступлений,
  // печать — только 3), «Остаток» считался завышенным, а уже оплаченные месяцы ошибочно
  // попадали в список будущих дат.
  const plan = sale.paymentPlan || [];
  const isReceipt = (p: Payment) => !!p.isPaid && p.isRealPayment !== false;
  const isPendingScheduled = (p: Payment) => !p.isPaid && p.isRealPayment !== true;

  const byDate = (a: { date: string }, b: { date: string }) =>
      new Date(a.date).getTime() - new Date(b.date).getTime();

  const receipts = plan.filter(isReceipt).sort(byDate);

  // Остаток по будущим датам считаем так же, как экран: излишек уже полученных денег над
  // суммой закрытых плановых слотов гасит ближайшие месяцы, и полностью закрытые в таблицу
  // не попадают.
  const totalReceived = receipts.reduce((sum, p) => sum + p.amount, 0);
  const totalAllocated = plan
      .filter(p => p.isPaid && p.isRealPayment !== true)
      .reduce((sum, p) => sum + p.amount, 0);
  let surplus = Math.max(0, totalReceived - totalAllocated);

  const pendingRows = plan
      .filter(isPendingScheduled)
      .sort(byDate)
      .map(p => {
          const covered = Math.min(p.amount, surplus);
          surplus = Math.max(0, surplus - covered);
          return { date: p.date, due: p.amount - covered };
      })
      // Порог 1 ₽: копеечный остаток — артефакт округления долей платежа, а не долг
      // (та же логика, что на экране договора — CustomerDetails.tsx).
      .filter(p => p.due >= 1);

  // Порядок строк: СНАЧАЛА все фактические поступления (по возрастанию даты), ПОТОМ оставшиеся
  // плановые даты. Раньше обе группы сортировались вместе по дате, и пустая плановая строка
  // вклинивалась между двумя оплатами — в печатном документе это читается как "дыра" в платежах.
  // "Остаток" — НАКОПИТЕЛЬНЫЙ остаток долга, уменьшается только на фактических поступлениях.
  let currentDebt = sale.totalAmount - sale.downPayment;
  const scheduleRows = [
      ...receipts.map(p => ({ date: p.date, paid: p.amount })),
      ...pendingRows.map(p => ({ date: p.date, paid: 0 }))
  ].map(p => {
      if (p.paid > 0) currentDebt -= p.paid;
      return { date: p.date, paid: p.paid, remaining: Math.max(0, currentDebt) };
  });

  // Обе печатные формы собираются в src/contractTemplates.ts — там же, откуда
  // печатает экран оформления. Иначе выбранный в настройках бланк применялся бы
  // только к одному из двух путей печати.
  const htmlContent = buildContractHtml(
    resolveContractTemplate(appSettings?.contractTemplate, contractTemplatesAllowed),
    {
      companyName,
      sellerPhone,
      contractNumber: numbers[sale.id],
      customerName: customer?.name,
      customerPhone: formatRuPhone(customer?.phone),
      passportSeries: customer?.passportSeries,
      passportNumber: customer?.passportNumber,
      passportIssuedBy: customer?.passportIssuedBy,
      customerAddress: customer?.address,
      guarantorName: sale.guarantorName,
      guarantorPhone: formatRuPhone(sale.guarantorPhone),
      productName: sale.productName,
      totalAmount: sale.totalAmount,
      downPayment: sale.downPayment,
      installments: sale.installments,
      monthlyPayment: sale.paymentPlan?.[0]?.amount || 0,
      startDate: sale.startDate,
      rows: scheduleRows,
    }
  );

  // Просмотром поверх приложения, а не новым окном: в приложении с экрана «Домой»
  // и в APK у окна нет кнопки «назад», и выйти можно было только перезапуском.
  // withPrintButton больше не нужен: кнопку «Закрыть» и печать даёт просмотр,
  // а своя автопечать документа открыла бы диалог второй раз.
  openPrintPreview(htmlContent, {
    title: contractDocumentTitle({ number: numbers[sale.id], customerName: customer?.name || sale.productName }),
  });
};
