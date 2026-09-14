import React, { useEffect, useRef, useState } from 'react';
import { Flashlight, FlashlightOff, Keyboard, ScanBarcode, X } from 'lucide-react';
import ModalPortal from './ModalPortal';
import { extractProductCode, normalizeBarcode } from '../src/barcode';
import { createBarcodeEngine, type BarcodeEngine } from '../src/barcodeEngine';
import { primeScanSound, scanBeep, type ScanTone } from '../src/scanFeedback';

export type { ScanTone };

export interface ScanOutcome {
  tone: ScanTone;
  /** Что произошло — крупно: «+1 Айфон 15» или «Товар не найден» */
  title: string;
  subtitle?: string;
  /** Закрыть камеру после этого кода, даже в непрерывном режиме */
  close?: boolean;
}

interface BarcodeScannerProps {
  title?: string;
  /**
   * Непрерывный режим: камера остаётся открытой, каждый новый код — отдельное
   * действие. Так принимают поставку и пробивают чек. Без него камера
   * закрывается на первом удачном коде — так заполняют поле формы.
   */
  continuous?: boolean;
  onCode: (code: string) => ScanOutcome | void | Promise<ScanOutcome | void>;
  onClose: () => void;
  /** Строка под результатом: итог чека, число позиций в документе */
  footer?: React.ReactNode;
}

/** Тот же код подряд считаем одним сканом, пока он не пропадёт из кадра на это время */
const SAME_CODE_PAUSE_MS = 1200;
/** Между разными кодами — короткая пауза, чтобы звук и подпись успевали за руками */
const ANY_CODE_PAUSE_MS = 450;
/** Код принимаем, когда он прочитался в двух кадрах подряд: одиночное чтение бывает ложным */
const CONFIRM_WINDOW_MS = 900;

const cameraErrorText = (error: any): string => {
  const name = error?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Нет доступа к камере. Разрешите его в настройках телефона или браузера для этого приложения.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Камера не найдена.';
  if (name === 'NotReadableError' || name === 'AbortError') return 'Камера занята другим приложением.';
  return error?.message || 'Не удалось включить камеру.';
};

const TONE_STYLES: Record<ScanTone, { frame: string; card: string }> = {
  ok: { frame: 'border-emerald-400', card: 'bg-emerald-500' },
  warn: { frame: 'border-amber-400', card: 'bg-amber-500' },
  error: { frame: 'border-rose-500', card: 'bg-rose-600' },
};

/**
 * Сканер штрихкодов камерой — во весь экран, поверх всего.
 *
 * Весь экран, а не окошко в форме: код наводят на расстоянии ладони, и в
 * маленьком превью не видно, попал ли он в кадр. Рамка показывает, куда
 * целиться, вспышка — чем подсветить склад, ручной ввод выручает, когда код
 * затёрт и не читается ничем.
 */
const BarcodeScanner: React.FC<BarcodeScannerProps> = ({
  title = 'Сканирование', continuous = false, onCode, onClose, footer,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const aliveRef = useRef(false);
  const handlingRef = useRef(false);
  const candidateRef = useRef<{ code: string; t: number } | null>(null);
  const lastRef = useRef<{ code: string; t: number } | null>(null);

  // Колбэки держим в ref: цикл распознавания живёт дольше одного рендера, и
  // замкнутая в нём старая версия onCode работала бы с устаревшей корзиной.
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<'starting' | 'running' | 'error'>('starting');
  const [errorText, setErrorText] = useState('');
  const [torch, setTorch] = useState({ available: false, on: false });
  const [outcome, setOutcome] = useState<(ScanOutcome & { at: number }) | null>(null);
  const [manual, setManual] = useState(false);
  const [manualValue, setManualValue] = useState('');

  const stopCamera = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  const deliver = async (raw: string) => {
    if (handlingRef.current) return;
    // Ссылку из QR и прочее, что не является кодом товара, дальше не пускаем;
    // из DataMatrix «Честного знака» достаём штрихкод товара.
    const extracted = extractProductCode(raw);
    if ('error' in extracted) {
      scanBeep('error');
      setOutcome({ tone: 'error', title: extracted.error, at: Date.now() });
      return;
    }
    const { code } = extracted;
    handlingRef.current = true;
    try {
      const result = (await onCodeRef.current(code)) || { tone: 'ok' as const, title: code };
      scanBeep(result.tone);
      setOutcome({ ...result, at: Date.now() });
      // Одиночный режим закрываем только на удаче: на «не найден» человек
      // должен увидеть причину и навести камеру ещё раз.
      if (result.close || (!continuous && result.tone !== 'error')) {
        aliveRef.current = false;
        stopCamera();
        onCloseRef.current();
      }
    } catch (e: any) {
      scanBeep('error');
      setOutcome({ tone: 'error', title: e?.message || 'Не удалось обработать код', at: Date.now() });
    } finally {
      handlingRef.current = false;
    }
  };
  const deliverRef = useRef(deliver);
  deliverRef.current = deliver;

  const accept = (raw: string) => {
    const code = normalizeBarcode(raw);
    if (!code) return;
    const now = Date.now();

    const candidate = candidateRef.current;
    if (!candidate || candidate.code !== code || now - candidate.t > CONFIRM_WINDOW_MS) {
      candidateRef.current = { code, t: now };
      return;
    }
    candidateRef.current = { code, t: now };

    const last = lastRef.current;
    if (last && last.code === code && now - last.t < SAME_CODE_PAUSE_MS) {
      // Код всё ещё в кадре — продлеваем паузу, а не пробиваем его второй раз.
      lastRef.current = { code, t: now };
      return;
    }
    if (last && now - last.t < ANY_CODE_PAUSE_MS) return;

    lastRef.current = { code, t: now };
    deliverRef.current(code);
  };
  const acceptRef = useRef(accept);
  acceptRef.current = accept;

  useEffect(() => {
    aliveRef.current = true;
    setStatus('starting');
    setErrorText('');
    let engine: BarcodeEngine | null = null;

    const loop = async () => {
      if (!aliveRef.current) return;
      const video = videoRef.current;
      if (engine && video && video.readyState >= 2 && !handlingRef.current && document.visibilityState === 'visible') {
        try {
          const raw = await engine.detect(video);
          if (raw && aliveRef.current) acceptRef.current(raw);
        } catch {
          // Кадр не прочитался — берём следующий.
        }
      }
      if (aliveRef.current) timerRef.current = window.setTimeout(loop, engine?.kind === 'native' ? 80 : 120);
    };

    (async () => {
      primeScanSound();
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('error');
        setErrorText(window.isSecureContext === false
          ? 'Камера работает только по защищённому соединению (https).'
          : 'Это устройство не даёт доступ к камере.');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
        if (!aliveRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;

        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => {});
        }

        const track = stream.getVideoTracks()[0];
        track?.addEventListener('ended', () => {
          if (!aliveRef.current) return;
          setStatus('error');
          setErrorText('Камера отключилась.');
        });
        const caps: any = track?.getCapabilities?.() || {};
        setTorch({ available: !!caps.torch, on: false });
        // Без непрерывного автофокуса камера на ряде Android держит фокус на
        // бесконечности, и штрихкод с двадцати сантиметров остаётся размытым.
        if (Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) {
          track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] } as any).catch(() => {});
        }

        engine = await createBarcodeEngine();
        if (!aliveRef.current) return;
        setStatus('running');
        loop();
      } catch (e) {
        if (!aliveRef.current) return;
        stopCamera();
        setStatus('error');
        setErrorText(cameraErrorText(e));
      }
    })();

    return () => {
      aliveRef.current = false;
      stopCamera();
    };
  }, [attempt]);

  // Подпись результата гаснет сама: следующий скан не должен читаться под старой.
  useEffect(() => {
    if (!outcome) return;
    const t = window.setTimeout(() => setOutcome(o => (o && o.at === outcome.at ? null : o)), 2600);
    return () => window.clearTimeout(t);
  }, [outcome]);

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torch.on;
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] } as any);
      setTorch(t => ({ ...t, on: next }));
    } catch {
      setTorch({ available: false, on: false });
    }
  };

  const submitManual = () => {
    const code = normalizeBarcode(manualValue);
    if (!code) return;
    setManualValue('');
    setManual(false);
    deliverRef.current(code);
  };

  const tone = outcome?.tone;

  return (
    <ModalPortal onClose={onClose}>
      <div className="fixed inset-0 z-modal-top bg-black text-white select-none overflow-hidden">
        <style>{'@keyframes barcode-scan-line{0%,100%{top:10%}50%{top:86%}}'}</style>

        <video ref={videoRef} playsInline muted autoPlay
               className="absolute inset-0 w-full h-full object-cover" />

        {/* Рамка и затемнение вокруг: огромная тень заливает всё, кроме самой рамки */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className={`relative w-[84%] max-w-md aspect-[16/10] rounded-3xl border-[3px] transition-colors duration-150 ${
                 tone ? TONE_STYLES[tone].frame : 'border-white/80'
               }`}
               style={{ boxShadow: '0 0 0 200vmax rgba(0,0,0,0.55)' }}>
            {status === 'running' && (
              <div className="absolute left-4 right-4 h-0.5 rounded-full bg-rose-500 shadow-[0_0_12px_2px_rgba(244,63,94,0.7)]"
                   style={{ animation: 'barcode-scan-line 2.2s ease-in-out infinite' }} />
            )}
          </div>
        </div>

        {/* Верхняя полоса */}
        <div className="absolute top-0 left-0 right-0 flex items-center gap-3 px-4 pb-3"
             style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}>
          <button type="button" onClick={onClose} aria-label="Закрыть"
                  className="w-11 h-11 rounded-full bg-black/50 backdrop-blur flex items-center justify-center active:scale-90 transition-transform">
            <X size={22} />
          </button>
          <p className="flex-1 min-w-0 text-center font-bold truncate">{title}</p>
          {torch.available ? (
            <button type="button" onClick={toggleTorch} aria-label="Фонарик"
                    className={`w-11 h-11 rounded-full backdrop-blur flex items-center justify-center active:scale-90 transition-transform ${
                      torch.on ? 'bg-amber-400 text-slate-900' : 'bg-black/50'
                    }`}>
              {torch.on ? <FlashlightOff size={20} /> : <Flashlight size={20} />}
            </button>
          ) : <span className="w-11 h-11" />}
        </div>

        {/* Состояния камеры */}
        {status === 'starting' && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="px-4 py-2 rounded-full bg-black/60 text-sm">Включаем камеру…</p>
          </div>
        )}
        {status === 'error' && (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="max-w-sm w-full rounded-3xl bg-slate-900/95 p-5 text-center space-y-4">
              <ScanBarcode size={40} className="mx-auto text-slate-400" />
              <p className="text-sm text-slate-200">{errorText}</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setAttempt(a => a + 1)}
                        className="flex-1 py-3 rounded-2xl bg-white/10 font-bold text-sm active:scale-95 transition-transform">
                  Повторить
                </button>
                <button type="button" onClick={() => setManual(true)}
                        className="flex-1 py-3 rounded-2xl bg-indigo-600 font-bold text-sm active:scale-95 transition-transform">
                  Ввести код
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Нижняя часть: результат, итог, ручной ввод */}
        <div className="absolute left-0 right-0 bottom-0 px-4 space-y-3"
             style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' }}>
          {outcome && (
            <div key={outcome.at}
                 className={`mx-auto max-w-md rounded-2xl px-4 py-3 shadow-2xl animate-dialog-in ${TONE_STYLES[outcome.tone].card}`}>
              <p className="font-bold leading-tight">{outcome.title}</p>
              {outcome.subtitle && <p className="text-xs text-white/85 mt-0.5">{outcome.subtitle}</p>}
            </div>
          )}

          {footer && (
            <div className="mx-auto max-w-md rounded-2xl bg-black/60 backdrop-blur px-4 py-2.5 text-sm">
              {footer}
            </div>
          )}

          {manual ? (
            <form onSubmit={e => { e.preventDefault(); submitManual(); }}
                  className="mx-auto max-w-md flex gap-2">
              <input value={manualValue} onChange={e => setManualValue(e.target.value)} autoFocus
                     inputMode="numeric" placeholder="Цифры под штрихкодом"
                     className="flex-1 min-w-0 px-4 py-3 rounded-2xl bg-white text-slate-900 font-bold outline-none" />
              <button type="submit" disabled={!normalizeBarcode(manualValue)}
                      className="px-5 rounded-2xl bg-indigo-600 font-bold disabled:opacity-50">
                OK
              </button>
            </form>
          ) : (
            <div className="mx-auto max-w-md flex justify-center">
              <button type="button" onClick={() => setManual(true)}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-black/50 backdrop-blur text-sm font-bold active:scale-95 transition-transform">
                <Keyboard size={18} /> Ввести вручную
              </button>
            </div>
          )}
        </div>
      </div>
    </ModalPortal>
  );
};

/** Кнопка сканирования рядом с полем поиска — одна на все экраны. */
export const ScanButton: React.FC<{ onClick: () => void; label?: string; className?: string }> = ({
  onClick, label = 'Сканировать штрихкод', className = '',
}) => (
  <button type="button" aria-label={label} title={label}
          onClick={() => { primeScanSound(); onClick(); }}
          className={`shrink-0 w-11 min-h-[2.75rem] rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-indigo-600 dark:text-indigo-300 flex items-center justify-center active:scale-95 transition-transform ${className}`}>
    <ScanBarcode size={20} />
  </button>
);

export default BarcodeScanner;
