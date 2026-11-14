// Бесплатный просмотр админки: синтетический отчёт, любые API/внешние запросы
// запрещены. Нужен локальный Vite :3000.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
require('./no-paid-ai.cjs');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'agent-quality-ui-')));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
  let win;
  try{
    win=new BrowserWindow({show:false,width:1080,height:1000,webPreferences:{backgroundThrottling:false}});
    win.webContents.on('console-message',(_event,_level,message)=>{if(/error|Error|Uncaught/i.test(message))console.log(message.slice(0,500));});
    win.webContents.session.webRequest.onBeforeRequest((details,cb)=>{
      const u=new URL(details.url);cb({cancel:['http:','https:','ws:','wss:'].includes(u.protocol)&&(!['localhost','127.0.0.1'].includes(u.hostname)||u.port!=='3000'||u.pathname.startsWith('/api/'))});
    });
    const js=code=>win.webContents.executeJavaScript(code);
    const until=async code=>{for(let i=0;i<100;i++){if(await js(code))return;await wait(60);}throw Error('Timeout: '+code);};
    await win.loadURL('http://localhost:3000/');
    await js(`(async()=>{
      const R=await import('/node_modules/.vite/deps/react.js'),D=await import('/node_modules/.vite/deps/react-dom_client.js');
      document.getElementById('root').style.display='none';const host=document.createElement('div');host.id='quality-test';host.style.padding='20px';document.body.appendChild(host);
      window.h=R.createElement||R.default.createElement;window.root=(D.createRoot||D.default.createRoot)(host);
      const {api}=await import('/services/api.ts');window.writes=0;
      api.adminAiReview=api.adminAiLesson=api.adminAiSetQualitySettings=async()=>{writes++;throw Error('Model/mutation blocked')};
      window.report={kinds:{honesty_fix:'Проверка обещанного действия',guard_payoff:'Уточнена сумма платежа',request_error:'Запрос не завершён'},kindGroups:{honesty_fix:'quality',guard_payoff:'guard',request_error:'quality'},
        outcomeLabels:{unknown:'Итог не отслеживался',corrected:'Исправлено защитой',blocked:'Ответ ограничен защитой',protected:'Проверено защитой',cancelled:'Остановлено пользователем',failed:'Запрос не завершён'},
        byDay:[],recent:[['honesty_fix','corrected','Исправленный случай'],['honesty_fix','blocked','Ограниченный случай'],['guard_payoff','protected','Уточнение платежа'],['honesty_fix','unknown','Старый случай'],['request_error','failed','Прерванный запрос']].map(([kind,outcome,question])=>({kind,outcome,question,created_at:new Date().toISOString()})),
        lessons:[{id:1,rule:'Проверяй карточку перед ответом',status:'proposed',cases:2},{id:2,rule:'Проверяй карточку перед ответом!',status:'proposed',similarTo:1,cases:2}],autoApply:false,pendingReview:0,lastReviewAt:null};
      api.adminGetAiQuality=async()=>report;
      const originalFetch=window.fetch.bind(window);
      window.fetch=async(input,opts={})=>{
        const u=new URL(typeof input==='string'?input:input.url,location.href);
        if(u.pathname==='/api/admin/ai/quality'&&(!opts.method||opts.method==='GET'))return new Response(JSON.stringify(report),{headers:{'content-type':'application/json'}});
        if(u.pathname.startsWith('/api/')){writes++;throw Error('API mutation blocked')}
        if(!['localhost','127.0.0.1'].includes(u.hostname)||u.port!=='3000')throw Error('External fetch blocked');return originalFetch(input,opts);
      };
      window.Page=(await import('/components/AdminAIQuality.tsx')).default;root.render(h(Page));return true;
    })()`);
    await until(`!!document.querySelector('#ai-quality-outcome')&&document.querySelectorAll('tbody tr').length===5`);
    assert(await js(`document.getElementById('quality-test').textContent.includes('Похоже на правило №1')`));
    const select=async value=>{await js(`(()=>{const e=document.querySelector('#ai-quality-outcome');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);await wait(80);};
    for(const [value,label] of [['corrected','Исправленный случай'],['blocked','Ограниченный случай'],['unknown','Старый случай'],['failed','Прерванный запрос']]){
      await select(value);assert.equal(await js(`document.querySelectorAll('tbody tr').length`),1);assert(await js(`document.querySelector('tbody').textContent.includes(${JSON.stringify(label)})`));
    }
    await select('all');
    await js(`(()=>{[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Сработала защита')).click();return true})()`);await wait(80);
    assert.equal(await js(`document.querySelectorAll('tbody tr').length`),1);assert(await js(`document.querySelector('tbody').textContent.includes('Уточнение платежа')`));
    await select('corrected');assert(await js(`document.querySelector('tbody').textContent.includes('сигналов нет')`));
    assert.equal(await js('writes'),0,'Платные кнопки не нажимались');
    await select('all');
    await js(`(()=>{[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Все').click();return true})()`);await wait(80);
    await js(`(()=>{document.documentElement.classList.add('dark');return true})()`);win.setSize(430,900);await wait(250);
    await js(`(()=>{document.querySelector('#ai-quality-outcome').scrollIntoView({block:'start'});return true})()`);await wait(100);
    fs.writeFileSync('/tmp/rassapp-agent-quality-mobile.png',(await win.webContents.capturePage()).toPNG());
    console.log('PASS: statuses, old unknown records, combined filters, duplicate hints, mobile/dark; no model or API mutations');
    win.destroy();app.exit(0);
  }catch(e){console.error(e.stack);if(win&&!win.isDestroyed()){console.error(await win.webContents.executeJavaScript('document.body.innerText.slice(-2000)'));win.destroy();}app.exit(1);}
});
setTimeout(()=>{console.error('UI test deadline');app.exit(2);},30000).unref();
