import type { Product } from '../types';
import type { PriceListOptions } from './priceListPdf';

/**
 * Прайс-лист таблицей — как в 1С: № · Артикул · Наименование · Ед. · Остаток · Цена.
 *
 * В отличие от «карточек» и «списка», которые снимаются html2canvas картинкой,
 * эта таблица — настоящий текст: его можно выделить и скопировать, а PDF —
 * перевести в Excel или Word (конвертеры распознают строки и колонки). Ради
 * этого PDF рисуется средствами jsPDF напрямую, со встроенным шрифтом PT Sans
 * (встроенные шрифты jsPDF кириллицы не знают). Шрифт лежит в public/fonts и
 * едет внутри сборки, поэтому работает и без интернета.
 *
 * Товары сгруппированы по категориям — строка категории на всю ширину, как в
 * 1С. Шапка колонок повторяется на каждой странице, внизу — номер страницы.
 */

const FONT_REGULAR = 'fonts/PT_Sans-Web-Regular.ttf';
const FONT_BOLD = 'fonts/PT_Sans-Web-Bold.ttf';
const FAMILY = 'PTSans';

const fontCache = new Map<string, string>();
const loadFont = async (path: string): Promise<string> => {
  const hit = fontCache.get(path);
  if (hit) return hit;
  const res = await fetch(`${import.meta.env.BASE_URL || '/'}${path}`);
  if (!res.ok) throw new Error(`Шрифт не загрузился: ${path}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const b64 = btoa(bin);
  fontCache.set(path, b64);
  return b64;
};

const money = (n: number) =>
  (Number(n) || 0).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).replace(/ /g, ' ');

// Миллиметры, A4 книжная
const PAGE_W = 210, PAGE_H = 297, M = 14;
const ROW_PAD = 1.9;          // отступ текста в строке сверху и снизу
const LINE_H = 4.4;           // высота строки текста 9.5 pt
const HEAD_H = 8;             // шапка колонок
const FOOT_H = 10;

const INK = [15, 23, 42] as const;       // slate-900
const MUTED = [100, 116, 139] as const;  // slate-500
const LINE = [203, 213, 225] as const;   // slate-300
const HEAD_BG = [241, 245, 249] as const; // slate-100
const CAT_BG = [248, 250, 252] as const;  // slate-50

interface Col { key: string; title: string; w: number; align: 'left' | 'right' | 'center' }

export const priceListTableBlob = async (
  products: Product[],
  o: PriceListOptions,
  onProgress?: (text: string) => void,
): Promise<Blob> => {
  onProgress?.('Готовим таблицу…');
  const [{ default: jsPDF }, regular, bold] = await Promise.all([
    import('jspdf'), loadFont(FONT_REGULAR), loadFont(FONT_BOLD),
  ]);
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  pdf.addFileToVFS('PTSans-Regular.ttf', regular);
  pdf.addFont('PTSans-Regular.ttf', FAMILY, 'normal');
  pdf.addFileToVFS('PTSans-Bold.ttf', bold);
  pdf.addFont('PTSans-Bold.ttf', FAMILY, 'bold');
  pdf.setProperties({ title: o.title || 'Прайс-лист', author: o.companyName || '', creator: o.companyName || '' });

  const cur = o.currency || '₽';
  const unit = (p: Product) => o.unitOf?.(p) || 'шт';

  // Колонки: наименование забирает всё, что осталось
  const fixed: Col[] = [
    { key: 'n', title: '№', w: 10, align: 'center' },
    ...(o.showSku ? [{ key: 'sku', title: 'Артикул', w: 26, align: 'left' as const }] : []),
    { key: 'name', title: 'Наименование', w: 0, align: 'left' },
    { key: 'unit', title: 'Ед.', w: 13, align: 'center' },
    ...(o.showStock ? [{ key: 'stock', title: 'Остаток', w: 19, align: 'right' as const }] : []),
    { key: 'price', title: `Цена, ${cur}`, w: 26, align: 'right' },
  ];
  const tableW = PAGE_W - M * 2;
  const nameCol = fixed.find(c => c.key === 'name')!;
  nameCol.w = tableW - fixed.reduce((s, c) => s + c.w, 0);
  const xs: number[] = [];
  fixed.reduce((x, c) => { xs.push(x); return x + c.w; }, M);

  const setText = (style: 'normal' | 'bold', size: number, color: readonly number[]) => {
    pdf.setFont(FAMILY, style);
    pdf.setFontSize(size);
    pdf.setTextColor(color[0], color[1], color[2]);
  };
  const cellText = (text: string, i: number, y: number) => {
    const c = fixed[i];
    const pad = 1.8;
    const x = c.align === 'right' ? xs[i] + c.w - pad : c.align === 'center' ? xs[i] + c.w / 2 : xs[i] + pad;
    pdf.text(text, x, y, { align: c.align, baseline: 'top' });
  };

  let y = M;

  // ── Шапка документа (только на первой странице) ──
  const date = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  setText('bold', 20, INK);
  pdf.text(o.title || 'Прайс-лист', M, y, { baseline: 'top' });
  setText('normal', 9.5, MUTED);
  const meta = [o.phone, `Цены на ${date}`, `${products.length} поз.`].filter(Boolean) as string[];
  meta.forEach((t, i) => pdf.text(t, PAGE_W - M, y + i * 4.6, { align: 'right', baseline: 'top' }));
  y += 9;
  if (o.companyName) {
    setText('bold', 11, MUTED);
    pdf.text(o.companyName, M, y, { baseline: 'top' });
  }
  y = Math.max(y + 6, M + meta.length * 4.6 + 1);
  pdf.setDrawColor(INK[0], INK[1], INK[2]);
  pdf.setLineWidth(0.5);
  pdf.line(M, y, PAGE_W - M, y);
  y += 3.5;
  if (o.note) {
    setText('normal', 9.5, MUTED);
    const lines = pdf.splitTextToSize(o.note, tableW) as string[];
    pdf.text(lines, M, y, { baseline: 'top' });
    y += lines.length * LINE_H + 2;
  }
  y += 1.5;

  const drawHead = () => {
    pdf.setFillColor(HEAD_BG[0], HEAD_BG[1], HEAD_BG[2]);
    pdf.setDrawColor(LINE[0], LINE[1], LINE[2]);
    pdf.setLineWidth(0.2);
    pdf.rect(M, y, tableW, HEAD_H, 'FD');
    setText('bold', 8.5, MUTED);
    fixed.forEach((c, i) => {
      if (i > 0) pdf.line(xs[i], y, xs[i], y + HEAD_H);
      cellText(c.title, i, y + 2.3);
    });
    y += HEAD_H;
  };
  const bottom = PAGE_H - M - FOOT_H;
  const newPage = () => { pdf.addPage(); y = M; drawHead(); };

  drawHead();

  let lastCat: string | null = null;
  let n = 0;
  products.forEach((p, idx) => {
    if (idx % 40 === 0) onProgress?.(`Строки ${idx + 1}–${Math.min(idx + 40, products.length)} из ${products.length}`);
    const cat = p.category || 'Без категории';
    // Строка категории, как группа в 1С
    if (cat !== lastCat) {
      const h = LINE_H + ROW_PAD * 2;
      if (y + h + (LINE_H + ROW_PAD * 2) > bottom) newPage();
      pdf.setFillColor(CAT_BG[0], CAT_BG[1], CAT_BG[2]);
      pdf.setDrawColor(LINE[0], LINE[1], LINE[2]);
      pdf.rect(M, y, tableW, h, 'FD');
      setText('bold', 9.5, INK);
      pdf.text(cat, M + 1.8, y + ROW_PAD, { baseline: 'top' });
      y += h;
      lastCat = cat;
    }

    setText('normal', 9.5, INK);
    const nameLines = pdf.splitTextToSize(p.name, nameCol.w - 3.6) as string[];
    const skuLines = o.showSku ? pdf.splitTextToSize(p.sku || '', 26 - 3.6) as string[] : [];
    const lines = Math.max(1, nameLines.length, skuLines.length);
    const h = lines * LINE_H + ROW_PAD * 2;
    if (y + h > bottom) newPage();
    n++;

    pdf.setDrawColor(LINE[0], LINE[1], LINE[2]);
    pdf.setLineWidth(0.2);
    pdf.rect(M, y, tableW, h);
    fixed.forEach((c, i) => { if (i > 0) pdf.line(xs[i], y, xs[i], y + h); });

    const ty = y + ROW_PAD;
    fixed.forEach((c, i) => {
      switch (c.key) {
        case 'n': setText('normal', 9, MUTED); cellText(String(n), i, ty); break;
        case 'sku': setText('normal', 9, MUTED); pdf.text(skuLines, xs[i] + 1.8, ty, { baseline: 'top' }); break;
        case 'name': setText('normal', 9.5, INK); pdf.text(nameLines, xs[i] + 1.8, ty, { baseline: 'top' }); break;
        case 'unit': setText('normal', 9, MUTED); cellText(unit(p), i, ty); break;
        case 'stock': {
          const s = o.stockOf(p);
          setText('normal', 9, s > 0 ? INK : MUTED);
          cellText(s > 0 ? money(s) : 'под заказ', i, ty);
          break;
        }
        case 'price': setText('bold', 9.5, INK); cellText(money(p.price), i, ty); break;
      }
    });
    y += h;
  });

  // ── Подвал на каждой странице ──
  const total = pdf.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    pdf.setPage(i);
    setText('normal', 8.5, MUTED);
    const fy = PAGE_H - M - 3;
    pdf.text([o.companyName, o.phone].filter(Boolean).join(' · '), M, fy, { baseline: 'top' });
    pdf.text(`Стр. ${i} из ${total}`, PAGE_W - M, fy, { align: 'right', baseline: 'top' });
  }

  return pdf.output('blob');
};
