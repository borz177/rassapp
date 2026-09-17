import {
  buildContractFragment, CONTRACT_SHEET_WIDTH_PX,
  type ContractData, type ContractTemplateId,
} from './contractTemplates';

/**
 * PDF договора из той же вёрстки, что идёт на печать.
 *
 * Лист снимается html2canvas и кладётся картинкой на страницу A4. Рисовать тот же
 * документ второй раз средствами jsPDF нельзя: её встроенные шрифты кириллицы не
 * знают, и договор вышел бы набором вопросительных знаков — пришлось бы тащить в
 * бандл шрифт целиком. А снимок показывает ровно то, что человек видел в
 * предпросмотре: одна вёрстка — один результат.
 */

/** Во сколько раз снимок крупнее экранного листа: 794 px × 3 ≈ 290 dpi на A4. */
const SNAPSHOT_SCALE = 3;

/**
 * Правка для замера шрифта внутри html2canvas.
 *
 * Базовую линию текста библиотека меряет так: ставит в строку текст и рядом
 * картинку 1×1 с выравниванием по базовой линии. Но сброс стилей Tailwind делает
 * всем картинкам display: block — картинка уезжает на следующую строку, замер
 * получается на высоту строки больше, и весь текст в снимке рисуется ниже, чем
 * лежит на странице (у 12pt — примерно на 10 px). Линейки и рамки рисуются по
 * настоящим координатам, поэтому прочерки выглядели поднятыми над подписями, а
 * цифры в таблице — прижатыми к нижней черте.
 *
 * Правило задевает только служебную картинку html2canvas (её узнаём по data-адресу)
 * и живёт ровно на время снимка.
 */
const METRICS_FIX_CSS =
  'img[src^="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP"] { display: inline !important; }';

/** A4 в миллиметрах — в них же считает jsPDF. */
const PAGE_W_MM = 210;
const PAGE_H_MM = 297;

/**
 * Снимок листа договора.
 *
 * Лист собирается за краем экрана: показывать его человеку незачем, а вот
 * отрисовать браузер обязан — `visibility: hidden` html2canvas уважает и снял бы
 * пустоту. Ширина фиксированная, печатная: без неё лист на телефоне сверстался бы
 * на 375 точек и на бумаге занял бы две страницы вместо одной.
 */
export const contractSheetCanvas = async (
  template: ContractTemplateId,
  data: ContractData
): Promise<HTMLCanvasElement> => {
  const { default: html2canvas } = await import('html2canvas');
  const { html, styles } = buildContractFragment(template, data);

  const host = document.createElement('div');
  host.className = 'contract-sheet';
  host.style.cssText = [
    'position:fixed', 'left:-10000px', 'top:0', 'z-index:-1',
    'pointer-events:none', 'background:#fff', `width:${CONTRACT_SHEET_WIDTH_PX}px`,
  ].join(';');
  // Поля листа заданы в padding, поэтому модель размеров должна быть border-box:
  // при content-box лист стал бы на 40 мм шире и уехал бы за край страницы.
  host.innerHTML = `<style>.contract-sheet, .contract-sheet * { box-sizing: border-box; }
${styles}</style>${html}`;
  document.body.appendChild(host);
  const metricsFix = document.createElement('style');
  metricsFix.textContent = METRICS_FIX_CSS;
  document.head.appendChild(metricsFix);

  try {
    // Кадр на раскладку и подгрузку шрифтов: без паузы снимок иногда выходит
    // с ненабранным текстом.
    await new Promise(resolve => setTimeout(resolve, 150));
    if ((document as any).fonts?.ready) await (document as any).fonts.ready.catch(() => {});
    return await html2canvas(host, {
      scale: SNAPSHOT_SCALE,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
      scrollX: 0,
      scrollY: 0,
    });
  } finally {
    host.remove();
    metricsFix.remove();
  }
};

/**
 * Договор одной страницей A4.
 *
 * Лист вписывается целиком: по ширине, а если он оказался длиннее страницы —
 * уменьшается до её высоты и встаёт по центру. Обрезать документ нельзя, а
 * растягивать по обеим сторонам — значит исказить пропорции печатной формы.
 */
export const contractPdfBlob = async (
  template: ContractTemplateId,
  data: ContractData
): Promise<Blob> => {
  const [{ default: jsPDF }, canvas] = await Promise.all([
    import('jspdf'),
    contractSheetCanvas(template, data),
  ]);

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  const ratio = canvas.height / canvas.width;

  let width = PAGE_W_MM;
  let height = PAGE_W_MM * ratio;
  if (height > PAGE_H_MM) {
    height = PAGE_H_MM;
    width = PAGE_H_MM / ratio;
  }

  // PNG, а не JPEG: документ — тонкие чёрные линии на белом, и JPEG разводит
  // вокруг них серую кайму. Заодно такая картинка и весит меньше.
  pdf.addImage(canvas.toDataURL('image/png'), 'PNG', (PAGE_W_MM - width) / 2, 0, width, height);
  return pdf.output('blob');
};

/** Имя файла без символов, которых не терпят файловые системы. */
export const safeFileName = (name: string): string =>
  name.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();

/**
 * Отдать готовый PDF человеку.
 *
 * В приложении из маркета обычная ссылка со скачиванием до файлов не доходит —
 * WebView её не сохраняет. Там файл пишется плагином и уходит в системное окно
 * «Поделиться / Сохранить», как это уже сделано для выгрузки в Excel.
 */
export const saveContractPdf = async (blob: Blob, fileName: string): Promise<void> => {
  const name = safeFileName(fileName);
  const native = !!(window as any).Capacitor?.isNativePlatform?.();

  if (native) {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
      import('@capacitor/filesystem'),
      import('@capacitor/share'),
    ]);
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.readAsDataURL(blob);
    });
    const saved = await Filesystem.writeFile({ path: name, data: base64, directory: Directory.Cache });
    await Share.share({ title: name, url: saved.uri, dialogTitle: 'Сохранить или отправить' });
    return;
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Ссылку держим, пока браузер не заберёт файл: отозвать сразу — скачивание
  // обрывается на больших документах.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
};
