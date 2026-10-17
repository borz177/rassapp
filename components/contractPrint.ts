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
import { buildContractHtml, resolveContractTemplate, type ContractData, type ContractTemplateId } from '../src/contractTemplates';
import { contractScheduleRows } from '../src/contractSchedule';
import { contractNumbers, escapeHtml, formatDate, getSellerPhone, formatRuPhone } from '../src/utils';
import { contractDocumentTitle, contractFileName, contractPdfBlob, paymentDocumentTitle, pdfFileName } from '../src/contractPdf';
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

/**
 * Лист договора: выбранный бланк и данные для него. Одни на печать, PDF для
 * WhatsApp и чек об оплате — чек это тот же лист, где в графике уже стоят
 * внесённые платежи.
 */
export const contractDocument = ({
  sale, sales, customers, appSettings, user, contractTemplatesAllowed,
}: PrintContractContext): { template: ContractTemplateId; data: ContractData; number: string | undefined; customer: Customer | undefined } => {
  const numbers = contractNumbers(sales || []);
  const customer = customers.find(c => c.id === sale.customerId);
  const companyName = appSettings?.companyName || "Компания";
  // То же правило, что при оформлении и приходе: один договор — один телефон продавца
  const sellerPhone = formatRuPhone(getSellerPhone(user, appSettings));

  // График — общий расчёт с чеком оплаты и печатью при оформлении (src/contractSchedule.ts):
  // сначала поступления, потом непокрытые месяцы, без пустых строк между оплатами.
  const scheduleRows = contractScheduleRows(sale);

  // Обе печатные формы собираются в src/contractTemplates.ts — там же, откуда
  // печатает экран оформления. Иначе выбранный в настройках бланк применялся бы
  // только к одному из двух путей печати.
  return {
    template: resolveContractTemplate(appSettings?.contractTemplate, contractTemplatesAllowed),
    number: numbers[sale.id],
    customer,
    data: {
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
    },
  };
};

export const printContract = (ctx: PrintContractContext) => {
  const { template, data, number, customer } = contractDocument(ctx);
  const htmlContent = buildContractHtml(template, data);

  // Просмотром поверх приложения, а не новым окном: в приложении с экрана «Домой»
  // и в APK у окна нет кнопки «назад», и выйти можно было только перезапуском.
  // withPrintButton больше не нужен: кнопку «Закрыть» и печать даёт просмотр,
  // а своя автопечать документа открыла бы диалог второй раз.
  openPrintPreview(htmlContent, {
    title: contractDocumentTitle({ number, customerName: customer?.name || ctx.sale.productName }),
  });
};

/**
 * PDF клиенту: договор («Договор №… — ФИО.pdf») или чек об оплате
 * («Оплата — ФИО.pdf», тот же лист с внесёнными платежами).
 */
export const contractPdfFile = async (ctx: PrintContractContext, kind: 'contract' | 'receipt'): Promise<{ blob: Blob; fileName: string; customer: Customer | undefined }> => {
  const { template, data, number, customer } = contractDocument(ctx);
  const title = kind === 'receipt'
    ? paymentDocumentTitle(customer?.name)
    : contractDocumentTitle({ number, customerName: customer?.name });
  const blob = await contractPdfBlob(template, data, title);
  const fileName = kind === 'receipt'
    ? pdfFileName(paymentDocumentTitle(customer?.name))
    : contractFileName({ number, customerName: customer?.name });
  return { blob, fileName, customer };
};
