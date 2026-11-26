const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {buildSync}=require('esbuild');

const code=buildSync({entryPoints:['src/keyboard.ts'],bundle:true,platform:'node',format:'cjs',write:false,external:['react']}).outputFiles[0].text;
function setup({fixed=true,coarse=true}={}) {
  const listeners=new Map(),timers=[],scrolls=[],classes=new Set();
  const target=prefix=>({addEventListener:(event,fn)=>{const key=prefix+event;listeners.set(key,[...(listeners.get(key)||[]),fn]);}});
  const viewport={...target('viewport:'),height:500,offsetTop:0,scale:1};
  const win={...target('window:'),matchMedia:()=>({matches:coarse}),visualViewport:viewport,innerHeight:800,scrollY:125,
    setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout:()=>{},
    scrollTo:options=>{scrolls.push(options.top);win.scrollY=options.top;}};
  const doc={...target('document:'),hidden:false,activeElement:null,
    documentElement:{clientHeight:800,classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x)}}};
  const context={module:{exports:{}},exports:{},require:name=>name==='react'?{useEffect(){}}:require(name),
    window:win,document:doc,getComputedStyle:el=>({position:el.fixed?'fixed':'static'})};
  context.exports=context.module.exports;
  vm.runInNewContext(code,context);
  context.module.exports.installKeyboardClass();
  const field={tagName:'INPUT',getAttribute:()=> 'text',readOnly:false,disabled:false,parentElement:{fixed,parentElement:null}};
  const emit=(key,event={})=>(listeners.get(key)||[]).forEach(fn=>fn(event));
  return {win,doc,viewport,scrolls,classes,field,emit,timers};
}

test('fixed form restores underlying scroll after keyboard closes, including a removed input',()=>{
  const s=setup();s.doc.activeElement=s.field;s.emit('document:focusin',{target:s.field});
  s.win.scrollY=460;
  s.doc.activeElement=null;s.emit('document:focusout');s.timers.splice(0).forEach(fn=>fn());
  assert.deepEqual(s.scrolls,[],'keyboard is still open');
  s.viewport.height=800;s.emit('viewport:resize');
  assert.deepEqual(s.scrolls,[125]);assert(!s.classes.has('kb-open'));
  s.emit('window:pageshow');assert.deepEqual(s.scrolls,[125]);
});
test('ordinary page scrolling, zoom and active input are preserved',()=>{
  const s=setup({fixed:false});s.doc.activeElement=s.field;s.emit('document:focusin',{target:s.field});
  s.doc.activeElement=null;s.viewport.height=800;s.emit('viewport:resize');
  assert.deepEqual(s.scrolls,[]);
  const zoom=setup();zoom.doc.activeElement=zoom.field;zoom.emit('document:focusin',{target:zoom.field});
  zoom.viewport.height=800;zoom.emit('viewport:resize');assert.deepEqual(zoom.scrolls,[]);
  zoom.doc.activeElement=null;zoom.viewport.scale=1.5;zoom.emit('viewport:scroll');assert.deepEqual(zoom.scrolls,[]);
  zoom.viewport.scale=1;zoom.emit('document:visibilitychange');assert.deepEqual(zoom.scrolls,[125]);
});
test('desktop does not install mobile recovery',()=>{
 const s=setup({coarse:false});s.emit('document:focusin',{target:s.field});s.emit('viewport:resize');assert.deepEqual(s.scrolls,[]);
});
