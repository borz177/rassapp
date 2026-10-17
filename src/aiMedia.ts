/**
 * Голос и фото для ИИ-ассистента.
 *
 * Голос: браузеры пишут кто во что — Chrome и Android в webm/opus, iPhone в
 * mp4/aac, — а модель принимает не всё. Поэтому после записи звук
 * перекодируется прямо здесь в WAV 16 кГц моно: его понимают все модели, а для
 * речи этого качества хватает с запасом (минута ≈ 2 МБ).
 *
 * Фото: уменьшаем до 1600 px по длинной стороне и жмём в JPEG — паспорт и чек
 * читаются, а запрос не весит десятки мегабайт.
 */

const TARGET_RATE = 16000;
/** Дольше — уже не команда, а диктовка; обрываем, чтобы не копить мегабайты */
export const MAX_RECORD_SECONDS = 60;

export interface Recording {
  stop: () => Promise<{ data: string; format: 'wav'; seconds: number }>;
  cancel: () => void;
  /** Громкость 0…1 — для живой анимации кнопки микрофона */
  level: () => number;
}

const toBase64 = (buf: ArrayBuffer): string => {
  let binary = '';
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
};

const encodeWav = (samples: Float32Array, rate: number): ArrayBuffer => {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  str(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
};

/** Запись с микрофона. Бросает ошибку, если доступа нет. */
export const startRecording = async (): Promise<Recording> => {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    throw new Error('Запись голоса на этом устройстве недоступна');
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  recorder.start();
  const started = Date.now();

  // Уровень звука для анимации
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);
  const level = () => {
    analyser.getByteTimeDomainData(data);
    let peak = 0;
    for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
    return Math.min(1, peak / 64);
  };

  const release = () => {
    stream.getTracks().forEach(t => t.stop());
    ctx.close().catch(() => {});
  };

  return {
    level,
    cancel: () => { try { recorder.stop(); } catch { /* уже остановлен */ } release(); },
    stop: () => new Promise((resolve, reject) => {
      recorder.onstop = async () => {
        release();
        try {
          const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
          const decodeCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
          const audio = await decodeCtx.decodeAudioData(await blob.arrayBuffer());
          decodeCtx.close().catch(() => {});
          // Моно и 16 кГц: OfflineAudioContext сам пересчитает частоту
          const length = Math.ceil(audio.duration * TARGET_RATE);
          const offline = new OfflineAudioContext(1, Math.max(1, length), TARGET_RATE);
          const src = offline.createBufferSource();
          src.buffer = audio;
          src.connect(offline.destination);
          src.start();
          const rendered = await offline.startRendering();
          resolve({ data: toBase64(encodeWav(rendered.getChannelData(0), TARGET_RATE)), format: 'wav', seconds: (Date.now() - started) / 1000 });
        } catch (e) {
          reject(new Error('Не удалось обработать запись'));
        }
      };
      recorder.stop();
    }),
  };
};

/** Фото → data:image/jpeg;base64,… не больше maxSide по длинной стороне */
export const compressImage = (file: Blob, maxSide = 1600, quality = 0.85): Promise<string> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const k = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * k);
      canvas.height = Math.round(img.height * k);
      const g = canvas.getContext('2d');
      if (!g) return reject(new Error('Не удалось обработать фото'));
      g.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Не удалось открыть фото')); };
    img.src = url;
  });
