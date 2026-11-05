// Явный запуск против ЛОКАЛЬНОГО API. Создаёт и удаляет своего тестового владельца.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { build } from 'esbuild';
const require=createRequire(new URL('../server/package.json',import.meta.url));
require('dotenv').config({path:new URL('../server/.env',import.meta.url).pathname,quiet:true});
const api=process.env.EXPENSE_LOCAL_API;
test('локальный HTTP API: сохранённый расход и капитал совпадают с расчётом до/после',{skip:!api},async()=>{
  const local=url=>['127.0.0.1','localhost','[::1]'].includes(new URL(url).hostname);
  assert(local(api)&&local(process.env.DATABASE_URL),'Только локальное API и локальная база');
  const {Pool}=require('pg'),jwt=require('jsonwebtoken');
  const pool=new Pool({connectionString:process.env.DATABASE_URL});
  const id=`expense_test_${Date.now()}_${randomBytes(3).toString('hex')}`;
  const compiled=await build({entryPoints:['src/expensePreview.ts','src/utils.ts','src/turnoverBreakdown.ts'],bundle:true,platform:'node',format:'esm',write:false,outdir:'unused-tests',logLevel:'silent'});
  const [P,U,T]=await Promise.all(compiled.outputFiles.map(f=>import(`data:text/javascript;base64,${Buffer.from(f.contents).toString('base64')}`)));
  const token=jwt.sign({id,role:'manager'},process.env.JWT_SECRET,{expiresIn:'5m'});
  const post=async(type,data)=>{
    const r=await fetch(`${api}/api/data/${type}`,{method:'POST',headers:{'Content-Type':'application/json','x-auth-token':token},body:JSON.stringify(data)});
    assert(r.ok,`POST ${type}: ${r.status} ${await r.text()}`);
  };
  const write=async(type,data)=>pool.query('INSERT INTO data_items(id,user_id,type,data) VALUES($1,$2,$3,$4)',[data.id,id,type,JSON.stringify(data)]);
  const read=async()=>{
    const rows=(await pool.query('SELECT type,data FROM data_items WHERE user_id=$1',[id])).rows;
    return Object.fromEntries(['accounts','sales','expenses','investors'].map(type=>[type,rows.filter(r=>r.type===type).map(r=>r.data)]));
  };
  const acc={id:`${id}_acc`,userId:id,name:'Проверка',type:'POOL',poolMemberIds:[`${id}_inv`],initialBalance:100000};
  const inv={id:`${id}_inv`,userId:id,name:'Тестовый инвестор',initialAmount:100000,profitPercentage:60,joinedDate:'2025-01-01'};
  const sale={id:`${id}_sale`,userId:id,accountId:acc.id,customerId:`${id}_client`,type:'INSTALLMENT',status:'COMPLETED',productName:'Тестовый товар',buyPrice:100000,totalAmount:120000,remainingAmount:0,downPayment:0,startDate:'2026-01-01',paymentPlan:[{id:`${id}_payment`,amount:120000,date:'2026-07-01',isPaid:true,isRealPayment:true}]};
  const purchase={id:`exp_sale_${sale.id}`,userId:id,accountId:acc.id,amount:100000,title:'Закуп',category:'Закуп',date:'2026-01-01'};
  try{
    await pool.query('INSERT INTO users(id,name,email,password,role,subscription) VALUES($1,$2,$3,$4,$5,$6)',[id,'Локальная проверка',`${id}@example.invalid`,'not-a-login','manager',JSON.stringify({plan:'BUSINESS_PRO',expiresAt:new Date(Date.now()+365*86400000).toISOString()})]);
    await write('accounts',acc);await write('investors',inv);await write('sales',sale);await write('expenses',purchase);
    for(const [label,extra] of [
      ['shared',{fromProfit:true,profitSource:'SHARED'}],
      ['manager',{fromProfit:true,profitSource:'MANAGER'}],
      ['capital',{category:'Выплата инвестора',investorId:inv.id,payoutType:'INVESTMENT',amount:20000}],
    ]){
      await pool.query("DELETE FROM data_items WHERE user_id=$1 AND type='expenses' AND id<>$2",[id,purchase.id]);
      await pool.query("UPDATE data_items SET data=$2 WHERE id=$1 AND user_id=$3",[inv.id,JSON.stringify(inv),id]);
      const before=await read();
      const e={id:`${id}_${label}`,userId:id,accountId:acc.id,amount:5000,category:'Rent',title:'Проверка',date:new Date().toISOString(),...extra};
      const predicted=P.expensePreview({...before,expense:e});assert.deepEqual(predicted.errors,[]);
      await post('expenses',e);
      if(e.payoutType==='INVESTMENT')await post('investors',U.applyCapitalChange(inv,-e.amount,e.date,e.id));
      const actual=await read();
      const stored=actual.expenses.find(x=>x.id===e.id);assert.equal(stored.fromProfit,e.fromProfit);assert.equal(stored.profitSource,e.profitSource);assert.equal(stored.amount,e.amount);
      const cash=U.computeAccountBalances(actual.accounts,actual.sales,actual.expenses);
      const totals=T.turnoverBreakdown({...actual,accountIds:[acc.id],accountBalances:cash});
      assert.equal(predicted.rows.find(r=>r.key==='cash').after,totals.cash);
      const profit=predicted.rows.find(r=>r.key==='manager'||r.key==='profit');assert.equal(profit.after,profit.key==='manager'?totals.manager.toWithdraw:totals.manager.toWithdraw+totals.investors.toPay);
      assert.equal(predicted.rows.find(r=>r.key==='capital').after,totals.investorCapital);
    }
  }finally{
    await pool.query('DELETE FROM data_items WHERE user_id=$1',[id]);
    await pool.query('DELETE FROM notifications WHERE user_id=$1',[id]);
    await pool.query('DELETE FROM users WHERE id=$1',[id]);await pool.end();
  }
});
