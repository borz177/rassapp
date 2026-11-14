// Статус действия определяется карточками сервера, а не словами модели.
const actionState = actions => {
  const states = [];
  const has = kind => actions.some(a => a.kind === kind);
  if (has('confirm')) states.push('Действие подготовлено — проверьте карточку и нажмите «Подтвердить». Пока оно не выполнено.');
  if (has('contract_form')) states.push('Черновик договора готов — откройте форму, проверьте и сохраните. Договор ещё не оформлен.');
  if (has('send_doc')) states.push('Документ подготовлен к отправке. Результат отправки появится в карточке.');
  if (has('template_draft')) states.push('Шаблон подготовлен — проверьте и сохраните его в карточке.');
  if (has('reschedule')) states.push('Изменение графика подготовлено — проверьте карточку перед применением.');
  if (has('delete_contract')) states.push('Удаление договора подготовлено — проверьте карточку перед подтверждением. Договор пока не удалён.');
  if (has('report') || has('customers_report')) states.push('Отчёт подготовлен — откройте файл в карточке.');
  if (actions.some(a => a.kind === 'done' && a.ok === true)) states.push('Действие выполнено. Результат — в карточке.');
  if (actions.some(a => a.kind === 'done' && a.ok !== true)) states.push('Часть действий не выполнена. Причина — в карточке.');
  return states.join('\n');
};
const guardActionReply = ({ text, actions, claimsDone, promisesAction, hasPastActions = false }) => {
  const state = actionState(actions);
  const pending = actions.some(a => ['confirm','contract_form','send_doc','template_draft','reschedule','delete_contract'].includes(a.kind));
  const done = actions.some(a => a.kind === 'done' && a.ok === true);
  if ((claimsDone && (pending || (state && !done))) || (!text.trim() && state)) return { text: state, replaced: true, verified: true };
  if ((claimsDone || promisesAction) && !state && !hasPastActions) return { text: 'Действие не подготовлено и не выполнено. Уточните, что нужно сделать.', replaced: true, verified: false };
  if (claimsDone && actions.some(a => a.kind === 'done' && a.ok !== true) && !done) return { text: state, replaced: true, verified: true };
  return { text, replaced: false, verified: !!state || (!claimsDone && !promisesAction) };
};

// Только явный вопрос владельца о своих вложениях без названного периода/счёта.
// Не перехватываем инвестора, расчёт прибыли, прогноз и «сколько вложил Хасан».
const isOwnerInvestmentQuestion = text => {
  const s = String(text || '').toLowerCase().replace(/ё/g,'е');
  return s.length <= 150 && /(?:^|\s)я\s+(?:всего\s+)?(?:вложил|вложила|инвестировал|инвестировала)|мо[ииеёя]+\s+(?:личные\s+|собственные\s+)?вложен|сколько\s+(?:своих|личных)\s+(?:денег|средств)/.test(s)
    && !/инвестор|прибыл|через|завтра|вчера|месяц|недел|\d{4}|счет|касс|период|прошл|будущ|с начала|за год|сегодня|в этом/.test(s);
};
module.exports = { actionState, guardActionReply, isOwnerInvestmentQuestion };
