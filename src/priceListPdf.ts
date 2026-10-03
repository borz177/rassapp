import type { Product } from '../types';
import { serverFileUrl } from './platform';
import { withHtml2canvasTextFix, safeFileName } from './contractPdf';

/**
 * Прайс-лист товаров в PDF — чтобы отправить клиенту в WhatsApp или распечатать.
 *
 * Страницы верстаются обычным HTML за краем экрана и снимаются html2canvas, как
 * договор (см. contractPdf.ts): встроенные шрифты jsPDF не знают кириллицы. Каждая
 * страница — отдельный лист A4, раскладка фиксированная, поэтому разбивка на
 * страницы считается заранее, а не браузером.
 *
 * Фото товаров перед вёрсткой загружаются и ужимаются до PHOTO_MAX в JPEG: в снимок
 * идут уже готовые data-адреса (никаких запросов и CORS во время съёмки), а
 * PDF на сотню товаров весит единицы мегабайт, а не сотни.
 */

export type PriceListLayout = 'grid' | 'list';

export interface PriceListOptions {
  title: string;
  companyName?: string;
  phone?: string;
  note?: string;
  layout: PriceListLayout;
  showStock: boolean;
  showSku: boolean;
  /** Остаток товара на момент выгрузки (с учётом выбранного склада) */
  stockOf: (p: Product) => number;
  unitOf?: (p: Product) => string;
  currency?: string;
}

const PAGE_W = 794;   // A4 при 96 dpi
// Чёткость снимка страницы: ×3 — около 290 dpi, печатное качество. При ×2
// (190 dpi) мелкий текст цен и названий на печати и при увеличении в
// телефоне выглядел мыльным.
const RENDER_SCALE = 3;
// Фото в карточке занимает около 220 px страницы, то есть ~660 px снимка —
// берём с запасом, чтобы фото не было мутнее текста вокруг.
const PHOTO_MAX = 900;
const PAGE_H = 1123;
const PAD = 44;
const HEADER_FIRST = 128; // шапка первой страницы
const HEADER_NEXT = 56;   // короткая шапка следующих
const FOOTER = 48;

const GRID_COLS = 3;
const GRID_CARD_H = 268;
const GRID_GAP = 16;
const LIST_ROW_H = 76;

const esc = (s: unknown) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Обрезка по длине вместо overflow: html2canvas сдвигает текст вниз, и скрытый
 *  край срезал бы строку посередине */
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

const money = (n: number) =>
  (Number(n) || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 });

/** Фото → уменьшенный JPEG data-адрес. Не загрузилось — null, будет заглушка */
const loadPhoto = async (src: string | undefined): Promise<string | null> => {
  if (!src) return null;
  if (src.startsWith('data:')) return src;
  try {
    const res = await fetch(serverFileUrl(src), { mode: 'cors', cache: 'force-cache' });
    if (!res.ok) return null;
    const bitmap = await createImageBitmap(await res.blob());
    const k = Math.min(1, PHOTO_MAX / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * k), h = Math.round(bitmap.height * k);
    // Уменьшаем ступенями, не больше чем вдвое за шаг: одним шагом из 4000 px в
    // 900 браузер сглаживает грубо, и на краях товара появлялась «лесенка».
    let stepSrc: CanvasImageSource = bitmap;
    let sw = bitmap.width, sh = bitmap.height;
    while (sw / 2 > w) {
      const step = document.createElement('canvas');
      step.width = Math.round(sw / 2); step.height = Math.round(sh / 2);
      const sctx = step.getContext('2d');
      if (!sctx) break;
      sctx.imageSmoothingQuality = 'high';
      sctx.drawImage(stepSrc, 0, 0, step.width, step.height);
      stepSrc = step; sw = step.width; sh = step.height;
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(stepSrc, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    return canvas.toDataURL('image/jpeg', 0.9);
  } catch {
    return null;
  }
};

/** Не больше 4 загрузок одновременно — каталог в сотни фото не должен душить сеть */
const loadAll = async (products: Product[], onProgress?: (done: number, total: number) => void) => {
  const out = new Map<string, string | null>();
  let i = 0, done = 0;
  const worker = async () => {
    while (i < products.length) {
      const p = products[i++];
      out.set(p.id, await loadPhoto(p.images?.[0]));
      onProgress?.(++done, products.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, products.length) }, worker));
  return out;
};

const STYLES = `
.pl-page { width:${PAGE_W}px; height:${PAGE_H}px; padding:${PAD}px; background:#fff; color:#0f172a;
  font-family: Inter, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; position:relative; box-sizing:border-box; }
.pl-page * { box-sizing:border-box; }
.pl-head { display:flex; align-items:flex-end; justify-content:space-between; gap:24px;
  padding-bottom:18px; margin-bottom:22px; border-bottom:2px solid #0f172a; }
.pl-title { font-size:34px; font-weight:800; letter-spacing:-0.02em; line-height:1.05; margin:0; }
.pl-company { font-size:15px; font-weight:600; color:#475569; margin-top:8px; }
.pl-meta { text-align:right; font-size:12px; color:#64748b; line-height:1.6; }
.pl-meta b { color:#0f172a; font-size:15px; }
.pl-note { font-size:12px; color:#475569; margin:-8px 0 18px; }
.pl-head-small { display:flex; justify-content:space-between; font-size:12px; color:#64748b;
  padding-bottom:10px; margin-bottom:16px; border-bottom:1px solid #e2e8f0; }
.pl-head-small b { color:#0f172a; }
.pl-grid { display:grid; grid-template-columns:repeat(${GRID_COLS}, 1fr); gap:${GRID_GAP}px; }
.pl-card { height:${GRID_CARD_H}px; border:1px solid #e2e8f0; border-radius:16px; overflow:hidden; display:flex; flex-direction:column; }
.pl-photo { height:140px; background:#f1f5f9; display:flex; align-items:center; justify-content:center; overflow:hidden; }
.pl-photo img { width:100%; height:100%; object-fit:cover; display:block; }
.pl-ph { font-size:44px; font-weight:800; color:#cbd5e1; }
.pl-body { padding:10px 12px 12px; display:flex; flex-direction:column; flex:1; min-height:0; }
.pl-cat { font-size:10px; line-height:16px; font-weight:700; color:#6366f1; text-transform:uppercase; letter-spacing:0.06em; white-space:nowrap; }
.pl-name { font-size:13.5px; font-weight:600; line-height:18px; margin-top:1px; min-height:36px; }
.pl-sub { font-size:10.5px; line-height:16px; color:#94a3b8; margin-top:2px; min-height:16px; white-space:nowrap; }
.pl-price { margin-top:auto; font-size:20px; font-weight:800; letter-spacing:-0.01em; }
.pl-price small { font-size:12px; color:#64748b; font-weight:600; }
.pl-row { height:${LIST_ROW_H}px; display:flex; align-items:center; gap:14px; padding:0 4px; border-bottom:1px solid #eef2f7; }
.pl-row .pl-photo { width:60px; height:60px; border-radius:12px; flex-shrink:0; }
.pl-row .pl-ph { font-size:22px; }
.pl-row-main { flex:1; min-width:0; }
.pl-row-name { font-size:14px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.pl-row-sub { font-size:11px; color:#94a3b8; margin-top:3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.pl-row-price { font-size:18px; font-weight:800; white-space:nowrap; }
.pl-row-price small { font-size:11px; color:#64748b; font-weight:600; }
.pl-foot { position:absolute; left:${PAD}px; right:${PAD}px; bottom:22px; display:flex; justify-content:space-between;
  font-size:11px; color:#94a3b8; border-top:1px solid #e2e8f0; padding-top:10px; }
`;

const photoHtml = (url: string | null | undefined, name: string) =>
  `<div class="pl-photo">${url ? `<img src="${url}" alt="">` : `<span class="pl-ph">${esc((name.trim()[0] || '?').toUpperCase())}</span>`}</div>`;

const subLine = (p: Product, o: PriceListOptions) => {
  const parts: string[] = [];
  if (o.showSku && p.sku) parts.push(`арт. ${p.sku}`);
  if (o.showStock) {
    const n = o.stockOf(p);
    parts.push(n > 0 ? `в наличии: ${money(n)} ${o.unitOf?.(p) || 'шт'}` : 'под заказ');
  }
  return parts.join(' · ');
};

const priceHtml = (p: Product, o: PriceListOptions, cls: string) =>
  `<div class="${cls}">${money(p.price)} <small>${esc(o.currency || '₽')}${o.unitOf ? ` / ${esc(o.unitOf(p))}` : ''}</small></div>`;

/** Сколько товаров влезает на страницу */
const perPage = (layout: PriceListLayout, first: boolean, withNote: boolean) => {
  const head = first ? HEADER_FIRST + (withNote ? 22 : 0) : HEADER_NEXT;
  const room = PAGE_H - PAD * 2 - head - FOOTER;
  if (layout === 'grid') return GRID_COLS * Math.max(1, Math.floor((room + GRID_GAP) / (GRID_CARD_H + GRID_GAP)));
  return Math.max(1, Math.floor(room / LIST_ROW_H));
};

const paginate = (items: Product[], o: PriceListOptions): Product[][] => {
  const pages: Product[][] = [];
  let i = 0;
  while (i < items.length || pages.length === 0) {
    const n = perPage(o.layout, pages.length === 0, !!o.note);
    pages.push(items.slice(i, i + n));
    i += n;
    if (items.length === 0) break;
  }
  return pages;
};

const pageHtml = (items: Product[], o: PriceListOptions, photos: Map<string, string | null>,
                  index: number, total: number, count: number) => {
  const date = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  const head = index === 0
    ? `<div class="pl-head">
         <div><h1 class="pl-title">${esc(o.title || 'Прайс-лист')}</h1>
         ${o.companyName ? `<div class="pl-company">${esc(o.companyName)}</div>` : ''}</div>
         <div class="pl-meta">${o.phone ? `<b>${esc(o.phone)}</b><br>` : ''}Цены на ${esc(date)}<br>${count} ${count % 10 === 1 && count % 100 !== 11 ? 'позиция' : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 10 || count % 100 >= 20) ? 'позиции' : 'позиций'}</div>
       </div>${o.note ? `<div class="pl-note">${esc(o.note)}</div>` : ''}`
    : `<div class="pl-head-small"><b>${esc(o.title || 'Прайс-лист')}</b><span>${esc(o.companyName || '')}</span></div>`;

  const body = o.layout === 'grid'
    ? `<div class="pl-grid">${items.map(p => `
        <div class="pl-card">${photoHtml(photos.get(p.id), p.name)}
          <div class="pl-body">
            <div class="pl-cat">${esc(clip(p.category || '', 28))}</div>
            <div class="pl-name">${esc(clip(p.name, 46))}</div>
            <div class="pl-sub">${esc(clip(subLine(p, o), 34))}</div>
            ${priceHtml(p, o, 'pl-price')}
          </div>
        </div>`).join('')}</div>`
    : items.map(p => {
        const sub = [p.category, subLine(p, o)].filter(Boolean).join(' · ');
        return `<div class="pl-row">${photoHtml(photos.get(p.id), p.name)}
          <div class="pl-row-main"><div class="pl-row-name">${esc(p.name)}</div>
          ${sub ? `<div class="pl-row-sub">${esc(sub)}</div>` : ''}</div>
          ${priceHtml(p, o, 'pl-row-price')}</div>`;
      }).join('');

  const foot = `<div class="pl-foot"><span>${esc([o.companyName, o.phone].filter(Boolean).join(' · '))}</span><span>Стр. ${index + 1} из ${total}</span></div>`;
  return `<div class="pl-page">${head}${body}${foot}</div>`;
};

/**
 * Собрать PDF прайс-листа.
 * onProgress — для подписи на кнопке: загрузка фото и съёмка страниц идут заметное время.
 */
export const priceListPdfBlob = async (
  products: Product[],
  o: PriceListOptions,
  onProgress?: (text: string) => void
): Promise<Blob> => {
  onProgress?.('Загружаем фото…');
  const photos = await loadAll(products, (d, t) => onProgress?.(`Фото ${d} из ${t}`));
  const pages = paginate(products, o);

  const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([import('jspdf'), import('html2canvas')]);
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  pdf.setProperties({ title: o.title || 'Прайс-лист', author: o.companyName || '', creator: o.companyName || '' });

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;z-index:-1;pointer-events:none;';
  document.body.appendChild(host);
  try {
    for (let i = 0; i < pages.length; i++) {
      onProgress?.(`Страница ${i + 1} из ${pages.length}`);
      host.innerHTML = `<style>${STYLES}</style>${pageHtml(pages[i], o, photos, i, pages.length, products.length)}`;
      // Кадр на раскладку, декодирование фото и шрифты
      await new Promise(r => setTimeout(r, 60));
      await Promise.all([...host.querySelectorAll('img')].map(img => (img as HTMLImageElement).decode?.().catch(() => {})));
      if ((document as any).fonts?.ready) await (document as any).fonts.ready.catch(() => {});
      const page = host.querySelector('.pl-page') as HTMLElement;
      const canvas = await withHtml2canvasTextFix(() => html2canvas(page, {
        scale: RENDER_SCALE, backgroundColor: '#ffffff', logging: false, scrollX: 0, scrollY: 0,
      }));
      if (i > 0) pdf.addPage();
      // JPEG: на страницах фотографии — PNG весил бы в разы больше
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.93), 'JPEG', 0, 0, 210, 297);
    }
  } finally {
    host.remove();
  }
  return pdf.output('blob');
};

export const priceListFileName = (title: string) =>
  `${safeFileName(`${title || 'Прайс-лист'} ${new Date().toLocaleDateString('ru-RU')}`)}.pdf`;
