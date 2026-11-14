// Сигнал — наблюдение сервера, а не доказательство неверной записи денег.
const KIND_LABELS = {
  undo_soon: 'Пользователь отменил действие',
  stop: 'Пользователь остановил ответ',
  honesty_fix: 'Проверка обещанного действия',
  tool_error: 'Ошибка выполнения',
  request_error: 'Запрос не завершён',
  model_fallback: 'Переход на запасную модель',
  empty_reply: 'Модель вернула пустой ответ',
  tool_rounds_exhausted: 'Достигнут предел шагов',
  ungrounded_number: 'Суммы требуют проверки',
  ungrounded_after_retry: 'Повторная проверка сумм не помогла',
  ungrounded_action: 'Действие не подтверждено результатом',
  tech_words: 'Технические названия в ответе',
  cant_do: 'Запрошено новое умение',
  guard_payment_kind: 'Проверен вид платежа: план или факт',
  guard_payoff: 'Уточнена сумма платежа',
  guard_bad_customer: 'Проверка клиента перед записью',
  guard_lookalike: 'Найден похожий клиент',
  guard_months_unsaid: 'Запрошен срок рассрочки',
  guard_amount_choices: 'Предложен выбор суммы',
  guard_bad_contract: 'Проверка договора перед записью',
  guard_buy_price: 'Уточнена сумма закупа',
  guard_guarantor_draft: 'Проверка поручителя в черновике',
  guard_markup_unsaid: 'Запрошена наценка',
  guard_own_text: 'Запрошен текст сообщения',
  guard_single_choice: 'Убран лишний выбор',
  guard_write_off_reason: 'Запрошена причина списания',
  guard_wrong_person: 'Уточнено, кто клиент и поручитель',
};
const qualityGroup = kind => kind === 'cant_do' ? 'wish'
  : kind === 'stop' || kind === 'undo_soon' ? 'user'
    : kind.startsWith('guard_') ? 'guard' : 'quality';
const KIND_GROUPS = Object.fromEntries(Object.keys(KIND_LABELS).map(k => [k, qualityGroup(k)]));
module.exports = { KIND_LABELS, KIND_GROUPS, qualityGroup };
