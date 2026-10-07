import React, { useEffect, useRef, useState } from 'react';
import { friendlyError } from '../src/friendlyError';
import ModalPortal from './ModalPortal';
import { CustomerDocument } from '../types';
import { docCategoryLabel, docObjectUrl, formatFileSize, isPendingDoc, shareDocument } from '../src/customerDocs';
import { appConfirm } from '../src/dialogs';

/**
 * Просмотр документов клиента на весь экран — как «Фото» в iOS.
 *
 * Было: картинка в белой рамке на затемнении, без жестов, а PDF в приложении
 * не открывался вовсе (ссылка со скачиванием во встроенном браузере молчит).
 *
 * Теперь: чёрный фон, документы листаются свайпом, фото увеличиваются двойным
 * касанием или щипком и двигаются пальцем, смахивание вниз закрывает. Внизу —
 * «Поделиться» (системное окно: сохранить в Файлы, отправить в мессенджер) и
 * «Удалить». PDF открывается в системном просмотрщике.
 */

interface DocumentViewerProps {
  documents: CustomerDocument[];
  startIndex: number;
  onClose: () => void;
  /** Не задан — кнопки удаления нет */
  onDelete?: (doc: CustomerDocument) => void | Promise<void>;
}

const OUT_MS = 260;
const MAX_ZOOM = 4;

// Картинка документа: грузится с токеном, пока не нужна — не грузится
const useDocUrl = (doc: CustomerDocument | undefined, enabled: boolean) => {
  const [state, setState] = useState<{ url: string | null; error: string | null }>({ url: null, error: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!doc || !enabled || doc.fileType !== 'image') return;
    let alive = true;
    let made: string | null = null;
    setState({ url: null, error: null });
    docObjectUrl(doc)
      .then(url => { made = url; if (alive) setState({ url, error: null }); else if (url.startsWith('blob:')) URL.revokeObjectURL(url); })
      .catch(e => alive && setState({ url: null, error: e?.message || 'Не удалось открыть документ' }));
    return () => {
      alive = false;
      if (made?.startsWith('blob:')) URL.revokeObjectURL(made);
    };
  }, [doc?.id, enabled, attempt]);
  return { ...state, retry: () => setAttempt(a => a + 1) };
};

const Slide: React.FC<{
  doc: CustomerDocument;
  near: boolean;
  zoom: { s: number; x: number; y: number };
  animate: boolean;
  onOpenPdf: () => void;
}> = ({ doc, near, zoom, animate, onOpenPdf }) => {
  const { url, error, retry } = useDocUrl(doc, near);

  if (doc.fileType === 'pdf') {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-5 px-10 text-center">
        <span className="w-24 h-28 rounded-2xl bg-white/10 ring-1 ring-white/15 flex items-center justify-center text-rose-400">
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" />
          </svg>
        </span>
        <div>
          <p className="text-[17px] font-semibold text-white break-all line-clamp-2">{doc.name}</p>
          <p className="mt-1 text-[13px] text-white/50">PDF{doc.fileSize ? ` · ${formatFileSize(doc.fileSize)}` : ''}</p>
        </div>
        <button type="button" onClick={onOpenPdf}
                className="h-11 px-6 rounded-full bg-white text-slate-900 text-[15px] font-semibold active:scale-95 transition-transform">
          Открыть
        </button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-3 px-8 text-center">
        <p className="text-[15px] text-white/80">{error}</p>
        <button type="button" onClick={retry} className="h-10 px-5 rounded-full bg-white/15 text-white text-[14px] font-semibold active:scale-95 transition-transform">
          Повторить
        </button>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex items-center justify-center overflow-hidden">
      {url ? (
        <img
          src={url}
          alt={doc.name}
          draggable={false}
          className="max-w-full max-h-full object-contain select-none"
          style={{
            transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.s})`,
            transition: animate ? 'transform 0.3s cubic-bezier(0.22, 1, 0.36, 1)' : 'none',
          }}
        />
      ) : (
        <span className="w-8 h-8 rounded-full border-2 border-white/20 border-t-white/80 animate-spin" />
      )}
    </div>
  );
};

const DocumentViewer: React.FC<DocumentViewerProps> = ({ documents, startIndex, onClose, onDelete }) => {
  const [index, setIndex] = useState(() => Math.min(Math.max(0, startIndex), documents.length - 1));
  const [closing, setClosing] = useState(false);
  const [busy, setBusy] = useState(false);
  // Жесты: горизонтальный сдвиг ленты, вертикальный — смахивание, и масштаб текущего фото
  const [dx, setDx] = useState(0);
  const [dy, setDy] = useState(0);
  const [zoom, setZoom] = useState({ s: 1, x: 0, y: 0 });
  const [animate, setAnimate] = useState(true);
  const [chrome, setChrome] = useState(true); // панели сверху и снизу; касание прячет их
  const stageRef = useRef<HTMLDivElement>(null);

  const doc = documents[index];

  // Документ удалили (или список сжался) — остаёмся в границах, пусто — закрываемся
  useEffect(() => {
    if (documents.length === 0) { onClose(); return; }
    if (index > documents.length - 1) setIndex(documents.length - 1);
  }, [documents.length]);

  const close = () => {
    if (closing) return;
    setClosing(true);
    setTimeout(onClose, OUT_MS);
  };

  const go = (to: number) => {
    const next = Math.min(Math.max(0, to), documents.length - 1);
    setAnimate(true);
    setDx(0);
    setZoom({ s: 1, x: 0, y: 0 });
    setIndex(next);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowRight') go(index + 1);
      if (e.key === 'ArrowLeft') go(index - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ── Жесты ───────────────────────────────────────────────────────────────
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{
    mode: 'none' | 'swipe' | 'dismiss' | 'pan' | 'pinch';
    x0: number; y0: number; t0: number;
    zoom0: { s: number; x: number; y: number };
    dist0: number; mid0: { x: number; y: number };
  }>({ mode: 'none', x0: 0, y0: 0, t0: 0, zoom0: { s: 1, x: 0, y: 0 }, dist0: 0, mid0: { x: 0, y: 0 } });
  const lastTap = useRef<{ t: number; x: number; y: number }>({ t: 0, x: 0, y: 0 });
  const moved = useRef(false);

  const pts = () => [...pointers.current.values()];
  const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

  // Масштаб вокруг точки (палец или середина щипка), со сдвигом в пределах экрана
  const zoomAround = (s: number, cx: number, cy: number, base = zoom) => {
    const stage = stageRef.current?.getBoundingClientRect();
    if (!stage) return base;
    const ox = cx - (stage.left + stage.width / 2);
    const oy = cy - (stage.top + stage.height / 2);
    const k = s / base.s;
    const x = ox - (ox - base.x) * k;
    const y = oy - (oy - base.y) * k;
    const limX = (stage.width * (s - 1)) / 2;
    const limY = (stage.height * (s - 1)) / 2;
    return { s, x: Math.max(-limX, Math.min(limX, x)), y: Math.max(-limY, Math.min(limY, y)) };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    moved.current = false;
    setAnimate(false);
    if (pointers.current.size === 2 && doc?.fileType === 'image') {
      const [a, b] = pts();
      g.mode = 'pinch';
      g.dist0 = distance(a, b);
      g.mid0 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      g.zoom0 = zoom;
      setDx(0); setDy(0);
      return;
    }
    g.mode = 'none';
    g.x0 = e.clientX; g.y0 = e.clientY; g.t0 = performance.now();
    g.zoom0 = zoom;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;

    if (g.mode === 'pinch') {
      const [a, b] = pts();
      if (!a || !b) return;
      const s = Math.max(1, Math.min(MAX_ZOOM, g.zoom0.s * (distance(a, b) / g.dist0)));
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const z = zoomAround(s, g.mid0.x, g.mid0.y, g.zoom0);
      setZoom({ ...z, x: z.x + (mid.x - g.mid0.x), y: z.y + (mid.y - g.mid0.y) });
      moved.current = true;
      return;
    }

    const mx = e.clientX - g.x0;
    const my = e.clientY - g.y0;
    if (g.mode === 'none') {
      if (Math.hypot(mx, my) < 8) return;
      moved.current = true;
      if (zoom.s > 1) g.mode = 'pan';
      else if (Math.abs(mx) > Math.abs(my)) g.mode = 'swipe';
      else if (my > 0) g.mode = 'dismiss';
      else return;
    }
    if (g.mode === 'pan') {
      const stage = stageRef.current?.getBoundingClientRect();
      const limX = stage ? (stage.width * (zoom.s - 1)) / 2 : 0;
      const limY = stage ? (stage.height * (zoom.s - 1)) / 2 : 0;
      setZoom({ s: zoom.s, x: Math.max(-limX, Math.min(limX, g.zoom0.x + mx)), y: Math.max(-limY, Math.min(limY, g.zoom0.y + my)) });
    } else if (g.mode === 'swipe') {
      // За крайними документами — с сопротивлением: видно, что дальше нет
      const edge = (index === 0 && mx > 0) || (index === documents.length - 1 && mx < 0);
      setDx(edge ? mx / 3 : mx);
    } else if (g.mode === 'dismiss') {
      setDy(Math.max(0, my));
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    const wasPinch = g.mode === 'pinch';
    pointers.current.delete(e.pointerId);
    if (wasPinch && pointers.current.size > 0) return; // ждём, пока отпустят второй палец
    setAnimate(true);
    const elapsed = Math.max(1, performance.now() - g.t0);

    if (wasPinch) {
      if (zoom.s < 1.05) setZoom({ s: 1, x: 0, y: 0 });
    } else if (g.mode === 'swipe') {
      const v = dx / elapsed;
      if ((dx < -70 || v < -0.5) && index < documents.length - 1) go(index + 1);
      else if ((dx > 70 || v > 0.5) && index > 0) go(index - 1);
      else setDx(0);
    } else if (g.mode === 'dismiss') {
      if (dy > 120 || dy / elapsed > 0.6) close();
      else setDy(0);
    } else if (!moved.current && pointers.current.size === 0) {
      // Касание: двойное — масштаб, одиночное — спрятать/показать панели
      const now = performance.now();
      const t = lastTap.current;
      if (doc?.fileType === 'image' && now - t.t < 280 && Math.hypot(e.clientX - t.x, e.clientY - t.y) < 30) {
        lastTap.current = { t: 0, x: 0, y: 0 };
        setZoom(zoom.s > 1 ? { s: 1, x: 0, y: 0 } : zoomAround(2.5, e.clientX, e.clientY));
      } else {
        lastTap.current = { t: now, x: e.clientX, y: e.clientY };
        const at = now;
        setTimeout(() => { if (lastTap.current.t === at) setChrome(c => !c); }, 290);
      }
    }
    g.mode = 'none';
  };

  const share = async () => {
    if (!doc || busy) return;
    setBusy(true);
    try { await shareDocument(doc); }
    catch (e: any) { if (e?.message && !/cancel/i.test(e.message)) alert(friendlyError(e)); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!doc || !onDelete || busy) return;
    if (!await appConfirm(`Удалить «${doc.name}»?`)) return;
    setBusy(true);
    try { await onDelete(doc); } finally { setBusy(false); }
  };

  if (!doc) return null;
  const fade = closing ? 0 : Math.max(0.2, 1 - dy / 400);

  return (
    <ModalPortal onClose={close}>
      <div
        className="fixed inset-0 z-[230] select-none touch-none animate-modal-fade-in"
        style={{ backgroundColor: `rgba(0,0,0,${fade})`, transition: closing ? `background-color ${OUT_MS}ms ease` : undefined }}
      >
        {/* Сцена: лента документов, двигается свайпом */}
        <div
          ref={stageRef}
          className="absolute inset-0 overflow-hidden"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          style={{
            transform: closing ? 'scale(0.92)' : `translateY(${dy}px) scale(${1 - Math.min(dy, 300) / 1500})`,
            opacity: closing ? 0 : 1,
            transition: closing || animate ? `transform ${OUT_MS}ms cubic-bezier(0.32, 0.72, 0, 1), opacity ${OUT_MS}ms ease` : 'none',
          }}
        >
          <div
            className="flex h-full"
            style={{
              transform: `translateX(calc(${-index * 100}% + ${dx}px))`,
              transition: animate ? 'transform 0.36s cubic-bezier(0.32, 0.72, 0, 1)' : 'none',
            }}
          >
            {documents.map((d, i) => (
              <div key={d.id} className="w-full h-full shrink-0 pt-[calc(env(safe-area-inset-top,0px)+56px)] pb-[calc(env(safe-area-inset-bottom,0px)+96px)]">
                <Slide
                  doc={d}
                  near={Math.abs(i - index) <= 1}
                  zoom={i === index ? zoom : { s: 1, x: 0, y: 0 }}
                  animate={animate}
                  onOpenPdf={share}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Верх: закрыть, что это и какой по счёту */}
        <div
          className={`absolute inset-x-0 top-0 flex items-center gap-3 px-4 pt-[calc(env(safe-area-inset-top,0px)+8px)] pb-3
                      bg-gradient-to-b from-black/70 to-transparent transition-opacity duration-200 ${chrome && !closing && dy < 20 ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        >
          <button type="button" onClick={close} aria-label="Закрыть"
                  className="w-10 h-10 shrink-0 rounded-full bg-white/15 backdrop-blur-xl text-white flex items-center justify-center active:scale-90 transition-transform">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
          <div className="flex-1 min-w-0 text-center">
            <p className="text-[15px] font-semibold text-white">{docCategoryLabel(doc.category)}</p>
            {documents.length > 1 && <p className="text-[12px] text-white/60">{index + 1} из {documents.length}</p>}
          </div>
          <span className="w-10 shrink-0" />
        </div>

        {/* Низ: подпись и действия */}
        <div
          className={`absolute inset-x-0 bottom-0 px-4 pt-8 pb-[calc(env(safe-area-inset-bottom,0px)+12px)]
                      bg-gradient-to-t from-black/75 to-transparent transition-opacity duration-200 ${chrome && !closing && dy < 20 ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        >
          <p className="text-[14px] font-medium text-white truncate text-center">{doc.name}</p>
          <p className="mt-0.5 text-[12px] text-white/55 text-center">
            {new Date(doc.uploadedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
            {doc.fileSize ? ` · ${formatFileSize(doc.fileSize)}` : ''}
            {isPendingDoc(doc) ? ' · ждёт сети' : ''}
          </p>
          <div className="mt-3 flex items-center justify-center gap-3">
            <button type="button" onClick={share} disabled={busy}
                    className="h-11 px-5 rounded-full bg-white/15 backdrop-blur-xl text-white text-[15px] font-semibold flex items-center gap-2 active:scale-95 transition-transform disabled:opacity-50">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 3v12" /><path d="m7 8 5-5 5 5" /><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
              </svg>
              Поделиться
            </button>
            {onDelete && (
              <button type="button" onClick={remove} disabled={busy} aria-label="Удалить"
                      className="w-11 h-11 rounded-full bg-white/15 backdrop-blur-xl text-rose-300 flex items-center justify-center active:scale-95 transition-transform disabled:opacity-50">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </ModalPortal>
  );
};

export default DocumentViewer;
