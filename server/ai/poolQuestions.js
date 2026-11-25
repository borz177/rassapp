// Ответы по общему пулу из того же расчёта, который использует касса.
const { createPoolService } = require('../pools/service');
const { addMonthsDay, mskDay, namedCalendarMonth } = require('./collections');
const profitModule = import('../../shared/profit.js');
const fundingModule = import('../../shared/funding.js');

const inPool = '(?:в общем пуле|по общему пулу|общего пула|в общей кассе|по общей кассе)';
const monthProfit = new RegExp('^(?:(?:покажи(?:те)?|скажи(?:те)?|какая|сколько)\\s+)?(?:начислено|прибыль(?: инвесторов)?|сколько (?:получили|заработали) инвесторы)\\s+' + inPool + '(?:\\s+за\\s+(.+))?$', 'iu');
const migration = new RegExp('^(?:(?:покажи(?:те)?|сделай(?:те)?)\\s+)?(?:предпросмотр|сравнение|сравни(?:те)?)\\s+(?:перехода?|пересч[её]та?|прибыль до и после перехода)\\s+' + inPool + '(?:\\s+на месячный уч[её]т)?$', 'iu');
const migrationQuestion = /^(?:(?:что изменится|как изменится прибыль|сколько будет),?\s+если\s+перейти на месячный уч[её]т|что мешает перейти на месячный уч[её]т)\s+в общем пуле$/iu;
const basisQuestion = new RegExp('^(?:как (?:считается|распределяется) прибыль|почему (?:у инвесторов )?(?:разная прибыль|отличается прибыль))\\s+' + inPool + '$', 'iu');
const monthLabel = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'Europe/Moscow' });
const dayLabel = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow' });
const amount = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const money = value => `${amount.format(value)} ₽`;
const normalize = s => String(s || '').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/gu, ' ');
const lines = (rows, format) => [
  ...rows.slice(0, 12).map(format),
  ...(rows.length > 12 ? [`Ещё ${rows.length - 12} участников в окне «Учёт общего пула».`] : []),
].join('\n');

function poolQuestionIntent({ text, image, images, audio, auditReportId, channel = 'app' } = {}, today = mskDay()) {
  if (channel !== 'app' || image || images?.length || audio || auditReportId || typeof text !== 'string') return null;
  const raw = text.trim().replace(/[.?!]+$/u, '').trim();
  if (raw.length > 240 || /[\r\n;]|[.!?]\s+\p{L}/u.test(raw)) return null;
  const scope = raw.match(/\s+по\s+сч[её]ту\s+(?:[«„]([^»“]{1,100})[»“]|"([^"]{1,100})"|([^"«»„“]{1,100}))$/iu);
  const question = scope ? raw.slice(0, scope.index) : raw;
  const account = (scope?.[1] || scope?.[2] || scope?.[3])?.trim();
  if (scope && !account) return null;
  if (scope?.[3] && /\sи\s+(?:добавь|запиши|отправь|удали|переведи|исправь|оплати)/iu.test(account)) return null;
  if (migration.test(question) || migrationQuestion.test(question)) return { kind: 'migration', account };
  if (basisQuestion.test(question)) return { kind: 'basis', account };
  const match = question.match(monthProfit);
  if (!match) return null;
  const period = normalize(match[1]);
  let month;
  if (!period || /^(?:этот|текущий) месяц$/u.test(period)) month = today.slice(0, 7);
  else if (/^(?:прошлый|предыдущий) месяц$/u.test(period)) month = addMonthsDay(today, -1).slice(0, 7);
  else if (/^20\d{2}-(0[1-9]|1[0-2])$/u.test(period)) month = period;
  else month = namedCalendarMonth(period, today, 'past');
  return month ? { kind: 'profit', month, account } : null;
}

async function answerPoolQuestion(pool, userId, intent, now = Date.now()) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await db.query("SET LOCAL statement_timeout='15s'");
    const result = await readPool(db, userId, intent, now);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    db.release();
  }
}

async function readPool(db, userId, intent, now) {
  const [P, F] = await Promise.all([profitModule, fundingModule]);
  // Предпросмотр получает тот же снимок. Он не может фиксировать месяцы через это подключение.
  const service = createPoolService({ pool: { query: db.query.bind(db) }, now: () => now });
  const data = await service.load(db, userId);
  const pools = data.accounts.filter(a => a.type === 'POOL' && !a.isArchived);
  if (!pools.length) return 'У вас нет активного общего пула.';
  const accountName = normalize(intent.account);
  const exact = accountName ? pools.filter(a => normalize(a.name) === accountName) : [];
  const candidates = exact.length ? exact : pools.filter(a => normalize(a.name).includes(accountName));
  if (!candidates.length) return 'Общий пул с таким названием не найден. Проверьте название счёта.';
  if (candidates.length > 1) return `Уточните счёт. Доступные пулы: ${candidates.slice(0, 5).map(a => `«${a.name}»`).join(', ')}. Например, «Прибыль в общем пуле по счёту „${candidates[0].name}“».`;
  const account = candidates[0];
  const name = `«${account.name}»`;
  const monthly = P.isMonthlyPool(account);
  const current = P.poolMonth(now);
  const scheduled = monthly && account.poolAccounting.startMonth > current;
  if (intent.kind === 'migration') {
    if (scheduled) return `${name} перейдёт на месячный учёт с ${account.poolAccounting.startMonth}. До этой даты действует прежний расчёт.`;
    if (monthly) return `${name} уже на месячном учёте с ${account.poolAccounting.startMonth}. Текущий месяц рассчитывается автоматически.`;
    const { comparison, historicalContracts } = await service.preview(userId, account.id, { history: true });
    const investors = comparison.rows.filter(row => row.id !== '__manager__');
    const personalCount = historicalContracts.filter(contract => contract.previouslyPersonal).length;
    const capitalIssues = comparison.capitalIssues.slice(0, 5).map(row => {
      const operation = row.type === 'deposit' ? 'внесение' : 'возврат';
      return `${row.investor.trim()} — ${operation} ${money(row.amount)} от ${dayLabel.format(new Date(P.poolTime(row.date)))}.`;
    });
    return [
      `${name} · предварительное сравнение с ${comparison.startMonth} по ${comparison.month}. Начислено после общих расходов, до выплат.`,
      lines(investors, row => `${row.name.trim()}: ${money(row.current)} → ${money(row.proposed)}`) || 'Участники пула отсутствуют.',
      personalCount ? `Личными остаются договоры, которые так определены в учёте: ${personalCount}.` : '',
      comparison.issues.length ? `Полный перенос пока заблокирован. ${comparison.issues.slice(0, 6).join(' ')}${comparison.issues.length > 6 ? ' Остальные замечания есть в окне пула.' : ''}` : 'Проверка истории прошла. Сравнение можно открыть в кассе, в разделе «Учёт общего пула».',
      capitalIssues.length ? `Сверьте эти операции с историей капитала инвестора:\n${capitalIssues.join('\n')}${comparison.capitalIssues.length > 5 ? '\nПоказаны пять последних записей, требующих сверки.' : ''}` : '',
    ].filter(Boolean).join('\n\n');
  }
  if (intent.kind === 'basis') {
    if (!monthly) return `${name} использует прежнюю схему: доли определяются по периоду графика и участию инвестора. Чтобы увидеть разницу при переходе, спросите «Сравни переход в общем пуле».`;
    if (scheduled) return `${name} пока использует прежний расчёт по периоду графика. Месячный учёт начнётся с ${account.poolAccounting.startMonth}.`;
    const config = account.poolAccounting;
    const basis = P.poolProfitBasis(account, now) === 'MONTH' ? 'в пределах месяца планового взноса' : 'за полный период между датами графика';
    return `${name} · месячный учёт с ${config.startMonth}. Поступления входят в месяц оплаты. Для долей считаются капитал, время участия и согласованный процент ${basis}. Поэтому одинаковые вложения могут давать разную прибыль, если даты участия или условия различаются. Из общей прибыли вычитаются расходы пула.`;
  }
  const { month } = intent;
  if (month > current) return 'Фактической прибыли за будущий месяц ещё нет. Можно отдельно спросить прогноз.';
  const title = `${name} · ${monthLabel.format(new Date(`${month}-15T12:00:00Z`))}`;
  const members = data.investors.filter(i => account.poolMemberIds?.includes(i.id));
  if (monthly && month >= account.poolAccounting.startMonth) {
    const report = (await service.reports(data, account, now)).find(r => r.month === month);
    if (!report) return `${title}. Расчёт за этот месяц недоступен.`;
    const names = new Map(members.map(i => [i.id, i.name.trim()]));
    const recipients = report.allocations.filter(row => row.id !== '__manager__');
    const carry = report.carryIn > 0 ? ` Покрытие прошлого убытка — ${money(Math.min(report.carryIn, Math.max(0, report.net + report.carryIn)))}.` : '';
    return [
      `${title}. ${report.status === 'CLOSED' ? 'Месяц зафиксирован.' : 'Предварительный расчёт по сохранённым данным.'}`,
      `Прибыль по оплатам — ${money(report.gross)}. Общие расходы — ${money(report.costs)}.${carry}`,
      recipients.length ? `Начислено инвесторам:\n${lines(recipients, row => `${names.get(row.id) || 'Участник'} — ${money(row.amount)}`)}` : 'Начислений инвесторам за этот месяц нет.',
      ...(report.unallocated > 0 ? [`Осталось распределить ${money(report.unallocated)}. Проверьте данные о капитале.`] : []),
      ...report.issues.slice(0, 5),
    ].join('\n\n');
  }
  const sales = F.expandFundedSales(data.sales);
  const period = P.poolMonthStart(month), end = Math.min(now, P.poolMonthStart(P.nextPoolMonth(month)) - 1);
  const legacy = members.map(i => ({
    name: i.name.trim(),
    total: P.investorProfitAccruals(account, data.investors, sales, i.id, !!data.settings[0]?.profitFromPaymentsOnly, [], now)
      .filter(row => !row.poolMonth && P.poolTime(row.date) >= period && P.poolTime(row.date) <= end)
      .reduce((sum, row) => sum + row.amount, 0),
  }));
  return `${title}. Прежняя схема, начислено инвесторам до общих расходов и выплат.\n\n${lines(legacy, row => `${row.name} — ${money(row.total)}`) || 'Участники пула отсутствуют.'}`;
}

module.exports = { poolQuestionIntent, answerPoolQuestion };
