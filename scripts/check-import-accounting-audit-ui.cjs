// Настоящий расчёт на синтетических записях; UI/API — локальные заглушки.
// Рабочая БД, платные модели и отправки не используются.
require('./no-paid-ai.cjs');
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const domain=require('../server/api/domain');
const {buildAccountingAudit}=require('../server/ai/accountingAudit');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'import-audit-ui-')));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

app.whenReady().then(async()=>{let win;try{
  await domain.ready;
  const sale=id=>({id,type:'INSTALLMENT',customerId:'c',accountId:'a',productName:id,buyPrice:100000,totalAmount:120000,downPayment:20000,remainingAmount:100000,paymentPlan:[{id:'plan_'+id,saleId:id,amount:100000,isPaid:false,isRealPayment:false,date:'2026-12-01'}]});
  const sales=['legacy','without','expected','mismatch'].map(sale);
  for(const s of sales.slice(1))s.importInfo={source:'FINPAY',importedAt:'2026-11-14T00:00:00Z',purchaseMode:s.id==='expected'?'WITH_EXPENSE':'WITHOUT_EXPENSE'};
  const report={...buildAccountingAudit({accounts:[{id:'a',name:'Основной',type:'MAIN',initialBalance:1000000},{id:'b',name:'Другой',type:'CUSTOM',initialBalance:1000000}],customers:[{id:'c',name:'Тестовый Клиент'}],sales,expenses:[{id:'exp_legacy',accountId:'a',category:'Себестоимость',amount:100000},{id:'linked',saleId:'mismatch',accountId:'b',category:'Закуп',amount:90000}]}),id:'ui_report',stale:false};
  assert.equal(report.counts.review,1);assert.equal(report.counts.confirmed,2);
  assert(!report.findings.some(f=>f.sources.some(s=>s.id==='legacy')));
  win=new BrowserWindow({show:false,width:1200,height:950,webPreferences:{backgroundThrottling:false}});
  win.webContents.session.webRequest.onBeforeRequest((details,cb)=>{const u=new URL(details.url);cb({cancel:['http:','https:','ws:','wss:'].includes(u.protocol)&&(!['localhost','127.0.0.1'].includes(u.hostname)||u.port!=='3000'||u.pathname.startsWith('/api/'))});});
  const js=code=>win.webContents.executeJavaScript(code),until=async code=>{for(let i=0;i<160;i++){if(await js(code))return;await wait(50);}throw Error('Timeout: '+code);};
  await win.loadURL('http://localhost:3000/');
  await js(`(async()=>{
    window.testReport=${JSON.stringify(report)};window.testState={opened:null,paidCalls:0,requests:[]};
    const originalFetch=window.fetch.bind(window),json=data=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
    window.fetch=async(input,options={})=>{
      const u=new URL(typeof input==='string'?input:input.url,location.href),opts=Object.fromEntries(u.searchParams);
      if(u.pathname.endsWith('/accounting-audit/ui_report/source')){
        if(!testReport.findings.some(f=>f.sources.some(s=>s.kind===opts.kind&&s.id===opts.id)))throw Error('Unexpected source');
        return json({kind:opts.kind,id:opts.id,contractId:opts.id,customerId:'c',title:'Договор'});
      }
      if(u.pathname.endsWith('/accounting-audit/ui_report')){
        testState.requests.push(opts);const items=testReport.findings.filter(f=>!opts.severity||f.severity===opts.severity);
        return json({...testReport,findings:items,findingsTotal:items.length,offset:0,hasMore:false});
      }
      if(u.pathname.startsWith('/api/')||!['localhost','127.0.0.1'].includes(u.hostname)||u.port!=='3000')throw Error('Unrelated network blocked');
      return originalFetch(input,options);
    };
    const R=await import('/node_modules/.vite/deps/react.js'),D=await import('/node_modules/.vite/deps/react-dom_client.js'),Page=(await import('/components/AccountingAuditCard.tsx')).default;
    document.getElementById('root').style.display='none';const host=document.createElement('main');host.id='audit-ui-test';host.style.padding='12px';document.body.append(host);
    window.mountAudit=()=>{sessionStorage.clear();window.auditRoot?.unmount();window.auditRoot=(D.createRoot||D.default.createRoot)(host);auditRoot.render((R.createElement||R.default.createElement)(Page,{report:testReport,onExplain:()=>{testState.paidCalls++;throw Error('Paid explanation forbidden')},onRefresh:async()=>{},onOpenContract:id=>{testState.opened=id}}));};
    mountAudit();return true;
  })()`);
  for(const width of [1200,390]){
    win.setSize(width,950);if(width===390)await js('mountAudit()');
    await until(`!![...document.querySelectorAll('#audit-ui-test button')].find(b=>b.textContent.includes('Уточнить · 1'))`);
    await js(`[...document.querySelectorAll('#audit-ui-test button')].find(b=>b.textContent.includes('Уточнить · 1')).click()`);
    await until(`document.querySelector('[aria-label="Записи проверки"]').textContent.includes('Расход закупа не найден')&&!document.querySelector('[aria-label="Записи проверки"]').textContent.includes('Импорт без истории закупа')`);
    assert(!await js(`document.querySelector('[aria-label="Записи проверки"]').textContent.includes('Импорт без истории закупа')`));
    await js(`[...document.querySelectorAll('#audit-ui-test button')].find(b=>b.textContent.includes('Особенности ·')).click()`);
    await until(`document.querySelector('[aria-label="Записи проверки"]').textContent.includes('Импорт без истории закупа')`);
    await js(`(()=>{const header=[...document.querySelectorAll('[aria-label="Записи проверки"] button')].find(b=>b.textContent.includes('Импорт без истории закупа'));window.importEntry=header.parentElement;header.click();return true})()`);
    await until(`importEntry.querySelector('[aria-expanded]').getAttribute('aria-expanded')==='true'`);
    assert(await js(`importEntry.textContent.includes('Договор перенесён без расходов закупа. Само по себе это не ошибка.')`));
    await js(`[...importEntry.querySelectorAll('button')].find(b=>b.textContent==='Открыть договор').click()`);
    await until(`testState.opened==='without'`);await js('testState.opened=null');
    assert.equal(await js('testState.paidCalls'),0);
    assert(await js('document.documentElement.scrollWidth<=innerWidth'));
  }
  console.log('PASS: desktop/mobile audit filters, short import explanation, contract navigation, no paid calls');
  win.destroy();app.exit(0);
}catch(e){console.error(e.stack);if(win&&!win.isDestroyed()){console.error(await win.webContents.executeJavaScript('JSON.stringify({text:document.querySelector("#audit-ui-test")?.textContent,state:window.testState})').catch(()=>''));win.destroy();}app.exit(1);}});
setTimeout(()=>app.exit(2),40000).unref();
