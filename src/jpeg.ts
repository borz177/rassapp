/**
 * Холст в JPEG, который пролезет на сервер.
 *
 * nginx перед сервером принимает запрос до 1 МБ (по умолчанию), а снимок
 * уходит строкой base64 — она на треть длиннее самого файла. Документ в 2000
 * точек при высоком качестве бывает больше, и тогда сервер отвечал 413, а
 * человек видел «не удалось распознать». Понижаем качество ступенями, пока
 * строка не уложится; для текста паспорта и 0,6 читается уверенно.
 */
export const MAX_UPLOAD_CHARS = 850_000;

export const canvasToJpeg = (canvas: HTMLCanvasElement, maxChars = MAX_UPLOAD_CHARS): string => {
  let url = '';
  for (const q of [0.86, 0.78, 0.7, 0.6, 0.5]) {
    url = canvas.toDataURL('image/jpeg', q);
    if (url.length <= maxChars) return url;
  }
  // Всё ещё велико — уменьшаем сам снимок
  const small = document.createElement('canvas');
  small.width = Math.round(canvas.width * 0.75);
  small.height = Math.round(canvas.height * 0.75);
  small.getContext('2d')!.drawImage(canvas, 0, 0, small.width, small.height);
  return small.toDataURL('image/jpeg', 0.7);
};
