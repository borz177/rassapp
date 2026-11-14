// Только локальный Vite :3000, заглушки API и фиктивные настройки.
// Никаких вызовов WhatsApp, моделей или сохранения в рабочую базу.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
require('./no-paid-ai.cjs');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'wa-three-days-ui-')));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
  let win;
  try{
    win=new BrowserWindow({show:false,width:430,height:950,webPreferences:{backgroundThrottling:false}});
    win.webContents.session.webRequest.onBeforeRequest((d,cb)=>{const u=new URL(d.url);cb({cancel:['http:','https:','ws:','wss:'].includes(u.protocol)&&(!['localhost','127.0.0.1'].includes(u.hostname)||u.port!=='3000'||u.pathname.startsWith('/api/'))});});
    const js=s=>win.webContents.executeJavaScript(s);
    const until=async s=>{for(let i=0;i<100;i++){if(await js(s))return;await wait(60);}throw Error('Timeout: '+s);};
    const click=async text=>{await js(`(()=>{const b=[...document.querySelectorAll('#wa-test button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('Missing '+${JSON.stringify(text)});b.click();return true})()`);await wait(80);};
    await win.loadURL('http://localhost:3000/');
    await js(`(async()=>{
      window.alert=()=>{};window.mock={writes:0,saved:null};const originalFetch=window.fetch.bind(window);
      window.fetch=async(input,opts={})=>{
        const u=new URL(typeof input==='string'?input:input.url,location.href);
        if(u.pathname==='/api/integrations/whatsapp/builtin/status')return new Response(JSON.stringify({loggedIn:true,phone:'79000000000'}),{headers:{'content-type':'application/json'}});
        if(u.pathname.startsWith('/api/')){if(opts.method&&opts.method!=='GET')mock.writes++;throw Error('API blocked')}
        if(!['localhost','127.0.0.1'].includes(u.hostname)||u.port!=='3000')throw Error('External call blocked');return originalFetch(input,opts);
      };
      const R=await import('/node_modules/.vite/deps/react.js'),D=await import('/node_modules/.vite/deps/react-dom_client.js');
      window.React=R.default||R;window.h=R.createElement||R.default.createElement;document.getElementById('root').style.display='none';
      const host=document.createElement('div');host.id='wa-test';host.style.padding='16px';document.body.appendChild(host);window.root=(D.createRoot||D.default.createRoot)(host);
      window.Page=(await import('/components/Integrations.tsx')).default;
      window.initial={companyName:'Локальный тест',whatsapp:{enabled:true,provider:'builtin',idInstance:'',apiTokenInstance:'',reminderTime:'10:00',reminderDays:[-1,0,1],overdueReminderInterval:7,templates:{upcoming:'ЗАВТРА {дата}',today:'СЕГОДНЯ {дата}',overdue:'ПРОСРОЧКА {долг}'}}};
      window.mount=settings=>root.render(h(Page,{key:Math.random(),appSettings:settings,onBack:()=>{},onUpdateSettings:value=>{mock.saved=JSON.parse(JSON.stringify(value));}}));
      mount(initial);return true;
    })()`);
    await until(`!!document.querySelector('[aria-label="Шаблон напоминания"]')`);
    const checked=()=>js(`(()=>{const l=[...document.querySelectorAll('#wa-test label')].find(l=>l.textContent.includes('За 3 дня до оплаты'));return l.querySelector('input').checked})()`);
    assert.equal(await checked(),false,'Старые аккаунты не получают включённую рассылку');
    await js(`(()=>{[...document.querySelectorAll('#wa-test label')].find(l=>l.textContent.includes('За 3 дня до оплаты')).querySelector('input').click();return true})()`);await wait(80);assert.equal(await checked(),true);
    await click('За 3 дня');assert((await js(`document.querySelector('#wa-test textarea').value`)).includes('Через *3 дня*'));
    const custom='Через три дня, {дата}: {сумма} ₽. {товары_блок}';
    await js(`(()=>{const e=document.querySelector('#wa-test textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(custom)});e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);await wait(80);
    await click('За день');assert.equal(await js(`document.querySelector('#wa-test textarea').value`),'ЗАВТРА {дата}');
    await click('За 3 дня');assert.equal(await js(`document.querySelector('#wa-test textarea').value`),custom);
    await click('Сохранить настройки');assert.deepEqual(await js('mock.saved.whatsapp.reminderDays'),[-1,0,1,-3]);
    assert.equal(await js('mock.saved.whatsapp.templates.threeDays'),custom);assert.equal(await js('mock.saved.whatsapp.templates.today'),'СЕГОДНЯ {дата}');assert.equal(await js('mock.saved.whatsapp.overdueReminderInterval'),7);
    await js('mount(mock.saved)');await until(`!!document.querySelector('[aria-label="Шаблон напоминания"]')`);await wait(80);assert.equal(await checked(),true);
    await click('За 3 дня');assert.equal(await js(`document.querySelector('#wa-test textarea').value`),custom);
    for(const width of [320,390,430]){
      win.setSize(width,950);await wait(100);
      const layout=await js(`(()=>{const e=document.querySelector('[aria-label="Шаблон напоминания"]');return {columns:getComputedStyle(e).gridTemplateColumns.split(' ').length,buttons:[...e.children].map(b=>({height:b.getBoundingClientRect().height,left:b.getBoundingClientRect().left,right:b.getBoundingClientRect().right})),width:innerWidth}})()`);
      assert.equal(layout.columns,2);assert(layout.buttons.every(b=>b.height>=44&&b.left>=0&&b.right<=layout.width));
    }
    await js(`(()=>{document.querySelector('[aria-label="Шаблон напоминания"]').scrollIntoView({block:'center'});return true})()`);await wait(100);
    fs.writeFileSync('/tmp/rassapp-whatsapp-three-days-settings.png',(await win.webContents.capturePage()).toPNG());
    await click('Предпросмотр');await until(`!!document.querySelector('pre')`);assert(await js(`document.querySelector('pre').textContent.includes('Через три дня')`));
    await js(`(()=>{document.documentElement.classList.add('dark');return true})()`);await wait(100);
    fs.writeFileSync('/tmp/rassapp-whatsapp-three-days-preview.png',(await win.webContents.capturePage()).toPNG());
    assert.equal(await js('mock.writes'),0,'Запросов отправки и сохранения на сервер нет');
    console.log('PASS: opt-in, custom fourth template, old settings preserved, local save/reopen, preview, 320/390/430px two-column touch controls; no external calls');
    win.destroy();app.exit(0);
  }catch(e){console.error(e.stack);if(win&&!win.isDestroyed()){console.error(await win.webContents.executeJavaScript('document.body.innerText.slice(-1800)'));win.destroy();}app.exit(1);}
});
setTimeout(()=>{console.error('UI test deadline');app.exit(2);},30000).unref();
