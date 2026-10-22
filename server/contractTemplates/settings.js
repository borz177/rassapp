const {
  normalizeTemplateList,
  normalizeTemplate,
  isCustomTemplateId,
  templateForSale,
} = require("../../shared/contractTemplate.js");
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const loadSettings = async (pool, userId) =>
  (
    await pool.query(
      `SELECT data FROM data_items WHERE user_id=$1 AND type='settings' ORDER BY updated_at DESC LIMIT 1`,
      [userId],
    )
  ).rows[0]?.data || {};
const validateCustomSettings = async (pool, user, userId, item, canUse) => {
  const previous = await loadSettings(pool, userId);
  if (!Object.hasOwn(item, "legacyContractTemplate"))
    item.legacyContractTemplate = previous.legacyContractTemplate;
  if (
    isCustomTemplateId(item.contractTemplate) &&
    !isCustomTemplateId(previous.contractTemplate)
  )
    item.legacyContractTemplate =
      previous.contractTemplate === "CLASSIC" ? "CLASSIC" : "MODERN";
  // Старая версия приложения не знает это поле: сохраняем библиотеку при её синхронизации.
  if (!Object.hasOwn(item, "customContractTemplates"))
    item.customContractTemplates = previous.customContractTemplates || [];
  const templates = normalizeTemplateList(item.customContractTemplates);
  const before = normalizeTemplateList(previous.customContractTemplates || []);
  if (JSON.stringify(templates) !== JSON.stringify(before)) {
    if (!["manager", "admin"].includes(user.role))
      throw bad("Личные шаблоны изменяет владелец аккаунта.", 403);
    if (!canUse) throw bad("Личные шаблоны недоступны на вашем тарифе.", 403);
    for (const t of templates) {
      const old = before.find((x) => x.id === t.id);
      if (old && JSON.stringify(old) !== JSON.stringify(t))
        throw bad("Изменённый шаблон нужно сохранить новой версией.");
    }
  }
  if (
    isCustomTemplateId(item.contractTemplate) &&
    !templates.some((t) => `CUSTOM:${t.id}` === item.contractTemplate)
  )
    throw bad("Выбранного шаблона нет в вашей библиотеке.");
  item.customContractTemplates = templates;
};
const stampSaleTemplate = async (pool, userId, item, canUse = true) => {
  if (
    (item.type !== "INSTALLMENT" &&
      !item.contractTemplateId &&
      !item.contractTemplateSnapshot) ||
    String(item.customerId || "").startsWith("system_")
  )
    return;
  const old = (
    await pool.query(
      `SELECT data FROM data_items WHERE id=$1 AND user_id=$2 AND type='sales'`,
      [item.id, userId],
    )
  ).rows[0]?.data;
  if (old?.contractTemplateSnapshot) {
    const snapshot = normalizeTemplate(old.contractTemplateSnapshot);
    if (
      item.contractTemplateSnapshot &&
      JSON.stringify(normalizeTemplate(item.contractTemplateSnapshot)) !==
        JSON.stringify(snapshot)
    )
      throw bad(
        "Печатная форма оформленного договора закреплена. Создайте отдельный договор для другой формы.",
      );
    item.contractTemplateId = old.contractTemplateId;
    item.contractTemplateSnapshot = snapshot;
    return;
  }
  if (old?.contractTemplateId) {
    item.contractTemplateId = old.contractTemplateId;
    delete item.contractTemplateSnapshot;
    return;
  }
  // Старый договор без выбора формы оставляем с прежним поведением при обычной правке.
  if (old && !item.contractTemplateId && !item.contractTemplateSnapshot) return;
  const settings = await loadSettings(pool, userId);
  const chosen = templateForSale(
    { ...item, contractTemplateSnapshot: undefined },
    settings,
    canUse,
  );
  item.contractTemplateId = chosen.id;
  if (chosen.snapshot) item.contractTemplateSnapshot = chosen.snapshot;
  else delete item.contractTemplateSnapshot;
};
module.exports = { validateCustomSettings, stampSaleTemplate, loadSettings };
