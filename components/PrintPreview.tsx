import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Loader2, Printer, X } from 'lucide-react';
import { registerBackInterceptor } from './transitions/PagePush';
import { isIOSStandalonePrint } from '../src/printEnvironment';
import { pdfFileName, saveContractPdf } from '../src/contractPdf';
import {isAndroidNativePrint,printAndroidPdf} from '../src/androidPrint';

interface PrintPreviewProps {
  html: string;
  pdfUrl?: string;
  title: string;
  autoPrint: boolean;
  onClose: () => void;
  preparePdf?: () => Promise<Blob>;
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
const PrintPreview: React.FC<PrintPreviewProps> = ({ html, pdfUrl, title, autoPrint, onClose, preparePdf }) => {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const printedRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [printError, setPrintError] = useState('');
  const androidPrint=isAndroidNativePrint();
  const systemPdf = (isIOSStandalonePrint() || androidPrint) && !!preparePdf;
  const [prepared, setPrepared] = useState<{ file: File; url: string } | null>(null);
  const [preparing, setPreparing] = useState(systemPdf), [sharing, setSharing] = useState(false), [retry, setRetry] = useState(0);
  const shareLock = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  // PDF готовится ДО нажатия: длительная сборка после клика теряет user activation.
  // Само системное меню открывается только явным нажатием «Печать».
  useEffect(() => {
    if (!systemPdf || !preparePdf) return;
    let disposed = false, url: string | undefined;
    setPrepared(null); setPreparing(true); setPrintError('');
    Promise.resolve().then((): Promise<Blob> => preparePdf()).then(blob => {
      if (disposed) return;
      const file = new File([blob], pdfFileName(title), { type: 'application/pdf' });
      url = URL.createObjectURL(file);
      setPrepared({ file, url });
    }).catch(() => { if (!disposed) setPrintError('Не удалось подготовить PDF для печати.'); })
      .finally(() => { if (!disposed) setPreparing(false); });
    return () => {
      disposed = true;
      // Загрузка файла могла начаться перед закрытием просмотра.
      if (url) { const revoke = url; setTimeout(() => URL.revokeObjectURL(revoke), 10000); }
    };
  }, [systemPdf, preparePdf, title, retry]);

  // Шаг «назад» закрывает просмотр, а не страницу под ним.
  useEffect(() => registerBackInterceptor(() => { onClose(); return true; }), [onClose]);

  // Документ печатается во фрейме, и печать уводит фокус клавиатуры туда
  // (win.focus() ниже — без него диалог печати открывает не тот документ). Когда
  // просмотр закрывается, фрейм исчезает вместе с фокусом: document.hasFocus()
  // становится false, и в приложении перестаёт печататься текст — до тех пор,
  // пока окно не свернут и не откроют заново. Поэтому при закрытии возвращаем
  // фокус приложению и полю, которое было активно до печати.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    return () => {
      window.focus();
      if (before?.isConnected) before.focus({ preventScroll: true });
    };
  }, []);

  // Имя документа в диалоге печати и в сохранённом PDF браузер берёт из заголовка
  // СТРАНИЦЫ, а не из документа во фрейме: печать договора называлась «FinUchet».
  // Пока просмотр открыт, заголовок страницы — название документа; при закрытии
  // возвращаем прежний.
  useEffect(() => {
    const pageTitle = document.title;
    document.title = title;
    return () => { document.title = pageTitle; };
  }, [title]);

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

  const print = async () => {
    if (systemPdf) {
      if (!prepared || shareLock.current) return;
      shareLock.current = true; setSharing(true); setPrintError('');
      try {
        if(androidPrint){
          await printAndroidPdf(prepared.file,title);
          return;
        }
        if (!navigator.share || !navigator.canShare?.({ files: [prepared.file] })) {
          setPrintError('Сохраните PDF и откройте его для печати.');
          return;
        }
        await navigator.share({ files: [prepared.file] });
      } catch (e: any) {
        // Отмена системного меню — не ошибка и не повод автоматически скачивать.
        if (e?.name !== 'AbortError' && e?.code!=='CANCELLED' && alive.current) setPrintError(e?.code==='PRINT_UPDATE_REQUIRED'
          ? 'Обновите приложение для системной печати. Сейчас можно сохранить PDF и напечатать его отдельно.'
          : 'Не удалось открыть меню печати. Повторите или сохраните PDF.');
      } finally {
        shareLock.current = false;
        if (alive.current) setSharing(false);
      }
      return;
    }
    if(androidPrint){setPrintError('Для этого документа откройте печать на сайте в браузере.');return;}
    const win = frameRef.current?.contentWindow as (Window & { __fitContractForPrint?: () => void }) | null;
    if (!win) return;
    // Договор подгоняет себя под лист перед печатью. На телефоне событие
    // beforeprint приходит не всегда — зовём подгонку сами (см. contractTemplates).
    try {
      if (!pdfUrl) win.__fitContractForPrint?.();
      win.focus();
      win.print();
      setPrintError('');
    } catch {
      setPrintError('Используйте кнопку печати в панели просмотра PDF.');
    }
  };

  return (
    <div className="fixed inset-0 z-[100000] flex flex-col bg-slate-200 dark:bg-slate-950 animate-fade-in"
         role="dialog" aria-label={title}>
      <div className="shell-window-head shrink-0 flex items-center gap-3 px-4 pb-3 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800"
           style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}>
        <button type="button" onClick={onClose} aria-label="Закрыть"
                className="w-10 h-10 shrink-0 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center active:scale-90 transition-transform">
          <X size={20} />
        </button>
        <p className="flex-1 min-w-0 font-bold text-slate-800 dark:text-white truncate">{title}</p>
        <button type="button" onClick={print} disabled={systemPdf ? !prepared || sharing : !ready}
                className="shrink-0 h-10 px-4 rounded-xl bg-indigo-600 text-white text-sm font-bold flex items-center gap-2 disabled:opacity-50 active:scale-95 transition-transform">
          {preparing || sharing ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : <Printer size={18} />} {preparing ? 'Готовим…' : 'Печать'}
        </button>
      </div>
      {systemPdf && !printError && <p role="status" className="px-4 py-2 text-sm bg-white text-slate-600 dark:bg-slate-900 dark:text-slate-300">{preparing ? 'Подготавливаем PDF…' : androidPrint ? 'Выберите принтер или «Сохранить как PDF» в системном окне.' : 'В системном меню выберите «Напечатать».'}</p>}
      {printError && <div role="alert" className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm bg-white text-amber-700 dark:bg-slate-900 dark:text-amber-300"><p>{printError}</p>
        {systemPdf && !prepared && !preparing && <button type="button" className="font-semibold underline" onClick={() => setRetry(n => n + 1)}>Повторить</button>}
        {prepared && (androidPrint ? <button type="button" disabled={sharing} className="font-semibold underline" onClick={async()=>{
          if(shareLock.current)return;shareLock.current=true;setSharing(true);
          try{await saveContractPdf(prepared.file,prepared.file.name);}catch{if(alive.current)setPrintError('Не удалось сохранить PDF. Попробуйте ещё раз.');}
          finally{shareLock.current=false;if(alive.current)setSharing(false);}
        }}>Сохранить PDF</button> : <a href={prepared.url} download={prepared.file.name} className="font-semibold underline">Сохранить PDF</a>)}
      </div>}
      <iframe
        ref={frameRef}
        title={title}
        srcDoc={pdfUrl ? undefined : html}
        src={pdfUrl}
        className="flex-1 w-full border-0 bg-white"
        onLoad={() => {
          setReady(true);
          // Firefox и Safari берут имя из документа во фрейме — проставляем и там
          try { if (frameRef.current?.contentDocument) frameRef.current.contentDocument.title = title; } catch { /* чужой origin — не наш случай */ }
          try { frameRef.current?.contentWindow?.addEventListener('keydown', e => onKeyRef.current(e)); } catch { /* PDF использует собственный просмотрщик браузера */ }
          if (autoPrint && !systemPdf && !printedRef.current) {
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
  { title = 'Печать', autoPrint, preparePdf }: { title?: string; autoPrint?: boolean; preparePdf?: () => Promise<Blob> } = {}
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
  root.render(<PrintPreview html={html} title={title} autoPrint={shouldAutoPrint} onClose={close} preparePdf={preparePdf} />);
  return close;
};

/** PDF из исходного Word открывается тем же просмотром поверх приложения. */
export const openPdfPrintPreview = (
  blob: Blob,
  { title = 'Договор' }: { title?: string } = {}
): (() => void) => {
  const url = URL.createObjectURL(blob);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    root.unmount();
    host.remove();
    URL.revokeObjectURL(url);
  };
  root.render(<PrintPreview html="" pdfUrl={url} title={title} autoPrint={false} onClose={close} preparePdf={() => Promise.resolve(blob)} />);
  return close;
};

export default PrintPreview;
