const crypto=require('node:crypto');
// JSONB переставляет ключи объектов. Отметка зависит от содержимого, а не от
// порядка ключей в ответе PostgreSQL или HTTP.
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value,(_,v)=>
  v&&typeof v==='object'&&!Array.isArray(v)
    ?Object.fromEntries(Object.keys(v).sort().map(key=>[key,v[key]])):v
)).digest('hex');
function reviewFingerprint(finding,data,version) {
  const refs=new Set(), contracts=new Set(), accounts=new Set();
  for(const ref of finding.sources){
    if(ref.kind==='contract'||ref.kind==='income')contracts.add(ref.id);
    if(ref.contractId)contracts.add(ref.contractId);
    if(ref.kind==='account')accounts.add(ref.id);
    if(ref.kind==='expense')refs.add('expenses:'+ref.id);
  }
  for(const sale of data.sales||[])if(contracts.has(sale.id)){
    refs.add('sales:'+sale.id);refs.add('customers:'+sale.customerId);
    refs.add('accounts:'+sale.accountId);
    for(const f of sale.funding||[])refs.add('accounts:'+f.accountId);
  }
  for(const e of data.expenses||[])if(contracts.has(e.saleId)||[...contracts].some(id=>e.id===`exp_${id}`||e.id===`exp_sale_${id}`||String(e.id).startsWith(`exp_sale_${id}__`)))refs.add('expenses:'+e.id);
  for(const type of ['accounts','sales','expenses','retailSales','investors','stockMovements'])for(const row of data[type]||[]){
    const relevant=type==='accounts'?accounts.has(row.id):type==='investors'?(data.accounts||[]).some(a=>accounts.has(a.id)&&(a.ownerId===row.id||a.poolMemberIds?.includes(row.id)||a.partners?.includes(row.id))):accounts.has(row.accountId)||row.funding?.some(f=>accounts.has(f.accountId));
    if(relevant)refs.add(type+':'+row.id);
  }
  const rows=[];for(const [type,items]of Object.entries(data))if(Array.isArray(items))for(const row of items)if(refs.has(type+':'+row.id))rows.push([type,row.id,row]);
  rows.sort((a,b)=>(a[0]+':'+a[1]).localeCompare(b[0]+':'+b[1]));
  return hash([version,finding.code,finding.sources,finding.facts,finding.difference,rows]);
}
module.exports={reviewFingerprint,hash};
