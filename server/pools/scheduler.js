// Фиксация завершённых месяцев; без моделей, уведомлений и движения денег.
function createPoolScheduler({pool,service,intervalMs=60*60*1000,onError=()=>{}}){
    let running=false,timer,startTimer;
    const tick=async()=>{
        if(running)return;running=true;
        try{
            const owners=(await pool.query("SELECT DISTINCT user_id FROM data_items WHERE type='accounts' AND data->'poolAccounting'->>'version'='1'")).rows;
            for(const {user_id}of owners){
                try{const result=await service.settleOwner(user_id);for(const issue of result.issues)onError(issue.accountId,issue.message);}
                catch(e){onError(user_id,e.message)}
            }
        }catch(e){onError('scheduler',e.message)}
        finally{running=false}
    };
    return {tick,start(){if(timer)return;startTimer=setTimeout(()=>void tick(),5000);startTimer.unref?.();timer=setInterval(()=>void tick(),intervalMs);timer.unref?.();},stop(){clearTimeout(startTimer);clearInterval(timer);timer=null;}};
}
module.exports={createPoolScheduler};
