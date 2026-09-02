import React, { useEffect, useState } from 'react';
import ModalPortal from './ModalPortal';

interface ImageViewerProps {
  images: string[];
  /** С какой картинки открыли */
  startIndex?: number;
  onClose: () => void;
}

/**
 * Просмотр фотографий товара во весь экран.
 *
 * В карточке снимок помещается в узкую полосу и обрезается — разглядеть на нём
 * комплектацию или состояние нельзя, а именно за этим к фотографии и
 * возвращаются. Поэтому по нажатию она раскрывается целиком, без обрезки, на
 * тёмном фоне: так видно сам товар, а не вёрстку вокруг него.
 *
 * Листание — и стрелками, и пальцем: на телефоне тянуться к маленькой стрелке в
 * углу неудобно, а на компьютере свайпа нет вовсе.
 */
const ImageViewer: React.FC<ImageViewerProps> = ({ images, startIndex = 0, onClose }) => {
  const [index, setIndex] = useState(() => Math.min(Math.max(0, startIndex), Math.max(0, images.length - 1)));
  const [swipeFrom, setSwipeFrom] = useState<number | null>(null);

  const many = images.length > 1;
  const go = (delta: number) => setIndex(i => (i + delta + images.length) % images.length);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (many && e.key === 'ArrowRight') go(1);
      if (many && e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [many, images.length, onClose]);

  if (images.length === 0) return null;

  return (
    <ModalPortal onClose={onClose}>
      <div
        className="fixed inset-0 z-modal-top bg-slate-950/95 flex flex-col animate-fade-in"
        onClick={onClose}
        onTouchStart={e => setSwipeFrom(e.touches[0].clientX)}
        onTouchEnd={e => {
          if (swipeFrom === null || !many) return;
          const dx = e.changedTouches[0].clientX - swipeFrom;
          // Порог, чтобы случайное дрожание пальца при закрытии не листало.
          if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
          setSwipeFrom(null);
        }}
      >
        <div className="flex items-center justify-between p-4 shrink-0">
          <span className="text-sm font-bold text-white/70">
            {many ? `${index + 1} из ${images.length}` : ''}
          </span>
          <button type="button" onClick={onClose} aria-label="Закрыть"
                  className="w-10 h-10 rounded-full bg-white/10 text-white text-xl font-bold flex items-center justify-center active:scale-90 transition-transform">
            ✕
          </button>
        </div>

        <div className="flex-1 min-h-0 flex items-center justify-center px-4 pb-4"
             onClick={e => e.stopPropagation()}>
          <img
            src={images[index]}
            alt=""
            decoding="sync"
            className="max-w-full max-h-full object-contain rounded-2xl select-none"
            draggable={false}
          />
        </div>

        {many && (
          <>
            <button type="button" aria-label="Предыдущее"
                    onClick={e => { e.stopPropagation(); go(-1); }}
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/10 text-white flex items-center justify-center active:scale-90 transition-transform">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <button type="button" aria-label="Следующее"
                    onClick={e => { e.stopPropagation(); go(1); }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/10 text-white flex items-center justify-center active:scale-90 transition-transform">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>

            {/* Полоска миниатюр: по ней видно, сколько всего снимков и какой
                сейчас открыт — иначе листаешь вслепую. */}
            <div className="shrink-0 flex gap-2 overflow-x-auto px-4 pb-5" onClick={e => e.stopPropagation()}>
              {images.map((src, i) => (
                <button key={`${src}_${i}`} type="button" onClick={() => setIndex(i)}
                        className={`shrink-0 w-14 h-14 rounded-xl overflow-hidden border-2 transition-colors ${
                          i === index ? 'border-white' : 'border-transparent opacity-60'
                        }`}>
                  <img src={src} alt="" decoding="sync" className="w-full h-full object-cover" draggable={false} />
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </ModalPortal>
  );
};

export default ImageViewer;
