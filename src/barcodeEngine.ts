/**
 * Распознавание штрихкода в кадре камеры.
 *
 * Два движка. Встроенный BarcodeDetector есть в Chrome на Android и в Android-
 * приложении: он работает на системной библиотеке, быстрый и ничего не весит.
 * В Safari на iPhone и в Chrome на Windows его нет — там подгружаем ZXing.
 *
 * ZXing лежит у нас (public/vendor), а не в зависимостях сборки и не на CDN:
 * внешний CDN в России открывается через раз, а новый пакет в package.json
 * не доехал бы до сервера сам по себе. Файл грузится только при первом
 * открытии камеры там, где встроенного детектора нет, и попадает в офлайн-кэш
 * вместе с остальным приложением.
 */

export interface BarcodeEngine {
  kind: 'native' | 'zxing';
  detect: (video: HTMLVideoElement) => Promise<string | null>;
}

const ZXING_URL = '/vendor/zxing-library-0.23.0.min.js';

let zxingLoading: Promise<any> | null = null;

const loadZxing = (): Promise<any> => {
  const w = window as any;
  if (w.ZXing) return Promise.resolve(w.ZXing);
  if (!zxingLoading) {
    zxingLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = ZXING_URL;
      script.async = true;
      script.onload = () => (w.ZXing ? resolve(w.ZXing) : reject(new Error('Модуль распознавания не загрузился')));
      script.onerror = () => {
        // Следующая попытка должна грузить заново, а не получать тот же отказ.
        zxingLoading = null;
        script.remove();
        reject(new Error('Не удалось загрузить модуль распознавания. Проверьте интернет и попробуйте ещё раз.'));
      };
      document.head.appendChild(script);
    });
  }
  return zxingLoading;
};

/** Форматы, которые встречаются на товарах и накладных. Остальные только замедляют поиск в кадре. */
const NATIVE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'code_93', 'itf', 'codabar', 'qr_code', 'data_matrix'];

const createNativeEngine = async (): Promise<BarcodeEngine | null> => {
  const Detector = (window as any).BarcodeDetector;
  if (!Detector) return null;
  try {
    const supported: string[] = await Detector.getSupportedFormats();
    const formats = NATIVE_FORMATS.filter(f => supported.includes(f));
    // Chrome на десктопе объявляет детектор, но без единого формата — это не поддержка.
    if (!formats.length) return null;
    const detector = new Detector({ formats });
    return {
      kind: 'native',
      detect: async video => {
        const found = await detector.detect(video);
        return found?.[0]?.rawValue || null;
      },
    };
  } catch {
    return null;
  }
};

const createZxingEngine = async (): Promise<BarcodeEngine> => {
  const Z = await loadZxing();
  const hints = new Map();
  hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [
    Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E,
    Z.BarcodeFormat.CODE_128, Z.BarcodeFormat.CODE_39, Z.BarcodeFormat.ITF, Z.BarcodeFormat.CODABAR,
    Z.BarcodeFormat.QR_CODE,
  ]);
  hints.set(Z.DecodeHintType.TRY_HARDER, true);
  const reader = new Z.MultiFormatReader();
  reader.setHints(hints);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let frame = 0;

  return {
    kind: 'zxing',
    detect: async video => {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!ctx || !vw || !vh) return null;

      // Через кадр читаем центральную полосу под рамкой и весь кадр целиком.
      // Полоса крупнее и читается быстрее — туда человек и наводит код; целый
      // кадр ловит код, который в рамку не попал.
      frame++;
      const crop = frame % 2 === 1;
      const sw = crop ? Math.round(vw * 0.9) : vw;
      const sh = crop ? Math.round(Math.min(vh, sw * 0.62)) : vh;
      const sx = Math.round((vw - sw) / 2);
      const sy = Math.round((vh - sh) / 2);
      // Больше 1000 точек по ширине точности не добавляет, а время удваивает.
      const scale = Math.min(1, 1000 / sw);
      canvas.width = Math.round(sw * scale);
      canvas.height = Math.round(sh * scale);
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

      try {
        const source = new Z.HTMLCanvasElementLuminanceSource(canvas);
        const bitmap = new Z.BinaryBitmap(new Z.HybridBinarizer(source));
        return reader.decodeWithState(bitmap).getText() || null;
      } catch {
        // NotFoundException — в кадре кода нет, это обычный исход.
        return null;
      } finally {
        reader.reset();
      }
    },
  };
};

export const createBarcodeEngine = async (): Promise<BarcodeEngine> =>
  (await createNativeEngine()) || createZxingEngine();
