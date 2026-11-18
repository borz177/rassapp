package com.finuchet.app;

import android.content.Context;
import android.net.Uri;
import android.print.PrintAttributes;
import android.print.PrintManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "FinuchetPrint")
public class FinuchetPrintPlugin extends Plugin {
    private PdfPrintAdapter active;
    private PluginCall activeCall;

    @Override public void load() {
        // После аварийного закрытия приложения удаляем только собственные старые файлы.
        File dir = new File(getContext().getCacheDir(), "print-jobs");
        File[] files = dir.listFiles();
        if (files != null) for (File file : files) {
            if (file.getName().endsWith(".pdf") && file.lastModified() < System.currentTimeMillis() - 86400000L) file.delete();
        }
    }

    @PluginMethod public void printPdf(PluginCall call) {
        final File file;
        try { file = checkedPdf(call.getString("uri")); }
        catch (Exception e) { call.reject("PDF недоступен для печати.", "INVALID_PDF"); return; }
        String rawTitle = call.getString("title", "Договор");
        String cleaned = rawTitle.replaceAll("[\\p{Cntrl}]", " ").trim();
        final String title = (cleaned.isEmpty() ? "Договор" : cleaned.substring(0, Math.min(cleaned.length(), 140)));
        getActivity().runOnUiThread(() -> {
            if (active != null) { call.reject("Сначала закройте текущее окно печати.", "PRINT_BUSY"); return; }
            if (getActivity().isFinishing() || getActivity().isDestroyed()) { call.reject("Просмотр закрыт.", "CANCELLED"); return; }
            PrintManager manager = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
            if (manager == null) { call.reject("Системная печать недоступна. Сохраните PDF.", "PRINT_UNAVAILABLE"); return; }
            activeCall = call;
            active = new PdfPrintAdapter(file, title.endsWith(".pdf") ? title : title + ".pdf", () ->
                getActivity().runOnUiThread(() -> {
                    PluginCall completed = activeCall;
                    activeCall = null;
                    active = null;
                    if (completed != null) {
                        JSObject result = new JSObject(); result.put("closed", true);
                        completed.resolve(result); // Закрытие диалога не означает, что принтер напечатал лист.
                    }
                }));
            try {
                if (manager.print(title, active, new PrintAttributes.Builder()
                        .setMediaSize(PrintAttributes.MediaSize.ISO_A4).build()) == null) {
                    throw new IllegalStateException("Print job unavailable");
                }
            } catch (Exception e) {
                activeCall = null;
                active.onFinish(); active = null;
                call.reject("Не удалось открыть системную печать. Сохраните PDF.", "PRINT_UNAVAILABLE");
            }
        });
    }

    private File checkedPdf(String value) throws Exception {
        if (value == null) throw new IllegalArgumentException();
        Uri uri = Uri.parse(value);
        if (!"file".equals(uri.getScheme()) || (uri.getAuthority() != null && !uri.getAuthority().isEmpty())) throw new IllegalArgumentException();
        File file = new File(uri.getPath()).getCanonicalFile();
        File allowed = new File(getContext().getCacheDir(), "print-jobs").getCanonicalFile();
        if (!file.getPath().startsWith(allowed.getPath() + File.separator) || !file.isFile() ||
                file.length() < 5 || file.length() > 40L * 1024 * 1024) throw new IllegalArgumentException();
        try (FileInputStream input = new FileInputStream(file)) {
            byte[] signature = new byte[5];
            if (input.read(signature) != 5 || !"%PDF-".equals(new String(signature, StandardCharsets.US_ASCII))) throw new IllegalArgumentException();
        }
        return file;
    }

    @Override protected void handleOnDestroy() {
        PluginCall cancelled = activeCall; activeCall = null;
        if (cancelled != null) cancelled.reject("Просмотр закрыт.", "CANCELLED");
        if (active != null) { active.onFinish(); active = null; }
    }
}
