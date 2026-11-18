/** Синтетический предпросмотр в окне Electron: геометрия и нажатия мышью, без ОС-печати. */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
require('./no-paid-ai.cjs');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-print-controls-')));
app.on('window-all-closed',()=>{});
const wait = ms => new Promise(r => setTimeout(r,ms));
app.whenReady().then(async()=>{
  let win;
  try {
    win = new BrowserWindow({show:false,width:1040,height:800,...(process.platform==='darwin'?{titleBarStyle:'hiddenInset',trafficLightPosition:{x:28,y:30}}:{}),webPreferences:{backgroundThrottling:false}});
    const js = s=>win.webContents.executeJavaScript(s);
    const until = async s=>{for(let i=0;i<160;i++){if(await js(s))return;await wait(50)}throw Error('Timeout '+s)};
    const mouse = async selector=>{
      const point=await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
      win.show();win.focus();await wait(80);
      win.webContents.sendInputEvent({type:'mouseMove',...point});win.webContents.sendInputEvent({type:'mouseDown',...point,button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseUp',...point,button:'left',clickCount:1});await wait(100);
    };
    await win.loadURL(`http://localhost:${process.env.PRINT_TEST_PORT||'3000'}/index.html`);await wait(600);
    await js(`(async()=>{
      document.getElementById('root').style.display='none';
      const fetchOriginal=window.fetch.bind(window);window.fetch=(input,opts)=>{const u=new URL(typeof input==='string'?input:input.url,location.href);if(u.pathname.startsWith('/api/')||!['localhost','127.0.0.1'].includes(u.hostname))throw Error('External/API request forbidden');return fetchOriginal(input,opts)};
      const grip=document.createElement('div');grip.className='shell-sidebar-grip';grip.style.cssText='position:fixed;left:12px;top:12px;width:256px;height:40px;z-index:60';document.body.append(grip);
      const input=document.createElement('input');input.id='return-focus';input.style.cssText='position:fixed;left:300px;top:100px';document.body.append(input);
      const P=await import('/components/PrintPreview.tsx');window.openHtml=P.openPrintPreview;window.openPdf=P.openPdfPrintPreview;window.printCalls=0;
      window.fixtureHtml='<!doctype html><html><body><h1>Тестовая печать</h1></body></html>';
      return true;
    })()`);
    for(const platform of ['mac','win'])for(const width of [1040,620]){
      await win.setSize(width,800);if(process.platform==='darwin')win.setWindowButtonVisibility(platform==='mac');
      await js(`document.documentElement.classList.add('shell-floating');document.documentElement.classList.toggle('shell-win',${platform==='win'});document.getElementById('return-focus').focus();window.closePreview=openHtml(fixtureHtml,{title:'Тестовый документ',autoPrint:false});true`);
      await until(`document.querySelector('[aria-label="Закрыть"]')&&![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Печать').disabled`);
      await wait(250);
      const bounds=await js(`(()=>{const h=document.querySelector('.shell-window-head'),b=h.querySelector('button'),p=h.querySelector('button:last-child');return{close:b.getBoundingClientRect().toJSON(),print:p.getBoundingClientRect().toJSON(),region:getComputedStyle(h).getPropertyValue('-webkit-app-region'),closeRegion:getComputedStyle(b).getPropertyValue('-webkit-app-region')}})()`);
      if(process.env.PRINT_CONTROLS_DIAGNOSE==='1'){console.log(platform,width,JSON.stringify(bounds));await js('closePreview();true');continue}
      assert.equal(bounds.region,'no-drag');assert.equal(bounds.closeRegion,'no-drag');
      if(platform==='mac')assert(bounds.close.left>=96,'Close must clear native Mac controls at every width');
      else assert(bounds.print.right<=width-152,'Print must clear Windows native controls at every width');
      const before=await js('printCalls');
      await js(`(()=>{const w=document.querySelector('iframe').contentWindow;w.print=()=>window.printCalls++;w.focus();return true})()`);
      await mouse('.shell-window-head button:last-child');assert.equal(await js('printCalls'),before+1);
      await mouse('.shell-window-head button[aria-label="Закрыть"]');await until(`!document.querySelector('[role=dialog]')`);
      assert(await js(`document.activeElement===document.getElementById('return-focus')`));
      console.log('PASS '+platform+' CSS / '+width+'px: native controls clear, no-drag, mouse print/close, iframe focus restored');
    }
    if(process.env.PRINT_CONTROLS_DIAGNOSE!=='1'){
      await js(`document.documentElement.classList.remove('shell-win');document.getElementById('return-focus').focus();window.closePreview=openPdf(new Blob(['%PDF-1.4'],{type:'application/pdf'}),{title:'PDF тест'});true`);
      await until(`!!document.querySelector('[aria-label="Закрыть"]')`);await wait(250);
      await mouse('.shell-window-head button[aria-label="Закрыть"]');await until(`!document.querySelector('[role=dialog]')`);
      console.log('PASS PDF preview closes with mouse too; no paid calls or printer requests');
    }
  } catch(e){console.error(e.stack);process.exitCode=1;if(win&&!win.isDestroyed())fs.writeFileSync('/tmp/rassapp-desktop-print-controls-failure.png',(await win.webContents.capturePage()).toPNG())}
  finally{win?.destroy();app.exit(process.exitCode||0)}
}).catch(e=>{console.error(e.stack);app.exit(1)});
setTimeout(()=>app.exit(2),60000).unref();
