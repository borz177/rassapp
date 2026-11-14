/** Бесплатная UI-проверка с заглушками API; нужен локальный Vite :3000. */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
require('./no-paid-ai.cjs');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'watchlist-quick-ui-')));
const wait = ms => new Promise(r => setTimeout(r, ms));
app.whenReady().then(async () => {
  let win;
  try {
    win = new BrowserWindow({ show: false, width: 1100, height: 950, webPreferences: { backgroundThrottling: false } });
    const js = s => win.webContents.executeJavaScript(s);
    const until = async s => { for (let i = 0; i < 180; i++) { if (await js(s)) return; await wait(50); } throw Error('Timeout '+s); };
    const click = async label => { await js(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>!e.closest('[aria-hidden=true]')&&(e.getAttribute('aria-label')===${JSON.stringify(label)}||e.textContent.trim()===${JSON.stringify(label)}));if(!b||b.disabled)throw Error('Button missing/disabled '+${JSON.stringify(label)});b.click();return true})()`);await wait(120); };
    const field = async (label,value) => { await js(`(()=>{const l=[...document.querySelectorAll('label')].find(e=>!e.closest('[aria-hidden=true]')&&e.querySelector('span')?.textContent.trim()===${JSON.stringify(label)});const el=l.querySelector('select,textarea');if(el.tagName==='SELECT'){el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('change',{bubbles:true}))}else{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}))}return true})()`);await wait(80); };
    const confirm = async () => { await js(`[...document.querySelectorAll('label')].find(e=>!e.closest('[aria-hidden=true]')&&e.textContent.includes('Подтверждаю')).querySelector('input').click();true`);await wait(80); };
    await win.loadURL('http://localhost:3000/index.html');await wait(600);
    await js(`(async()=>{
      const R=await import('/node_modules/.vite/deps/react.js'),D=await import('/node_modules/.vite/deps/react-dom_client.js');window.h=R.createElement||R.default.createElement;
      Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>true});
      document.getElementById('root').style.display='none';const host=document.createElement('div');host.id='test-root';document.body.appendChild(host);window.uiRoot=(D.createRoot||D.default.createRoot)(host);
      window.Customer=(await import('/components/CustomerDetails.tsx')).default;window.Contracts=(await import('/components/Contracts.tsx')).default;window.List=(await import('/components/ClientWatchlist.tsx')).default;
      window.customer={id:'client',userId:'owner',name:'Тестов Тест Тестович',phone:'79991234567',email:'',trustScore:70,notes:'',birthDate:'1988-01-02',passportNumber:'003456'};
      window.sale={id:'sale',userId:'owner',type:'INSTALLMENT',customerId:'client',productName:'Тестовый товар',buyPrice:7000,accountId:'account',totalAmount:10000,downPayment:0,remainingAmount:10000,interestRate:30,installments:2,startDate:'2026-11-01',status:'ACTIVE',paymentPlan:[]};
      window.mock={granted:true,auto:false,statusCalls:0,previewCalls:[],entries:[],mode:'ok',hold:null,unrelated:[]};window.snapshot=JSON.stringify({customer,sale});
      const originalFetch=window.fetch.bind(window),res=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
      window.fetch=async(input,opts={})=>{
        const url=new URL(typeof input==='string'?input:input.url,location.href);
        if(url.pathname==='/api/watchlist/status'){mock.statusCalls++;return res({policyVersion:'test',enabled:true,accepted:true,autoPublish:mock.auto,searchPaused:false,submissionsPaused:false,access:{status:mock.granted?'granted':'revoked',canSearch:mock.granted,canSubmit:mock.granted}})}
        if(url.pathname==='/api/watchlist/preview'){mock.previewCalls.push(JSON.parse(opts.body));if(!mock.granted)return res({msg:'Доступ отозван'},403);return res({customerId:'client',name:'Тестов Тест Тестович',birthYear:1988,fingerprint:'server-fingerprint'})}
        if(url.pathname==='/api/watchlist/entries'){mock.entries.push(JSON.parse(opts.body));if(mock.mode==='stale')return res({msg:'Данные клиента изменились'},409);if(mock.mode==='hold')return new Promise(resolve=>mock.hold=()=>resolve(res({id:'entry',name:customer.name,status:'pending'})));return res({id:'entry',name:customer.name,status:mock.auto?'published':'pending'})}
        if(['/api/watchlist/mine','/api/watchlist/appeals/mine'].includes(url.pathname))return res({items:[],hasMore:false});
        if(url.pathname.startsWith('/api/')){mock.unrelated.push(url.pathname);throw Error('Unrelated API forbidden')}
        if(!['localhost','127.0.0.1'].includes(url.hostname))throw Error('External calls forbidden');return originalFetch(input,opts);
      };
      window.manager={id:'owner',role:'admin',permissions:{canEdit:true,canDelete:true}};
      window.mountCustomer=(role='admin',initialSaleId=null)=>uiRoot.render(h(Customer,{key:Math.random(),customer,sales:[sale],accounts:[],investors:[],appSettings:{showCents:false},user:{...manager,role},onBack:()=>{},onInitiatePayment:()=>{},initialSaleId}));
      window.mountContracts=()=>uiRoot.render(h(Contracts,{key:Math.random(),sales:[sale],customers:[customer],accounts:[],activeTab:'ALL',onTabChange:()=>{},onViewSchedule:()=>{},onEditSale:()=>{},onDeleteSale:()=>{},appSettings:{showCents:false},user:manager}));
      window.mountList=()=>uiRoot.render(h(List,{key:Math.random(),customers:[customer],userId:'owner'}));
      mountCustomer();return true;
    })()`);
    await until(`!!document.querySelector('button[aria-label="В чёрный список"]')`);
    assert.equal(await js('mock.statusCalls'),1);
    await click('В чёрный список');await until(`!!document.querySelector('select')`);
    assert.deepEqual(await js('mock.previewCalls.at(-1)'),{customerId:'client'});
    assert(!await js(`!!document.querySelector('input[aria-label="Поиск своих клиентов"]')`));
    assert(await js(`document.querySelector('[role=dialog]').textContent.includes('1988 г.')`));
    assert(!await js(`document.querySelector('[role=dialog]').textContent.includes('003456')`));
    assert(await js(`[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Отправить').disabled`));
    await field('Причина','other');await confirm();
    assert(await js(`[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Отправить').disabled`));
    await field('Описание причины','Синтетическая причина');
    await js(`mock.mode='hold';[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Отправить').click();[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Отправить'||e.textContent.trim()==='Отправляем…').click();true`);
    await until('mock.hold!==null');assert.equal(await js('mock.entries.length'),1);
    assert.deepEqual(await js('mock.entries[0]'),{customerId:'client',fingerprint:'server-fingerprint',reason:'other',reasonDetails:'Синтетическая причина',confirmed:true});
    await js('mock.hold();mock.hold=null;mock.mode="ok";true');await until(`document.querySelector('[role=dialog]').textContent.includes('На проверке')`);
    await click('Закрыть');await wait(400);
    assert(await js(`!!document.querySelector('#test-root button[aria-label="В чёрный список"]')`));
    console.log('PASS customer button: saved identity selected; reason/confirmation required; double click sends once; no passport/financial fields');

    await js('mountContracts();true');await until(`!!document.querySelector('button[aria-label="Меню"]')`);
    const count=await js('mock.statusCalls');await wait(200);assert.equal(await js('mock.statusCalls'),count);
    await click('Меню');await until(`Array.from(document.querySelectorAll('button')).some(e=>e.textContent.trim()==='В чёрный список')`);await click('В чёрный список');await until(`!!document.querySelector('select')`);
    assert.deepEqual(await js('mock.previewCalls.at(-1)'),{customerId:'client'});
    assert(!await js(`!!document.querySelector('input[aria-label="Поиск своих клиентов"]')`));
    await win.setSize(390,844);await wait(100);assert(await js('document.documentElement.scrollWidth<=innerWidth+1'));
    fs.writeFileSync('/tmp/rassapp-watchlist-quick-add.png',(await win.webContents.capturePage()).toPNG());
    await js(`document.documentElement.classList.add('dark');true`);await wait(80);fs.writeFileSync('/tmp/rassapp-watchlist-quick-add-dark.png',(await win.webContents.capturePage()).toPNG());
    await js(`document.documentElement.classList.remove('dark');mock.mode='stale';true`);await confirm();await click('Отправить');await until(`document.body.textContent.includes('Данные клиента изменились')`);
    assert(!await js(`!!document.querySelector('[role=status]')?.textContent.includes('На проверке')`));await click('Закрыть');await wait(400);
    console.log('PASS contracts menu: exact customer selected, mobile/dark layout, stale source error stays in form');

    await win.setSize(1100,950);await js(`mock.auto=true;mock.mode='ok';mountCustomer('admin','sale');true`);
    await until(`document.body.textContent.includes('Тестовый товар')&&document.querySelector('button[aria-label="Действия по договору"]')`);
    await wait(300);await click('Действия по договору');await click('В чёрный список');await until(`!!document.querySelector('select')`);await confirm();await click('Отправить');await until(`document.querySelector('[role=dialog]').textContent.includes('Опубликовано')`);await click('Закрыть');await wait(400);
    assert(await js(`document.body.textContent.includes('Тестовый товар')`));
    console.log('PASS customer contract details menu: same form, automatic publication mode, source page preserved');

    await js(`mock.granted=false;mountCustomer();true`);await wait(350);assert(!await js(`!!document.querySelector('button[aria-label="В чёрный список"]')`));
    await js(`mock.granted=true;mountCustomer('employee');true`);const employeeCalls=await js('mock.statusCalls');await wait(350);assert.equal(await js('mock.statusCalls'),employeeCalls);assert(!await js(`!!document.querySelector('button[aria-label="В чёрный список"]')`));
    await js(`mountCustomer('manager');true`);const managerCalls=await js('mock.statusCalls');await wait(350);assert.equal(await js('mock.statusCalls'),managerCalls);assert(!await js(`!!document.querySelector('button[aria-label="В чёрный список"]')`));
    await js(`mountCustomer();true`);await until(`!!document.querySelector('button[aria-label="В чёрный список"]')`);
    await js('mock.granted=false;true');await click('В чёрный список');await until(`document.body.textContent.includes('Добавление недоступно')`);assert(!await js(`!!document.querySelector('select')`));
    console.log('PASS denied/employee access hidden; permission rechecked on opening the form');

    await js(`mock.granted=true;mock.auto=false;mountList();true`);await until(`Array.from(document.querySelectorAll('button')).some(e=>e.textContent.trim()==='+ Добавить')`);await click('+ Добавить');
    await js(`[...document.querySelectorAll('button')].find(e=>e.textContent.includes('Тестов Тест Тестович')&&e.textContent.includes('79991234567')).click();true`);await until(`!!document.querySelector('select')`);
    await field('Причина','other');await field('Описание причины','Проверка сброса');await click('Выбрать другого клиента');
    await js(`[...document.querySelectorAll('button')].find(e=>e.textContent.includes('Тестов Тест Тестович')&&e.textContent.includes('79991234567')).click();true`);await until(`!!document.querySelector('select')`);
    assert.equal(await js(`document.querySelector('select').value`),'overdue');assert(!await js(`!!document.querySelector('textarea')`));
    assert.equal(await js('JSON.stringify({customer,sale})'),await js('snapshot'));
    assert.deepEqual(await js('mock.unrelated'),[]);
    console.log('PASS existing list uses same form; choosing another resets private draft; clients/contracts unchanged; no external or financial API');
  } catch(e) {
    console.error(e.stack);process.exitCode=1;if(win){console.error(await win.webContents.executeJavaScript('document.body.textContent.slice(-2200)'));fs.writeFileSync('/tmp/rassapp-watchlist-quick-add-failure.png',(await win.webContents.capturePage()).toPNG())}
  } finally { win?.destroy();app.exit(process.exitCode||0); }
}).catch(e=>{console.error(e.stack);app.exit(1)});
setTimeout(()=>app.exit(2),90000).unref();
