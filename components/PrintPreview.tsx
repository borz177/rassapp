import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Printer, X } from 'lucide-react';
import { registerBackInterceptor } from './transitions/PagePush';

interface PrintPreviewProps {
  html: string;
  title: string;
  autoPrint: boolean;
  onClose: () => void;
}

/**
 * Документ на печать — поверх приложения, а не новым окном.
 *
 * Раньше этикетки и накладные открывались через window.open. В браузере на
 * компьютере это обычная вкладка, но в приложении с экрана «Домой» и в APK у
 * такого окна нет ни вкладок, ни кнопки «назад»: документ закрывал собой всё
 * приложение, и выйти из него можно было только перезапуском.
 *
 * Здесь документ живёт во фрейме внутри страницы: сверху всегда есть
 * «Закрыть», работают жест «назад» и Esc, а печатается только сам документ.
 */
const PrintPreview: React.FC<PrintPreviewProps> = ({ html, title, autoPrint, onClose }) => {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const printedRef = useRef(false);
  const [ready, setReady] = useState(false);

  // Шаг «назад» закрывает просмотр, а не страницу под ним.
  useEffect(() => registerBackInterceptor(() => { onClose(); return true; }), [onClose]);

  // Esc слушаем и в приложении, и в самом документе: после печати фокус остаётся
  // во фрейме, и нажатие уходит туда — без второго слушателя Esc переставал
  // закрывать просмотр, как только открывался диалог печати.
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
  const onKeyRef = useRef(onKey);
  onKeyRef.current = onKey;
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKeyRef.current(e);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  const print = () => {
    const win = frameRef.current?.contentWindow as (Window & { __fitContractForPrint?: () => void }) | null;
    if (!win) return;
    // Договор подгоняет себя под лист перед печатью. На телефоне событие
    // beforeprint приходит не всегда — зовём подгонку сами (см. contractTemplates).
    win.__fitContractForPrint?.();
    win.focus();
    win.print();
  };

  return (
    <div className="fixed inset-0 z-[100000] flex flex-col bg-slate-200 dark:bg-slate-950 animate-fade-in"
         role="dialog" aria-label={title}>
      <div className="shrink-0 flex items-center gap-3 px-4 pb-3 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800"
           style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}>
        <button type="button" onClick={onClose} aria-label="Закрыть"
                className="w-10 h-10 shrink-0 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center active:scale-90 transition-transform">
          <X size={20} />
        </button>
        <p className="flex-1 min-w-0 font-bold text-slate-800 dark:text-white truncate">{title}</p>
        <button type="button" onClick={print} disabled={!ready}
                className="shrink-0 h-10 px-4 rounded-xl bg-indigo-600 text-white text-sm font-bold flex items-center gap-2 disabled:opacity-50 active:scale-95 transition-transform">
          <Printer size={18} /> Печать
        </button>
      </div>
      <iframe
        ref={frameRef}
        title={title}
        srcDoc={html}
        className="flex-1 w-full border-0 bg-white"
        onLoad={() => {
          setReady(true);
          frameRef.current?.contentWindow?.addEventListener('keydown', e => onKeyRef.current(e));
          if (autoPrint && !printedRef.current) {
            printedRef.current = true;
            window.setTimeout(print, 250);
          }
        }}
      />
    </div>
  );
};

/**
 * Открыть документ на печать. Вызывается и из экранов, и из обычных функций
 * (накладная из журнала), поэтому монтируется в собственный корень.
 *
 * На компьютере диалог печати открывается сразу, как раньше. На телефоне
 * сначала документ: системный диалог печати там закрывает экран целиком, и
 * человек не видел бы, что именно отправляет на принтер.
 *
 * @returns функция закрытия
 */
export const openPrintPreview = (
  html: string,
  { title = 'Печать', autoPrint }: { title?: string; autoPrint?: boolean } = {}
): (() => void) => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    root.unmount();
    host.remove();
  };
  const shouldAutoPrint = autoPrint ?? window.matchMedia?.('(pointer: fine)').matches ?? false;
  root.render(<PrintPreview html={html} title={title} autoPrint={shouldAutoPrint} onClose={close} />);
  return close;
};

export default PrintPreview;
