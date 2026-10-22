// Операции, которые завершает приложение (PDF/форма), имеют отдельную квитанцию.
// Потерянный ответ не разрешает автоматически повторять отправку или создание.
const kinds = new Set(['contract_form','send_doc','delete_contract','reschedule']);
const createClientActions = pool => {
  let initialized;
  const ready = () => initialized ||= pool.query(`CREATE TABLE IF NOT EXISTS ai_client_actions(
    id TEXT PRIMARY KEY,user_id TEXT NOT NULL,kind TEXT NOT NULL,payload JSONB NOT NULL,status TEXT NOT NULL,
    result JSONB,created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW())`);
  const claim = async (userId,id) => {
    await ready();
    const previous = (await pool.query('SELECT status,result FROM ai_client_actions WHERE id=$1 AND user_id=$2',[id,userId])).rows[0];
    if (previous) return { claimed:false, result:previous.result || { ok:false,text:'Операция уже начата. Проверьте результат в приложении перед повтором.' } };
    const action = (await pool.query(`SELECT a AS action FROM ai_turns t CROSS JOIN LATERAL jsonb_array_elements(t.result->'actions') a
      WHERE t.user_id=$1 AND a->>'id'=$2 AND t.created_at>NOW()-INTERVAL '15 minutes' LIMIT 1`,[userId,id])).rows[0]?.action;
    if (!action || !kinds.has(action.kind)) throw new Error('Действие устарело. Подготовьте его заново.');
    const inserted = await pool.query("INSERT INTO ai_client_actions(id,user_id,kind,payload,status) VALUES($1,$2,$3,$4,'running') ON CONFLICT DO NOTHING RETURNING id",[id,userId,action.kind,JSON.stringify(action)]);
    return { claimed:!!inserted.rowCount, ...(!inserted.rowCount ? { result:{ok:false,text:'Действие уже выполняется на другом устройстве.'} } : {}) };
  };
  const finish = async (userId,id,input) => {
    await ready();
    const row = (await pool.query("SELECT * FROM ai_client_actions WHERE id=$1 AND user_id=$2 AND status='running'",[id,userId])).rows[0];
    if (!row) return;
    const result = { ok:input?.ok === true,text:String(input?.text || '').slice(0,1000) };
    if (row.kind === 'contract_form' && result.ok) {
      const sale = (await pool.query("SELECT data FROM data_items WHERE user_id=$1 AND type='sales' AND id=$2",[userId,String(input.saleId || '')])).rows[0]?.data;
      if (!sale) { result.ok=false; result.text='Договор пока не подтверждён сервером. Проверьте синхронизацию в приложении перед повтором.'; }
      else Object.assign(result,{saleId:sale.id,customerId:sale.customerId,number:sale.contractNumber,total:sale.totalAmount,monthly:input.monthly});
    }
    await pool.query('UPDATE ai_client_actions SET status=$3,result=$4,updated_at=NOW() WHERE id=$1 AND user_id=$2 AND status=\'running\'',[id,userId,result.ok?'done':'uncertain',JSON.stringify(result)]);
    return result;
  };
  const list = async userId => { await ready(); return (await pool.query('SELECT * FROM ai_client_actions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',[userId])).rows; };
  return { ready,claim,finish,list };
};
module.exports = { createClientActions };
