const {test}=require('node:test'),assert=require('node:assert/strict');
const {createPoolScheduler}=require('./scheduler');
test('планировщик не запускает параллельные проходы и продолжает после ошибки одного владельца',async()=>{
    let release;const gate=new Promise(r=>release=r),seen=[],errors=[];
    const scheduler=createPoolScheduler({pool:{query:async()=>({rows:[{user_id:'one'},{user_id:'two'}]})},service:{settleOwner:async id=>{seen.push(id);if(id==='one'){await gate;throw Error('busy')}return{issues:[]}}},onError:(id,message)=>errors.push([id,message])});
    const first=scheduler.tick();await Promise.resolve();await scheduler.tick();release();await first;
    assert.deepEqual(seen,['one','two']);assert.deepEqual(errors,[['one','busy']]);scheduler.stop();
});
