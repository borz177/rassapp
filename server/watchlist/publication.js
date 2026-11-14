// Продление только действующих публикаций. Удалённые/отозванные/истёкшие
// записи не восстанавливаем и независимый журнал отзыва не изменяем.
async function keepActivePublications(db, actor, revokedIds = []) {
  const result = await db.query(`UPDATE client_watchlist_entries SET expires_at=NULL,version=version+1,updated_at=now()
    WHERE status IN ('published','hidden') AND deleted_at IS NULL AND expires_at>now()
      AND NOT(id=ANY($1::text[])) RETURNING id`, [revokedIds]);
  if(result.rows.length) await db.query(`INSERT INTO client_watchlist_events(actor_id,action,target_id)
    SELECT $1,'PUBLICATION_TERM_REMOVED',unnest($2::text[])`,[actor,result.rows.map(r=>r.id)]);
  return result.rows.length;
}
module.exports = {keepActivePublications};
