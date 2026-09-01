/**
 * Печатные формы договора рассрочки.
 *
 * Два вида — не украшение: у них разное назначение. «Современный» короткий и
 * читается с экрана, его отправляют в WhatsApp. «Классический» повторяет
 * привычный типографский бланк с реквизитами, паспортными данными, поручителем и
 * графой для подписи под каждым платежом — такой подписывают на руках и
 * подшивают в папку.
 *
 * Разметку держим здесь, а не в экранах: договор печатают из трёх мест, и три
 * копии верстки разошлись бы на первой же правке — у одного пользователя в
 * договоре появился бы пункт, которого нет у другого.
 */

export type ContractTemplateId = 'MODERN' | 'CLASSIC';

export interface ContractTemplateInfo {
  id: ContractTemplateId;
  name: string;
  description: string;
}

export const CONTRACT_TEMPLATES: ContractTemplateInfo[] = [
  {
    id: 'MODERN',
    name: 'Современный',
    description: 'Короткий, на один лист: стороны, товар, график и подписи. Его же отправляют клиенту.',
  },
  {
    id: 'CLASSIC',
    name: 'Классический',
    description: 'Полный бланк: паспортные данные, адреса, поручитель, ответственность сторон и подпись под каждым платежом.',
  },
];

/** Одна строка графика: что и когда платят, сколько остаётся. */
export interface ContractScheduleRow {
  date: string;
  paid: number;
  remaining: number;
}

export interface ContractData {
  companyName: string;
  sellerPhone: string;
  sellerExtraPhone?: string;
  customerName?: string;
  customerPhone?: string;
  passportSeries?: string;
  passportNumber?: string;
  passportIssuedBy?: string;
  customerAddress?: string;
  deliveryAddress?: string;
  guarantorName?: string;
  guarantorPhone?: string;
  contractNumber?: string;
  productName: string;
  totalAmount: number;
  downPayment: number;
  installments: number;
  monthlyPayment: number;
  startDate: string;
  rows: ContractScheduleRow[];
}

const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const money = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`;
const day = (d: string) => new Date(d).toLocaleDateString('ru-RU');

/** Пустая линия под рукописное заполнение, если значения нет. */
const orBlank = (value: string | undefined, width = '100%') =>
  value && value.trim()
    ? `<span class="filled">${escapeHtml(value)}</span>`
    : `<span class="blank" style="min-width:${width}"></span>`;

// ─── Современный ────────────────────────────────────────────────────────────

const modernBody = (d: ContractData): string => {
  const hasGuarantor = !!d.guarantorName;
  const rows = d.rows.length > 0
    ? d.rows.map((p, i) => `
        <tr>
          <td class="c">${i + 1}</td>
          <td class="c">${day(p.date)}</td>
          <td class="c">${p.paid > 0.01 ? money(p.paid) : ''}</td>
          <td class="c">${p.paid > 0.01 ? money(p.remaining) : ''}</td>
        </tr>`).join('')
    : Array.from({ length: Math.max(1, d.installments) }).map((_, i) => `
        <tr><td class="c">${i + 1}</td><td class="c" style="height:30px"></td><td></td><td></td></tr>`).join('');

  return `
    <h1>ДОГОВОР КУПЛИ-ПРОДАЖИ ТОВАРА В РАССРОЧКУ</h1>
    <div class="header-info">Дата: ${day(d.startDate)}${d.contractNumber ? ` · № ${escapeHtml(d.contractNumber)}` : ''}</div>
    <div class="content-wrapper">
      <div class="section">
        <div class="field-row">
          <span><span class="field-label">Продавец:</span> ${escapeHtml(d.companyName)}</span>
          <span>Тел: ${escapeHtml(d.sellerPhone)}</span>
        </div>
        <div class="field-row">
          <span><span class="field-label">Покупатель:</span> ${d.customerName ? escapeHtml(d.customerName) : '__________________'}</span>
          <span>Тел: ${d.customerPhone ? escapeHtml(d.customerPhone) : '+7 (___) ___-__-__'}</span>
        </div>
        ${hasGuarantor ? `<div class="field-row"><span><span class="field-label">Поручитель:</span> ${escapeHtml(d.guarantorName)}</span><span>Тел: ${escapeHtml(d.guarantorPhone || '')}</span></div>` : ''}
      </div>
      <div class="section">
        <div><span class="field-label">Товар:</span> ${escapeHtml(d.productName)}</div>
        <div class="two-col">
          <span><span class="field-label">Срок рассрочки:</span> ${d.installments} мес.</span>
          <span><span class="field-label">Стоимость:</span> ${money(d.totalAmount)}</span>
        </div>
        <div class="two-col">
          <span><span class="field-label">Ежемесячный платеж:</span> ${money(d.monthlyPayment)}</span>
          <span><span class="field-label">Первый взнос:</span> ${money(d.downPayment)}</span>
        </div>
      </div>
      <table>
        <thead><tr><th style="width:10%">№</th><th style="width:30%">Дата</th><th style="width:25%">Сумма</th><th style="width:35%">Остаток долга</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="obligation">
        Продавец обязуется передать Покупателю товар, а Покупатель обязуется принять
        и оплатить его в рассрочку на указанных выше условиях.
      </p>
    </div>
    <div class="footer">
      <div class="signature-block" style="width:${hasGuarantor ? '30%' : '45%'}">
        <div class="signature-line"></div><div class="signature-label">Продавец</div>
      </div>
      ${hasGuarantor ? '<div class="signature-block" style="width:30%"><div class="signature-line"></div><div class="signature-label">Поручитель</div></div>' : ''}
      <div class="signature-block" style="width:${hasGuarantor ? '30%' : '45%'}">
        <div class="signature-line"></div><div class="signature-label">Покупатель</div>
      </div>
    </div>`;
};

const MODERN_STYLES = `
  body { font-family: 'Times New Roman', serif; color: #000; padding: 24px; }
  h1 { text-align: center; font-size: 15pt; margin: 0 0 4px; }
  .header-info { text-align: center; font-size: 10.5pt; margin-bottom: 18px; }
  .section { margin-bottom: 14px; }
  .field-row, .two-col { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 6px; }
  .field-label { font-weight: bold; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th, td { border: 1px solid #000; padding: 5px 6px; font-size: 10.5pt; }
  th { background: #f1f1f1; }
  td.c, th { text-align: center; }
  .obligation { margin: 22px 0; font-size: 11pt; line-height: 1.45; }
  .footer { display: flex; justify-content: space-between; margin-top: 36px; }
  .signature-block { text-align: center; }
  .signature-line { border-bottom: 1px solid #000; height: 28px; }
  .signature-label { font-size: 10pt; margin-top: 4px; }
`;

// ─── Классический ───────────────────────────────────────────────────────────

const classicBody = (d: ContractData): string => {
  // Строк всегда столько, сколько платежей по договору, но не меньше двенадцати:
  // бланк с пустыми строками — привычная бумага, на ней дописывают от руки.
  const count = Math.max(12, d.rows.length, d.installments);
  const rows = Array.from({ length: count }).map((_, i) => {
    const p = d.rows[i];
    return `
      <tr>
        <td class="c num">${i + 1}.</td>
        <td class="c">${p && p.paid > 0.01 ? money(p.paid) : '<span class="dots"></span> руб.'}</td>
        <td class="c">${p ? day(p.date) : '<span class="dots-sm"></span> / <span class="dots-sm"></span> 20___ г.'}</td>
        <td></td>
        <td></td>
      </tr>`;
  }).join('');

  const passport = [d.passportSeries, d.passportNumber].filter(Boolean).join(' № ');

  return `
    <h1>ДОГОВОР КУПЛИ-ПРОДАЖИ</h1>
    <div class="subtitle">товаров с условием о рассрочке платежа.</div>

    <div class="row-line">
      <span>«<span class="ins w60">${d.startDate ? new Date(d.startDate).getDate() : ''}</span>»
      <span class="ins w110">${d.startDate ? new Date(d.startDate).toLocaleDateString('ru-RU', { month: 'long' }) : ''}</span>
      ${d.startDate ? new Date(d.startDate).getFullYear() : '202__'} г.</span>
      <span>№ <span class="ins w120">${escapeHtml(d.contractNumber || '')}</span></span>
    </div>

    <p class="para">
      ${escapeHtml(d.companyName)}, именуемый в дальнейшем «Продавец», и
      ${orBlank(d.customerName, '340px')}, именуемый в дальнейшем «Покупатель»,
      действующий на основании паспорта серия ${orBlank(passport, '150px')},
      выданный ${orBlank(d.passportIssuedBy, '280px')}
    </p>

    <div class="label-line">Адрес Покупателя ${orBlank(d.customerAddress, '520px')}</div>
    <div class="label-line">Адрес Доставки ${orBlank(d.deliveryAddress, '540px')}</div>
    <div class="label-line">Поручитель ${orBlank(
      d.guarantorName ? `${d.guarantorName}${d.guarantorPhone ? `, тел. ${d.guarantorPhone}` : ''}` : undefined,
      '560px'
    )}</div>

    <p class="para">с другой стороны, заключили настоящий договор о нижеследующем.</p>

    <div class="clause"><b>4. Наименование, стоимость товаров и порядок расчетов:</b></div>
    <div class="label-line indent">4.1.1. Наименование Товара ${orBlank(d.productName, '430px')}</div>
    <div class="label-line indent">4.1.2. Общая стоимость товаров составляет
      <span class="ins w200">${money(d.totalAmount)}</span>) руб., с учетом НДС</div>
    <div class="label-line">Предоплата составляет
      <span class="ins w200">${money(d.downPayment)}</span>) руб., с учетом НДС</div>
    <div class="clause indent">4.2. Расчеты производятся в кассу Продавца.</div>

    <table class="schedule">
      <thead>
        <tr>
          <th style="width:12%">Оплата</th>
          <th style="width:24%">Сумма</th>
          <th style="width:24%">Дата</th>
          <th style="width:20%">Подпись<br>продавца</th>
          <th style="width:20%">Подпись<br>покупателя</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <p class="para small">
      7.1 Настоящий договор вступает в силу с момента его подписания обеими сторонами и
      действует до полного выполнения сторонами всех принятых на себя обязательств в
      соответствии с условиями договора.
    </p>
    <div class="clause"><b>5. Ответственность Сторон:</b></div>
    <p class="para small">
      5.1 За неисполнение обязательств по настоящему договору стороны несут ответственность
      с действующим законодательством РФ.
    </p>
    <p class="para small">
      5.2 После подписания и соблюдения Договора сторонами, Товар возврату или обмену не подлежит.
    </p>
    <div class="clause"><b>6. Адреса и реквизиты сторон</b></div>

    <p class="para">
      Продавец: ${escapeHtml(d.companyName)} — Тел.: ${escapeHtml(d.sellerPhone)}${
        d.sellerExtraPhone ? ` — Тел.: ${escapeHtml(d.sellerExtraPhone)} (WhatsApp)` : ''
      }
    </p>

    <div class="label-line sign">Продавец: Подпись <span class="blank" style="min-width:420px"></span></div>
    <div class="label-line sign">Покупатель: Подпись <span class="blank" style="min-width:400px"></span></div>
    <div class="label-line sign">Поручитель: Подпись <span class="blank" style="min-width:400px"></span></div>
    <div class="label-line sign">Номер Покупателя: ${orBlank(d.customerPhone, '380px')}</div>
    <div class="label-line sign">Номер Поручителя: ${orBlank(d.guarantorPhone, '380px')}</div>`;
};

const CLASSIC_STYLES = `
  body { font-family: 'Times New Roman', serif; color: #000; padding: 26px 30px; font-size: 12pt; line-height: 1.35; }
  h1 { text-align: center; font-size: 14pt; margin: 0; font-weight: bold; }
  .subtitle { text-align: center; font-size: 12pt; margin-bottom: 14px; }
  .row-line { display: flex; justify-content: space-between; margin-bottom: 6px; }
  .para { margin: 6px 0; text-align: justify; }
  .para.small { font-size: 11pt; margin: 8px 0; }
  .clause { margin: 8px 0 4px; }
  .indent { padding-left: 22px; }
  .label-line { margin: 4px 0; }
  .label-line.sign { margin: 10px 0; }
  /* Пустая линия под рукописное заполнение — сплошная, как в типографском бланке */
  .blank { display: inline-block; border-bottom: 1px solid #000; height: 14px; }
  .ins { display: inline-block; border-bottom: 1px solid #000; text-align: center; padding: 0 4px; }
  .w60 { min-width: 60px } .w110 { min-width: 110px } .w120 { min-width: 120px } .w200 { min-width: 200px }
  .filled { border-bottom: 1px solid #000; padding: 0 4px; }
  .dots { display: inline-block; border-bottom: 1px solid #000; min-width: 110px; height: 13px; }
  .dots-sm { display: inline-block; border-bottom: 1px solid #000; min-width: 26px; height: 13px; }
  table.schedule { width: 100%; border-collapse: collapse; margin: 14px 0; }
  table.schedule th, table.schedule td { border: 1px solid #000; padding: 4px 6px; font-size: 11pt; height: 24px; }
  table.schedule th { text-align: center; font-weight: bold; }
  td.c { text-align: center; }
  td.num { font-weight: bold; }
`;

// ─── Сборка документа ───────────────────────────────────────────────────────

const SHARED_HEAD = `
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; }
  .no-print { position: fixed; top: 10px; right: 10px; padding: 8px 14px; border: 0;
              border-radius: 8px; background: #4f46e5; color: #fff; font: inherit; cursor: pointer; }
  @media print { .no-print { display: none } body { padding: 12mm } }
`;

/**
 * Готовый HTML-документ договора.
 *
 * `withPrintButton` — для окна печати; в предпросмотре кнопка не нужна, там
 * закрывают само окно приложения.
 */
export const buildContractHtml = (
  template: ContractTemplateId,
  data: ContractData,
  options: { withPrintButton?: boolean } = {}
): string => {
  const classic = template === 'CLASSIC';
  const body = classic ? classicBody(data) : modernBody(data);
  const styles = classic ? CLASSIC_STYLES : MODERN_STYLES;

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Договор купли-продажи</title>
  <style>${SHARED_HEAD}${styles}</style>
</head>
<body>
  ${options.withPrintButton ? '<button class="no-print" onclick="window.close()">✕ Закрыть</button>' : ''}
  ${body}
  ${options.withPrintButton ? '<script>window.onload = function () { setTimeout(function () { window.print(); }, 300); }<\/script>' : ''}
</body>
</html>`;
};

/** Образец для предпросмотра в настройках — с правдоподобными числами. */
export const sampleContractData = (companyName: string, sellerPhone: string): ContractData => {
  const start = new Date();
  const rows: ContractScheduleRow[] = Array.from({ length: 6 }).map((_, i) => {
    const date = new Date(start);
    date.setMonth(date.getMonth() + i + 1);
    return { date: date.toISOString(), paid: 5000, remaining: 30000 - 5000 * (i + 1) };
  });
  return {
    companyName: companyName || 'ООО «Пример»',
    sellerPhone: sellerPhone || '+7 (900) 000-00-00',
    customerName: 'Иванов Иван Иванович',
    customerPhone: '+7 (900) 111-22-33',
    passportSeries: '4501',
    passportNumber: '123456',
    passportIssuedBy: 'ОВД г. Москвы',
    customerAddress: 'г. Москва, ул. Примерная, д. 1',
    guarantorName: 'Петров Пётр Петрович',
    guarantorPhone: '+7 (900) 444-55-66',
    contractNumber: '0001',
    productName: 'Телефон Samsung Galaxy A55',
    totalAmount: 36000,
    downPayment: 6000,
    installments: 6,
    monthlyPayment: 5000,
    startDate: start.toISOString(),
    rows,
  };
};
