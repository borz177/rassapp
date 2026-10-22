/**
 * Личные печатные формы. Шаблон — список блоков (заголовок, текст, строка с
 * полями, нумерованные условия, таблица графика, подписи), а не готовая
 * вёрстка: приложение само рисует из него договор, поэтому ничего не вылезает
 * за край, а график переносится на следующий лист. Только известные поля,
 * без HTML и скриптов.
 */
export const TEMPLATE_LIMIT = 10;
export const MAX_BLOCKS = 120;
export const MAX_TEXT = 3000;
export const BLOCK_TYPES = ["title", "text", "row", "list", "schedule", "signatures", "gap", "pagebreak"];
export const ALIGNS = ["left", "center", "right", "justify"];
export const SIZES = ["small", "normal", "large"];
export const COLUMN_KEYS = ["number", "date", "paid", "remaining", "signature", "blank"];
export const COLUMN_TITLES = { number: "№", date: "Дата", paid: "Сумма", remaining: "Остаток долга", signature: "Подпись", blank: "" };
export const TEMPLATE_FIELDS = {
  companyName: "Название продавца",
  sellerPhone: "Телефон продавца",
  contractNumber: "Номер договора",
  startDate: "Дата договора",
  customerName: "ФИО покупателя",
  customerPhone: "Телефон покупателя",
  customerPhone2: "Второй телефон покупателя",
  customerBirthDate: "Дата рождения покупателя",
  passportSeries: "Серия паспорта",
  passportNumber: "Номер паспорта",
  passportIssuedBy: "Кем выдан паспорт",
  customerAddress: "Адрес покупателя",
  guarantorName: "ФИО поручителя",
  guarantorPhone: "Телефон поручителя",
  guarantorPhone2: "Второй телефон поручителя",
  guarantorPassportSeries: "Серия паспорта поручителя",
  guarantorPassportNumber: "Номер паспорта поручителя",
  guarantorPassportIssuedBy: "Кем выдан паспорт поручителя",
  guarantorAddress: "Адрес поручителя",
  productName: "Наименование товара",
  totalAmount: "Цена договора",
  downPayment: "Первый взнос",
  installments: "Срок в месяцах",
  monthlyPayment: "Ежемесячный платёж",
};

export const isCustomTemplateId = (id) =>
  typeof id === "string" && /^CUSTOM:ct_[a-f0-9]{24,40}$/.test(id);
export const templateTokens = (text) =>
  [...String(text || "").matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map((m) => m[1]);

const str = (v, max = MAX_TEXT) => (typeof v === "string" ? v.replace(/\r\n?/g, "\n").slice(0, max) : "");
const pick = (v, list, def) => (list.includes(v) ? v : def);
const clampInt = (v, min, max, def) => (Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Math.round(Number(v)))) : def);
/** Неизвестные поля не печатаем как «{{…}}», а убираем из текста */
const cleanText = (v, max = MAX_TEXT) =>
  str(v, max).replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (m, k) =>
    Object.hasOwn(TEMPLATE_FIELDS, k) && k !== "paymentSchedule" ? `{{${k}}}` : "",
  );

/** Один блок → проверенный блок с только допустимыми полями; null — выбросить */
export const normalizeBlock = (b) => {
  if (!b || typeof b !== "object" || !BLOCK_TYPES.includes(b.type)) return null;
  const base = { type: b.type };
  if (b.type === "title" || b.type === "text") {
    return {
      ...base,
      text: cleanText(b.text),
      align: pick(b.align, ALIGNS, b.type === "title" ? "center" : "left"),
      bold: !!b.bold,
      italic: !!b.italic,
      size: pick(b.size, SIZES, "normal"),
    };
  }
  if (b.type === "row") {
    const cells = (Array.isArray(b.cells) ? b.cells : []).slice(0, 4).map((c) => ({
      label: cleanText(c?.label, 200),
      text: cleanText(c?.text, 500),
      width: clampInt(c?.width, 10, 100, 50),
      fill: c?.fill !== false,
      bold: !!c?.bold,
      align: pick(c?.align, ["left", "center", "right"], "left"),
    }));
    return cells.length ? { ...base, cells } : null;
  }
  if (b.type === "list") {
    const items = (Array.isArray(b.items) ? b.items : []).slice(0, 60).map((x) => cleanText(x, 1500)).filter((x) => x.trim());
    return items.length ? { ...base, items, size: pick(b.size, SIZES, "normal") } : null;
  }
  if (b.type === "schedule") {
    const columns = (Array.isArray(b.columns) ? b.columns : [])
      .filter((c) => c && COLUMN_KEYS.includes(c.key))
      .slice(0, 6)
      .map((c) => ({ key: c.key, title: str(c.title, 60), width: clampInt(c.width, 5, 90, 20) }));
    if (!columns.length) return null;
    return { ...base, columns, rows: clampInt(b.rows, 0, 40, 8) };
  }
  if (b.type === "signatures") {
    const items = (Array.isArray(b.items) ? b.items : []).slice(0, 4).map((x) => cleanText(x, 80)).filter((x) => x.trim());
    return items.length ? { ...base, items } : null;
  }
  if (b.type === "gap") return { ...base, size: clampInt(b.size, 1, 6, 1) };
  return base;
};

export const normalizeLayout = (layout) => {
  const blocks = (Array.isArray(layout?.blocks) ? layout.blocks : []).slice(0, MAX_BLOCKS).map(normalizeBlock).filter(Boolean);
  return { blocks };
};

/** Готовый пример для ручного создания: простой договор, который можно менять */
export const starterLayout = () =>
  normalizeLayout({
    blocks: [
      { type: "title", text: "ДОГОВОР КУПЛИ-ПРОДАЖИ № {{contractNumber}}" },
      { type: "row", cells: [{ label: "Дата:", text: "{{startDate}}", width: 40, fill: true }, { label: "Продавец:", text: "{{companyName}}", width: 60, fill: false }] },
      { type: "row", cells: [{ label: "Покупатель:", text: "{{customerName}}", width: 60, fill: true }, { label: "Телефон:", text: "{{customerPhone}}", width: 40, fill: true }] },
      { type: "row", cells: [{ label: "Паспорт:", text: "{{passportSeries}} {{passportNumber}}", width: 100, fill: true }] },
      { type: "row", cells: [{ label: "Адрес:", text: "{{customerAddress}}", width: 100, fill: true }] },
      { type: "row", cells: [{ label: "Товар:", text: "{{productName}}", width: 100, fill: true }] },
      { type: "row", cells: [{ label: "Стоимость:", text: "{{totalAmount}}", width: 50, fill: true }, { label: "Первый взнос:", text: "{{downPayment}}", width: 50, fill: true }] },
      { type: "row", cells: [{ label: "Срок, мес.:", text: "{{installments}}", width: 50, fill: true }, { label: "Платёж в месяц:", text: "{{monthlyPayment}}", width: 50, fill: true }] },
      { type: "gap", size: 1 },
      { type: "schedule", columns: ["number", "date", "paid", "remaining"].map((key) => ({ key, title: COLUMN_TITLES[key], width: key === "number" ? 10 : 30 })), rows: 8 },
      { type: "gap", size: 2 },
      { type: "text", text: "Продавец обязуется передать Покупателю товар, а Покупатель обязуется принять и оплатить его в рассрочку на указанных выше условиях." },
      { type: "gap", size: 4 },
      { type: "signatures", items: ["Продавец", "Покупатель"] },
    ],
  });

/** Прежний текстовый шаблон → блоки: строка — абзац, {{paymentSchedule}} — таблица */
export const textToLayout = (text) => {
  const blocks = [];
  const lines = str(text, 40000).split("\n");
  lines.forEach((line, index) => {
    if (!line.trim()) return void (blocks.at(-1)?.type !== "gap" && blocks.push({ type: "gap", size: 1 }));
    if (/^\s*\{\{\s*paymentSchedule\s*\}\}\s*$/.test(line))
      return void blocks.push({ type: "schedule", columns: ["number", "date", "paid", "remaining"].map((key) => ({ key, title: COLUMN_TITLES[key], width: key === "number" ? 10 : 30 })), rows: 8 });
    blocks.push(index === 0 && line.length < 150 ? { type: "title", text: line } : { type: "text", text: line });
  });
  return normalizeLayout({ blocks });
};

/** Блоки шаблона: свои или собранные из прежнего текста */
export const layoutOf = (t) => (t?.layout?.blocks ? normalizeLayout(t.layout) : textToLayout(t?.text || ""));

/** Тексты блока, в которых встречаются поля */
export const blockTexts = (b) =>
  b.type === "title" || b.type === "text"
    ? [b.text]
    : b.type === "row"
      ? b.cells.flatMap((c) => [c.label, c.text])
      : b.type === "list" || b.type === "signatures"
        ? b.items
        : [];
/** Какие поля использует шаблон (для формы оформления договора) */
export const layoutTokens = (layout) => [
  ...new Set(layout.blocks.flatMap((b) => blockTexts(b).flatMap((t) => templateTokens(t)))),
];

export const templateErrors = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return ["Неверный формат шаблона."];
  const errors = [];
  if (!/^ct_[a-f0-9]{24,40}$/.test(value.id || ""))
    errors.push("Неверный идентификатор шаблона.");
  if (typeof value.name !== "string" || !value.name.trim() || value.name.length > 80)
    errors.push("Укажите название до 80 символов.");
  if (value.layout !== undefined && (!Array.isArray(value.layout?.blocks) || value.layout.blocks.length > MAX_BLOCKS))
    errors.push(`В шаблоне может быть до ${MAX_BLOCKS} блоков.`);
  const layout = layoutOf(value);
  if (!layout.blocks.length) errors.push("Добавьте в шаблон хотя бы один блок.");
  if (JSON.stringify(layout).length > 120000) errors.push("Шаблон слишком большой.");
  if (!["serif", "sans"].includes(value.fontFamily)) errors.push("Выберите шрифт шаблона.");
  if (![10, 11, 12, 13, 14].includes(value.fontSize)) errors.push("Размер шрифта должен быть от 10 до 14.");
  return errors;
};
export const normalizeTemplate = (value) => {
  const errors = templateErrors(value);
  if (errors.length) throw new Error(errors[0]);
  return {
    id: value.id,
    name: value.name.trim(),
    fontFamily: value.fontFamily,
    fontSize: value.fontSize,
    createdAt: typeof value.createdAt === "string" ? value.createdAt.slice(0, 40) : new Date().toISOString(),
    layout: layoutOf(value),
  };
};
export const normalizeTemplateList = (list) => {
  if (!Array.isArray(list) || list.length > TEMPLATE_LIMIT)
    throw new Error(`Можно сохранить до ${TEMPLATE_LIMIT} личных шаблонов.`);
  const normalized = list.map(normalizeTemplate);
  if (new Set(normalized.map((t) => t.id)).size !== normalized.length)
    throw new Error("Идентификаторы шаблонов должны быть разными.");
  return normalized;
};
/** Снимок формы живёт с договором, независимо от переименований и удаления в профиле. */
export const templateForSale = (sale, settings, allowCustom = true) => {
  if (sale.contractTemplateSnapshot) {
    const snapshot = normalizeTemplate(sale.contractTemplateSnapshot);
    if (sale.contractTemplateId !== `CUSTOM:${snapshot.id}`)
      throw new Error("Версия шаблона не соответствует договору.");
    return { id: sale.contractTemplateId, snapshot };
  }
  // Без закреплённой формы договор печатается по текущему выбору в настройках.
  const defaultId = settings?.contractTemplate || "MODERN";
  const id =
    sale.contractTemplateId ||
    (!allowCustom && isCustomTemplateId(defaultId) ? "MODERN" : defaultId);
  if (isCustomTemplateId(id)) {
    const found = (settings?.customContractTemplates || []).find(
      (t) => `CUSTOM:${t.id}` === id,
    );
    if (!found || !allowCustom)
      throw new Error(
        "Выбранный личный шаблон недоступен. Выберите другую форму договора.",
      );
    return { id, snapshot: normalizeTemplate(found) };
  }
  return { id: id === "CLASSIC" ? "CLASSIC" : "MODERN", snapshot: undefined };
};
