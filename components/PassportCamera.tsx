import React, { useEffect, useRef, useState } from 'react';
import { Flashlight, FlashlightOff, Image as ImageIcon, X } from 'lucide-react';
import ModalPortal from './ModalPortal';
import { haptics } from '../src/haptics';
import { canvasToJpeg } from '../src/jpeg';
import type { PassportFields } from './PassportScan';

/**
 * Сканирование паспорта камерой — без кнопки «сфотографировать».
 *
 * Камера открывается прямо в приложении, как сканер штрихкодов. Человек держит
 * разворот в рамке, а телефон сам ловит момент: кадр неподвижен и резкий —
 * берём его и отправляем на распознавание. Резкость и неподвижность считаются
 * на телефоне по уменьшенной копии кадра (бесплатно); на распознавание уходит
 * только выбранный кадр — каждое распознавание платное.
 *
 * Не всё прочиталось (блик, палец на номере) — пробуем ещё раз сами, но не
 * больше MAX_ATTEMPTS за одно сканирование. «Снять» — на случай, когда
 * автоматика не срабатывает (темно, дрожат руки); «Из галереи» — готовое фото.
 */

const MAX_ATTEMPTS = 2;
/** Сколько тиков подряд кадр должен быть неподвижен (тик — TICK_MS) */
const STABLE_TICKS = 4;
const TICK_MS = 220;
/** Первые мгновения не снимаем: человек ещё наводит камеру */
const WARMUP_MS = 1200;
/** Разворот паспорта: 125 × 176 мм — держат вертикально */
const FRAME_ASPECT = 125 / 176;

type Phase = 'starting' | 'aiming' | 'steady' | 'recognizing' | 'error';

const cameraErrorText = (error: any): string => {
  const name = error?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Нет доступа к камере. Разрешите его в настройках телефона — или загрузите фото из галереи.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Камера не найдена — загрузите фото из галереи.';
  if (name === 'NotReadableError' || name === 'AbortError') return 'Камера занята другим приложением.';
  return 'Не удалось включить камеру — загрузите фото из галереи.';
};

/** Прочитано достаточно, чтобы не переснимать: ФИО и номер паспорта */
const goodEnough = (f: PassportFields) => !!f.name.trim() && !!f.number.trim();
const filledCount = (f: PassportFields) => Object.values(f).filter(v => String(v || '').trim()).length;

interface Props {
  /** Распознать кадр (data URL JPEG) */
  recognize: (dataUrl: string) => Promise<PassportFields>;
  /** Готово: подставить поля. preview — снимок, по которому распознали */
  onDone: (fields: PassportFields, preview: string) => void;
  /** Открыть выбор фото из галереи (вызывается в обработчике нажатия) */
  onGallery: () => void;
  onClose: () => void;
}

const PassportCamera: React.FC<Props> = ({ recognize, onDone, onGallery, onClose }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<Phase>('starting');
  const phaseRef = useRef<Phase>('starting');
  const [hint, setHint] = useState('Наведите камеру на разворот с фото');
  const [errorText, setErrorText] = useState('');
  const [torch, setTorch] = useState({ available: false, on: false });
  const [attempt, setAttempt] = useState(0);
  const attemptsRef = useRef(0);
  const bestRef = useRef<{ fields: PassportFields; preview: string } | null>(null);
  const setPhaseBoth = (p: Phase) => { phaseRef.current = p; setPhase(p); };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  };

  /** Кадр из области рамки — в полном разрешении камеры, с небольшим запасом по краям */
  const grabFrame = (): string | null => {
    const video = videoRef.current, frame = frameRef.current;
    if (!video || !frame || !video.videoWidth) return null;
    const vw = video.videoWidth, vh = video.videoHeight;
    const box = video.getBoundingClientRect(), fr = frame.getBoundingClientRect();
    // object-cover: видео масштабировано по большей стороне и обрезано по центру
    const scale = Math.max(box.width / vw, box.height / vh);
    const offX = (box.width - vw * scale) / 2, offY = (box.height - vh * scale) / 2;
    const pad = 0.06;
    let x = (fr.left - box.left - offX) / scale, y = (fr.top - box.top - offY) / scale;
    let w = fr.width / scale, h = fr.height / scale;
    x -= w * pad; y -= h * pad; w *= 1 + pad * 2; h *= 1 + pad * 2;
    x = Math.max(0, x); y = Math.max(0, y); w = Math.min(vw - x, w); h = Math.min(vh - y, h);
    const k = Math.min(1, 2000 / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * k); canvas.height = Math.round(h * k);
    canvas.getContext('2d')!.drawImage(video, x, y, w, h, 0, 0, canvas.width, canvas.height);
    return canvasToJpeg(canvas);
  };

  const capture = async () => {
    if (phaseRef.current === 'recognizing') return;
    const dataUrl = grabFrame();
    if (!dataUrl) return;
    haptics.light();
    setPhaseBoth('recognizing');
    setHint('Распознаём…');
    attemptsRef.current += 1;
    try {
      const fields = await recognize(dataUrl);
      if (!bestRef.current || filledCount(fields) > filledCount(bestRef.current.fields)) {
        bestRef.current = { fields, preview: dataUrl };
      }
      if (goodEnough(fields) || attemptsRef.current >= MAX_ATTEMPTS) {
        const best = bestRef.current!;
        if (filledCount(best.fields) > 0) {
          haptics.success();
          stopCamera();
          onDone(best.fields, best.preview);
          return;
        }
        setPhaseBoth('aiming');
        setHint('Не прочиталось. Уберите блики и держите разворот целиком в рамке — или нажмите «Снять»');
        attemptsRef.current = 0;
        return;
      }
      setPhaseBoth('aiming');
      setHint('Почти — держите ровнее, без бликов');
    } catch (e: any) {
      haptics.error();
      // Лимит или нет связи — повторять самим бессмысленно
      setErrorText(e?.message || 'Не удалось распознать паспорт');
      setPhaseBoth('error');
    }
  };
  const captureRef = useRef(capture);
  captureRef.current = capture;

  useEffect(() => {
    let alive = true;
    let timer = 0;
    const started = performance.now();
    const probe = document.createElement('canvas');
    probe.width = 96; probe.height = Math.round(96 / FRAME_ASPECT);
    const pctx = probe.getContext('2d', { willReadFrequently: true })!;
    let prev: Uint8ClampedArray | null = null;
    let stable = 0;
    let sharpBest = 0;

    // Неподвижность — средняя разница яркости с прошлым кадром; резкость —
    // средний перепад яркости между соседними точками (у текста он высокий,
    // у размытого кадра и пустой стены — низкий); не берём кадр заметно мутнее
    // лучшего из недавних — значит, камера ещё фокусируется или дрогнула рука.
    const tick = () => {
      if (!alive) return;
      const video = videoRef.current, frame = frameRef.current;
      if (phaseRef.current !== 'recognizing' && phaseRef.current !== 'error' && video && frame && video.videoWidth) {
        const vw = video.videoWidth, vh = video.videoHeight;
        const box = video.getBoundingClientRect(), fr = frame.getBoundingClientRect();
        const scale = Math.max(box.width / vw, box.height / vh);
        const offX = (box.width - vw * scale) / 2, offY = (box.height - vh * scale) / 2;
        pctx.drawImage(video, (fr.left - box.left - offX) / scale, (fr.top - box.top - offY) / scale,
          fr.width / scale, fr.height / scale, 0, 0, probe.width, probe.height);
        const { data } = pctx.getImageData(0, 0, probe.width, probe.height);
        const n = probe.width * probe.height;
        const gray = new Uint8ClampedArray(n);
        let sum = 0;
        for (let i = 0; i < n; i++) { const v = (data[i * 4] * 299 + data[i * 4 + 1] * 587 + data[i * 4 + 2] * 114) / 1000; gray[i] = v; sum += v; }
        const mean = sum / n;
        let spread = 0, diff = 0, sharp = 0;
        for (let i = 0; i < n; i++) {
          spread += Math.abs(gray[i] - mean);
          if (prev) diff += Math.abs(gray[i] - prev[i]);
          if ((i + 1) % probe.width) sharp += Math.abs(gray[i] - gray[i + 1]);
        }
        spread /= n; diff = prev ? diff / n : 255; sharp /= n;
        prev = gray;
        sharpBest = Math.max(sharpBest * 0.97, sharp);

        // Документ в кадре — много чётких контуров (строки текста); пустая стена
        // или стол дают перепады около 1–2 от шума камеры
        const hasContent = sharp > 3 && spread > 6;
        const still = diff < 3.2;
        const crisp = sharp >= sharpBest * 0.8;
        if (hasContent && still && crisp) stable++; else stable = 0;

        if (phaseRef.current !== 'starting') {
          const next: Phase = stable >= 2 ? 'steady' : 'aiming';
          if (next !== phaseRef.current) {
            setPhaseBoth(next);
            if (next === 'steady') setHint('Держите так…');
            else if (attemptsRef.current === 0) setHint(hasContent ? 'Держите неподвижно' : 'Наведите камеру на разворот с фото');
          }
        }
        if (stable >= STABLE_TICKS && performance.now() - started > WARMUP_MS) {
          stable = 0;
          void captureRef.current();
        }
      }
      timer = window.setTimeout(tick, TICK_MS);
    };

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setErrorText(window.isSecureContext === false
          ? 'Камера работает только по защищённому соединению — загрузите фото из галереи.'
          : 'Это устройство не даёт доступ к камере — загрузите фото из галереи.');
        setPhaseBoth('error');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          // Максимум, что даст камера: текст паспорта мелкий, и при 1080 точках
          // номер и «кем выдан» читаются с ошибками
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
        });
        if (!alive) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) { video.srcObject = stream; await video.play().catch(() => {}); }
        const track = stream.getVideoTracks()[0];
        const caps: any = track?.getCapabilities?.() || {};
        setTorch({ available: !!caps.torch, on: false });
        if (Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) {
          track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] } as any).catch(() => {});
        }
        setPhaseBoth('aiming');
        tick();
      } catch (e) {
        if (!alive) return;
        stopCamera();
        setErrorText(cameraErrorText(e));
        setPhaseBoth('error');
      }
    })();

    return () => { alive = false; window.clearTimeout(timer); stopCamera(); };
  }, [attempt]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torch.on }] } as any);
      setTorch(t => ({ ...t, on: !t.on }));
    } catch { /* фонарик недоступен */ }
  };

  const frameColor = phase === 'recognizing' ? 'border-indigo-400' : phase === 'steady' ? 'border-emerald-400' : 'border-white/80';

  return (
    <ModalPortal onClose={onClose}>
      <div className="fixed inset-0 bg-black text-white select-none overflow-hidden" style={{ zIndex: 260 }}>
        <video ref={videoRef} playsInline muted autoPlay className="absolute inset-0 w-full h-full object-cover" />

        {phase !== 'error' && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div ref={frameRef}
                 className={`relative w-[78%] max-w-sm rounded-2xl border-[3px] transition-colors duration-200 ${frameColor}`}
                 style={{ aspectRatio: String(FRAME_ASPECT), boxShadow: '0 0 0 200vmax rgba(0,0,0,0.55)' }}>
              {/* Линия сгиба разворота — подсказывает, как положить паспорт */}
              <div className="absolute left-3 right-3 top-1/2 border-t border-dashed border-white/40" />
              {phase === 'recognizing' && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="w-10 h-10 rounded-full border-4 border-white/30 border-t-white animate-spin" />
                </div>
              )}
            </div>
          </div>
        )}

        <div className="absolute top-0 left-0 right-0 z-10 flex items-center gap-3 px-4 pb-3"
             style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}>
          <button type="button" onClick={onClose} aria-label="Закрыть"
                  className="w-11 h-11 rounded-full bg-black/50 backdrop-blur flex items-center justify-center active:scale-90 transition-transform">
            <X size={22} />
          </button>
          <p className="flex-1 min-w-0 text-center font-bold truncate">Паспорт</p>
          {torch.available ? (
            <button type="button" onClick={toggleTorch} aria-label="Фонарик"
                    className={`w-11 h-11 rounded-full backdrop-blur flex items-center justify-center active:scale-90 transition-transform ${torch.on ? 'bg-amber-400 text-slate-900' : 'bg-black/50'}`}>
              {torch.on ? <FlashlightOff size={20} /> : <Flashlight size={20} />}
            </button>
          ) : <span className="w-11 h-11" />}
        </div>

        {phase === 'error' && (
          <div className="absolute inset-0 flex items-center justify-center p-6 pointer-events-none">
            <div className="pointer-events-auto max-w-sm w-full rounded-3xl bg-slate-900/95 p-5 text-center space-y-4">
              <p className="text-sm text-slate-200">{errorText}</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => { attemptsRef.current = 0; setErrorText(''); setPhaseBoth('starting'); setAttempt(a => a + 1); }}
                        className="flex-1 py-3 rounded-2xl bg-white/10 font-bold text-sm active:scale-95 transition-transform">
                  Повторить
                </button>
                <button type="button" onClick={() => { stopCamera(); onGallery(); }}
                        className="flex-1 py-3 rounded-2xl bg-indigo-600 font-bold text-sm active:scale-95 transition-transform">
                  Из галереи
                </button>
              </div>
            </div>
          </div>
        )}

        {phase !== 'error' && (
          <div className="absolute left-0 right-0 bottom-0 z-10 px-6 space-y-5"
               style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 20px)' }}>
            <p className="mx-auto max-w-xs text-center text-[15px] font-semibold leading-snug drop-shadow">
              {phase === 'starting' ? 'Включаем камеру…' : hint}
            </p>
            <div className="mx-auto max-w-sm grid grid-cols-3 items-center">
              <button type="button" onClick={() => { stopCamera(); onGallery(); }}
                      className="justify-self-start flex flex-col items-center gap-1 text-xs font-semibold active:scale-95 transition-transform">
                <span className="w-12 h-12 rounded-full bg-black/50 backdrop-blur flex items-center justify-center"><ImageIcon size={22} /></span>
                Из галереи
              </button>
              <button type="button" aria-label="Снять" disabled={phase === 'recognizing' || phase === 'starting'}
                      onClick={() => void capture()}
                      className="justify-self-center w-[72px] h-[72px] rounded-full border-4 border-white flex items-center justify-center disabled:opacity-40 active:scale-90 transition-transform">
                <span className="w-[56px] h-[56px] rounded-full bg-white" />
              </button>
              <span />
            </div>
          </div>
        )}
      </div>
    </ModalPortal>
  );
};

export default PassportCamera;
