// Образец договора → то, что увидит модель: PDF и фото уходят как есть (модель
// смотрит на картинку), Word разбирается в список абзацев и таблиц с признаками
// оформления (выравнивание, жирный, размер), потому что картинки у него нет.
const { unzipSync, strFromU8 } = require("fflate");
const { DOMParser } = require("@xmldom/xmldom");
const { PDFDocument } = require("pdf-lib");
const sharp = require("sharp");

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const MAX_PAGES = 8;

const detectType = (file) => {
  const b = file.buffer;
  if (b.subarray(0, 5).toString() === "%PDF-") return "pdf";
  if (b[0] === 0x50 && b[1] === 0x4b) return "docx";
  if (
    (b[0] === 0xff && b[1] === 0xd8) ||
    b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    (b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP")
  )
    return "image";
  throw new Error("Поддерживаются фото JPEG, PNG, WebP, PDF и Word DOCX.");
};

const children = (node, name) =>
  Array.from(node.childNodes).filter((n) => n.namespaceURI === W && n.localName === name);
const child = (node, name) => children(node, name)[0];
const on = (el) => !!el && !["0", "false", "none"].includes(el.getAttributeNS(W, "val") || "");

const paragraphInfo = (p) => {
  let text = "";
  let bold = 0, runs = 0, underline = 0, size = 0;
  const walk = (node) => {
    for (let n = node.firstChild; n; n = n.nextSibling) {
      if (n.namespaceURI !== W) continue;
      if (n.localName === "t") text += n.textContent;
      else if (n.localName === "tab") text += "\t";
      else if (n.localName === "br" || n.localName === "cr") text += "\n";
      else if (n.localName === "r") {
        const rPr = child(n, "rPr");
        const had = text.length;
        walk(n);
        if (text.length > had && text.slice(had).trim()) {
          runs++;
          if (on(child(rPr || n, "b"))) bold++;
          if (on(child(rPr || n, "u"))) underline++;
          size = Math.max(size, Number(child(rPr || n, "sz")?.getAttributeNS(W, "val")) || 0);
        }
      } else if (["hyperlink", "smartTag", "sdt", "sdtContent", "ins"].includes(n.localName)) walk(n);
    }
  };
  walk(p);
  const pPr = child(p, "pPr");
  const jc = child(pPr || p, "jc")?.getAttributeNS(W, "val");
  return {
    text,
    align: jc === "center" ? "center" : jc === "right" ? "right" : jc === "both" ? "justify" : "left",
    bold: runs > 0 && bold === runs,
    underlined: underline > 0,
    sizePt: size ? size / 2 : undefined,
    numbered: !!child(pPr || p, "numPr"),
  };
};

/** Word → { items: [{kind:'p'|'table', …}] }; бросает понятную ошибку */
const docxStructure = (buffer) => {
  let files;
  try {
    files = unzipSync(buffer, {
      filter: (f) => f.name === "word/document.xml" && f.originalSize < 5 * 1024 * 1024,
    });
  } catch {
    throw new Error("Не удалось прочитать DOCX. Сохраните образец как PDF.");
  }
  if (!files["word/document.xml"])
    throw new Error("Это не документ DOCX. Старый формат DOC нужно сохранить как DOCX или PDF.");
  const xml = strFromU8(files["word/document.xml"]);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Этот DOCX содержит неподдерживаемые XML-объекты.");
  const doc = new DOMParser({ onError: () => {} }).parseFromString(xml, "application/xml");
  const body = doc.getElementsByTagNameNS(W, "body")[0];
  if (!body) throw new Error("В файле нет текста документа.");
  const items = [];
  for (const n of Array.from(body.childNodes)) {
    if (n.namespaceURI !== W) continue;
    if (n.localName === "p") {
      const info = paragraphInfo(n);
      items.push({ kind: "p", ...info, text: info.text.slice(0, 1500) });
    } else if (n.localName === "tbl") {
      const rows = children(n, "tr").slice(0, 60).map((tr) =>
        children(tr, "tc").slice(0, 8).map((tc) =>
          children(tc, "p").map((p) => paragraphInfo(p).text).join(" ").trim().slice(0, 200),
        ),
      );
      items.push({ kind: "table", rows });
    }
    if (items.length > 600) throw new Error("Слишком большой документ. Разделите образец.");
  }
  if (!items.some((i) => i.kind === "table" || /\S/.test(i.text)))
    throw new Error("В документе нет текста.");
  return { items };
};

/** Файлы → части сообщения для модели */
const messageParts = async (files) => {
  const parts = [];
  let pages = 0;
  for (const file of files) {
    const type = detectType(file);
    if (type === "docx") {
      parts.push({
        type: "text",
        text: "Word-документ (абзацы и таблицы по порядку, с выравниванием и жирностью):\n" + JSON.stringify(docxStructure(file.buffer)),
      });
      pages++;
    } else if (type === "pdf") {
      let count;
      try {
        count = (await PDFDocument.load(file.buffer, { updateMetadata: false })).getPageCount();
      } catch {
        throw new Error("PDF повреждён или защищён паролем. Загрузите открытый PDF.");
      }
      pages += count;
      parts.push({
        type: "file",
        file: { filename: "sample.pdf", file_data: "data:application/pdf;base64," + file.buffer.toString("base64") },
      });
    } else {
      pages++;
      let jpeg;
      try {
        jpeg = await sharp(file.buffer, { limitInputPixels: 24e6 })
          .rotate()
          .resize({ width: 1800, height: 2600, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer();
      } catch {
        throw new Error("Не удалось открыть фотографию. Загрузите другое изображение.");
      }
      parts.push({ type: "image_url", image_url: { url: "data:image/jpeg;base64," + jpeg.toString("base64") } });
    }
    if (pages > MAX_PAGES) throw new Error(`Загрузите не больше ${MAX_PAGES} страниц.`);
  }
  return { parts, pages };
};

module.exports = { detectType, docxStructure, messageParts, MAX_PAGES };
