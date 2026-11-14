/** Бесплатная UI-проверка. Запуск: env -u ELECTRON_RUN_AS_NODE electron scripts/check-watchlist-search.cjs
 * Нужен только локальный Vite :3000. Все API — заглушки, БД/провайдеры не используются. */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
require('./no-paid-ai.cjs');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'watchlist-auto-ui-')));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  let win;
  try {
    win = new BrowserWindow({ show: false, width: 1100, height: 950, webPreferences: { backgroundThrottling: false } });
    win.webContents.on('console-message', (_e, _level, text) => { if (/Uncaught|Error Boundary/.test(text)) console.log(text); });
    const js = code => win.webContents.executeJavaScript(code);
    const until = async code => { for (let i = 0; i < 160; i++) { if (await js(code)) return; await wait(50); } throw Error('Timeout: ' + code); };
    const setInput = async (selector, value) => { await js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error('Input missing');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));return true})()`); await wait(40); };
    const click = async label => { await js(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>!e.closest('[aria-hidden=true]')&&(e.textContent.trim()===${JSON.stringify(label)}||e.getAttribute('aria-label')===${JSON.stringify(label)}));if(!b||b.disabled)throw Error('Missing/disabled '+${JSON.stringify(label)});b.click();return true})()`); await wait(100); };
    await win.loadURL('http://localhost:3000/index.html'); await wait(500);
    await js(`(async()=>{
      const R=await import('/node_modules/.vite/deps/react.js'),D=await import('/node_modules/.vite/deps/react-dom_client.js');
      window.h=R.createElement||R.default.createElement;document.getElementById('root').style.display='none';
      const host=document.createElement('div');host.id='test-root';document.body.appendChild(host);window.uiRoot=(D.createRoot||D.default.createRoot)(host);
      window.Page=(await import('/components/ClientWatchlist.tsx')).default;window.Global=(await import('/components/GlobalSearch.tsx')).default;window.Panel=(await import('/components/WatchlistSearchPanel.tsx')).default;
      window.mock={granted:true,calls:[],held:[],hold:false,code:200,reports:[],opened:[],statusCalls:0};window.testHidden=false;window.testOnline=true;
      Object.defineProperty(document,'hidden',{configurable:true,get:()=>testHidden});Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>testOnline});
      window.statusValue=()=>({policyVersion:'test',accepted:true,enabled:true,searchPaused:false,submissionsPaused:false,access:{status:mock.granted?'granted':'requested',canSearch:mock.granted,canSubmit:mock.granted}});
      window.match={id:'public-one',name:'Семёнов Тест Тестович',birthYear:1988,reason:'other',reasonDetails:'Синтетическое описание'};
      const originalFetch=window.fetch.bind(window),response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
      window.fetch=async(input,options={})=>{
        const url=new URL(typeof input==='string'?input:input.url,location.href);
        if(url.pathname==='/api/watchlist/status'){mock.statusCalls++;return response(statusValue())}
        if(url.pathname==='/api/watchlist/search'){
          const body=JSON.parse(options.body);const call={body,signal:options.signal};mock.calls.push(call);
          const answer=()=>mock.code===200?response({items:body.name==='семенов тест тестович'?[match]:[],limited:false}):response({msg:'Проверка недоступна'},mock.code);
          if(mock.hold){mock.hold=false;return new Promise(resolve=>mock.held.push(()=>resolve(answer())))}return answer();
        }
        if(url.pathname==='/api/watchlist/appeals'){mock.reports.push(JSON.parse(options.body));return response({})}
        if(['/api/watchlist/mine','/api/watchlist/appeals/mine'].includes(url.pathname))return response({items:[],hasMore:false});
        if(url.pathname.startsWith('/api/'))throw Error('Unrelated API blocked');
        if(!['localhost','127.0.0.1'].includes(url.hostname))throw Error('External host blocked');return originalFetch(input,options);
      };
      window.mountPage=()=>uiRoot.render(h(Page,{key:Math.random(),userId:'owner',customers:[]}));
      window.mountGlobal=(enabled=true)=>uiRoot.render(h(Global,{key:Math.random(),watchlistUserId:enabled?'owner':undefined,data:{customers:[{id:'own',name:match.name,phone:'79991234567'}],sales:[]},onOpenCustomer:id=>mock.opened.push(id),onOpenProducts:()=>{},onOpenOperations:()=>{}}));
      window.renderProbe=(name,active=true,userId='owner')=>uiRoot.render(h(Panel,{key:'probe',userId,name,active,status:statusValue()}));
      mountPage();return true;
    })()`);
    await until(`!!document.querySelector('#test-root label[for]')`);
    assert(!await js(`Array.from(document.querySelectorAll('#test-root button')).some(b=>b.textContent.trim()==='Найти')`));
    await setInput('#test-root input[maxlength="200"]', 'Семёнов'); await wait(1300);assert.equal(await js('mock.calls.length'),0);
    await js(`document.querySelector('#test-root input[maxlength="200"]').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));true`);
    await setInput('#test-root input[maxlength="200"]', 'Семёнов Тест');await wait(150);
    await setInput('#test-root input[maxlength="200"]', 'Семёнов Тест Тестович');
    await wait(1300);assert.equal(await js('mock.calls.length'),0);
    await js(`document.querySelector('#test-root input[maxlength="200"]').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));true`);
    await until(`document.body.textContent.includes('Синтетическое описание')`);assert.equal(await js('mock.calls.length'),1);
    await setInput('#test-root input[maxlength="200"]', '  СЕМЕНОВ   ТЕСТ ТЕСТОВИЧ  ');await wait(1300);assert.equal(await js('mock.calls.length'),1);
    await setInput('#test-root input[maxlength="4"]','198');await wait(1300);assert.equal(await js('mock.calls.length'),1);assert(!await js(`document.body.textContent.includes('Синтетическое описание')`));
    await setInput('#test-root input[maxlength="4"]','1988');await until(`mock.calls.length===2`);
    console.log('PASS page: no Find button, debounce, normalized deduplication, incomplete name/year never sent');

    await js(`mock.hold=true;renderProbe('Другой Тест Тестович');true`);await until('mock.held.length===1');
    await js(`renderProbe('Семёнов Тест Тестович');true`);await wait(50);
    assert(await js('mock.calls.at(-1).signal.aborted'));
    await js('mock.held.shift()();true');await wait(100);assert(!await js(`document.body.textContent.includes('Совпадений в чёрном списке не найдено')`));
    await until(`document.body.textContent.includes('Синтетическое описание')`);
    await js(`testOnline=false;window.dispatchEvent(new Event('offline'));true`);await until(`document.body.textContent.includes('Нет интернета')`);assert(!await js(`document.body.textContent.includes('Синтетическое описание')`));
    await js(`testOnline=true;window.dispatchEvent(new Event('online'));true`);await until(`document.body.textContent.includes('Синтетическое описание')`);
    await js(`testHidden=true;document.dispatchEvent(new Event('visibilitychange'));true`);await wait(100);assert(!await js(`document.body.textContent.includes('Синтетическое описание')`));
    await js(`testHidden=false;document.dispatchEvent(new Event('visibilitychange'));mock.code=429;true`);await until(`document.body.textContent.includes('Лимит проверок исчерпан')`);
    const exhausted=await js('mock.calls.length');await wait(1400);assert.equal(await js('mock.calls.length'),exhausted);
    console.log('PASS stale response ignored after abort; offline/hidden clear results; 429 has no automatic retry');

    await js('mock.code=200;mock.granted=false;mountGlobal();true');await wait(150);await click('Поиск');
    await setInput('input[aria-label="Поиск по всем данным"]','Семёнов Тест Тестович');await wait(1450);assert.equal(await js('mock.calls.length'),exhausted);
    assert(!await js(`!!document.querySelector('section[aria-label="Проверка по чёрному списку"]')`));
    await js('mock.granted=true;mountGlobal(false);true');await wait(150);await click('Поиск');
    const statusCount=await js('mock.statusCalls');await setInput('input[aria-label="Поиск по всем данным"]','Семёнов Тест Тестович');await wait(1400);assert.equal(await js('mock.statusCalls'),statusCount);
    await js('mountGlobal();true');await wait(150);await click('Поиск');
    await setInput('input[aria-label="Поиск по всем данным"]','Семёнов Тест Тестович');await until(`document.body.textContent.includes('Синтетическое описание')`);
    assert(await js(`document.body.textContent.includes('79991234567')`));
    const beforeHistory=await js(`localStorage.getItem('finuchet_recent_searches')`);
    await click('Открыть совпадение: Семёнов Тест Тестович');await until(`!!document.querySelector('[role=dialog][aria-label="Возможное совпадение"]')`);
    await js(`document.querySelector('[role=dialog][aria-label="Возможное совпадение"] button').focus();document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));true`);await wait(400);
    assert(await js(`!!document.querySelector('input[aria-label="Поиск по всем данным"]')`));assert.equal(await js(`localStorage.getItem('finuchet_recent_searches')`),beforeHistory);
    await click('Сообщить об ошибке');await until(`!!document.querySelector('textarea')`);
    await js(`(()=>{const e=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'Синтетическое обращение для проверки');e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);await click('Отправить обращение');await until('mock.reports.length===1');
    await win.setSize(390,844);await wait(150);assert(await js('document.documentElement.scrollWidth<=innerWidth+1'));
    fs.writeFileSync('/tmp/rassapp-global-watchlist-search.png',(await win.webContents.capturePage()).toPNG());
    await click('Отмена');await wait(400);assert(!await js(`document.body.textContent.includes('Синтетическое описание')`));
    console.log('PASS global: rights gate, own results preserved, shared detail/appeal, no shared history, clear on close, mobile layout');

    await js(`window.originalTimeout=window.setTimeout;window.setTimeout=(fn,ms,...args)=>originalTimeout(fn,ms===30000?250:ms,...args);renderProbe('Семёнов Тест Тестович');true`);
    await until(`document.body.textContent.includes('Результаты очищены.')`);const expired=await js('mock.calls.length');await wait(1400);assert.equal(await js('mock.calls.length'),expired);
    assert(!await js(`document.body.textContent.includes('Синтетическое описание')`));
    await js(`window.setTimeout=originalTimeout;mock.code=403;true`);await click('Повторить проверку');await until(`document.body.textContent.includes('Проверка недоступна')`);
    assert(!await js(`document.body.textContent.includes('Совпадений в чёрном списке не найдено')`));
    console.log('PASS expiry clears personal data without polling; permission failure never becomes a negative match');
    await js(`mock.code=200;renderProbe('Другой Тест Тестович');true`);await until(`document.body.textContent.includes('Совпадений в чёрном списке не найдено')`);
    await js(`mock.hold=true;renderProbe('Семёнов Тест Тестович');true`);await until('mock.held.length===1');
    await js(`mock.granted=false;renderProbe('Семёнов Тест Тестович',true,'another-user');true`);await wait(80);
    assert(await js('mock.calls.at(-1).signal.aborted'));
    await js('mock.held.shift()();true');await wait(150);
    assert(!await js(`document.body.textContent.includes('Синтетическое описание')`));
    assert(!await js(`!!document.querySelector('section[aria-label="Проверка по чёрному списку"]')`));
    console.log('PASS account/access switch cancels pending lookup and never renders previous account result');
  } catch (e) {
    console.error(e.stack);process.exitCode=1;
    if(win) { console.error(await win.webContents.executeJavaScript('document.body.textContent.slice(-2000)'));fs.writeFileSync('/tmp/rassapp-watchlist-autosearch-failure.png',(await win.webContents.capturePage()).toPNG()); }
  } finally { win?.destroy();app.exit(process.exitCode||0); }
}).catch(e=>{console.error(e.stack);app.exit(1)});
setTimeout(()=>app.exit(2),120000).unref();
