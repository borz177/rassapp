package com.finuchet.app;

import static org.junit.Assert.*;
import android.accessibilityservice.AccessibilityService;
import android.graphics.Paint;
import android.graphics.pdf.PdfDocument;
import android.util.Base64;
import android.view.accessibility.AccessibilityNodeInfo;
import androidx.test.ext.junit.rules.ActivityScenarioRule;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Rule;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Реальный Android/WebView/Capacitor/PrintSpooler. Только синтетический PDF;
 * сеть к API и моделям блокируется в странице, документы пользователей не читаются. */
@RunWith(AndroidJUnit4.class)
public class NativePrintTest {
    @Rule public ActivityScenarioRule<MainActivity> activity = new ActivityScenarioRule<>(MainActivity.class);

    private String js(String script) throws Exception {
        CountDownLatch latch=new CountDownLatch(1);AtomicReference<String> result=new AtomicReference<>();
        activity.getScenario().onActivity(a->a.getBridge().getWebView().evaluateJavascript(script,s->{result.set(s);latch.countDown();}));
        assertTrue("JavaScript callback",latch.await(10,TimeUnit.SECONDS));return result.get();
    }
    private void until(String script) throws Exception {
        for(int i=0;i<150;i++){if("true".equals(js(script)))return;Thread.sleep(150);}
        fail("Timed out: "+script+" state="+js("JSON.stringify({error:window.printTestError,body:document.body.innerText.slice(-500)})"));
    }
    private byte[] pdf() throws Exception {
        PdfDocument document=new PdfDocument();
        try(ByteArrayOutputStream out=new ByteArrayOutputStream()){
            for(int i=1;i<=2;i++){PdfDocument.Page page=document.startPage(new PdfDocument.PageInfo.Builder(595,842,i).create());
                Paint paint=new Paint();paint.setTextSize(20);page.getCanvas().drawText("Synthetic print page "+i,50,100,paint);document.finishPage(page);}
            document.writeTo(out);return out.toByteArray();
        } finally { document.close(); }
    }
    private void setupPage() throws Exception {
        until("!!window.Capacitor?.nativePromise");
        String base64=Base64.encodeToString(pdf(),Base64.NO_WRAP);
        js("window.printTestError=null;window.printTestReady=false;window.printFixture='"+base64+"';"+
            "window.fetch=(original=>async(input,opts)=>{const u=new URL(typeof input==='string'?input:input.url,location.href);if(u.pathname.startsWith('/api/'))throw Error('API blocked in print test');return original(input,opts)})(window.fetch.bind(window));"+
            "(async()=>{const origin='http://10.0.2.2:3002';const refresh=await import(origin+'/@react-refresh');refresh.default.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>t=>t;window.__vite_plugin_react_preamble_installed__=true;"+
            "const preview=await import(origin+'/components/PrintPreview.tsx');window.testPreview=preview;window.fixtureBlob=()=>new Blob([Uint8Array.from(atob(printFixture),c=>c.charCodeAt(0))],{type:'application/pdf'});window.printTestReady=true;})().catch(e=>window.printTestError=String(e));true");
        until("printTestReady===true");
    }
    private void openPreview() throws Exception {
        js("window.closeTestPrint=testPreview.openPrintPreview('<!doctype html><html><body><h1>Тестовый договор</h1></body></html>',{title:'Тестовый договор',autoPrint:false,preparePdf:()=>Promise.resolve(fixtureBlob())});true");
        until("!![...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent.trim()==='Печать'&&!b.disabled)");
    }
    private void waitForPrintDialog() throws Exception {
        for(int i=0;i<100;i++){
            android.app.UiAutomation ui=InstrumentationRegistry.getInstrumentation().getUiAutomation();
            android.accessibilityservice.AccessibilityServiceInfo info=ui.getServiceInfo();
            info.flags |= android.accessibilityservice.AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS;
            ui.setServiceInfo(info);
            for(android.view.accessibility.AccessibilityWindowInfo w:ui.getWindows()){
                AccessibilityNodeInfo root=w.getRoot();
                if(root!=null&&hasPackage(root,"printspooler"))return;
            }
            Thread.sleep(150);
        }
        fail("Android PrintSpooler did not open");
    }
    private boolean hasPackage(AccessibilityNodeInfo node,String value){
        if(String.valueOf(node.getPackageName()).contains(value))return true;
        for(int i=0;i<node.getChildCount();i++){AccessibilityNodeInfo child=node.getChild(i);if(child!=null&&hasPackage(child,value))return true;}
        return false;
    }
    @Test public void realButtonOpensSystemPrintCancelAndRetry() throws Exception {
        setupPage();openPreview();
        js("[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent.trim()==='Печать').click();true");
        waitForPrintDialog();
        InstrumentationRegistry.getInstrumentation().getUiAutomation().performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK);
        until("!![...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent.trim()==='Печать'&&!b.disabled)");
        assertEquals("null",js("document.querySelector('[role=alert]')?.textContent||null"));
        js("[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent.trim()==='Печать').click();true");
        waitForPrintDialog();
        InstrumentationRegistry.getInstrumentation().getUiAutomation().performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK);
        until("!![...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent.trim()==='Печать'&&!b.disabled)");
        js("document.querySelector('[aria-label=Закрыть]').click();true");until("!document.querySelector('[role=dialog]')");
        AtomicReference<Integer> count=new AtomicReference<>(-1);activity.getScenario().onActivity(a->{File[] files=new File(a.getCacheDir(),"print-jobs").listFiles();count.set(files==null?0:files.length);});
        assertEquals("Temporary PDFs removed after cancellation",Integer.valueOf(0),count.get());
    }
    private AccessibilityNodeInfo byId(AccessibilityNodeInfo node,String suffix){
        if(node==null)return null;
        if(node.getViewIdResourceName()!=null&&node.getViewIdResourceName().endsWith(suffix))return node;
        for(int i=0;i<node.getChildCount();i++){AccessibilityNodeInfo found=byId(node.getChild(i),suffix);if(found!=null)return found;}
        return null;
    }
    private AccessibilityNodeInfo waitForId(String suffix) throws Exception {
        android.app.UiAutomation ui=InstrumentationRegistry.getInstrumentation().getUiAutomation();
        android.accessibilityservice.AccessibilityServiceInfo info=ui.getServiceInfo();
        info.flags |= android.accessibilityservice.AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS | android.accessibilityservice.AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS;
        ui.setServiceInfo(info);
        for(int i=0;i<150;i++){
            for(android.view.accessibility.AccessibilityWindowInfo w:ui.getWindows()){
                AccessibilityNodeInfo found=byId(w.getRoot(),suffix);if(found!=null&&found.isEnabled())return found;
            }
            Thread.sleep(150);
        }
        StringBuilder tree=new StringBuilder();for(android.view.accessibility.AccessibilityWindowInfo w:ui.getWindows())dumpNode(w.getRoot(),tree);
        throw new AssertionError("System print control missing: "+suffix+" tree="+tree);
    }
    private void clickText(String text) throws Exception {
        android.app.UiAutomation ui=InstrumentationRegistry.getInstrumentation().getUiAutomation();
        for(int i=0;i<100;i++){
            for(android.view.accessibility.AccessibilityWindowInfo w:ui.getWindows()){
                AccessibilityNodeInfo root=w.getRoot();if(root==null)continue;
                for(AccessibilityNodeInfo found:root.findAccessibilityNodeInfosByText(text)){
                    if(!text.contentEquals(found.getText()))continue;
                    while(found!=null&&!found.isClickable())found=found.getParent();
                    if(found!=null&&found.performAction(AccessibilityNodeInfo.ACTION_CLICK))return;
                }
            }
            Thread.sleep(150);
        }
        throw new AssertionError("System text missing: "+text);
    }
    private void dumpNode(AccessibilityNodeInfo n,StringBuilder out){
        if(n==null||out.length()>8000)return;
        out.append(" [").append(n.getPackageName()).append("/").append(n.getViewIdResourceName()).append(" ").append(n.getText()).append(" desc=").append(n.getContentDescription()).append(" enabled=").append(n.isEnabled()).append("]");
        for(int i=0;i<n.getChildCount();i++)dumpNode(n.getChild(i),out);
    }
    @Test public void saveTwoPagePdfThroughAndroidSystemDialog() throws Exception {
        setupPage();
        js("window.closeTestPrint=testPreview.openPrintPreview('<html><body>Тест</body></html>',{title:'rassapp-print-test',autoPrint:false,preparePdf:()=>Promise.resolve(fixtureBlob())});true");
        until("!![...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent.trim()==='Печать'&&!b.disabled)");
        js("[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent.trim()==='Печать').click();true");
        waitForPrintDialog();
        assertTrue(waitForId(":id/destination_spinner").performAction(AccessibilityNodeInfo.ACTION_CLICK));
        clickText("Save as PDF");
        assertTrue(waitForId(":id/print_button").performAction(AccessibilityNodeInfo.ACTION_CLICK));
        assertTrue(waitForId(":id/button1").performAction(AccessibilityNodeInfo.ACTION_CLICK));
        until("!![...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent.trim()==='Печать'&&!b.disabled)");
        assertEquals("null",js("document.querySelector('[role=alert]')?.textContent||null"));
        js("closeTestPrint();true");
    }
    @Test public void nativeHandlerOnlyAcceptsPdfInsideItsPrivateCache() throws Exception {
        AtomicReference<Throwable> error=new AtomicReference<>();CountDownLatch latch=new CountDownLatch(1);
        final byte[] bytes=pdf();
        activity.getScenario().onActivity(a->{try{
            FinuchetPrintPlugin plugin=(FinuchetPrintPlugin)a.getBridge().getPlugin("FinuchetPrint").getInstance();
            Method method=FinuchetPrintPlugin.class.getDeclaredMethod("checkedPdf",String.class);method.setAccessible(true);
            File dir=new File(a.getCacheDir(),"print-jobs");dir.mkdirs();File valid=new File(dir,"test-valid.pdf");try(FileOutputStream out=new FileOutputStream(valid)){out.write(bytes);}
            assertEquals(valid.getCanonicalFile(),method.invoke(plugin,valid.toURI().toString()));
            for(String uri:new String[]{"https://example.com/doc.pdf","file:///etc/hosts",new File(dir,"../outside.pdf").toURI().toString()}){
                try{method.invoke(plugin,uri);fail("Unsafe URI accepted");}catch(InvocationTargetException expected){assertNotNull(expected.getCause());}
            }
            File bad=new File(dir,"invalid.pdf");try(FileOutputStream out=new FileOutputStream(bad)){out.write("not a pdf".getBytes());}
            try{method.invoke(plugin,bad.toURI().toString());fail("Invalid PDF accepted");}catch(InvocationTargetException expected){}
            valid.delete();bad.delete();
        }catch(Throwable t){error.set(t);}finally{latch.countDown();}});
        assertTrue(latch.await(10,TimeUnit.SECONDS));if(error.get()!=null)throw new AssertionError(error.get());
    }
}
