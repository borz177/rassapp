const { test } = require('node:test');
const assert = require('node:assert/strict');
const { telegramMessages, publicationDate } = require('./telegramArchive');
const { draftFields, verifyDraft, withPublicationDate, messageDrafts, linkArchiveReasons } = require('./archiveImports');
const { defaultSelection } = require('./archiveSelection');

test('Telegram HTML preserves text and message dates without interpreting the archive', () => {
  const html = '<div class="message default" id="message42"><div class="date details" title="25.11.2026 15:30:04 UTC+05:00"></div>' +
    '<div class="text">Первая строка<br>Вторая &lt;img&gt;<style>SECRET</style><svg><text>HIDE</text></svg><a href="https://example.invalid">ссылка</a></div></div>';
  assert.deepEqual(telegramMessages(html), [{
    messageId:'42',position:1,text:'Первая строка\nВторая <img>ссылка',publishedAt:'2026-11-25T10:30:04.000Z',truncated:false,
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

test('separate people retain their own birth dates and reasons, and filter independently', () => {
  const message = { messageId:'50', publishedAt:'2024-01-02T10:00:00Z', text:[
    '[5.10, 22:49] Тестовый автор: Учебный Первый Примерович (01.02.1990)г. Причина: Длительная просрочка',
    '2. ФИО: Учебная Вторая Примеровна',
    '03,04,1991 г.р.',
    'Причина: Неисполнение обязательств',
    'ФИО: Учебный Третий Примерович',
    'Дата рождения: не указана',
    'Не давать ❌',
  ].join('\n') };
  const all = messageDrafts(message,'Тестовый источник',Date.now(),defaultSelection);
  assert.deepEqual(all.map(row=>[row.fields.name,row.fields.birthDate,row.fields.reason,row.message.part]),[
    ['Учебный Первый Примерович','01.02.1990','overdue',1],
    ['Учебная Вторая Примеровна','03.04.1991','unfulfilled',2],
    ['Учебный Третий Примерович','','other',3],
  ]);
  assert(all.every(row=>row.message.people===3 && row.message.stamp===message.publishedAt));
  assert(!all[0].message.text.includes('Вторая'));
  assert(!all[2].message.text.includes('Неисполнение'));
  const selected = messageDrafts(message,'Тестовый источник',Date.now(),{...defaultSelection,includeAny:['вторая'],reasons:['unfulfilled']});
  assert.equal(selected.length,1);
  assert.equal(selected[0].message.part,2);
});

test('one comment at the end applies to everyone, while individual reasons take priority', () => {
  const message = { messageId:'51', publishedAt:null,
    text:'Учебный Первый Примерович 01.02.1990; Учебная Вторая Примеровна 03.04.1991\nРассрочку не оплачивают' };
  const rows = messageDrafts(message,'Тестовый источник',Date.now(),defaultSelection);
  assert.deepEqual(rows.map(row=>row.fields.reason),['unfulfilled','unfulfilled']);
  assert.equal(rows[0].message.stamp,rows[1].message.stamp);
  const shared = messageDrafts({...message,text:message.text+'\nОбщая причина: Длительная просрочка'},'Тестовый источник',Date.now(),defaultSelection);
  assert.deepEqual(shared.map(row=>row.fields.reason),['overdue','unfulfilled']);
  assert.deepEqual(messageDrafts({...message,text:'Долг не оплатил 03.04.2024'},'Тестовый источник',Date.now(),defaultSelection),[]);
  const inline = messageDrafts({...message,text:'Учебный Первый Примерович 01.02.1990 3 месяца просрочки.    Учебная Вторая Примеровна 03.04.1991 не оплачивает.'},'Тестовый источник',Date.now(),defaultSelection);
  assert.deepEqual(inline.map(row=>[row.fields.birthDate,row.fields.reason,row.fields.reasonDetails]),[
    ['01.02.1990','other','Просрочка платежа'],['03.04.1991','unfulfilled',''],
  ]);
});

test('crosses are preserved as source marks and addresses do not become common reasons', () => {
  const message = { messageId:'53', publishedAt:'2024-01-02T10:00:00Z',
    text:'Учебный Первый Примерович 01.02.1990❌\nУчебная Вторая Примеровна 03.04.1991\nАдрес: Учебная улица' };
  const read = text => messageDrafts({...message,text},'Тестовый источник',Date.now(),defaultSelection);
  assert.deepEqual(read(message.text).map(row=>row.fields.reasonDetails),['❌','']);
  assert.deepEqual(read('❌ '+message.text.replace('1990❌','1990')).map(row=>row.fields.reasonDetails),['❌','']);
  assert.deepEqual(read(message.text.replace('1990❌','1990')+'\n❌❌').map(row=>row.fields.reasonDetails),['❌','❌']);
  assert.equal(verifyDraft(read(message.text)[0].fields).valid.reasonDetails,'❌');
  const common = read(message.text.replace('1990❌','1990')+'\nРассрочку не давать');
  assert.deepEqual(common.map(row=>row.fields.reasonDetails),['Не давать рассрочку','Не давать рассрочку']);
});

test('confirmed birth year and labelled dates stay with their person, and an individual reason overrides the common one', () => {
  const message = { messageId:'52', publishedAt:'2024-01-02T10:00:00Z', text:[
    'Покупатель: Учебный Первый Примерович 1990 г.р. не оплачивает.',
    'Учебная Вторая Примеровна, дата рождения: 03.04.1991',
    'ФИО: Учебный Третий Примерович',
    'Дата договора: 25.05.2023',
    'Д.р.: 05.06.1992',
    'Общая причина: Длительная просрочка',
  ].join('\n') };
  const rows = messageDrafts(message,'Тестовый источник',Date.now(),defaultSelection);
  assert.deepEqual(rows.map(row=>[row.fields.birthDate,row.fields.reason]),[
    ['1990','unfulfilled'],['03.04.1991','overdue'],['05.06.1992','overdue'],
  ]);
  assert.equal(verifyDraft(rows[0].fields).valid.birthYear,1990);
  assert.equal(verifyDraft(rows[0].fields).valid.birthDate,undefined);
});

test('birth dates with a space instead of a dot are normalized on the person card', () => {
  const message = { messageId:'54', publishedAt:'2024-01-02T10:00:00Z', text:[
    'Учебный Первый Примерович',
    '01.02 1990',
    '❌❌❌',
    'Учебная Вторая Примеровна 03 04.1991',
  ].join('\n') };
  const rows = messageDrafts(message,'Тестовый источник',Date.now(),defaultSelection);
  assert.deepEqual(rows.map(row=>[row.fields.birthDate,row.fields.reasonDetails]),[
    ['01.02.1990','❌'],['03.04.1991',''],
  ]);
});

const nameOne = 'Учебный Первый Примерович';
const nameTwo = 'Учебная Вторая Примеровна';
const message = (messageId, text, extra = {}) => ({
  messageId, text, publishedAt: '2024-01-02T10:00:00Z', truncated: false, ...extra,
});
const linkedDrafts = messages => {
  const people = linkArchiveReasons(messages);
  return messages.flatMap((item, index) => messageDrafts(item, 'Тестовый источник', Date.now(), defaultSelection, people[index]));
};

test('short comments remain verbatim and inline comments stay with their person', () => {
  for (const reason of ['не давать', 'Сложный клиент', 'Проблемная клиентка', 'Не давать ему']) {
    const [row] = messageDrafts(message('1', nameOne+' 01.02.1990\n'+reason), 'Тестовый источник', Date.now(), defaultSelection);
    assert.equal(row.fields.reasonDetails, reason);
  }
  const rows = messageDrafts(message('1', nameOne+' 01.02.1990 сложный клиент\n'+nameTwo+' 03.04.1991'), 'Тестовый источник', Date.now(), defaultSelection);
  assert.deepEqual(rows.map(row => row.fields.reasonDetails), ['сложный клиент', '']);
  assert.equal(linkedDrafts([message('1', nameOne), message('2', 'Не давать интервью', {replyTo:'1'})])[0].fields.reason, '');
});

test('Telegram extracts reply links, authors and joined continuation metadata', () => {
  const html = '<div class="message default" id="message1"><div class="from_name">Автор</div><div class="text">'+nameOne+'</div></div>'+
    '<div class="message default joined" id="message2"><div class="reply_to details"><a href="#go_to_message1">ответ</a></div><div class="text">не давать</div></div>';
  const rows = telegramMessages(html);
  assert.equal(rows[0].author, 'Автор');
  assert.equal(rows[1].author, 'Автор');
  assert.equal(rows[1].replyTo, '1');
  assert.equal(rows[1].position, 2);
  assert.equal(linkedDrafts(rows)[0].fields.reasonDetails, 'не давать');
});

test('explicit replies attach only to an unambiguous person and preserve their source', () => {
  const rows = linkedDrafts([message('1', nameOne), message('2', nameTwo), message('3', 'сложный клиент', {replyTo:'1'})]);
  assert.deepEqual(rows.map(row => row.fields.reasonDetails), ['сложный клиент','']);
  assert.equal(rows[0].reasonMessage.messageId, '3');
  assert.equal(rows[0].reasonMessage.kind, 'reply');
  assert.equal(rows[0].message.text, nameOne);
  const ambiguous = linkedDrafts([message('1', nameOne+'\n'+nameTwo), message('2', 'не давать', {replyTo:'1'})]);
  assert.deepEqual(ambiguous.map(row => row.fields.reasonDetails), ['','']);
  const named = linkedDrafts([message('1', nameOne+'\n'+nameTwo), message('2', nameTwo+' — сложный клиент', {replyTo:'1'})]);
  assert.deepEqual(named.map(row => row.fields.reasonDetails), ['', 'сложный клиент']);
});

test('adjacent comments need the same author, consecutive messages and a short time gap', () => {
  const source = message('1', nameOne, {author:'Автор',position:1});
  const comment = message('2','не давать',{author:'Автор',position:2});
  assert.equal(linkedDrafts([source,comment])[0].fields.reasonDetails, 'не давать');
  for(const patch of [{author:'Другой'}, {author:undefined}, {position:3}, {publishedAt:'2024-01-02T10:06:00Z'}, {replyTo:'99'}, {truncated:true}]) {
    assert.equal(linkedDrafts([source,{...comment,...patch}])[0].fields.reasonDetails, '');
  }
});

test('conflicting replies and existing reasons are protected against silent replacement', () => {
  const conflict = linkedDrafts([message('1', nameOne),message('2','не давать',{replyTo:'1'}),message('3','сложный клиент',{replyTo:'1'})]);
  assert.equal(conflict[0].fields.reasonDetails, '');
  const existing = linkedDrafts([message('1', nameOne+' 01.02.1990\nПричина: своя причина'),message('2','не давать',{replyTo:'1'})]);
  assert.equal(existing[0].fields.reasonDetails,'своя причина');
});

test('conversational reasons retain both lines and stay with their person', () => {
  const reason = 'Я больше не дам\nВсе время какие-то проблемы';
  const rows = messageDrafts(message('1', nameOne+' 1990 г.р.\n'+reason+'\n'+nameTwo+' 03.04.1991'),
    'Тестовый источник',Date.now(),defaultSelection);
  assert.deepEqual(rows.map(row=>row.fields.reasonDetails),[reason,'']);
  assert.equal(rows[0].fields.birthDate,'1990');
  for(const text of ['Я больше не дам, всё время какие-то проблемы','С ним постоянно проблемы','Ему больше не дам','Не дам','Постоянно какие то проблемы']) {
    const [row] = linkedDrafts([message('1',nameOne),message('2',text,{replyTo:'1'})]);
    assert.equal(row.fields.reasonDetails,text);
  }
  assert.equal(linkedDrafts([message('1',nameOne),message('2',reason,{replyTo:'1'})])[0].fields.reasonDetails,reason);
  for(const text of ['Я больше дам','Я больше не дам интервью','Все время какие-то проблемы с сайтом']) {
    assert.equal(linkedDrafts([message('1',nameOne),message('2',text,{replyTo:'1'})])[0].fields.reasonDetails,'');
  }
});

test('frequent payment comments stay verbatim while unrelated phrases stay empty', () => {
  const reasons=['Не давайте','Ему не давайте','Не выдавайте ей','Не рекомендую давать рассрочку',
    'Трудный клиент','Тяжелая клиентка','Не берёт трубку','Трубку не берет','Платит с задержками',
    'Оплачивает с опозданием','Задерживает оплату','Кормит обещаниями','Обещает, но не платит',
    'Еле забрали деньги','С трудом вернул долг'];
  for(const reason of reasons) {
    const [row]=messageDrafts(message('1',nameOne+' 01.02.1990\n'+reason),'Тестовый источник',Date.now(),defaultSelection);
    assert.equal(row.fields.reasonDetails,reason,reason);
    const [reply]=linkedDrafts([message('1',nameOne),message('2',reason,{replyTo:'1'})]);
    assert.equal(reply.fields.reasonDetails,reason,reason);
  }
  for(const text of ['Не задерживает оплату','Платит без задержек','Не кормит обещаниями','Не рекомендую этот сайт','Трубку починили']) {
    assert.equal(linkedDrafts([message('1',nameOne),message('2',text,{replyTo:'1'})])[0].fields.reason,'',text);
  }
  const combined='Трубку не берет\nКормит обещаниями';
  assert.equal(linkedDrafts([message('1',nameOne),message('2',combined,{replyTo:'1'})])[0].fields.reasonDetails,combined);
});

test('messages6 wording variants remain readable and unrelated phrases are excluded', () => {
  const variants=['Ничего не давать','Нечего не давать','Вообще не давать','Пока ничего не давать',
    'Категорически ничего не давать','Никогда не давать','Не давать ничего','Не давать вообще',
    'Проблемные','Очень проблемные','Неплатежеспособный','Неплатёжеспособная','В просрочке','Просрочки'];
  for(const text of variants) {
    const [row]=messageDrafts(message('1',nameOne+' 1990 г.р.\n'+text),'Тестовый источник',Date.now(),defaultSelection);
    assert.equal(row.fields.reasonDetails,text,text);
    assert.equal(row.fields.birthDate,'1990');
    assert.equal(linkedDrafts([message('1',nameOne),message('2',text,{replyTo:'1'})])[0].fields.reasonDetails,text);
  }
  for(const text of ['Не проблемный клиент','Проблемные вопросы решили','Ничего страшного','В просрочке нет','Проблемные вопросы']) {
    assert.equal(linkedDrafts([message('1',nameOne),message('2',text,{replyTo:'1'})])[0].fields.reason,'');
  }
});
