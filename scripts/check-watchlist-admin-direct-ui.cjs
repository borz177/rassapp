// Синтетический статус администратора. API, отправки и рабочая БД не используются.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
require('./no-paid-ai.cjs');app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'watchlist-admin-direct-')));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{let win;try{
  win=new BrowserWindow({show:false,width:430,height:950,webPreferences:{backgroundThrottling:false}});
  win.webContents.session.webRequest.onBeforeRequest((d,cb)=>{const u=new URL(d.url);cb({cancel:['http:','https:','ws:','wss:'].includes(u.protocol)&&(!['localhost','127.0.0.1'].includes(u.hostname)||u.port!=='3000'||u.pathname.startsWith('/api/'))});});
  const js=s=>win.webContents.executeJavaScript(s),until=async s=>{for(let i=0;i<140;i++){if(await js(s))return;await wait(50);}throw Error('Timeout: '+s);};
  await win.loadURL('http://localhost:3000/');await js(`(async()=>{
    window.mock={accepted:false,accessRequests:0,accepts:0};const original=window.fetch.bind(window),response=data=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
    window.fetch=async(input,opts={})=>{const u=new URL(typeof input==='string'?input:input.url,location.href);
      if(u.pathname==='/api/watchlist/status')return response({policyVersion:'test',enabled:true,accepted:mock.accepted,adminAccess:true,adminOnly:true,searchPaused:false,submissionsPaused:false,access:{status:'granted',canSearch:true,canSubmit:true}});
      if(u.pathname==='/api/watchlist/mine'||u.pathname==='/api/watchlist/appeals/mine')return response({items:[],hasMore:false});
      if(u.pathname==='/api/watchlist/accept'){mock.accepted=true;mock.accepts++;return response({ok:true})}
      if(u.pathname==='/api/watchlist/access-request'){mock.accessRequests++;throw Error('Admin self-request forbidden')}
      if(u.pathname.startsWith('/api/'))throw Error('Unrelated API blocked');if(!['localhost','127.0.0.1'].includes(u.hostname)||u.port!=='3000')throw Error('External host blocked');return original(input,opts);
    };
    const R=await import('/node_modules/.vite/deps/react.js'),D=await import('/node_modules/.vite/deps/react-dom_client.js');document.getElementById('root').style.display='none';const host=document.createElement('div');host.id='admin-page-test';document.body.append(host);
    const Page=(await import('/components/ClientWatchlist.tsx')).default;(D.createRoot||D.default.createRoot)(host).render((R.createElement||R.default.createElement)(Page,{userId:'admin',customers:[]}));return true;
  })()`);
  await until(`document.querySelector('#admin-page-test').textContent.includes('Перед началом')`);
  assert(!await js(`document.querySelector('#admin-page-test').textContent.includes('Запросить доступ')`));
  assert(await js(`document.querySelector('#admin-page-test').textContent.includes('Доступ администратора')`));
  await js(`(()=>{document.querySelector('#admin-page-test input[type=checkbox]').click();return true})()`);await wait(80);
  await js(`(()=>{[...document.querySelectorAll('#admin-page-test button')].find(b=>b.textContent.trim()==='Принять и продолжить').click();return true})()`);
  await until(`!!document.querySelector('#admin-page-test input[maxlength="200"]')`);
  assert(await js(`[...document.querySelectorAll('#admin-page-test button')].some(b=>b.textContent.trim()==='+ Добавить')`));assert.equal(await js('mock.accessRequests'),0);assert.equal(await js('mock.accepts'),1);
  console.log('PASS: admin page without self-request, one-time rules acceptance, search and add visible while public access stays off');win.destroy();app.exit(0);
}catch(e){console.error(e.stack);if(win&&!win.isDestroyed())win.destroy();app.exit(1);}});
setTimeout(()=>app.exit(2),30000).unref();
