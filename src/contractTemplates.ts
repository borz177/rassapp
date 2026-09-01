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

/**
 * Формы, доступные не на всех тарифах. «Договор 2» — со «Стандарта» и выше.
 *
 * Список держим рядом с самими формами: разойдись он с проверкой доступа —
 * человек выбрал бы бланк, который потом молча заменится другим при печати.
 */
export const PAID_CONTRACT_TEMPLATES: ContractTemplateId[] = ['CLASSIC'];

/**
 * Какую форму печатать на самом деле.
 *
 * Тариф могли понизить уже после выбора: в настройках останется «Договор 2», а
 * права на него больше нет. Печатать по сохранённому значению значило бы отдавать
 * платную форму бесплатно; молча возвращаемся к базовой.
 */
export const resolveContractTemplate = (
  chosen: ContractTemplateId | undefined,
  allowPaid: boolean
): ContractTemplateId => {
  const id = chosen || 'MODERN';
  return !allowPaid && PAID_CONTRACT_TEMPLATES.includes(id) ? 'MODERN' : id;
};

export const CONTRACT_TEMPLATES: ContractTemplateInfo[] = [
  {
    id: 'MODERN',
    name: 'Договор 1',
    description: 'Короткий, на один лист: стороны, товар, график и подписи. Его же отправляют клиенту.',
  },
  {
    id: 'CLASSIC',
    name: 'Договор 2',
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

/**
 * Значение — или пустая линия под рукописное заполнение.
 *
 * Черта нужна ровно там, где писать будут от руки. Под уже подставленным
 * значением она превращает документ в бланк, который будто не заполнили: глаз
 * читает подчёркнутое как место для записи, а не как ответ.
 */
const orBlank = (value: string | number | undefined, width = '100%') => {
  const text = value === undefined || value === null ? '' : String(value).trim();
  return text
    ? `<span class="filled">${escapeHtml(text)}</span>`
    : `<span class="blank" style="min-width:${width}"></span>`;
};

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
    <div class="footer-container">
      <div class="footer">
        <div class="signature-block" style="width:${hasGuarantor ? '30%' : '45%'}">
          <div class="signature-line"></div><div class="signature-label">Продавец</div>
        </div>
        ${hasGuarantor ? '<div class="signature-block" style="width:30%"><div class="signature-line"></div><div class="signature-label">Поручитель</div></div>' : ''}
        <div class="signature-block" style="width:${hasGuarantor ? '30%' : '45%'}">
          <div class="signature-line"></div><div class="signature-label">Покупатель</div>
        </div>
      </div>
    </div>`;
};

const MODERN_STYLES = `
  /* Ровно те правила, по которым эта форма печаталась до появления выбора: Arial,
     12pt, дата справа, поля 20 мм. Вид не меняли намеренно — у людей на руках
     подписанные договоры, и печать «того же» документа не должна отличаться от
     прошлой. Изменилось только одно: правила вложены в .contract-sheet, потому
     что лист теперь бывает и внутри страницы приложения (снимок для PDF). */
  .contract-sheet {
    font-family: 'Arial', Helvetica, sans-serif;
    font-size: 12pt;
    line-height: 1.5;
    padding: 20mm;
    color: #000;
    background: #fff;
  }
  .contract-sheet h1 { text-align: center; font-size: 15pt; font-weight: bold; margin: 0 0 25px 0; text-transform: uppercase; }
  .contract-sheet .header-info { text-align: right; margin-bottom: 20px; font-size: 11pt; }
  .contract-sheet .field-row { display: flex; justify-content: space-between; margin-bottom: 10px; }
  .contract-sheet .two-col { display: flex; justify-content: space-between; margin-top: 10px; }
  .contract-sheet .field-label { font-weight: bold; }
  .contract-sheet .section { margin: 0 0 20px 0; }
  .contract-sheet .section > div { margin-bottom: 12px; }
  .contract-sheet .section > div:last-child { margin-bottom: 0; }
  .contract-sheet table { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 10.5pt; }
  .contract-sheet th, .contract-sheet td { border: 1px solid #000; padding: 8px; text-align: center; }
  .contract-sheet th { font-weight: bold; background: #f9f9f9; }
  .contract-sheet .content-wrapper { width: 100%; }
  .contract-sheet .obligation { margin: 25px 0; font-size: 11pt; line-height: 1.4; }
  .contract-sheet .footer-container { width: 100%; margin-top: 40px; break-inside: avoid; page-break-inside: avoid; }
  .contract-sheet .footer { display: flex; justify-content: space-between; align-items: flex-end; width: 100%; }
  .contract-sheet .signature-block { text-align: center; break-inside: avoid; page-break-inside: avoid; }
  .contract-sheet .signature-line { border-bottom: 1px solid #000; margin: 40px 0 5px 0; min-height: 1px; }
  .contract-sheet .signature-label { font-size: 10pt; font-style: italic; }
  @media print {
    .contract-sheet .field-row { flex-wrap: nowrap !important; gap: 0 !important; }
    .contract-sheet .field-row > span:last-child { text-align: right !important; margin-left: 10px; }
    .contract-sheet h1 { font-size: 14pt; }
    .contract-sheet table { font-size: 10pt; }
  }
`;

// ─── Классический ───────────────────────────────────────────────────────────

const classicBody = (d: ContractData): string => {
  // Строк ровно столько, сколько платежей по договору. График уже посчитан так
  // же, как в современной форме: каждое фактическое поступление — своя строка,
  // поэтому частичные оплаты добавляют строки сверх срока рассрочки, а не
  // сжимаются в один месяц. Пока графика нет (договор ещё не проведён) — рисуем
  // пустой бланк на срок рассрочки.
  const count = d.rows.length > 0 ? d.rows.length : Math.max(1, d.installments);
  const rows = Array.from({ length: count }).map((_, i) => {
    const p = d.rows[i];
    return `
      <tr>
        <td class="c num">${i + 1}.</td>
        <td class="c">${p && p.paid > 0.01 ? money(p.paid) : ''}</td>
        <td class="c">${p ? day(p.date) : '__ / __ 20___ г.'}</td>
        <td></td>
        <td></td>
      </tr>`;
  }).join('');

  const passport = [d.passportSeries, d.passportNumber].filter(Boolean).join(' № ');

  return `
    <h1>ДОГОВОР КУПЛИ-ПРОДАЖИ</h1>
    <div class="subtitle">товаров с условием о рассрочке платежа.</div>

    <div class="row-line">
      <span>«${orBlank(d.startDate ? new Date(d.startDate).getDate() : undefined, '46px')}»
      ${orBlank(d.startDate ? new Date(d.startDate).toLocaleDateString('ru-RU', { month: 'long' }) : undefined, '110px')}
      ${d.startDate ? new Date(d.startDate).getFullYear() : '202__'} г.</span>
      <span>№ ${orBlank(d.contractNumber, '120px')}</span>
    </div>

    <p class="para">
      ${escapeHtml(d.companyName)}, именуемый в дальнейшем «Продавец», и
      ${orBlank(d.customerName, '340px')}, именуемый в дальнейшем «Покупатель»,
      действующий на основании паспорта серия ${orBlank(passport, '150px')},
      выданный ${orBlank(d.passportIssuedBy, '280px')}
    </p>

    <div class="label-line fill">Адрес Покупателя ${orBlank(d.customerAddress)}</div>
    <div class="label-line fill">Адрес Доставки ${orBlank(d.deliveryAddress)}</div>
    <div class="label-line fill">Поручитель ${orBlank(
      d.guarantorName ? `${d.guarantorName}${d.guarantorPhone ? `, тел. ${d.guarantorPhone}` : ''}` : undefined
    )}</div>

    <p class="para">с другой стороны, заключили настоящий договор о нижеследующем.</p>

    <div class="clause"><b>4. Наименование, стоимость товаров и порядок расчетов:</b></div>
    <div class="label-line indent">4.1.1. Наименование Товара ${orBlank(d.productName, '430px')}</div>
    <div class="label-line indent">4.1.2. Общая стоимость товаров составляет
      ${orBlank(money(d.totalAmount), '200px')}) руб., с учетом НДС</div>
    <div class="label-line">Предоплата составляет
      ${orBlank(money(d.downPayment), '200px')}) руб., с учетом НДС</div>
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

    <div class="label-line sign fill">Продавец: Подпись <span class="blank grow"></span></div>
    <div class="label-line sign fill">Покупатель: Подпись <span class="blank grow"></span></div>
    <div class="label-line sign fill">Поручитель: Подпись <span class="blank grow"></span></div>
    <div class="label-line sign fill">Номер Покупателя: ${orBlank(d.customerPhone)}</div>
    <div class="label-line sign fill">Номер Поручителя: ${orBlank(d.guarantorPhone)}</div>`;
};

const CLASSIC_STYLES = `
  .contract-sheet { font-family: 'Times New Roman', serif; color: #000; background: #fff; padding: 16mm 17mm; font-size: 12pt; line-height: 1.32; }
  .contract-sheet h1 { text-align: center; font-size: 14pt; margin: 0; font-weight: bold; }
  .contract-sheet .subtitle { text-align: center; font-size: 11.5pt; margin-bottom: 10px; }
  .contract-sheet .row-line { display: flex; justify-content: space-between; margin-bottom: 6px; }
  .contract-sheet .para { margin: 5px 0; text-align: justify; }
  .contract-sheet .para.small { font-size: 11pt; margin: 6px 0; }
  .contract-sheet .clause { margin: 6px 0 3px; }
  .contract-sheet .indent { padding-left: 22px; }
  .contract-sheet .label-line { margin: 3px 0; }
  .contract-sheet .label-line.sign { margin: 7px 0; }
  /* Подпись и линия — на одной строке: с фиксированной шириной линия не влезала
     рядом с подписью и переносилась вниз, съедая по строке на каждый пункт. */
  .contract-sheet .label-line.fill { display: flex; align-items: baseline; gap: 6px; }
  .contract-sheet .label-line.fill .blank,
  .contract-sheet .label-line.fill .filled { flex: 1; min-width: 0 !important; }
  /* Пустая линия под рукописное заполнение — сплошная, как в типографском бланке */
  .contract-sheet .blank { display: inline-block; border-bottom: 1px solid #000; height: 14px; }
  .contract-sheet .filled { padding: 0 4px; }
  .contract-sheet table.schedule { width: 100%; border-collapse: collapse; margin: 10px 0; }
  /* Номер, сумма и дата стоят по центру клетки — и по ширине, и по высоте.
     Своя высота строки, а не унаследованная от листа: у листа она рассчитана на
     абзацы, и в клетке высотой 22px текст ложился прямо на линейку — строки
     выглядели слипшимися, а буквы задевали границу. */
  .contract-sheet table.schedule th, .contract-sheet table.schedule td {
    border: 1px solid #000; padding: 6px; font-size: 11pt; height: 28px;
    line-height: 1.15; vertical-align: middle;
  }
  .contract-sheet table.schedule th { text-align: center; font-weight: bold; }
  .contract-sheet td.c { text-align: center; }
  .contract-sheet td.num { font-weight: bold; }
`;

// ─── Сборка документа ───────────────────────────────────────────────────────

/**
 * Ширина листа A4 при 96 dpi. По ней раскладывается договор везде: на печати, в
 * предпросмотре и в PDF — иначе один и тот же документ выглядел бы по-разному в
 * зависимости от того, с чего его открыли.
 */
export const CONTRACT_SHEET_WIDTH_PX = 794;

/** Высота листа A4 при 96 dpi. По ней решаем, поместится ли договор на страницу. */
export const CONTRACT_SHEET_HEIGHT_PX = 1123;

const SHARED_HEAD = `
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; background: #fff; }
  .no-print { position: fixed; top: 10px; right: 10px; padding: 8px 14px; border: 0;
              border-radius: 8px; background: #4f46e5; color: #fff; font: inherit; cursor: pointer;
              z-index: 10; }

  /* Лист всегда раскладывается по ширине A4, а не по ширине экрана.
     Без этого договор, открытый с телефона, верстался на 375 точек: строки
     переносились, таблица растягивалась в высоту, и на бумаге тот же документ
     занимал две-три страницы вместо одной. На компьютере окно и так близко к
     A4, поэтому расхождение было видно только на телефоне. */
  .contract-sheet { width: ${CONTRACT_SHEET_WIDTH_PX}px; margin: 0 auto; transform-origin: top center; }

  @media print {
    /* Поля нулевые, а отступы даёт сам лист. Иначе печатная область уже экранной
       (A4 минус поля), текст перевёрстывается на другую ширину — и документ,
       занимавший один лист на экране, на бумаге уезжает на второй. */
    @page { size: A4 portrait; margin: 0; }
    .no-print { display: none }
    .contract-sheet { width: ${CONTRACT_SHEET_WIDTH_PX}px; margin: 0; transform: none !important; }
  }
`;

/**
 * Подгонка листа под узкий экран.
 *
 * Ширина листа фиксирована, поэтому на телефоне он не помещается и его пришлось
 * бы двигать пальцем. Уменьшаем целиком — так виден весь документ сразу, а
 * раскладка остаётся печатной. Только на экране: печать идёт по @page.
 */
const FIT_SCRIPT = `
  (function () {
    var sheet = document.querySelector('.contract-sheet');
    if (!sheet) return;

    /* Лист занимает страницу целиком — в обе стороны.
     *
     * Короткий договор на три платежа оставлял внизу половину пустого листа и
     * читался мелко; длинный не помещался и уезжал на второй. Задавать «правильный»
     * кегль руками бессмысленно: он зависит от числа платежей, а их бывает и три,
     * и пятнадцать. Поэтому базовый размер выбран удобным для чтения, а лист
     * подгоняется под страницу целиком — пропорционально растёт и текст, и поля,
     * и таблица.
     *
     * zoom, а не transform: transform не меняет высоту в потоке, и браузер разорвал
     * бы страницу в прежнем месте — выглядело бы как исправление, не будучи им.
     *
     * Пределы намеренно узкие. Ниже 0.65 договор становится нечитаемым, и честные
     * две страницы лучше. Выше 1.35 документ на один платёж превратился бы в
     * плакат с гигантскими буквами.
     */
    function fitPage() {
      sheet.style.zoom = '';
      var h = sheet.scrollHeight;
      if (!h) return;
      var z = ${CONTRACT_SHEET_HEIGHT_PX} / h;
      sheet.style.zoom = Math.min(1.35, Math.max(0.65, z));
    }

    /* Подгонка под узкий экран. Ширина листа фиксирована, поэтому на телефоне он
       не помещается и его пришлось бы двигать пальцем. Уменьшаем целиком — так
       виден весь документ сразу, а раскладка остаётся печатной. */
    function fitWidth() {
      var w = document.documentElement.clientWidth;
      var scale = Math.min(1, w / ${CONTRACT_SHEET_WIDTH_PX});
      sheet.style.transform = scale < 1 ? 'scale(' + scale + ')' : '';
      document.body.style.height = scale < 1 ? (sheet.offsetHeight * scale) + 'px' : '';
    }

    function refresh() { fitPage(); fitWidth(); }

    refresh();
    window.addEventListener('resize', refresh);
    window.addEventListener('beforeprint', function () {
      // На бумаге лист не уменьшают под ширину экрана — только под страницу.
      sheet.style.transform = '';
      document.body.style.height = '';
      fitPage();
    });
    window.addEventListener('afterprint', refresh);
    // Печать с телефона идёт через системный диалог, и beforeprint там срабатывает
    // не всегда — подгоняем заранее, до самого вызова печати.
    window.__fitContractForPrint = function () {
      sheet.style.transform = '';
      document.body.style.height = '';
      fitPage();
    };
  })();
`;

/**
 * Разметка договора без обёртки документа: тот же лист, но пригодный для вставки
 * в страницу приложения — из него снимается PDF для WhatsApp.
 *
 * Стили вложены в `.contract-sheet` намеренно. Без этого правила вроде `body`,
 * `h1` и `table` разъехались бы по всему приложению: лист живёт внутри общей
 * страницы, а не в отдельном окне.
 */
export const buildContractFragment = (
  template: ContractTemplateId,
  data: ContractData
): { html: string; styles: string } => ({
  html: template === 'CLASSIC' ? classicBody(data) : modernBody(data),
  styles: template === 'CLASSIC' ? CLASSIC_STYLES : MODERN_STYLES,
});

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
  const { html: body, styles } = buildContractFragment(template, data);

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
  <div class="contract-sheet">${body}</div>
  <script>${FIT_SCRIPT}<\/script>
  ${options.withPrintButton ? '<script>window.onload = function () { setTimeout(function () { if (window.__fitContractForPrint) window.__fitContractForPrint(); window.print(); }, 300); }<\/script>' : ''}
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
