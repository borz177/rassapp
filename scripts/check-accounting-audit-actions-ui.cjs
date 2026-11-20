// Синтетические данные, реальные компоненты и файловые API-заглушки.
// Проверяет подтверждение, повторы, синхронизацию, отметки и отмену без модели.
require('./no-paid-ai.cjs');
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {buildAccountingAudit}=require('../server/ai/accountingAudit');
const domain=require('../server/api/domain');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'audit-actions-ui-')));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{let win;try{
  await domain.ready;
  const data={accounts:[{id:'a',type:'MAIN',name:'Касса',initialBalance:1000000}],customers:[{id:'c',name:'Тестовый Клиент'}],
    sales:[{id:'s',accountId:'a',customerId:'c',productName:'Тестовый товар',type:'INSTALLMENT',status:'ACTIVE',buyPrice:114000,totalAmount:147000,downPayment:0,remainingAmount:52000,installments:6,startDate:'2026-04-17',
      paymentPlan:[...Array.from({length:5},(_,i)=>({id:'old'+i,amount:25400,date:`2026-${String(i+6).padStart(2,'0')}-17`,isRealPayment:false,isPaid:i<3})),{id:'pay_reconcile_test',amount:24500,date:'2026-11-17',isRealPayment:false,isPaid:false},
      ...[20000,20000,10000,20000,25000].map((amount,i)=>({id:'r'+i,amount,date:`2026-11-${i+1}`,isPaid:true,isRealPayment:true}))]}],expenses:[{id:'exp_sale_s',amount:114000,accountId:'a',category:'Закуп'}]};
  const built=buildAccountingAudit(data),finding=built.findings.find(f=>f.code==='schedule_review');assert(finding);
  const report={...built,id:'ui_report',findings:[finding],findingsTotal:1,offset:0,hasMore:false,stale:false,counts:{confirmed:0,review:1,information:0,affectedRecords:1,reviewed:0}};
  win=new BrowserWindow({show:false,width:1100,height:950,webPreferences:{backgroundThrottling:false}});
  win.webContents.session.webRequest.onBeforeRequest((d,cb)=>{const u=new URL(d.url);cb({cancel:['http:','https:','ws:','wss:'].includes(u.protocol)&&(!['localhost','127.0.0.1'].includes(u.hostname)||u.port!=='3000'||u.pathname.startsWith('/api/'))});});
  const js=s=>win.webContents.executeJavaScript(s);
  const until=async s=>{for(let i=0;i<200;i++){if(await js(s))return;await wait(60);}throw Error('Timeout '+s);};
  const click=async text=>{await js(`(()=>{const scope=document.querySelector('[role=dialog]')||document.querySelector('#audit-actions-test');const b=[...scope.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b||b.disabled)throw Error('Missing/disabled button '+${JSON.stringify(text)});b.click();return true})()`);await wait(70);};
  const rapid=async text=>{await js(`(()=>{const scope=document.querySelector('[role=dialog]')||document.querySelector('#audit-actions-test');const b=[...scope.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});for(let i=0;i<4;i++)b.click();return true})()`);};
  const expand=async()=>{await until(`!!document.querySelector('#audit-actions-test [aria-expanded]')`);await js(`document.querySelector('#audit-actions-test [aria-expanded]').click();true`);await until(`document.querySelector('#audit-actions-test [aria-expanded]').getAttribute('aria-expanded')==='true'`);};
  await win.loadURL('http://localhost:3000');await wait(700);
  await js(`(async()=>{
    const R=await import('/node_modules/.vite/deps/react.js'),D=await import('/node_modules/.vite/deps/react-dom_client.js');const React=R.default||R;
    const Card=(await import('/components/AIActionCard.tsx')).default,Journal=(await import('/components/AIAgentJournal.tsx')).default;
    const {api}=await import('/services/api.ts'),{offlineStorage}=await import('/services/offlineStorage.ts');window.dialogs=(await import('/src/dialogs.ts')).dialogStore;
    window.apiFetches=0;const fetchOriginal=window.fetch.bind(window);window.fetch=(input,opts)=>{const u=new URL(typeof input==='string'?input:input.url,location.href);if(u.pathname.startsWith('/api/')){apiFetches++;throw Error('Unexpected API call')}if(!['localhost','127.0.0.1'].includes(u.hostname))throw Error('External request');return fetchOriginal(input,opts)};
    const oldQueue=offlineStorage.getQueue;offlineStorage.getQueue=async()=>[{ownerId:''}];window.guarded=0;
    for(const operation of [()=>api.aiAssistant.accountingAudit.create({accountIds:null,requestId:'local-test'}),()=>api.aiAssistant.accountingAudit.review('r','f',true),()=>api.aiAssistant.accountingAudit.prepareRepair('r','f','local-test'),()=>api.aiAssistant.accountingAudit.repairAction('r','confirm'),()=>api.aiAssistant.accountingAudit.repairAction('r','undo')]){
      try{await operation();throw Error('Queue was ignored')}catch(e){if(!e.message.includes('несинхронизированные'))throw e;guarded++;}
    }window.guardFetches=apiFetches;offlineStorage.getQueue=oldQueue;
    document.getElementById('root').style.display='none';const host=document.createElement('main');host.id='audit-actions-test';host.style.padding='12px';document.body.append(host);const root=(D.createRoot||D.default.createRoot)(host);
    window.baseReport=${JSON.stringify(report)};window.s={};
    const pause=ms=>new Promise(r=>setTimeout(r,ms));
    const summary=()=>({...baseReport,stale:s.stale,counts:{...baseReport.counts,review:s.checked?0:1,reviewed:s.checked?1:0},summary:s.checked?'Новых вопросов для проверки нет.':baseReport.summary});
    api.aiAssistant.accountingAudit.report=async(_id,opts={})=>{await pause(10);const findings=baseReport.findings.map(f=>({...f,reviewedAt:s.checked?'2026-11-20T10:00:00Z':null,repairable:!s.stale})).filter(f=>opts.status==='reviewed'?f.reviewedAt:!f.reviewedAt);return{...summary(),findings,findingsTotal:findings.length};};
    api.aiAssistant.accountingAudit.review=async(_r,_f,checked)=>{s.reviews++;await pause(80);s.checked=checked;};
    api.aiAssistant.accountingAudit.prepareRepair=async()=>{s.prepares++;await pause(80);s.actionStatus='pending';return{id:'repair'+s.prepares,status:'pending',expiresAt:new Date(Date.now()+(s.expired?-1000:900000)).toISOString(),contractId:'s',customer:'Тестовый Клиент',product:'Тестовый товар',price:147000,received:95000,remaining:52000,beforeTotal:151500,afterTotal:147000,rows:[{id:'p',date:'2026-11-17',before:25400,after:24500}],actualPaymentsChanged:false};};
    api.aiAssistant.accountingAudit.repairAction=async(_id,action)=>{if(action==='cancel'){s.cancels++;s.actionStatus='cancelled';return{ok:true}}s[action]++;await pause(120);if(s.fail)throw Error('Договор изменился. Обновите проверку.');s.actionStatus=action==='confirm'?'done':'undone';return{ok:true,text:action==='confirm'?'График исправлен.':'Исправление графика отменено.',undoUntil:new Date(Date.now()+1800000).toISOString()};};
    api.aiAssistant.journal=async()=>({actions:[{id:'repair1',status:s.actionStatus,source:'accounting',created_at:'2026-11-20T10:00:00Z',summary:'Исправление графика: Тестовый товар',undoable:s.actionStatus==='done',undoUntil:new Date(Date.now()+1800000).toISOString()}]});
    window.unexpectedNetwork=0;window.fetch=async(input,options={})=>{
      const u=new URL(typeof input==='string'?input:input.url,location.href),body=JSON.parse(options.body||'{}');
      const json=data=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
      if(u.pathname.endsWith('/accounting-audit/ui_report'))return json(await api.aiAssistant.accountingAudit.report('ui_report',Object.fromEntries(u.searchParams)));
      if(u.pathname.endsWith('/review'))return json(await api.aiAssistant.accountingAudit.review('r','f',body.checked)||{ok:true});
      if(u.pathname.endsWith('/repair'))return json(await api.aiAssistant.accountingAudit.prepareRepair());
      const action=u.pathname.match(/\\/repairs\\/[^/]+\\/(confirm|undo|cancel)$/);
      if(action){try{return json(await api.aiAssistant.accountingAudit.repairAction('r',action[1]))}catch(e){return new Response(JSON.stringify({msg:e.message}),{status:409,headers:{'content-type':'application/json'}})}}
      if(u.pathname.endsWith('/assistant/journal'))return json(await api.aiAssistant.journal());
      if(u.pathname.startsWith('/api/')||!['localhost','127.0.0.1'].includes(u.hostname)){unexpectedNetwork++;throw Error('Unexpected network')}
      return fetchOriginal(input,options);
    };
    window.renderJournal=()=>root.render(React.createElement(Journal,{key:crypto.randomUUID(),onClose:()=>{},onDataChanged:()=>s.changed++}));
    window.reset=(opts={})=>{sessionStorage.clear();window.s={checked:false,reviews:0,prepares:0,cancels:0,confirm:0,undo:0,changed:0,stale:false,expired:false,fail:false,actionStatus:'pending',...opts};root.render(React.createElement(Card,{key:crypto.randomUUID(),action:{id:'audit-ui',kind:'accounting_audit',report:summary()},sending:false,onAuditChanged:()=>s.changed++}));};reset();window.uiReady=true;
  })()`);
  await until('window.uiReady');assert.equal(await js('guarded'),5);assert.equal(await js('guardFetches'),0);
  await expand();await rapid('Проверено');await until('s.reviews===1&&s.checked');await until(`!![...document.querySelectorAll('#audit-actions-test button')].find(b=>b.textContent==='Проверено · 1')`);await click('Проверено · 1');await expand();await click('Вернуть в проверку');await until('s.reviews===2&&!s.checked');await click('Все');await expand();
  await rapid('Подготовить исправление');await until(`!!document.querySelector('[role=dialog]')`);assert.equal(await js('s.prepares'),1);assert.equal(await js('s.changed'),0);assert(await js(`document.querySelector('[role=dialog]').textContent.includes('151 500 ₽')`));await click('Отмена');await rapid('Подтвердить исправление');await until('s.cancels===1');await until(`!document.querySelector('[role=dialog]')`);assert.equal(await js('s.confirm'),0);
  await click('Подготовить исправление');await until(`!!document.querySelector('[role=dialog]')`);await rapid('Подтвердить исправление');await click('Отмена');await until('s.changed===1');assert(await js(`!!document.querySelector('[role=dialog]')`));assert.equal(await js('s.confirm'),1);assert.equal(await js('s.cancels'),1);await rapid('Отменить исправление');await until('s.changed===2');assert.equal(await js('s.undo'),1);await click('Закрыть');await until(`!document.querySelector('[role=dialog]')`);
  console.log('PASS queued edits blocked; reviewed/unreviewed; prepare without writes; cancel; duplicate confirm/undo; application refresh');
  await js('reset();true');await expand();await click('Подготовить исправление');await until(`!!document.querySelector('[role=dialog]')`);await click('Подтвердить исправление');await until('s.changed===1');await click('Закрыть');await until(`!document.querySelector('[role=dialog]')`);await js('renderJournal();true');await until(`document.querySelector('[role=dialog]')?.textContent.includes('Выполнено')`);await click('Отменить исправление');await until('!!dialogs.current()');assert.equal(await js('s.undo'),0);await js('dialogs.resolve(dialogs.current().id,true);true');await until('s.changed===2');assert.equal(await js('s.undo'),1);assert(await js(`document.querySelector('[role=dialog]').textContent.includes('Изменение отменено')`));
  console.log('PASS undo persists in journal after closing the preview; explicit confirmation required');
  win.setSize(390,900);await js('reset({expired:true});true');await wait(400);await expand();await click('Подготовить исправление');await until(`document.querySelector('[role=dialog]')?.textContent.includes('Срок подтверждения истёк')`);assert(await js(`[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent==='Подтвердить исправление').disabled`));assert(await js('document.documentElement.scrollWidth<=innerWidth'));await click('Отмена');await until(`!document.querySelector('[role=dialog]')`);
  await js('reset({stale:true});true');await expand();assert(await js(`[...document.querySelectorAll('#audit-actions-test button')].find(b=>b.textContent==='Проверено').disabled`));
  await js('reset({fail:true});true');await expand();await click('Подготовить исправление');await until(`!!document.querySelector('[role=dialog]')`);await click('Подтвердить исправление');await until(`document.querySelector('[role=dialog]')?.textContent.includes('Договор изменился')`);assert.equal(await js('s.changed'),0);assert.equal(await js('unexpectedNetwork'),0);
  console.log('PASS mobile layout; expired confirmation; stale report; server rejection never reports success; only mocked audit API calls, no paid calls');
  win.destroy();app.exit(0);
}catch(e){console.error(e.stack);if(win&&!win.isDestroyed()){console.error(await win.webContents.executeJavaScript('JSON.stringify({state:window.s,text:document.body.textContent.slice(-2500)})').catch(()=>''));win.destroy()}app.exit(1)}});
setTimeout(()=>app.exit(2),90000).unref();
