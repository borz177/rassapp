// Экскурсовод: выполняет шаги из JSON (click/type/wait/shot/scroll/js) в приложении на экране телефона
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const S = process.env.SCRATCH, W = +(process.env.W || 390), H = +(process.env.H || 844), MODE = process.env.MODE || 'light';
const steps = JSON.parse(fs.readFileSync(process.env.STEPS, 'utf8'));
const OUT = process.env.OUT || (S + '/tour');
const login = JSON.parse(fs.readFileSync(S + '/login.json', 'utf8'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: W, height: H, show: false, webPreferences: { partition: 'tour' + MODE + W } });
  w.webContents.setUserAgent('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36');
  const js = s => w.webContents.executeJavaScript(s);
  await w.loadURL('http://localhost:3000/').catch(()=>{}); await sleep(800);
  await js(`localStorage.setItem('token', ${JSON.stringify(login.token)}); localStorage.setItem('user', ${JSON.stringify(JSON.stringify(login.user))}); localStorage.setItem('finuchet_theme_mode','${MODE}'); localStorage.removeItem('finuchet_dashboard_account'); for (let i=30;i<60;i++) localStorage.setItem('template_update_notice_last_shown_v'+i,'1');1`);
  await w.loadURL('http://localhost:3000/').catch(()=>{}); await sleep(7000);
  const find = (t, sel) => `(()=>{const t=${JSON.stringify(t)}; const els=[...document.querySelectorAll(${JSON.stringify(sel || 'button,a,[role=button],[class*=cursor-pointer],label,li')})].filter(e=>e.offsetParent!==null); const exact=els.filter(e=>e.textContent.trim()===t); const start=els.filter(e=>e.textContent.trim().startsWith(t)); const inc=els.filter(e=>e.textContent.includes(t)); const pick=(exact[exact.length-1]||start[start.length-1]||inc.sort((a,b)=>a.textContent.length-b.textContent.length)[0]); return pick})()`;
  for (const st of steps) {
    try {
      if (st.click) { const r = await js(`(()=>{const e=${find(st.click, st.sel)}; if(!e) return 'NO'; e.scrollIntoView({block:'center'}); e.click(); return 'ok'})()`); console.log('click', st.click, r); }
      if (st.type !== undefined) { const r = await js(`(()=>{const q=${JSON.stringify(st.into)}; const ins=[...document.querySelectorAll('input,textarea')].filter(e=>e.offsetParent!==null && e.type!=='checkbox' && e.type!=='hidden'); let e=ins.find(i=>(i.placeholder||'').includes(q)); if(!e){ for (const i of ins){ let a=i.parentElement; while(a && a!==document.body){ if(a.querySelectorAll('input:not([type=checkbox]),textarea').length>1) break; if(a.textContent.includes(q)){ e=i; break; } a=a.parentElement; } if(e) break; } } if(!e) return 'NO'; e.focus(); const set=Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set; set.call(e, ${JSON.stringify(String(st.type))}); e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); e.blur(); return 'ok'})()`); console.log('type', st.into, r); }
      if (st.tap) { const [x, y] = st.tap; w.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 }); w.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 }); console.log('tap', x, y); }
      if (st.js) console.log('js', await js(st.js));
      if (st.scroll !== undefined) await js(`(()=>{[...document.querySelectorAll('*')].filter(e=>e.scrollHeight>e.clientHeight+20 && /auto|scroll/.test(getComputedStyle(e).overflowY) && e.getClientRects().length>0).forEach(sc=>sc.scrollTop=${st.scroll}); window.scrollTo(0,${st.scroll}); return 1})()`);
      if (st.hl || st.hlsel) { const r = await js(`(()=>{document.querySelectorAll('.__hl').forEach(e=>e.remove()); const e=${st.hlsel ? `document.querySelector(${JSON.stringify(st.hlsel)})` : find(st.hl, st.sel)}; if(!e) return 'NO'; if(${!!st.hlscroll}) e.scrollIntoView({block:'center'}); const b=e.getBoundingClientRect(); const d=document.createElement('div'); d.className='__hl'; Object.assign(d.style,{position:'fixed',left:(b.left-6)+'px',top:(b.top-6)+'px',width:(b.width+12)+'px',height:(b.height+12)+'px',border:'3px solid #f43f5e',borderRadius:'16px',boxShadow:'0 0 0 4px rgba(244,63,94,0.18)',zIndex:2147483647,pointerEvents:'none'}); document.body.appendChild(d); return 'ok'})()`); console.log('hl', st.hl || st.hlsel, r); await sleep(250); }
      await sleep(st.wait || 900);
      if (st.shot) { fs.writeFileSync(`${OUT}/${st.shot}.png`, (await w.webContents.capturePage()).toPNG()); console.log('shot', st.shot); }
      await js(`document.querySelectorAll('.__hl').forEach(e=>e.remove());1`);
      if (st.texts) console.log('texts', await js(`[...document.querySelectorAll('button,label,h1,h2,h3,[role=button]')].filter(e=>e.offsetParent!==null).map(e=>e.textContent.trim().replace(/\\s+/g,' ').slice(0,40)).filter(Boolean).slice(0,${st.texts}).join(' | ')`));
    } catch (e) { console.log('ERR', JSON.stringify(st), e.message); }
  }
  app.exit(0);
});
setTimeout(() => app.exit(1), +(process.env.TIMEOUT || 120000));
