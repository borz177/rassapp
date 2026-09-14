/**
 * Звук и вибрация на скан.
 *
 * При сканировании человек смотрит на товар, а не на экран, — узнать, что код
 * принят, он должен ухом. Разные тона для «принят» и «не найден»: иначе ошибку
 * на кассе заметили бы только по чеку.
 *
 * AudioContext браузеры разрешают запускать только в ответ на нажатие, поэтому
 * primeScanSound зовём прямо в обработчике кнопки, открывающей сканер.
 */

export type ScanTone = 'ok' | 'warn' | 'error';

let ctx: AudioContext | null = null;

export const primeScanSound = (): void => {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    if (!ctx) ctx = new AudioCtx();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  } catch {
    // Звук — украшение: без него сканирование работает так же.
  }
};

const TONES: Record<ScanTone, { freq: number; duration: number; vibrate: number | number[] }> = {
  ok: { freq: 1760, duration: 0.07, vibrate: 15 },
  warn: { freq: 880, duration: 0.14, vibrate: [20, 40, 20] },
  error: { freq: 240, duration: 0.3, vibrate: [40, 60, 40] },
};

export const scanBeep = (tone: ScanTone = 'ok'): void => {
  const { freq, duration, vibrate } = TONES[tone];
  try {
    if (navigator.vibrate) navigator.vibrate(vibrate);
  } catch { /* вибрации нет */ }
  try {
    primeScanSound();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    // Плавный вход и выход: резкий старт синусоиды щёлкает в динамике.
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.18, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  } catch { /* звука нет */ }
};
