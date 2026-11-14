const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs');
const content=require('./whatsappReminderContent');

const fixedDate = iso => class extends Date {
  constructor(...args){super(...(args.length?args:[iso]));}
  static now(){return new Date(iso).getTime();}
};

function scheduler({now='2026-11-13T10:00:00',days=[-3],payments=[{id:'plan',date:'2026-11-16',amount:12000,isRealPayment:false}],allowed=true,provider='builtin',sendOk=true,templates}={}){
  const sales=[{id:'sale',customerId:'customer',productName:'Тестовый товар',status:'ACTIVE',paymentPlan:structuredClone(payments)}];
  const original=structuredClone(sales),calls=[],writes=[];
  const customers=[{id:'customer',name:'Тестовый Клиент',phone:'79000000000',allowWhatsappNotification:allowed}];
  const pool={query:async(sql,args)=>{
    if(sql.startsWith('SELECT data FROM data_items WHERE user_id')){assert.equal(args[0],'owner');return {rows:(args[1]==='sales'?sales:customers).map(data=>({data:structuredClone(data)}))};}
    if(sql.includes('SELECT data FROM data_items WHERE id'))return {rows:[{data:{notifications:{enabled:false}}}]};
    if(sql.includes('UPDATE data_items SET data')){assert.equal(args[2],'owner');writes.push(args[1]);const i=sales.findIndex(s=>s.id===args[1]);assert(i>=0);sales[i]=JSON.parse(args[0]);return {rowCount:1,rows:[]};}
    throw Error('Unexpected database operation: '+sql);
  }};
  const transport={isConfigured:async()=>true,getState:async()=> 'authorized',sendText:async(id,settings,phone,text)=>{
    assert.equal(id,'owner');assert.equal(settings.provider,provider);calls.push({text,phone});return {ok:sendOk};
  }};
  const mod={exports:{}};
  const sandbox={module:mod,exports:mod.exports,Date:fixedDate(now),console:{log(){},warn(){},error(){}},process:{env:{},argv:[]},setTimeout:fn=>{fn();return {unref(){}}},
    require:name=>{
      if(name==='dotenv')return {config(){}};
      if(name==='pg')return {Pool:class{constructor(){return pool}}};
      if(name==='axios')return {};
      if(name==='web-push')throw Error('Push disabled in test');
      if(name==='./waTransport')return {createWaTransport:()=>transport};
      if(name==='./whatsappReminderContent')return content;
      throw Error('External dependency blocked: '+name);
    },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('./whatsapp-reminders'),'utf8'),sandbox,{filename:'whatsapp-reminders-isolated.js'});
  const run=()=>mod.exports.processRemindersForUser({id:'owner',whatsapp_settings:{enabled:true,provider,reminderTime:'10:00',reminderDays:days,templates}});
  return {run,sales,original,calls,writes};
}

test('за 3 дня — самостоятельный выключенный по умолчанию вариант; соседние дни не подходят',()=>{
  for(let day=-5;day<=5;day++)assert.equal(content.reminderTrigger(day,[-3]),day===3);
  assert.equal(content.reminderTrigger(3,[0]),false);assert.equal(content.reminderTrigger(1,[-1]),true);
  assert.equal(content.reminderTrigger(-3,[-1]),false);assert.equal(content.reminderTrigger(-3,[1]),true);
});

test('cron: встроенный и Green API, правильная дата и сумма, повтор в тот же день пропускается',async()=>{
  for(const provider of ['builtin','greenapi']){
    const s=scheduler({provider});await s.run();assert.equal(s.calls.length,1);assert.match(s.calls[0].text,/Через \*3 дня\*/);assert.match(s.calls[0].text,/16 ноября 2026/);assert.match(s.calls[0].text,/12\s000 ₽/);assert(!s.calls[0].text.includes('Завтра'));
    await s.run();assert.equal(s.calls.length,1);assert.deepEqual(s.writes,['sale']);
    const payment=s.sales[0].paymentPlan[0];assert(payment.lastNotificationDate);delete payment.lastNotificationDate;assert.deepEqual(s.sales,s.original,'Отправка меняет только отметку уведомления');
  }
});

test('cron: оплата и частичная оплата, выключенные уведомления, время и ошибка транспорта',async()=>{
  for(const opts of [{days:[0]},{allowed:false},{now:'2026-11-13T12:00:00'},{payments:[{id:'p',date:'2026-11-15',amount:12000}]}]){
    const s=scheduler(opts);await s.run();assert.equal(s.calls.length,0);assert.deepEqual(s.sales,s.original);
  }
  const plan={id:'plan',date:'2026-11-16',amount:12000,isRealPayment:false};
  const paid=scheduler({payments:[plan,{id:'actual',date:'2026-11-12',amount:12000,isRealPayment:true,isPaid:true}]});await paid.run();assert.equal(paid.calls.length,0);
  const partial=scheduler({payments:[plan,{id:'actual',date:'2026-11-12',amount:4500,isRealPayment:true,isPaid:true}]});await partial.run();assert.match(partial.calls[0].text,/7\s500 ₽/);assert(!partial.calls[0].text.includes('12 000'));
  const failed=scheduler({sendOk:false});await failed.run();assert.equal(failed.calls.length,1);assert.equal(failed.writes.length,0);assert.deepEqual(failed.sales,failed.original);
});

test('cron: календарные границы года и високосного февраля',async()=>{
  for(const [now,due,label] of [['2026-12-30T10:00:00','2027-01-02','2 января 2027'],['2028-02-27T10:00:00','2028-03-01','1 марта 2028']]){
    const s=scheduler({now,payments:[{id:'plan',date:due,amount:12000}]});await s.run();assert.equal(s.calls.length,1);assert(s.calls[0].text.includes(label));
  }
});

test('разные сроки одного клиента — одно сообщение, отдельные суммы; задолженность учитывается один раз',async()=>{
  const s=scheduler({days:[-3,-1,0,1],payments:[{id:'debt',date:'2026-11-10',amount:1000},{id:'today',date:'2026-11-13',amount:2000},{id:'tomorrow',date:'2026-11-14',amount:3000},{id:'three',date:'2026-11-16',amount:4000}],templates:{today:'СЕГОДНЯ {дата}: {сумма}. Долг {долг}',upcoming:'ЗАВТРА {дата}: {сумма}. Долг {долг}',threeDays:'ЧЕРЕЗ ТРИ {дата}: {сумма}. Долг {долг}'}});
  await s.run();assert.equal(s.calls.length,1);const text=s.calls[0].text;
  assert.match(text,/СЕГОДНЯ 13 ноября 2026 г\.: 3\s000\. Долг 1\s000/);
  assert.match(text,/ЗАВТРА 14 ноября 2026 г\.: 3\s000\. Долг 0/);
  assert.match(text,/ЧЕРЕЗ ТРИ 16 ноября 2026 г\.: 4\s000\. Долг 0/);
  assert(s.sales[0].paymentPlan.every(p=>p.lastNotificationDate));await s.run();assert.equal(s.calls.length,1);
});

test('старые пользовательские шаблоны не подставляются вместо нового с фразой «Завтра»',()=>{
  const item={saleId:'sale',productName:'Товар',diffDays:3,remaining:5000,originalAmount:5000,date:'2026-11-16',dateObj:new Date('2026-11-16')};
  const data={customer:{name:'Тест'},items:[item]};
  const message=content.buildCustomerReminderMessage(data,{upcoming:'Завтра {сумма}',today:'Сегодня {сумма}'});
  assert.match(message,/Через \*3 дня\*/);assert(!message.includes('Завтра'));assert.match(message,/16 ноября/);
});
