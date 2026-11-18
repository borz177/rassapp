/** Бесплатные проверки файлового моста: синтетический PDF, без ОС и сети. */
require('./no-paid-ai.cjs');
const {build}=require('esbuild');
const vm=require('node:vm');
const assert=require('node:assert/strict');
(async()=>{
  const result=await build({entryPoints:['src/androidPrint.ts'],bundle:true,write:false,format:'cjs',platform:'node',plugins:[{name:'native-fixture',setup(b){
    b.onResolve({filter:/^@capacitor\/(core|filesystem)$/},a=>({path:a.path,namespace:'fixture'}));
    b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path.endsWith('/core')?'export const Capacitor=globalThis.nativeFixture.cap;export const registerPlugin=()=>globalThis.nativeFixture.plugin;':'export const Filesystem=globalThis.nativeFixture.fs;export const Directory={Cache:"CACHE"};',loader:'js'}));
  }}]});
  const calls=[];let available=true,platform='android',native=true,fail='',closePrint;
  const fixture={cap:{isNativePlatform:()=>native,getPlatform:()=>platform,isPluginAvailable:()=>available},
    fs:{writeFile:async o=>{calls.push(['write',o]);if(fail==='write')throw Error('write failed');return{uri:'file:///private/cache/'+o.path}},deleteFile:async o=>{calls.push(['delete',o]);if(fail==='delete')throw Error('delete failed')}},
    plugin:{printPdf:async o=>{calls.push(['print',o]);if(fail==='print')throw Error('print failed');if(fail==='cancel')throw Object.assign(Error('closed'),{code:'CANCELLED'});if(fail==='pending')await new Promise(r=>closePrint=r);return{closed:true}}}};
  class Reader{readAsDataURL(blob){blob.arrayBuffer().then(b=>{this.result='data:application/pdf;base64,'+Buffer.from(b).toString('base64');this.onload()})}}
  const context={module:{exports:{}},window:{},nativeFixture:fixture,FileReader:Reader,crypto:require('node:crypto').webcrypto};
  vm.runInNewContext(result.outputFiles[0].text,context);const api=context.module.exports,pdf=new Blob(['%PDF-1.4 synthetic']);
  assert.equal(api.isAndroidNativePrint(),true);platform='ios';assert.equal(api.isAndroidNativePrint(),false);platform='android';native=false;assert.equal(api.isAndroidNativePrint(),false);native=true;
  available=false;await assert.rejects(api.printAndroidPdf(pdf,'Договор'),e=>e.code==='PRINT_UPDATE_REQUIRED');assert.equal(calls.length,0);available=true;
  await assert.rejects(api.printAndroidPdf(new Blob(['bad']),'Договор'));assert.equal(calls.length,0);
  for(const failure of ['', 'write','print','cancel','delete']){
    calls.length=0;fail=failure;const pending=api.printAndroidPdf(pdf,'Договор №1');
    if(['write','print','cancel'].includes(failure))await assert.rejects(pending);else await pending;
    assert.equal(calls[0][0],'write');assert.equal(calls.at(-1)[0],'delete');
    assert.equal(calls[0][1].directory,'CACHE');assert.match(calls[0][1].path,/^print-jobs\/[a-f0-9-]+\.pdf$/);
    assert.equal(calls[0][1].path,calls.at(-1)[1].path);
    if(failure!=='write'){assert.equal(calls[1][0],'print');assert.equal(calls[1][1].title,'Договор №1');}
  }
  calls.length=0;fail='pending';const pending=api.printAndroidPdf(pdf,'Договор');
  while(!closePrint)await new Promise(r=>setTimeout(r,1));assert.equal(calls.some(c=>c[0]==='delete'),false);closePrint();await pending;assert.equal(calls.at(-1)[0],'delete');
  console.log('PASS Android detection, old APK update, invalid size, private cache, failures/cancellation, cleanup only after system dialog closes');
})().catch(e=>{console.error(e);process.exitCode=1});
