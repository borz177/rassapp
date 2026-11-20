// Бесплатная проверка: настоящий выбор шаблона и меню «Договоров», синтетические
// данные. Внешняя сеть/API записи и физическая печать не используются.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
require('./no-paid-ai.cjs');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'contract-print-template-')));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
  let win;
  try{
    win=new BrowserWindow({show:false,width:1040,height:900,webPreferences:{backgroundThrottling:false}});
    win.webContents.session.webRequest.onBeforeRequest((d,cb)=>{const u=new URL(d.url);cb({cancel:['http:','https:','ws:','wss:'].includes(u.protocol)&&(!['localhost','127.0.0.1'].includes(u.hostname)||u.port!==(process.env.PRINT_TEST_PORT||'3000')||u.pathname.startsWith('/api/'))});});
    win.webContents.on('console-message',(_e,_level,message)=>{if(/Error|error|Uncaught/.test(message))console.log(message.slice(0,500));});
    const js=s=>win.webContents.executeJavaScript(s);
    const until=async s=>{for(let i=0;i<160;i++){if(await js(s))return;await wait(50);}throw Error('Timeout: '+s);};
    const click=async(label,prefix=false)=>{await js(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.getBoundingClientRect().width&&(${prefix?'b.textContent.trim().startsWith':'b.textContent.trim() ==='}(${JSON.stringify(label)})||b.getAttribute('aria-label')===${JSON.stringify(label)}));if(!b)throw Error('Missing '+${JSON.stringify(label)});b.click();return true})()`);await wait(100);};
    await win.loadURL(`http://localhost:${process.env.PRINT_TEST_PORT||'3000'}/`);console.log('Loaded local Vite');
    await js(`(async()=>{
      const originalMatchMedia=window.matchMedia.bind(window);window.matchMedia=q=>q==='(pointer: fine)'?{matches:false,media:q,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){},dispatchEvent(){return true}}:originalMatchMedia(q);
      const originalFetch=window.fetch.bind(window);window.writes=0;
      window.fetch=async(input,opts={})=>{const u=new URL(typeof input==='string'?input:input.url,location.href);
        if(u.pathname==='/api/watchlist/status')return new Response(JSON.stringify({enabled:false,accepted:false,access:null}),{headers:{'content-type':'application/json'}});
        if(u.pathname.startsWith('/api/')){if(opts.method&&opts.method!=='GET')writes++;throw Error('API blocked')}
        if(!['localhost','127.0.0.1'].includes(u.hostname)||u.port!==${JSON.stringify(process.env.PRINT_TEST_PORT||'3000')})throw Error('External calls blocked');return originalFetch(input,opts);
      };
      const R=await import('/node_modules/.vite/deps/react.js'),D=await import('/node_modules/.vite/deps/react-dom_client.js');window.React=R.default||R;window.h=React.createElement;
      document.getElementById('root').style.display='none';const host=document.createElement('div');host.id='print-template-test';document.body.appendChild(host);window.root=(D.createRoot||D.default.createRoot)(host);
      window.Picker=(await import('/components/ContractTemplatePicker.tsx')).default;window.Contracts=(await import('/components/Contracts.tsx')).default;
      window.customer={id:'customer',name:'Тестовый Клиент',phone:'79000000000',passportSeries:'0012',passportNumber:'003456',trustScore:70,notes:''};
      window.sale={id:'sale',customerId:'customer',productName:'Тестовый товар',accountId:'account',startDate:'2026-11-13',type:'INSTALLMENT',status:'ACTIVE',contractTemplateId:'MODERN',totalAmount:18000,buyPrice:15000,downPayment:0,remainingAmount:18000,installments:3,paymentPlan:[{id:'p',date:'2026-12-13',amount:6000,isRealPayment:false,isPaid:false}]};window.before=JSON.stringify(sale);
      function Harness(){const [settings,setSettings]=React.useState({contractTemplate:'MODERN',companyName:'Локальный тест'}),[page,setPage]=React.useState('settings');window.settings=settings;
        return h('div',null,h('button',{onClick:()=>setPage(page==='settings'?'contracts':'settings')},page==='settings'?'К договорам':'К настройкам'),page==='settings'
          ?h(Picker,{value:settings.contractTemplate,companyName:'Локальный тест',sellerPhone:'',allowPaid:true,onChange:id=>setSettings({...settings,contractTemplate:id})})
          :h(Contracts,{sales:[sale],customers:[customer],accounts:[{id:'account',name:'Основной',type:'MAIN'}],activeTab:'ALL',onTabChange:()=>{},onViewSchedule:()=>{},onEditSale:()=>{},onDeleteSale:()=>{},appSettings:settings,contractTemplatesAllowed:true,user:{id:'owner',role:'manager'}}));
      }root.render(h(Harness));return true;
    })()`);
    console.log('Mounted picker');await until(`document.body.textContent.includes('Договор 2')`);await click('Договор 2',true);assert.equal(await js('settings.contractTemplate'),'CLASSIC');
    const print=async()=>{await click('К договорам');console.log('Contracts mounted');await until(`!!document.querySelector('button[aria-label="Меню"]')`);await click('Меню');await until(`document.body.textContent.includes('Печать договора')`);await click('Печать договора');console.log('Print clicked');await until(`!!document.querySelector('iframe[srcdoc]')?.contentDocument?.querySelector('h1')`);};
    console.log('Selected Classic');await print();console.log('Opened Classic print');assert(await js(`!!document.querySelector('iframe[srcdoc]').contentDocument.querySelector('.subtitle')`),'Печатная форма действительно классическая');
    assert.equal(await js(`document.querySelector('iframe[srcdoc]').contentDocument.querySelector('.monthly-payment b').textContent.replace(/\\s/g,'')`),'6000₽');
    assert.equal(await js('sale.contractTemplateId'),'MODERN');assert.equal(await js('JSON.stringify(sale)===before'),true);
    fs.writeFileSync('/tmp/rassapp-contract-classic-print.png',(await win.webContents.capturePage()).toPNG());await click('Закрыть');await click('К настройкам');
    await click('Договор 1',true);assert.equal(await js('settings.contractTemplate'),'MODERN');await print();
    assert(await js(`!!document.querySelector('iframe[srcdoc]').contentDocument.querySelector('.header-info')`));assert(!await js(`!!document.querySelector('iframe[srcdoc]').contentDocument.querySelector('.subtitle')`));await click('Закрыть');
    assert.equal(await js('writes'),0);assert.equal(await js('JSON.stringify(sale)===before'),true);
    console.log('PASS: settings Classic -> Contracts print -> Classic; change back -> Modern; saved sale untouched; no writes or physical printing');
    win.destroy();app.exit(0);
  }catch(e){console.error(e.stack);if(win&&!win.isDestroyed()){console.error(await win.webContents.executeJavaScript('document.body.innerText.slice(-1800)'));win.destroy();}app.exit(1);}
});
setTimeout(()=>{console.error('UI deadline');app.exit(2);},60000).unref();
