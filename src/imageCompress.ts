/**
 * Сжатие картинки в браузере перед отправкой.
 *
 * Сервер тоже сжимает, но этого мало: снимок с телефона весит 4–8 МБ, и на
 * мобильном интернете загрузка такого файла занимает десятки секунд, а иногда
 * упирается в лимит multer в 5 МБ и падает. Сжимаем до отправки — уходит
 * 100–300 КБ, и серверное сжатие остаётся страховкой, а не единственной защитой.
 *
 * Ориентацию EXIF не разбираем вручную: createImageBitmap с imageOrientation
 * применяет её сам, иначе фото с телефона приезжали бы повёрнутыми на бок.
 */
export interface CompressResult {
  file: File;
  originalSize: number;
  size: number;
}

export const compressImageFile = async (
  file: File,
  maxSide = 1400,
  quality = 0.78
): Promise<CompressResult> => {
  if (!file.type.startsWith('image/')) return { file, originalSize: file.size, size: file.size };

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  } catch {
    // Старые движки не знают imageOrientation — пробуем без него, чем совсем никак
    bitmap = await createImageBitmap(file);
  }

  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { file, originalSize: file.size, size: file.size };
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const blob = await new Promise<Blob | null>(resolve =>
    canvas.toBlob(resolve, 'image/jpeg', quality)
  );
  // Если сжатие почему-то не удалось или вышло тяжелее исходника — отдаём оригинал.
  if (!blob || blob.size >= file.size) return { file, originalSize: file.size, size: file.size };

  const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
  return {
    file: new File([blob], name, { type: 'image/jpeg' }),
    originalSize: file.size,
    size: blob.size,
  };
};
