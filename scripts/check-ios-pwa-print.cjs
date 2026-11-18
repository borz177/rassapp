/** Бесплатно: Vite :3000, синтетические документы, подмена ОС-меню. Никаких отправок. */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
require('./no-paid-ai.cjs');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'pwa-print-ui-')));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  let win;
  try {
    win = new BrowserWindow({ show: false, width: 430, height: 932, webPreferences: { backgroundThrottling: false } });
    const js = code => win.webContents.executeJavaScript(code);
    const until = async code => { for (let i = 0; i < 240; i++) { if (await js(code)) return; await wait(60); } throw Error('Timeout: '+code); };
    const click = async label => { await js(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(label)}||e.getAttribute('aria-label')===${JSON.stringify(label)});if(!b||b.disabled)throw Error('Missing/disabled '+${JSON.stringify(label)});window.insideClick=true;b.click();window.insideClick=false;return true})()`);await wait(100); };
    await win.loadURL(`http://localhost:${process.env.PRINT_TEST_PORT||'3000'}/index.html`);await wait(600);
    await js(`(async()=>{
      document.getElementById('root').style.display='none';window.mode='pwa';window.shareMode='ok';window.shareCalls=[];window.printCalls=0;window.preparations=0;
      const fetchOriginal=window.fetch.bind(window);window.fetch=(input,opts)=>{const u=new URL(typeof input==='string'?input:input.url,location.href);if(u.pathname.startsWith('/api/')||!['localhost','127.0.0.1'].includes(u.hostname))throw Error('External/API request forbidden');return fetchOriginal(input,opts)};
      Object.defineProperty(navigator,'userAgent',{configurable:true,get:()=>mode==='desktop'?'Macintosh':'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X)'});
      Object.defineProperty(navigator,'standalone',{configurable:true,get:()=>mode==='pwa'});
      Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>shareMode!=='unsupported'});
      Object.defineProperty(navigator,'share',{configurable:true,value:data=>{if(!insideClick)throw Error('Share outside click');shareCalls.push(data);if(shareMode==='cancel')return Promise.reject(new DOMException('Cancelled','AbortError'));if(shareMode==='fail')return Promise.reject(new DOMException('Denied','NotAllowedError'));return Promise.resolve()}});
      const originalTimeout=window.setTimeout;window.setTimeout=(fn,ms,...args)=>originalTimeout(fn,ms===10000?100:ms,...args);
      const revoke=URL.revokeObjectURL.bind(URL);window.revoked=[];URL.revokeObjectURL=url=>{revoked.push(url);revoke(url)};
      const P=await import('/components/PrintPreview.tsx');window.openPreview=P.openPrintPreview;window.openPdf=P.openPdfPrintPreview;
      window.html='<!doctype html><html><body><h1>Синтетический договор</h1></body></html>';
      window.prepare=()=>{preparations++;return Promise.resolve(new Blob(['%PDF-1.4 synthetic'],{type:'application/pdf'}))};
      window.closePreview=openPreview(html,{title:'Договор №0001',autoPrint:true,preparePdf:()=>new Promise(resolve=>window.finishPrepare=()=>resolve(new Blob(['%PDF-1.4 synthetic'],{type:'application/pdf'})))});
      return true;
    })()`);
    await until(`document.body.textContent.includes('Готовим…')`);assert.equal(await js('shareCalls.length'),0);
    await js('finishPrepare();true');await until(`!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Печать'&&!b.disabled)`);
    await wait(400);assert.equal(await js('shareCalls.length'),0);
    await click('Печать');assert.equal(await js('shareCalls.length'),1);
    assert.deepEqual(await js(`({keys:Object.keys(shareCalls[0]),name:shareCalls[0].files[0].name,type:shareCalls[0].files[0].type})`),{keys:['files'],name:'Договор №0001.pdf',type:'application/pdf'});
    await js("shareMode='cancel';true");await click('Печать');assert(!await js(`!!document.querySelector('[role=alert]')`));
    await js("shareMode='fail';true");await click('Печать');assert(await js(`document.body.textContent.includes('Не удалось открыть меню печати')`));assert(await js(`!!document.querySelector('a[download="Договор №0001.pdf"]')`));
    await click('Закрыть');await wait(180);assert(await js('revoked.length>=1'));
    console.log('PASS PWA: PDF prepared before click; no automatic share; only the PDF shared; cancel clean; denied share offers save; URL cleanup');

    await js("shareMode='unsupported';closePreview=openPreview(html,{title:'Без Web Share',preparePdf:prepare});true");await until(`!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Печать'&&!b.disabled)`);await click('Печать');assert(await js(`document.body.textContent.includes('Сохраните PDF')`));await click('Закрыть');
    await js("shareMode='ok';closePreview=openPreview(html,{title:'Ошибка PDF',preparePdf:()=>{throw Error('Synthetic failure')}});true");await until(`document.body.textContent.includes('Не удалось подготовить PDF')`);assert(await js(`!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Повторить')`));await click('Закрыть');
    await js("closePreview=openPreview(html,{title:'Закрыт до подготовки',preparePdf:()=>new Promise(resolve=>window.lateResolve=resolve)});true");await until(`typeof lateResolve==='function'`);await click('Закрыть');await js("lateResolve(new Blob(['%PDF-1.4'],{type:'application/pdf'}));true");await wait(150);assert(!await js(`!!document.querySelector('[role=dialog]')`));
    console.log('PASS missing share support, synchronous PDF failure and closing during preparation');

    const preparations=await js('preparations');
    await js("mode='safari';closePreview=openPreview(html,{title:'Safari',autoPrint:false,preparePdf:prepare});true");await until(`!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Печать'&&!b.disabled)`);
    await js(`(()=>{const w=document.querySelector('iframe').contentWindow;w.focus=()=>{};w.print=()=>window.printCalls++;return true})()`);await click('Печать');assert.equal(await js('printCalls'),1);assert.equal(await js('preparations'),preparations);await click('Закрыть');
    await js("mode='desktop';closePreview=openPreview(html,{title:'Desktop',autoPrint:false,preparePdf:prepare});true");await until(`!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Печать'&&!b.disabled)`);await js(`(()=>{const w=document.querySelector('iframe').contentWindow;w.focus=()=>{};w.print=()=>window.printCalls++;return true})()`);await click('Печать');assert.equal(await js('printCalls'),2);await click('Закрыть');
    console.log('PASS Safari tab and desktop retain iframe printing without generating PDFs');

    await js(`(async()=>{mode='pwa';const {contractPdfBlob}=await import('/src/contractPdf.ts');const {buildContractHtml}=await import('/src/contractTemplates.ts');window.data={companyName:'Тестовая компания',customerName:'Тестов Тест Тестович',contractNumber:'0001',productName:'Тестовый товар',buyPrice:7000,totalAmount:10000,downPayment:0,remainingAmount:10000,installments:2,startDate:'2026-11-12',rows:[]};closePreview=openPreview(buildContractHtml('MODERN',data),{title:'Тестовый PDF',preparePdf:()=>contractPdfBlob('MODERN',data,'Тестовый PDF')});return true})()`);
    await until(`!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Печать'&&!b.disabled)`);
    await click('Печать');assert(await js(`shareCalls.at(-1).files[0].size>10000`));assert.equal(await js(`shareCalls.at(-1).files[0].text().then(t=>t.slice(0,5))`),'%PDF-');
    fs.writeFileSync('/tmp/rassapp-ios-pwa-print.png',(await win.webContents.capturePage()).toPNG());await click('Закрыть');
    const pages = await js(`(async()=>{const {contractPdfBlob}=await import('/src/contractPdf.ts');const classic=await contractPdfBlob('CLASSIC',data,'Классический');const custom={id:'ct_0123456789abcdef01234567',name:'Синтетический',fontFamily:'Arial',fontSize:12,layout:{version:1,blocks:[{type:'title',text:'Первая страница'},{type:'pagebreak'},{type:'text',text:'Вторая страница {{customerName}}'}]}};const multi=await contractPdfBlob('CUSTOM:'+custom.id,{...data,customTemplate:custom},'Две страницы');const count=async blob=>(await blob.text()).match(/\\/Type\\s*\\/Page\\b/g)?.length||0;return {classic:await count(classic),custom:await count(multi)}})()`);
    assert.deepEqual(pages,{classic:1,custom:2});
    await js("closePreview=openPdf(new Blob(['%PDF-1.4 synthetic'],{type:'application/pdf'}),{title:'Готовый PDF'});true");await until(`!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Печать'&&!b.disabled)`);await click('Печать');assert.equal(await js(`shareCalls.at(-1).files[0].name`),'Готовый PDF.pdf');await click('Закрыть');
    console.log('PASS real MODERN/CLASSIC/custom two-page PDFs and existing PDF; no server/AI requests');
  } catch(e) {
    console.error(e.stack);process.exitCode=1;if(win){console.error(await win.webContents.executeJavaScript('document.body.textContent.slice(-2000)'));fs.writeFileSync('/tmp/rassapp-ios-pwa-print-failure.png',(await win.webContents.capturePage()).toPNG())}
  } finally {win?.destroy();app.exit(process.exitCode||0)}
}).catch(e=>{console.error(e.stack);app.exit(1)});
setTimeout(()=>app.exit(2),90000).unref();
