import type { CustomContractTemplate } from "../types";
import {
  TEMPLATE_FIELDS,
  COLUMN_TITLES,
  layoutOf,
} from "../shared/contractTemplate.js";
const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
const blank = "____________________";
const moneyFields = new Set(["totalAmount", "downPayment", "monthlyPayment"]);
/** Значение поля; пустая строка — значения нет (линия остаётся для записи от руки) */
const valueOf = (key: string, data: any): string => {
  if (!Object.hasOwn(TEMPLATE_FIELDS, key)) return "";
  if (data.isBlank && !["companyName", "sellerPhone"].includes(key)) return "";
  if (key === "startDate" || key === "customerBirthDate") {
    const d = new Date(data[key] || "");
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("ru-RU");
  }
  if (moneyFields.has(key))
    return typeof data[key] === "number"
      ? data[key].toLocaleString("ru-RU", { maximumFractionDigits: 2 })
      : "";
  return data[key] == null ? "" : String(data[key]).replace(/\s+/g, " ").trim();
};
const TOKEN = /\{\{\s*([^{}]+?)\s*\}\}/g;
/** Текст с полями: пустое поле — линия для записи, заполненное — просто значение */
const inline = (text: string, data: any): string =>
  esc(text).replace(TOKEN, (_, key) => esc(valueOf(key, data) || blank));
const money = (n: unknown) =>
  typeof n === "number" && Number.isFinite(n)
    ? n.toLocaleString("ru-RU", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })
    : "";
const dateText = (v: unknown) => {
  const d = new Date(String(v || ""));
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("ru-RU");
};

const sizeClass = (s?: string) => (s === "small" ? " cc-small" : s === "large" ? " cc-large" : "");
const alignStyle = (a?: string) => (a && a !== "left" ? ` style="text-align:${a}"` : "");

/** Одна ячейка строки: подпись + значение; пустое значение — линия, заполненное — без линии */
const cellHtml = (c: any, data: any): string => {
  const tokens = [...String(c.text || "").matchAll(TOKEN)].map((m) => m[1]);
  const empty = tokens.length > 0 && tokens.every((k) => !valueOf(k, data));
  const text = esc(String(c.text || "").replace(TOKEN, (_, k) => valueOf(k, data)));
  const line = c.fill && (empty || (!tokens.length && !String(c.text || "").trim()));
  const label = c.label ? `<span class="cc-lbl">${inline(c.label, data)}</span>` : "";
  const align = c.align && c.align !== "left" ? `text-align:${c.align};` : "";
  return `<div class="cc-cell" style="flex:${c.width} 1 0">${label}<span class="cc-val${line ? " cc-line" : ""}${c.bold ? " cc-b" : ""}" style="${align}">${text || (line ? "&nbsp;" : "")}</span></div>`;
};

const scheduleHtml = (b: any, data: any): string => {
  const rows: any[] = data.isBlank
    ? Array.from({ length: Math.max(b.rows || 8, 3) }, () => ({}))
    : data.rows || [];
  if (!rows.length) return "";
  const total = b.columns.reduce((n: number, c: any) => n + c.width, 0) || 1;
  const cols = b.columns.map((c: any) => `<col style="width:${((c.width / total) * 100).toFixed(2)}%">`).join("");
  const head = b.columns.map((c: any) => `<th>${esc(c.title || COLUMN_TITLES[c.key as keyof typeof COLUMN_TITLES] || "")}</th>`).join("");
  const cell = (key: string, r: any, i: number) =>
    key === "number" ? String(i + 1) : key === "date" ? dateText(r.date) : key === "paid" ? money(r.paid) : key === "remaining" ? money(r.remaining) : "";
  const body = rows
    .map((r, i) => `<tr>${b.columns.map((c: any) => `<td>${esc(data.isBlank && c.key === "number" ? i + 1 : data.isBlank ? "" : cell(c.key, r, i))}</td>`).join("")}</tr>`)
    .join("");
  return `<table class="custom-schedule"><colgroup>${cols}</colgroup><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
};

const blockHtml = (b: any, data: any): string => {
  switch (b.type) {
    case "title":
      return `<h1 class="cc-title${sizeClass(b.size)}${b.italic ? " cc-i" : ""}"${alignStyle(b.align)}>${inline(b.text, data)}</h1>`;
    case "text":
      return `<p class="${[b.bold ? "cc-b" : "", b.italic ? "cc-i" : "", sizeClass(b.size).trim()].filter(Boolean).join(" ")}"${alignStyle(b.align)}>${inline(b.text, data)}</p>`;
    case "row":
      return `<div class="cc-row">${b.cells.map((c: any) => cellHtml(c, data)).join("")}</div>`;
    case "list":
      return b.items
        .map((t: string, i: number) => `<div class="cc-li${sizeClass(b.size)}"><span class="cc-n">${i + 1}.</span><span>${inline(t, data)}</span></div>`)
        .join("");
    case "schedule":
      return scheduleHtml(b, data);
    case "signatures":
      return `<div class="cc-sign">${b.items.map((t: string) => `<div><div class="cc-sline"></div><div class="cc-cap">${inline(t, data)}</div></div>`).join("")}</div>`;
    case "gap":
      return `<div class="cc-gap" style="height:${(b.size || 1) * 6}pt"></div>`;
    case "pagebreak":
      return `<div class="cc-break"></div>`;
    default:
      return "";
  }
};

export const customContractFragment = (
  template: CustomContractTemplate,
  data: any,
): { html: string; styles: string } => {
  const font = [10, 11, 12, 13, 14].includes(template.fontSize) ? template.fontSize : 12;
  const family = template.fontFamily === "sans" ? "Arial, sans-serif" : '"Times New Roman", serif';
  const html = layoutOf(template).blocks.map((b: any) => blockHtml(b, data)).join("");
  return {
    html: `<div class="custom-contract">${html}</div>`,
    styles: `
.contract-sheet .custom-contract{font-family:${family};font-size:${font}pt;line-height:1.35;color:#111;background:#fff;padding:18mm 18mm;overflow-wrap:anywhere;}
.contract-sheet .custom-contract p{margin:0 0 4pt;white-space:pre-wrap;}
.contract-sheet .custom-contract .cc-title{font-family:inherit;font-size:1.2em;font-weight:bold;text-align:center;margin:0 0 12pt;line-height:1.3;}
.contract-sheet .custom-contract .cc-b{font-weight:bold}.contract-sheet .custom-contract .cc-i{font-style:italic}
.contract-sheet .custom-contract .cc-small{font-size:.85em}.contract-sheet .custom-contract .cc-large{font-size:1.2em}
.contract-sheet .cc-row{display:flex;align-items:flex-end;gap:16pt;margin:0 0 8pt;}
.contract-sheet .cc-cell{display:flex;align-items:flex-end;gap:5pt;min-width:0;}
.contract-sheet .cc-lbl{font-weight:bold;flex:0 0 auto;max-width:62%;overflow-wrap:normal;word-break:normal;}
.contract-sheet .cc-val{flex:1 1 auto;min-width:24pt;}
.contract-sheet .cc-line{border-bottom:1px solid #222;min-height:1.25em;}
.contract-sheet .cc-li{display:flex;gap:6pt;margin:0 0 3pt;text-align:justify;}.contract-sheet .cc-n{flex:0 0 auto;}
.contract-sheet .cc-gap{display:block;}
.contract-sheet .cc-sign{display:flex;gap:36pt;margin-top:8pt;}.contract-sheet .cc-sign>div{flex:1;}
.contract-sheet .cc-sline{border-bottom:1px solid #222;height:22pt;}.contract-sheet .cc-cap{text-align:center;font-size:.85em;font-style:italic;margin-top:3pt;}
.contract-sheet .custom-schedule{width:100%;border-collapse:collapse;margin:6pt 0;font-size:.85em;table-layout:fixed;}
.contract-sheet .custom-schedule td,.contract-sheet .custom-schedule th{border:1px solid #222;padding:5pt;text-align:center;overflow-wrap:anywhere;height:1.9em;}
.contract-sheet .custom-schedule th{font-weight:bold;background:#f4f4f4;}
@media print{@page{size:A4;margin:18mm}.contract-sheet{width:174mm!important;transform:none!important}.contract-sheet .custom-contract{padding:0}.custom-contract p{orphans:3;widows:3;}.custom-schedule thead{display:table-header-group;}.custom-schedule tr{break-inside:avoid;}.cc-row,.cc-li,.cc-sign{break-inside:avoid;}.cc-break{break-after:page;}}
`,
  };
};

/** Делим по блокам и строкам до снимка: длинный договор сохраняется читаемыми A4. */
export const paginateCustomContract = (host: HTMLElement): HTMLElement[] => {
  const original = host.querySelector<HTMLElement>(".custom-contract");
  if (!original) return [host];
  const blocks = Array.from(original.children) as HTMLElement[];
  const pages: HTMLElement[] = [];
  const height = 1122; // A4 при ширине 794 px
  let page: HTMLElement, content: HTMLElement;
  const addPage = () => {
    page = document.createElement("div");
    page.className = "contract-sheet custom-pdf-page";
    page.style.cssText = `width:794px;height:${height}px;background:#fff;overflow:hidden;box-sizing:border-box;`;
    content = document.createElement("div");
    content.className = "custom-contract";
    page.append(content);
    host.append(page);
    pages.push(page);
    if (pages.length > 40)
      throw new Error(
        "Договор получился длиннее 40 страниц. Сократите текст или размер шрифта.",
      );
  };
  const fits = () => content.getBoundingClientRect().height <= height - 2;
  const used = () => content.children.length > 0;
  const append = (block: HTMLElement) => {
    content.append(block);
    if (fits()) return;
    block.remove();
    if (used()) addPage();
    content.append(block);
    if (fits()) return;
    block.remove();
    if (block.tagName === "TABLE") {
      const rows = Array.from(
        block.querySelectorAll("tbody tr"),
      ) as HTMLElement[];
      let table: HTMLTableElement, body: HTMLTableSectionElement;
      const newTable = () => {
        table = block.cloneNode(false) as HTMLTableElement;
        const head = block.querySelector("thead");
        if (head) table.append(head.cloneNode(true));
        body = document.createElement("tbody");
        table.append(body);
        content.append(table);
      };
      newTable();
      for (const row of rows) {
        body.append(row);
        if (!fits()) {
          row.remove();
          if (!body.children.length)
            throw new Error(
              "Строка графика не помещается на страницу. Уменьшите шрифт.",
            );
          addPage();
          newTable();
          body.append(row);
        }
      }
      return;
    }
    const text = block.textContent || "";
    let rest = text;
    while (rest.length) {
      const piece = block.cloneNode(false) as HTMLElement;
      content.append(piece);
      let lo = 1,
        hi = rest.length,
        best = 0;
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        piece.textContent = rest.slice(0, mid);
        if (fits()) {
          best = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      if (!best)
        throw new Error(
          "Не удалось разместить текст на странице. Уменьшите шрифт.",
        );
      if (best < rest.length) {
        const space = rest.lastIndexOf(" ", best);
        if (space > best / 2) best = space + 1;
      }
      piece.textContent = rest.slice(0, best);
      rest = rest.slice(best);
      if (rest) addPage();
    }
  };
  original.remove();
  addPage();
  for (const block of blocks) {
    // Явный разрыв страницы: следующий блок — с нового листа
    if (block.classList.contains("cc-break")) {
      if (used()) addPage();
      continue;
    }
    append(block);
  }
  return pages;
};
