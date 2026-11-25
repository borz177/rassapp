// Узкие запросы к сверке отвечают по отчёту, без передачи данных модели.
const investorCodes = new Set(['deposit_investor', 'payout_investor', 'historical_investor_return']);
const money = value => `${value.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`;

function localAuditIntent({ text, image, images, audio, channel = 'app', auditReportId } = {}) {
  if (channel !== 'app' || image || images?.length || audio) return null;
  const question = String(text || '').trim();
  if (!question || question.length > 220 || /[.!?]\s+\p{L}/u.test(question) && !auditReportId) return null;
  if (auditReportId) return /^объясни(?:те)? эту проверку уч[её]та\s*:/iu.test(question) ? { kind: 'summary' } : null;
  const textOnly = question.replace(/[?!.,:]+$/u, '').trim();
  const scope = textOnly.match(/\s+по\s+сч[её]ту\s+(.{1,100})$/iu);
  const subject = scope ? textOnly.slice(0, scope.index) : textOnly;
  const account = scope?.[1].trim().replace(/^[«"]|[»"]$/gu, '');
  if (account && /\sи\s+(?:добавь|запиши|отправь|удали|переведи|исправь)(?!\p{L})/iu.test(account)) return null;
  if (/^(?:(?:что значит|почему|откуда|что за|объясни(?:те)?)\s+)?(?:(?:в уч[её]те|в сверке|в отч[её]те)\s+)?(?:показывает\s+)?(?:(?:сумм[ау]|внесение|выплат[ау]|деньги) без инвестора|карточка инвестора по внесению не найдена|инвестор внесения не найден|получатель выплаты не найден)(?:\s+(?:в уч[её]те|в сверке|в отч[её]те))?$/iu.test(subject))
    return { kind: 'investor', account };
  if (/^(?:почему|откуда)\s+(?:минус|отрицательный (?:баланс|остаток))(?:\s+(?:(?:в|на) кассе|на сч[её]те))?$/iu.test(subject))
    return { kind: 'balance', account };
  if (/^(?:почему |объясни(?:те)? )?(?:нет закупа|не найден расход закупа|импорт без истории закупа)(?:\s+(?:в сверке|в уч[её]те))?$/iu.test(subject))
    return { kind: 'purchase', account };
  if (/^(?:(?:проверь(?:те)?|сверь(?:те)?|проверить|сверить)\s+(?:(?:мой|весь|наш)\s+)?(?:уч[её]т|кассу)|(?:найди(?:те)?|покажи(?:те)?|есть ли|почему|откуда)\s+(?:несоответствия|расхождения)(?:\s+в\s+(?:мо[её]м\s+)?уч[её]те)?|(?:проверка|сверка)\s+(?:уч[её]та|кассы)|(?:что|где)\s+(?:не\s+сходится|расхождение)\s+(?:в уч[её]те|в кассе|по уч[её]ту))$/iu.test(subject))
    return { kind: 'scan', account };
  return null;
}

function auditExplanation(report, kind) {
  const findings = report.findings;
  if (kind === 'investor') {
    const linked = findings.filter(f => investorCodes.has(f.code));
    const returned = linked.filter(f => f.code === 'historical_investor_return');
    const unresolved = linked.find(f => f.code !== 'historical_investor_return');
    const lines = ['Так сверка обозначает внесение или выплату, для которых сейчас нельзя открыть карточку инвестора. Сумма относится к записи операции.'];
    if (!linked.length) return `${lines[0]} В выбранном отчёте таких записей нет.`;
    if (unresolved) {
      const payout = unresolved.code === 'payout_investor';
      const amount = unresolved.facts.find(f => f.label === (payout ? 'Сумма выплаты' : 'Сумма внесения'))?.value;
      const operation = payout ? 'выплата' : 'внесение';
      if (typeof amount === 'number') {
        lines.push(`В отчёте есть ${operation} на ${money(amount)} (${unresolved.accountName || 'счёт не указан'}). Откройте эту операцию в карточке и сверьте получателя.`);
      }
    }
    if (returned.length) {
      const item = returned[0];
      const amount = item.facts.find(f => f.label === 'Сумма внесения')?.value;
      if (typeof amount === 'number') lines.push(`Например, по счёту «${item.accountName}» есть внесение и возврат по ${money(amount)}. По этой паре разница — 0 ₽.`);
    }
    if (unresolved) lines.push('По такой записи нельзя определить, сколько капитала сейчас в пуле.');
    return lines.join('\n\n');
  }
  if (kind === 'balance') {
    const negative = findings.filter(f => f.code === 'negative_balance');
    if (!negative.length) return 'По сохранённым записям в выбранной сверке отрицательного остатка нет.';
    const lines = negative.slice(0, 3).map(f => {
      const facts = new Map(f.facts.map(fact => [fact.label, fact.value]));
      return `«${facts.get('Счёт')}» — остаток ${money(facts.get('На счёте'))}.`;
    });
    return `${lines.join('\n')}\n\nВ карточке показано, из чего сложился остаток: начальная сумма, поступления, расходы и продажи магазина. Отрицательный остаток сам по себе не доказывает ошибку.`;
  }
  if (kind === 'purchase') {
    const missing = findings.filter(f => f.code === 'missing_purchase');
    const imported = findings.filter(f => f.code === 'import_purchase_history');
    if (!missing.length && !imported.length) return 'В выбранной сверке нет замечаний по расходам закупа и истории импорта.';
    const messages = [];
    if (missing.length) messages.push('В «Уточнить» есть договоры, у которых сверка не нашла связанный расход закупа. Откройте договор и сравните его с записью в кассе.');
    if (imported.length) messages.push('Импорт без истории закупа показан в «Особенностях». Себестоимость в договоре может быть заполнена, а старого расхода в кассе может не быть. Добавлять расход только из-за этого не нужно.');
    return messages.join('\n\n');
  }
  const first = findings.find(f => !f.reviewedAt && f.severity === 'confirmed') || findings.find(f => !f.reviewedAt && f.severity === 'review');
  if (!first) return `${report.summary.replace(/\.$/u, '')}. Особенности учёта и исходные записи доступны в карточке проверки.`;
  if (investorCodes.has(first.code)) return `${report.summary}\n\n${auditExplanation(report, 'investor')}`;
  return `${report.summary}\n\nНачните с пункта «${first.title}». ${first.explanation} ${first.nextStep}`;
}

module.exports = { localAuditIntent, auditExplanation };
