// Локальный UI-прогон. Отдельная схема PostgreSQL, отдельный Electron-профиль,
// без рабочего backend, реальных клиентов, внешней сети и платных моделей.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), { spawn } = require('node:child_process');
const { Pool } = require('../server/node_modules/pg'), express = require('../server/node_modules/express');
const root = path.resolve(__dirname, '..'), suffix = crypto.randomBytes(6).toString('hex'), schema = `pool_ui_${suffix}`;
const url = process.env.POOL_TEST_DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:5434/finuchet';
if (!['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname))
    throw Error('UI tests require a LOCAL database.');
const scratch = fs.mkdtempSync('/tmp/rassapp-pool-ui-'), entry = path.join(root, `.pool-ui-${suffix}.tsx`), html = path.join(root, `.pool-ui-${suffix}.html`), runner = path.join(__dirname, `.pool-ui-${suffix}.cjs`);
(async () => {
    const raw = new Pool({ connectionString: url });
    let db, http, vite;
    try {
        await raw.query(`CREATE SCHEMA ${schema}`);
        db = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
        await db.query('CREATE TABLE users(id text PRIMARY KEY,name text,email text,password text,role text,manager_id text,phone text,permissions jsonb,blocked boolean DEFAULT false)');
        await db.query('CREATE TABLE data_items(id text PRIMARY KEY,user_id text,type text,data jsonb,updated_at timestamptz DEFAULT now())');
        const owner = 'ui_owner', id = 'ui_pool';
        await db.query("INSERT INTO users(id,name,role) VALUES($1,'Тест','manager')", [owner]);
        const ii = ['one', 'two'].map((id, n) => ({ id, name: n ? 'Второй инвестор' : 'Первый инвестор', initialAmount: 1000000, profitPercentage: 50, joinedDate: '2026-11-01T00:00:00+03:00' }));
        const terms = { date: '2026-11-01T00:00:00+03:00', members: { one: { rate: 50, disposition: 'REINVEST' }, two: { rate: 50, disposition: 'PAYABLE' } }, managerShareSplit: [] };
        const account = { id, name: 'Тестовый общий пул', userId: owner, type: 'POOL', initialBalance: 2000000, poolMemberIds: ii.map(i => i.id), poolAccounting: { version: 1, startMonth: '2026-11', openingTerms: terms, terms: [terms], closed: [], reinvestments: [], excludedSaleIds: [], requests: [] } };
        const sale = { id: 'ui_sale', accountId: id, type: 'INSTALLMENT', customerId: 'ui_client', productName: 'Тестовый товар', startDate: '2026-11-01', buyPrice: 100000, totalAmount: 200000, downPayment: 0, paymentPlan: [{ id: 'ui_payment', amount: 200000, date: '2026-11-20T12:00:00+03:00', isPaid: true, isRealPayment: true }] };
        for (const [type, items] of [['accounts', [account]], ['investors', ii], ['sales', [sale]]])
            for (const item of items)
                await db.query('INSERT INTO data_items(id,user_id,type,data) VALUES($1,$2,$3,$4)', [item.id, owner, type, JSON.stringify(item)]);
        const oldInvestors = [{ id: 'old_one', name: 'Старший инвестор', initialAmount: 1000000, profitPercentage: 50, joinedDate: '2026-08-01T00:00:00+03:00' }, { id: 'old_two', name: 'Новый инвестор', initialAmount: 1000000, profitPercentage: 50, joinedDate: '2026-10-24T00:00:00+03:00' }];
        const oldAccount = { id: 'ui_old_pool', userId: owner, name: 'Пул до перехода', type: 'POOL', poolMemberIds: oldInvestors.map(i => i.id), initialBalance: 2000000 };
        const oldSale = { ...sale, id: 'ui_old_sale', accountId: oldAccount.id, startDate: '2026-09-01', paymentPlan: [{ id: 'planned', date: '2026-12-20', amount: 200000, isPaid: false, isRealPayment: false }, { id: 'actual', date: '2026-12-01T08:00:00+03:00', amount: 200000, isPaid: true, isRealPayment: true }] };
        for (const [type, items] of [['accounts', [oldAccount]], ['investors', oldInvestors], ['sales', [oldSale]]])
            for (const item of items)
                await db.query('INSERT INTO data_items(id,user_id,type,data) VALUES($1,$2,$3,$4)', [item.id, owner, type, JSON.stringify(item)]);
        const historicalAccount = { ...oldAccount, id: 'ui_history_pool', name: 'Пул для пересчёта' };
        const historicalSale = { ...sale, id: 'ui_history_sale', accountId: historicalAccount.id };
        for (const [type, item] of [['accounts', historicalAccount], ['sales', historicalSale]])
            await db.query('INSERT INTO data_items(id,user_id,type,data) VALUES($1,$2,$3,$4)', [item.id, owner, type, JSON.stringify(item)]);
        const cashInvestors=ii.map(i=>({...i,id:`cash_${i.id}`,joinedDate:'2026-09-01T00:00:00+03:00'}));
        const cashTerms={date:'2026-09-01T00:00:00+03:00',members:Object.fromEntries(cashInvestors.map(i=>[i.id,{rate:50,disposition:'PAYABLE'}])),managerShareSplit:[]};
        const cashAccount={...account,id:'cash_pool',name:'Проверка одной кнопки',poolMemberIds:cashInvestors.map(i=>i.id),poolAccounting:{...account.poolAccounting,startMonth:'2026-09',openingTerms:cashTerms,terms:[cashTerms]}};
        const cashSale={...sale,id:'cash_sale',accountId:cashAccount.id,startDate:'2026-09-01',paymentPlan:['09','10','11'].map(m=>({id:m,date:`2026-${m}-20`,amount:200000,isPaid:true,isRealPayment:true})).concat([{id:'current',date:'2026-12-01T08:00:00+03:00',amount:20000,isPaid:true,isRealPayment:true}])};
        const cashExpenses=[{id:'cash_self',accountId:cashAccount.id,category:'Моя выплата',managerPayoutSource:'PROFIT',date:'2026-11-25',amount:10000},{id:'cash_investor',accountId:cashAccount.id,payoutType:'PROFIT',investorId:cashInvestors[0].id,date:'2026-11-25',amount:5000}];
        for(const [type,items]of [['accounts',[cashAccount]],['investors',cashInvestors],['sales',[cashSale]],['expenses',cashExpenses]])for(const item of items)await db.query('INSERT INTO data_items(id,user_id,type,data) VALUES($1,$2,$3,$4)',[item.id,owner,type,JSON.stringify(item)]);
        const service = require('../server/pools/service').createPoolService({ pool: db, now: () => Date.parse('2026-12-01T09:00:00+03:00') });
        const app = express();
        app.use((req, res, next) => { res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', 'content-type,x-auth-token'); if (req.method === 'OPTIONS')
            return res.sendStatus(204); next(); });
        app.use(express.json());
        require('../server/pools/routes').registerPoolRoutes(app, { service, auth: (req, res, next) => { req.user = { id: owner, role: 'manager' }; next(); } });
        http = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
        const apiPort = http.address().port;
        const entrySource = `import React from 'react';import {createRoot}from'react-dom/client';import PoolAccountingSheet from './components/PoolAccountingSheet';import CashProfitSheet from './components/CashProfitSheet';import {api} from './services/api';import {cashProfitLedgers}from './src/cashProfitLedger';import AppDialogs from './components/AppDialogs';import './src/index.css';
Date.now=()=>Date.parse('2026-12-01T09:00:00+03:00');localStorage.setItem('token','local-ui-test');localStorage.setItem('user',JSON.stringify({id:'${owner}',role:'manager'}));
const original=window.fetch.bind(window);window.fetch=(url,options)=>original((String(url).startsWith('/api/')?'http://127.0.0.1:${apiPort}'+url:String(url)).replace('http://localhost:5000','http://127.0.0.1:${apiPort}').replace('http://127.0.0.1:5000','http://127.0.0.1:${apiPort}'),options);window.poolChanges=[];
const root=createRoot(document.getElementById('root'));const render=account=>root.render(<><PoolAccountingSheet key={account.id} account={account} onClose={()=>{window.closedSheet=true}} onChanged={data=>window.poolChanges.push(data)}/><AppDialogs/></>);window.switchToLegacy=()=>render(${JSON.stringify(oldAccount)});
window.switchToHistorical=()=>render(${JSON.stringify(historicalAccount)});
function CashReview(){const[a,setA]=React.useState(${JSON.stringify(cashAccount)}),[ii,setIi]=React.useState(${JSON.stringify(cashInvestors)});React.useEffect(()=>{api.poolRequest(a.id).then(r=>{setA(r.account);setIi(r.investors);window.cashSnapshot=r})},[]);const ledger=cashProfitLedgers({accounts:[a],investors:ii,sales:[${JSON.stringify(cashSale)}],expenses:${JSON.stringify(cashExpenses)},customers:[],period:{start:'2000-01-01',end:'2026-12-31'}}).manager;return <CashProfitSheet view="available" ledger={ledger} subtitle={a.name} showCents onClose={()=>window.cashClosed=true}/>}
window.showCash=()=>root.render(<CashReview/>);render(${JSON.stringify(account)});`;
        fs.writeFileSync(entry, entrySource);
        fs.writeFileSync(html, `<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${path.basename(entry)}"></script></body></html>`);
        const { createServer } = await import('vite');
        vite = await createServer({ root, define: { 'import.meta.env.VITE_API_URL': JSON.stringify(`http://127.0.0.1:${apiPort}/api`) }, server: { host: '127.0.0.1', port: 3017, strictPort: true, hmr: { host: '127.0.0.1', port: 3017 } }, logLevel: 'error' });
        await vite.listen();
        const webPort = vite.httpServer.address().port;
        fs.writeFileSync(runner, `const {app,BrowserWindow}=require('electron'),fs=require('fs'),assert=require('assert/strict');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const errors=[];app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{let win;try{win=new BrowserWindow({show:false,width:1100,height:900,webPreferences:{partition:'pool-ui-${suffix}'}});
win.webContents.session.webRequest.onBeforeRequest((d,cb)=>cb({cancel:!/^(https?|wss?):\\/\\/(127\\.0\\.0\\.1|localhost)(:|\\/)/.test(d.url)&&!d.url.startsWith('devtools:')}));
win.webContents.on('console-message',(_e,level,message)=>{if(level>=3)errors.push(message)});
const js=code=>win.webContents.executeJavaScript(code),wait=async code=>{for(let i=0;i<200;i++){if(await js(code))return;await sleep(100);}throw Error('UI timeout: '+code)};
const click=async text=>{const ok=await js('(()=>{const e=[...document.querySelectorAll("button")].filter(e=>!e.closest("[inert], [aria-hidden=true]")).find(e=>e.textContent.trim().replace(/ ?›$/,"")==='+JSON.stringify(text)+');if(!e||e.disabled)return false;e.scrollIntoView({block:"center"});e.click();return true})()');assert(ok,'Button unavailable: '+text);await sleep(180)};
const input=async(sel,value)=>{assert(await js('(()=>{const e=[...document.querySelectorAll('+JSON.stringify(sel)+')].find(e=>e instanceof HTMLInputElement&&!e.closest("[inert], [aria-hidden=true]"));if(!e)return false;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,'+JSON.stringify(value)+');e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));return true})()'));await sleep(150)};
await win.loadURL('http://127.0.0.1:${webPort}/${path.basename(html)}');await wait('document.body.innerText.includes("Первый инвестор")');
await input('[aria-label="Расчётный месяц"]','2026-10');await wait('document.body.innerText.includes("Месяц рассчитан")');
assert(await js('document.querySelector("input[type=month]").value==="2026-11"'),'Calendar and report month differ below range');
await input('[aria-label="Расчётный месяц"]','');await wait('document.body.innerText.includes("Месяц рассчитан")');
assert(await js('document.querySelector("input[type=month]").value==="2026-11"'),'Empty month hides available report');
await input('[aria-label="Расчётный месяц"]','2027-01');await wait('document.querySelector("input[type=month]").value==="2026-12"');
assert(!await js('document.body.innerText.includes("Расчёт начнётся")'),'Calendar and report month differ above range');
await input('[aria-label="Расчётный месяц"]','2026-11');await wait('document.body.innerText.includes("Месяц рассчитан")');
assert(await js('document.body.innerText.includes("Месяц рассчитан")'));
assert(!await js('document.body.innerText.includes("Расходы, убытки и возвратность долгов проверены")'),'Old verification checkbox remains');
await wait('document.body.innerText.includes("Месяц рассчитан")&&window.poolChanges.length===1');assert(!await js('document.body.innerText.includes("Подтвердить начисления")'),"Manual confirmation remains");
await js('document.querySelectorAll(".overflow-y-auto").forEach(e=>e.scrollTop=0)');
fs.writeFileSync(${JSON.stringify(path.join(scratch, 'desktop.png'))},(await win.webContents.capturePage()).toPNG());
assert(await js('window.poolChanges[0].investors.some(i=>i.id==="one"&&i.initialAmount===1025000)'));
await js('[...document.querySelectorAll("button")].find(e=>e.textContent.includes("Второй инвестор")).click()');await click('Пополнить');
assert(await js('[...document.querySelectorAll("[role=dialog]")].some(e=>e.getAttribute("aria-label")==="Пополнить"&&!e.closest("[inert], [aria-hidden=true]"))'));
assert(await js('getComputedStyle([...document.querySelectorAll("button")].find(e=>e.textContent==="Сохранить")).color==="rgb(0, 0, 0)"'));
await input('[aria-label="Сумма операции пула"]','10000');await click('Сохранить');await click('Подтвердить');await wait('window.poolChanges.length===2');
assert(await js('window.poolChanges[1].investors.some(i=>i.id==="two"&&i.initialAmount===1010000)'));
await wait('[...document.querySelectorAll("[role=dialog]")].some(e=>e.getAttribute("aria-label")==="Второй инвестор")');
await click('Реинвестировать');await input('[aria-label="Сумма операции пула"]','5000');await click('Сохранить');await click('Подтвердить');await wait('window.poolChanges.length===3');
assert(await js('window.poolChanges[2].accounts[0].poolAccounting.reinvestments.some(r=>r.investorId==="two"&&r.amount===5000)'));
await wait('[...document.querySelectorAll("[role=dialog]")].some(e=>e.getAttribute("aria-label")==="Второй инвестор")');
await click('Назад');await wait('!document.querySelector("[inert]")');
for(const label of ['Корректировка','Доли за управление']){
    await click(label);
    assert(await js('[...document.querySelectorAll("[role=dialog]")].some(e=>!e.closest("[inert], [aria-hidden=true]")&&e.getAttribute("aria-label")==='+JSON.stringify(label)+')'));
    await click('Назад');await wait('!document.querySelector("[inert]")');
}
await click('Корректировка');await input('[aria-label="Сумма операции пула"]','123');
await click('Назад');
assert(await js('document.body.innerText.includes("Закрыть без сохранения?")'));
await click('Продолжить');
assert(await js('[...document.querySelectorAll("input")].some(e=>e.getAttribute("aria-label")==="Сумма операции пула"&&e.value==="123")'));
await click('Назад');await click('Закрыть');await wait('!document.querySelector("[inert]")');
await click('+ Добавить инвестора');await input('[aria-label="Имя инвестора пула"]','Оченьдлинноеимяинвесторадляпроверкипереносастрок');await input('[aria-label="Сумма операции пула"]','10000000000');await input('[aria-label="Дата операции пула"]','2026-12-01');await click('Сохранить');await click('Подтвердить');await wait('window.poolChanges.length===4');await wait('!document.querySelector("[inert]")');
await win.setSize(390,844);await js('document.documentElement.classList.add("dark");document.querySelectorAll(".overflow-y-auto").forEach(e=>e.scrollTop=0)');await sleep(300);
assert(await js('document.documentElement.scrollWidth<=window.innerWidth+1'),'Horizontal overflow');fs.writeFileSync(${JSON.stringify(path.join(scratch, 'mobile-dark.png'))},(await win.webContents.capturePage()).toPNG());
await js('[...document.querySelectorAll("button")].find(e=>e.textContent.includes("Второй инвестор")).click()');
await click('Условия');
assert(await js('[...document.querySelectorAll("[role=dialog]")].some(e=>e.getAttribute("aria-label")==="Условия"&&!e.closest("[inert], [aria-hidden=true]"))&&!!document.querySelector("[inert] [role=dialog]")'));
await click('Исправить дату входа');
await input('[aria-label="Дата первого входа"]','2026-11-21');await click('Проверить расчёт');
await wait('document.body.innerText.includes("Разница за закрытые месяцы (2026-11)")');
assert(await js('window.poolChanges.length===4&&document.documentElement.scrollWidth<=innerWidth+1'),'Entry date preview wrote changes or overflowed');
await click('Подтвердить исправление');await wait('window.poolChanges.length===5');
assert(await js('window.poolChanges[4].accounts[0].poolAccounting.entryDateAdjustments.length===1'));
await js('window.switchToLegacy()');await wait('document.body.innerText.includes("Сравнить расчёт")');await click('Сравнить расчёт');await wait('document.body.innerText.toLowerCase().includes("история с")');
await js('document.querySelector("input[type=checkbox]").click()');await click('Сравнить расчёт');await wait('document.body.innerText.toLowerCase().includes("пример за")');
assert(await js('document.documentElement.scrollWidth<=window.innerWidth+1'),'Comparison overflow');
await js('[...document.querySelectorAll("label")].find(e=>e.textContent.includes("Суммы вложений и условия проверены")).querySelector("input").click()');await click('Включить с 2027-01');await wait('window.poolChanges.length===6');
assert(await js('window.poolChanges[5].accounts[0].poolAccounting.startMonth==="2027-01"'));
await wait('document.body.innerText.includes("Настройки расчёта прибыли")');
await click('Настройки расчёта прибыли');
assert(await js('document.querySelector("select").value==="MONTH"'));
await js('(()=>{const e=document.querySelector("select");e.value="SCHEDULE_PERIOD";e.dispatchEvent(new Event("change",{bubbles:true}))})()');
await click('Сохранить способ расчёта');await wait('window.poolChanges.length===7');
assert(await js('window.poolChanges[6].accounts[0].poolAccounting.terms.some(t=>t.profitBasis==="SCHEDULE_PERIOD"&&t.date==="2026-12-31T21:00:00.000Z")'));
await wait('!document.querySelector("[inert]")');await click('Настройки расчёта прибыли');
await wait('[...document.querySelectorAll("button")].some(e=>e.textContent==="Сохранить способ расчёта"&&e.disabled)');
await js('window.switchToHistorical()');await wait('document.body.innerText.includes("Пул для пересчёта")&&document.body.innerText.includes("Сравнить расчёт")');
await click('Сравнить расчёт');await wait('document.body.innerText.toLowerCase().includes("история с 2026-08 по 2026-12")');
await js('[...document.querySelectorAll("label")].find(e=>e.textContent.includes("Суммы вложений и условия проверены")).querySelector("input").click()');
await click('Включить с пересчётом');await wait('window.poolChanges.length===8');
assert(await js('window.poolChanges[7].accounts[0].poolAccounting.closed.map(r=>r.month).join(",")==="2026-08,2026-09,2026-10,2026-11"'));
await js('window.showCash()');await wait('!!window.cashSnapshot');await sleep(350);
assert(await js('document.body.innerText.replaceAll(String.fromCharCode(160),"").replaceAll(" ","").includes("145000,00")'),'Current month is excluded from withdrawal');
assert(!await js('document.body.innerText.includes("Подтвердить начисления")||document.body.innerText.includes("Пока не подтверждено")'),'Confirmation gate remains in withdrawal sheet');
assert(await js('window.cashSnapshot.account.poolAccounting.closed.length===3'),'Past months were not calculated automatically');
assert(await js('window.cashSnapshot.balances.manager.available===145000'),'Cash preview and ledger disagree');
assert(await js('[...document.querySelectorAll("[data-profit-month]")].find(e=>e.dataset.profitMonth==="2026-12").innerText.includes("По данным на сегодня")'),'Current month status missing');
await js('document.querySelectorAll(".overflow-y-auto").forEach(e=>e.scrollTop=0)');await sleep(300);assert(await js('document.documentElement.scrollWidth<=innerWidth+1'),'Automatic cash phone overflow');
fs.writeFileSync(${JSON.stringify(path.join(scratch,'cash-automatic-phone-dark.png'))},(await win.webContents.capturePage()).toPNG());
assert.equal(errors.length,0,errors.join('\\n'));console.log(JSON.stringify({ok:true,checks:['automatic monthly calculation without buttons','automatic reinvestment','capital deposit','manual reinvestment','new investor','390px dark layout','legacy future activation','legacy activation with full history','scheduled profit basis','current profit included in withdrawal','three past months frozen, current live','no console errors'],screenshots:${JSON.stringify(scratch)}}));app.exit(0);
}catch(e){console.error(e);console.error(JSON.stringify(errors));if(win){console.error(await win.webContents.executeJavaScript('document.body.innerText'));fs.writeFileSync(${JSON.stringify(path.join(scratch, 'failure.png'))},(await win.webContents.capturePage()).toPNG());}app.exit(1)}});setTimeout(()=>app.exit(2),90000);`);
        const electronEnv = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' };
        delete electronEnv.ELECTRON_RUN_AS_NODE;
        const child = spawn(require('electron'), [runner, `--user-data-dir=${path.join(scratch, 'profile')}`], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: electronEnv });
        child.stdout.on('data', d => process.stdout.write(d));
        child.stderr.on('data', d => fs.appendFileSync(path.join(scratch, 'electron.log'), d));
        const code = await new Promise(resolve => child.on('exit', resolve));
        if (code !== 0)
            throw Error(`Electron UI test exited ${code}; log: ${scratch}/electron.log`);
        const final = await service.preview(owner, id);
        if (final.account.poolAccounting.closed.length !== 1 || final.balances.investors.two.available !== -5000)
            throw Error('UI financial result mismatch');
        const confirmedCash=await service.preview(owner,cashAccount.id);
        if(confirmedCash.account.poolAccounting.closed.length!==3||confirmedCash.balances.manager.available!==145000||confirmedCash.balances.investors.cash_one.available!==72500)throw Error('One-click cash confirmation mismatch');
        console.log('Local UI financial assertions passed. Artifacts: ' + scratch);
    }
    finally {
        if (vite)
            await vite.close();
        if (http)
            await new Promise(resolve => http.close(resolve));
        for (const f of [entry, html, runner])
            fs.rmSync(f, { force: true });
        if (db)
            await db.end();
        await raw.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await raw.end();
    }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
