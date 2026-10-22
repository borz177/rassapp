const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeTemplate,
  normalizeTemplateList,
  layoutOf,
  layoutTokens,
  textToLayout,
  starterLayout,
  templateForSale,
} = require("../../shared/contractTemplate.js");
const { validateCustomSettings, stampSaleTemplate } = require("./settings");
const template = (suffix = "a") =>
  normalizeTemplate({
    id: "ct_" + suffix.repeat(32),
    name: "Личная форма",
    text: "ДОГОВОР\nПокупатель: {{customerName}}. Цена: {{totalAmount}} руб.\n{{paymentSchedule}}",
    fontFamily: "serif",
    fontSize: 12,
    createdAt: "2026-10-21T00:00:00Z",
  });
const textBlock = (text) => ({ type: "text", text, align: "left", bold: false, italic: false, size: "normal" });

test("template validation limits fields, size, count and duplicate IDs", () => {
  const t = template();
  assert.deepEqual(normalizeTemplate(t), t);
  assert.deepEqual(layoutTokens(t.layout), ["customerName", "totalAmount"]);
  // Неизвестное поле не печатается как «{{…}}» — его убирают
  const cleaned = normalizeTemplate({ ...t, layout: { blocks: [textBlock("Поле {{unknown}} и {{customerName}}")] } });
  assert.equal(cleaned.layout.blocks[0].text, "Поле  и {{customerName}}");
  assert.throws(() => normalizeTemplate({ ...t, fontSize: 90 }), /шрифта/);
  assert.throws(() => normalizeTemplate({ ...t, layout: { blocks: [] } }), /хотя бы один/);
  assert.throws(() => normalizeTemplateList([t, template()]), /разными/);
  assert.throws(() => normalizeTemplateList(Array.from({ length: 11 }, () => template())), /до 10/);
});
test("blocks are cleaned: only known types and keys, widths and counts are limited", () => {
  const dirty = normalizeTemplate({
    ...template(),
    layout: {
      blocks: [
        { type: "title", text: "<b>Договор</b>", evil: 1 },
        { type: "row", cells: [{ label: "ФИО", text: "{{customerName}}", width: 999 }, {}, {}, {}, {}] },
        { type: "script", text: "x" },
        { type: "schedule", columns: [{ key: "date", width: 30 }, { key: "hack", width: 10 }], rows: 500 },
        { type: "list", items: ["", "Условие"] },
      ],
    },
  });
  assert.deepEqual(dirty.layout.blocks.map((b) => b.type), ["title", "row", "schedule", "list"]);
  assert.equal(dirty.layout.blocks[0].evil, undefined);
  assert.equal(dirty.layout.blocks[1].cells.length, 4);
  assert.equal(dirty.layout.blocks[1].cells[0].width, 100);
  assert.equal(dirty.layout.blocks[2].columns.length, 1);
  assert.equal(dirty.layout.blocks[2].rows, 40);
  assert.deepEqual(dirty.layout.blocks[3].items, ["Условие"]);
});
test("old text templates become blocks, and the starter layout is valid", () => {
  const blocks = textToLayout("ДОГОВОР № {{contractNumber}}\nПокупатель {{customerName}}\n\n{{paymentSchedule}}").blocks;
  assert.deepEqual(blocks.map((b) => b.type), ["title", "text", "gap", "schedule"]);
  assert.equal(normalizeTemplate({ ...template(), layout: starterLayout() }).layout.blocks.length, 14);
  assert.equal(layoutOf({ text: "Привет {{customerName}}" }).blocks[0].type, "title");
});
test("saved sale uses its snapshot after profile edits, removal and subscription downgrade", () => {
  const t = template();
  const sale = { contractTemplateId: `CUSTOM:${t.id}` };
  const chosen = templateForSale(sale, { customContractTemplates: [t] });
  const saved = { ...sale, contractTemplateSnapshot: chosen.snapshot };
  t.layout = { blocks: [textBlock("Изменено")] };
  assert.match(
    JSON.stringify(templateForSale(saved, { customContractTemplates: [] }, false).snapshot.layout),
    /Покупатель/,
  );
  assert.equal(
    templateForSale({}, { contractTemplate: chosen.id }, false).id,
    "MODERN",
  );
});
test("existing sales without a fixed form use the selected custom template while fixed forms remain unchanged", () => {
  const t = template();
  const settings = {
    contractTemplate: `CUSTOM:${t.id}`,
    legacyContractTemplate: "CLASSIC",
    customContractTemplates: [t],
  };
  const old = { id: "old", type: "INSTALLMENT" };
  const chosen = templateForSale(old, settings, true);
  assert.equal(chosen.id, settings.contractTemplate);
  assert.deepEqual(chosen.snapshot, t);
  assert.equal(old.contractTemplateId, undefined);
  assert.equal(old.contractTemplateSnapshot, undefined);
  assert.equal(templateForSale(old, settings, false).id, "MODERN");
  assert.equal(
    templateForSale({ ...old, contractTemplateId: "CLASSIC" }, settings, true)
      .id,
    "CLASSIC",
  );
  const fixed = {
    ...old,
    contractTemplateId: chosen.id,
    contractTemplateSnapshot: chosen.snapshot,
  };
  assert.deepEqual(
    templateForSale(fixed, { contractTemplate: "MODERN" }, false),
    chosen,
  );
});
test("settings preserve libraries for old clients and refuse staff edits and mutations of existing versions", async () => {
  const previous = {
    customContractTemplates: [template()],
    contractTemplate: "MODERN",
    legacyContractTemplate: "CLASSIC",
  };
  const pool = {
    query: async (sql, args) => {
      assert.equal(args[0], "owner");
      return { rows: [{ data: previous }] };
    },
  };
  const oldClient = { companyName: "Компания" };
  await validateCustomSettings(
    pool,
    { role: "manager" },
    "owner",
    oldClient,
    true,
  );
  assert.deepEqual(
    oldClient.customContractTemplates,
    previous.customContractTemplates,
  );
  assert.equal(oldClient.legacyContractTemplate, "CLASSIC");
  const selectCustom = {
    contractTemplate: `CUSTOM:${template().id}`,
    customContractTemplates: previous.customContractTemplates,
  };
  await validateCustomSettings(
    pool,
    { role: "manager" },
    "owner",
    selectCustom,
    true,
  );
  assert.equal(selectCustom.legacyContractTemplate, "MODERN");
  await assert.rejects(
    () =>
      validateCustomSettings(
        pool,
        { role: "employee" },
        "owner",
        { customContractTemplates: [] },
        true,
      ),
    /владелец/,
  );
  await assert.rejects(
    () =>
      validateCustomSettings(
        pool,
        { role: "manager" },
        "owner",
        {
          customContractTemplates: [
            {
              ...template(),
              layout: { blocks: [textBlock("Цена {{totalAmount}}. Покупатель {{customerName}}. Изменённый текст")] },
            },
          ],
        },
        true,
      ),
    /новой версией/,
  );
});
test("sale snapshots are stamped from that owner library; a crafted client snapshot cannot borrow another owner template", async () => {
  const settings = {
    contractTemplate: `CUSTOM:${template().id}`,
    customContractTemplates: [template()],
  };
  let existing;
  const pool = {
    query: async (sql, args) => {
      assert.equal(
        sql.includes("type='settings'") ? args[0] : args[1],
        "owner",
      );
      return {
        rows: sql.includes("type='settings'")
          ? [{ data: settings }]
          : existing
            ? [{ data: existing }]
            : [],
      };
    },
  };
  const sale = { id: "s", type: "INSTALLMENT", customerId: "c" };
  await stampSaleTemplate(pool, "owner", sale, true);
  assert.equal(sale.contractTemplateSnapshot.name, "Личная форма");
  existing = structuredClone(sale);
  settings.customContractTemplates = [];
  const update = { ...sale, remainingAmount: 10 };
  await stampSaleTemplate(pool, "owner", update, false);
  assert.deepEqual(
    update.contractTemplateSnapshot,
    existing.contractTemplateSnapshot,
  );
  existing = undefined;
  await assert.rejects(
    () =>
      stampSaleTemplate(
        pool,
        "owner",
        {
          id: "another",
          type: "INSTALLMENT",
          customerId: "c",
          contractTemplateId: `CUSTOM:${template("b").id}`,
          contractTemplateSnapshot: template("b"),
        },
        true,
      ),
    /недоступен/,
  );
});

test("recognition route enforces role, consent, files and daily quota, isolating two owners", async () => {
  const express = require("express");
  const { registerContractTemplateRoutes } = require("./routes");
  const app = express();
  const counts = new Map();
  let recognitions = 0;
  const pool = {
    query: async (sql, args) => {
      if (sql.startsWith("CREATE")) return { rows: [] };
      const id = args[0],
        n = counts.get(id) || 0;
      if (n >= 5) return { rows: [] };
      counts.set(id, n + 1);
      return { rows: [{ attempts: n + 1 }] };
    },
  };
  const channel = registerContractTemplateRoutes(app, {
    pool,
    auth: (req, res, next) => {
      if (!req.get("x-owner")) return res.sendStatus(401);
      req.user = {
        id: req.get("x-owner"),
        role: req.get("x-role") || "manager",
      };
      next();
    },
    checkFeatureAccess: async () => ({ allowed: true }),
    recognize: async () => {
      recognitions++;
      return { name: "Тест", layout: template().layout, fontFamily: "serif", fontSize: 12, warnings: [], pages: 1 };
    },
  });
  await channel.ready;
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const post = async (owner, role = "manager", consent = true) => {
    const data = new FormData();
    data.append(
      "files",
      new Blob([new Uint8Array([255, 216, 255, 217])], { type: "image/jpeg" }),
      "sample.jpg",
    );
    if (consent) data.append("consent", "true");
    return fetch(
      `http://127.0.0.1:${server.address().port}/api/contract-templates/recognize`,
      {
        method: "POST",
        body: data,
        headers: { "x-owner": owner, "x-role": role },
      },
    );
  };
  try {
    assert.equal((await post("owner", "employee")).status, 403);
    assert.equal((await post("owner", "manager", false)).status, 400);
    for (let i = 0; i < 5; i++) assert.equal((await post("owner")).status, 200);
    assert.equal((await post("owner")).status, 429);
    assert.equal((await post("second-owner")).status, 200);
    assert.equal(recognitions, 6);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("disconnecting during multipart upload releases processing slots", async () => {
  const express = require("express");
  const http = require("http");
  const { registerContractTemplateRoutes } = require("./routes");
  const app = express();
  let entered = 0;
  registerContractTemplateRoutes(app, {
    pool: {
      query: async (sql) => ({
        rows: sql.startsWith("CREATE") ? [] : [{ attempts: 1 }],
      }),
    },
    auth: (req, res, next) => {
      req.user = { id: req.get("x-owner"), role: "manager" };
      next();
    },
    checkFeatureAccess: async () => {
      entered++;
      return { allowed: true };
    },
    recognize: async () => ({ name: "Тест", layout: template().layout }),
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const port = server.address().port;
  const requests = [];
  try {
    for (let i = 0; i < 3; i++) {
      const req = http.request({
        host: "127.0.0.1",
        port,
        path: "/api/contract-templates/recognize",
        method: "POST",
        headers: {
          "x-owner": "interrupted-" + i,
          "Content-Type": "multipart/form-data; boundary=unfinished",
        },
      });
      req.on("error", () => {});
      req.write(
        '--unfinished\r\nContent-Disposition: form-data; name="files"; filename="sample.jpg"\r\nContent-Type: image/jpeg\r\n\r\n',
      );
      requests.push(req);
    }
    for (let i = 0; i < 100 && entered < 3; i++)
      await new Promise((r) => setTimeout(r, 5));
    assert.equal(entered, 3);
    for (const req of requests) req.destroy();
    await new Promise((r) => setTimeout(r, 30));
    const data = new FormData();
    data.append("consent", "true");
    data.append(
      "files",
      new Blob([new Uint8Array([255, 216, 255, 217])]),
      "sample.jpg",
    );
    const response = await fetch(
      `http://127.0.0.1:${port}/api/contract-templates/recognize`,
      { method: "POST", body: data, headers: { "x-owner": "new-owner" } },
    );
    assert.equal(response.status, 200);
  } finally {
    for (const req of requests) req.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
});
