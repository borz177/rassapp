const { test } = require('node:test');
const assert = require('node:assert/strict');
const { telegramMessages, publicationDate } = require('./telegramArchive');
const { draftFields, verifyDraft, withPublicationDate } = require('./archiveImports');

test('Telegram HTML preserves text and message dates without interpreting the archive', () => {
  const html = '<div class="message default" id="message42"><div class="date details" title="25.11.2026 15:30:04 UTC+05:00"></div>' +
    '<div class="text">Первая строка<br>Вторая &lt;img&gt;<style>SECRET</style><svg><text>HIDE</text></svg><a href="https://example.invalid">ссылка</a></div></div>';
  assert.deepEqual(telegramMessages(html), [{
    messageId:'42',text:'Первая строка\nВторая <img>ссылка',publishedAt:'2026-11-25T10:30:04.000Z',truncated:false,
  }]);
  assert.throws(()=>telegramMessages('<p>Обычный HTML</p>'),/NO_MESSAGES/);
  assert.equal(publicationDate('31.02.2026 10:00'),null);
  assert.equal(publicationDate('25.11.2026 24:00'),null);
  assert.equal(publicationDate('25.11.2026 12:30'),'2026-11-25T09:30:00.000Z');
  assert.equal(publicationDate('5 октября 2023, 22:49:20'),'2023-10-05T19:49:20.000Z');
  assert.equal(publicationDate('29 февраля 2024, 10:00:00 UTC+05:00'),'2024-02-29T05:00:00.000Z');
  assert.equal(publicationDate('29 февраля 2023, 10:00:00'),null);
});

test('birth date is optional, while explicit dates, reason and source are validated', () => {
  const good = { name:'Тестовый Синтетический Клиент',birthDate:'29.02.2000',reason:'other',reasonDetails:'Причина для теста',
    source:'Синтетический источник',publishedAt:'2020-01-01T12:30:00+03:00' };
  const result=verifyDraft(draftFields(good));
  assert.deepEqual(result.errors,[]);
  assert.equal(result.valid.birthDate,'2000-02-29');
  assert.equal(verifyDraft(draftFields({...good,birthDate:'2000'})).valid.birthYear,2000);
  const missing = verifyDraft(draftFields({...good,birthDate:''}));
  assert.deepEqual(missing.errors,[]);
  assert.equal(missing.valid.birthYear,null);
  assert.match(verifyDraft(draftFields({...good,birthDate:'30.02.2000'})).errors[0],/дату рождения/);
  assert(verifyDraft(draftFields({...good,publishedAt:'9999-01-01T10:00:00Z',reason:'unknown'})).errors.length===2);
  const withoutPublication = { fields: draftFields({...good,publishedAt:''}), message:{ publishedAt:null } };
  const completed = withPublicationDate(withoutPublication, '2026-11-25T12:30:00+03:00');
  assert.equal(completed.fields.publishedAt,'2026-11-25T09:30:00.000Z');
  assert.equal(completed.dateFromImport,true);
  assert.equal(completed.message.publishedAt,null);
});

test('large archive is parsed in slices and reports progress', () => {
  const progress = [];
  const html = Array.from({length:3500}, (_, index) =>
    `<div id="message${index+1}" class="message default"><div class="text">${'А'.repeat(950)} &amp; ${index}</div></div>`).join('');
  const messages = telegramMessages(html, value=>progress.push(value));
  assert.equal(messages.length,3500);
  assert.match(messages[3499].text,/& 3499$/u);
  assert(progress.length>10 && progress[0] < 85);
  assert.equal(progress.at(-1),85);
});
