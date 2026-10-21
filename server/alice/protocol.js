const crypto = require('crypto');

const normalize = text => String(text || '').toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const isPoll = text => /^(готово|готов|готово ли|проверь результат|результат|что получилось|дальше|продолжай)$/.test(normalize(text));
const isExit = text => /^(выход|выйти|хватит|закрой навык|стоп)$/.test(normalize(text));
const sessionKey = body => crypto.createHash('sha256').update(JSON.stringify([
  body.session.skill_id, body.session.session_id, body.session.user?.user_id || body.session.application?.application_id,
])).digest('hex');
const say = (text, end = false) => ({ version: '1.0', response: { text: String(text).slice(0, 1024), end_session: end } });
const linkAccount = body => body.meta?.interfaces?.account_linking
  ? { version: '1.0', start_account_linking: {} }
  : say('Для подключения FinUchet откройте этот навык в приложении Яндекс на телефоне и войдите в свой аккаунт.');

const validRequest = (body, skillId) => !!body && body.version === '1.0'
  && body.session?.skill_id === skillId
  && typeof body.session.session_id === 'string' && body.session.session_id.length <= 64
  && Number.isSafeInteger(body.session.message_id) && body.session.message_id >= 0
  && body.session.message_id <= 99999999
  && (body.account_linking_complete_event || body.request?.type === 'SimpleUtterance' || body.request?.type === 'ButtonPressed')
  && (body.request?.command == null || (typeof body.request.command === 'string' && body.request.command.length <= 4000));

const speech = result => {
  let text = String(result?.reply || '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '').replace(/[*#`_]/g, '').trim();
  const actions = result?.actions || [];
  const choices = actions.filter(a => a.kind === 'choices').flatMap(a => a.options || []).slice(0, 6);
  if (choices.length) text += ` Варианты: ${choices.map((o, i) => `${i + 1}. ${o.label}`).join('; ')}. Назовите вариант или его номер.`;
  const prepared = actions.some(a => ['confirm', 'contract_form', 'send_doc', 'delete_contract', 'report', 'open_view'].includes(a.kind));
  if (prepared) {
    // Модель могла попросить нажать кнопку: на колонке кнопки приложения нет.
    text = text.replace(/[^.!?\n]*(?:нажмите|нажми|под ответом|подтвердите|откройте форму)[^.!?\n]*[.!?]?/gi, '').trim();
    text = `${text.slice(0, 650)} Подготовленный результат доступен в чате ИИ в FinUchet. Откройте приложение, проверьте и подтвердите действие там. С колонки ничего не проводится.`;
  }
  if (text.length > 1000) text = `${text.slice(0, 880).replace(/\s+\S*$/, '')} Полный ответ есть в чате ИИ в FinUchet.`;
  return text || 'Ответ доступен в чате ИИ в FinUchet.';
};

// Голосовой выбор берёт ref только из последнего настоящего результата агента.
const choiceText = (text, result) => {
  const options = (result?.actions || []).filter(a => a.kind === 'choices').flatMap(a => a.options || []);
  const n = normalize(text);
  const numbers = ['первый', 'второй', 'третий', 'четвертый', 'пятый', 'шестой'];
  const byNumber = /^\d$/.test(n) ? Number(n) - 1 : numbers.indexOf(n.replace(/ вариант$/, ''));
  const found = byNumber >= 0 ? options[byNumber] : options.find(o => normalize(o.label) === n);
  return found ? `${found.label} [${found.ref}]` : text;
};

module.exports = { normalize, isPoll, isExit, sessionKey, say, linkAccount, validRequest, speech, choiceText };
