package com.finuchet.app;

import android.graphics.pdf.PdfRenderer;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintDocumentInfo;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/** Передаёт исходный PDF в Android без повторной вёрстки или потери кириллицы.
 * Как Android PrintFileDocumentAdapter, отдаёт полный файл; выбранные страницы
 * извлекает системный spooler. Дисковое чтение выполняется вне UI-потока. */
final class PdfPrintAdapter extends PrintDocumentAdapter {
    private final File file;
    private final String title;
    private final Runnable finishedCallback;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicBoolean finished = new AtomicBoolean(false);

    PdfPrintAdapter(File file, String title, Runnable finishedCallback) {
        this.file = file;
        this.title = title;
        this.finishedCallback = finishedCallback;
    }

    @Override public void onLayout(PrintAttributes oldAttributes, PrintAttributes newAttributes,
            CancellationSignal signal, LayoutResultCallback callback, Bundle extras) {
        worker.execute(() -> {
            if (signal.isCanceled() || finished.get()) { callback.onLayoutCancelled(); return; }
            final int count;
            try (ParcelFileDescriptor descriptor = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
                    PdfRenderer renderer = new PdfRenderer(descriptor)) {
                count = renderer.getPageCount();
                if (count < 1) throw new IllegalArgumentException("Empty PDF");
            } catch (Exception e) {
                callback.onLayoutFailed("Не удалось прочитать PDF. Сохраните документ и повторите печать.");
                return;
            }
            if (signal.isCanceled() || finished.get()) { callback.onLayoutCancelled(); return; }
            callback.onLayoutFinished(new PrintDocumentInfo.Builder(title)
                .setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT).setPageCount(count).build(), false);
        });
    }

    @Override public void onWrite(PageRange[] pages, ParcelFileDescriptor destination,
            CancellationSignal signal, WriteResultCallback callback) {
        worker.execute(() -> {
            boolean cancelled = false;
            try (FileInputStream input = new FileInputStream(file);
                    FileOutputStream output = new ParcelFileDescriptor.AutoCloseOutputStream(destination)) {
                byte[] buffer = new byte[32768];
                int size;
                while ((size = input.read(buffer)) != -1) {
                    if (signal.isCanceled() || finished.get() || Thread.currentThread().isInterrupted()) {
                        cancelled = true; break;
                    }
                    output.write(buffer, 0, size);
                }
                output.flush();
            } catch (Exception e) {
                if (signal.isCanceled() || finished.get()) callback.onWriteCancelled();
                else callback.onWriteFailed("Не удалось передать PDF на печать.");
                return;
            }
            if (cancelled || signal.isCanceled() || finished.get()) callback.onWriteCancelled();
            else callback.onWriteFinished(new PageRange[]{PageRange.ALL_PAGES});
        });
    }

    @Override public void onFinish() {
        if (!finished.compareAndSet(false, true)) return;
        worker.shutdown();
        file.delete();
        finishedCallback.run();
    }
}
