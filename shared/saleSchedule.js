// Только узнаваемый сбой старого достраивания. Денежные поступления не меняются.
export const isRebuiltSlot = p => String(p.id || '').startsWith('pay_reconcile_');
export function alignRebuiltAmounts(rows, installments, totalDue, discounts = 0) {
  if (!Number.isInteger(installments) || installments < 1 || !Number.isFinite(totalDue) || totalDue < 0 ||
    rows.length !== installments || rows.some(p => p.isRealPayment !== false || !Number.isFinite(p.amount) || p.amount < 0)) return rows;
  const rebuilt = rows.filter(isRebuiltSlot), original = rows.filter(p => !isRebuiltSlot(p));
  if (!rebuilt.length || !original.length) return rows;
  const sum = rows.reduce((n,p) => n+p.amount,0);
  if (Math.abs(sum-totalDue)<=0.011 || Math.abs(sum-Math.max(0,totalDue-discounts))<=0.011) return rows;
  const monthly = Math.round(totalDue/installments*100)/100;
  if (original.some(p=>Math.abs(p.amount-original[0].amount)>0.011) || rebuilt.some(p=>Math.abs(p.amount-monthly)>0.011)) return rows;
  const cents = Math.round(totalDue*100), base = Math.floor(cents/installments);
  return rows.map((p,i)=>({...p,amount:(i===rows.length-1?cents-base*(installments-1):base)/100}));
}

/** Узкое исправление полного графика. Возвращает null, если безопасная
 * правка не доказана. Сохраняет все остальные поля, порядок и реальные оплаты. */
export function repairRebuiltSchedule(sale) {
  if (sale.type!=='INSTALLMENT' || !Array.isArray(sale.paymentPlan)) return null;
  const total=Number(sale.totalAmount),down=Number(sale.downPayment||0);
  if (!Number.isFinite(total)||!Number.isFinite(down)||total<=0||down<0||down>total ||
    sale.paymentPlan.some(p=>!p||typeof p.id!=='string'||!p.id||!Number.isFinite(Date.parse(p.date)))) return null;
  const rows = sale.paymentPlan.filter(p=>p.isRealPayment!==true).slice().sort((a,b)=>new Date(a.date)-new Date(b.date));
  const paid = sale.paymentPlan.filter(p=>p.isPaid && p.isRealPayment!==false);
  if (paid.some(p=>!Number.isFinite(p.amount)||p.amount<0||!Number.isFinite(Number(p.discountAmount||0))||Number(p.discountAmount||0)<0)) return null;
  const discounts = paid.reduce((n,p)=>n+Number(p.discountAmount||0),0);
  const due = total-down;
  if (paid.reduce((n,p)=>n+p.amount,0)+discounts>due+0.011) return null;
  const remaining = Math.max(0,Math.round((due-paid.reduce((n,p)=>n+p.amount,0)-discounts)*100)/100);
  if (!Number.isFinite(sale.remainingAmount) || Math.abs(remaining-sale.remainingAmount)>0.011 ||
    new Set(sale.paymentPlan.map(p=>p.id)).size!==sale.paymentPlan.length) return null;
  const aligned = alignRebuiltAmounts(rows,Number(sale.installments),due,discounts);
  if (aligned===rows) return null;
  let surplus=paid.reduce((n,p)=>n+p.amount,0)+discounts;
  const byId=new Map(aligned.map(p=>{const covered=surplus>=p.amount-0.01;if(covered)surplus=Math.max(0,surplus-p.amount);return[p.id,{...p,isPaid:covered}];}));
  return {...sale,paymentPlan:sale.paymentPlan.map(p=>byId.get(p.id)||p)};
}
