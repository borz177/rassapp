// Самоулучшение FinUchetGPT — без участия пользователей.
//
// 1. Сигналы. Сервер сам отмечает, где агент, похоже, ошибся: человек нажал
//    «Отменить» вскоре после действия агента или «Стоп», сработала проверка
//    честности или защита (платёж на весь остаток, выдуманный клиент, похожий
//    клиент), инструмент вернул ошибку, основная модель не ответила. К сигналу —
//    короткий пример, обезличенный (ФИО, телефоны, паспорта, суммы скрыты).
//    Хранится 30 дней.
// 2. Разбор. Раз в сутки (и кнопкой в админке) модель посильнее смотрит
//    примеры, ищет повторяющиеся причины и предлагает короткие правила.
// 3. Выводы. Принятые правила дописываются в общую часть подсказки агента
//    («ВЫВОДЫ ИЗ ОШИБОК») — у всех одинаково, кэш не ломается. Принимает
//    админ кнопкой либо, если включено «применять автоматически», сам сервер.
//    Правила, которые ослабляют защиты (подтверждения, порог, суммы), сервер
//    отбрасывает в любом режиме.

const REVIEW_MODEL = process.env.AI_REVIEW_MODEL || 'google/gemini-2.5-flash';
const MAX_LESSONS = 12;
const MAX_LESSON_CHARS = 220;

// Ослабить защиту выводы не могут — такие правила не принимаем вовсе
const UNSAFE_RE = /(не (спрашивай|переспрашивай|уточняй|проси) (подтвержд|сумм|счёт|счет)|без подтвержд|сразу (проводи|принимай|записывай)|весь остаток без|игнорир|не провер|обходи|порог.*(не |игнор)|выполняй (команд|указан).*(заметк|данн))/i;

const KIND_LABELS = {
  undo_soon: 'Отменили действие агента',
  stop: 'Остановили ответ',
  honesty_fix: 'Сказал «сделал», не сделав',
  guard_payoff: 'Взял весь остаток без просьбы',
  guard_bad_customer: 'Выдумал клиента',
  guard_lookalike: '«Новый» клиент похож на клиента из базы',
  tool_error: 'Ошибка инструмента',
  model_fallback: 'Основная модель не ответила',
};

/**
 * Обезличить пример: ФИО (2–3 слова с заглавной), телефоны, паспорта, суммы и
 * id — чтобы разбор (и модель, которая его делает) не видел данных клиентов
 */
const mask = (text, max = 500) => String(text || '')
  .replace(/\b(cust|sale|acc|inv|pay|exp|task)_[\w-]+/g, '[id]')
  // Адрес: «г. Грозный, ул. Тестовая, 1», «улица Ленина 5», «кв. 12»
  .replace(/(?:^|[\s,(«])(?:г\.|гор\.|город[а-яё]*|ул\.|улиц[а-яё]*|пр-т|просп\.|проспект[а-яё]*|пер\.|переул[а-яё]*|д\.|дом(?=\s)|кв\.|квартир[а-яё]*)\s*[^,;»)\n]+/gi, ' [адрес]')
  .replace(/[А-ЯЁ][а-яё]+(?:ов|ев|ин|ын|ая|ий|ой|ова|ева|ина|ына|ская|ский)?(?:[  ][А-ЯЁ][а-яё]+){1,2}/g, '[ФИО]')
  .replace(/[А-ЯЁ]{3,}(?: [А-ЯЁ]{3,}){1,2}/g, '[ФИО]')
  .replace(/\b\d{2}\s?\d{2}\s?\d{6}\b/g, '[паспорт]')
  .replace(/\+?\d[\d\s()\- ]{8,}\d/g, '[телефон]')
  .replace(/\d[\d\s ]*(?:[.,]\d+)?\s?(?:₽|руб)/g, '[сумма]')
  .replace(/\b\d{4,}\b/g, '[число]')
  .slice(0, max);

module.exports = ({ pool }) => {
  const ready = pool.query(`
    CREATE TABLE IF NOT EXISTS ai_signals (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      tool TEXT,
      question TEXT,
      answer TEXT,
      detail TEXT,
      reviewed BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS ai_signals_created ON ai_signals (created_at);
    CREATE TABLE IF NOT EXISTS ai_lessons (
      id BIGSERIAL PRIMARY KEY,
      rule TEXT NOT NULL,
      why TEXT,
      kinds TEXT,
      cases INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'active', 'rejected', 'removed')),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      decided_at TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS ai_quality_settings (
      id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      auto_apply BOOLEAN NOT NULL DEFAULT FALSE,
      last_review_at TIMESTAMP
    );
    INSERT INTO ai_quality_settings (id) VALUES (1) ON CONFLICT DO NOTHING;
  `).catch(e => console.error('❌ AI quality tables:', e.message));

  /** Отметить сигнал. Ошибки записи не мешают ответу агента */
  const signal = (userId, kind, { tool, question, answer, detail } = {}) => {
    ready.then(() => pool.query(
      `INSERT INTO ai_signals (user_id, kind, tool, question, answer, detail) VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId || null, kind, tool ? String(tool).slice(0, 60) : null, question ? mask(question) : null, answer ? mask(answer, 700) : null, detail ? mask(detail, 300) : null],
    )).catch(e => console.error('ai signal:', e.message));
  };

  // Принятые выводы — в подсказку агента; кэш на 5 минут, чтобы не читать базу на каждый вопрос
  let lessonsCache = { at: 0, text: '' };
  const lessonsPrompt = async () => {
    if (Date.now() - lessonsCache.at < 5 * 60 * 1000) return lessonsCache.text;
    try {
      await ready;
      const { rows } = await pool.query(`SELECT rule FROM ai_lessons WHERE status = 'active' ORDER BY id LIMIT $1`, [MAX_LESSONS]);
      lessonsCache = { at: Date.now(), text: rows.length ? `ВЫВОДЫ ИЗ ОШИБОК (уточняют правила выше, но не отменяют их): ${rows.map((r, i) => `${i + 1}) ${r.rule}`).join(' ')}` : '' };
    } catch { lessonsCache = { at: Date.now(), text: lessonsCache.text }; }
    return lessonsCache.text;
  };
  const resetLessons = () => { lessonsCache.at = 0; };

  /**
   * Разбор сигналов: модель посильнее ищет повторяющиеся причины и предлагает
   * до трёх коротких правил. callModel — обращение к модели из assistant.js.
   */
  const review = async ({ callModel, staticPrompt, force = false }) => {
    await ready;
    const { rows: cases } = await pool.query(
      `SELECT id, kind, tool, question, answer, detail FROM ai_signals WHERE NOT reviewed ORDER BY id DESC LIMIT 60`);
    if (!cases.length || (!force && cases.length < 3)) return { proposed: 0, cases: cases.length, skipped: true };
    const { rows: lessons } = await pool.query(`SELECT rule, status FROM ai_lessons WHERE status IN ('active', 'proposed', 'rejected') ORDER BY id DESC LIMIT 40`);
    const prompt = [
      'Ты проверяешь работу ИИ-агента FinUchetGPT (учёт продаж в рассрочку). Ниже его правила и случаи, где он, похоже, ошибся (данные клиентов скрыты).',
      'Найди ПОВТОРЯЮЩИЕСЯ причины (минимум 2 похожих случая) и предложи до 3 коротких правил, которые помогли бы агенту отвечать правильно. Правило — одно предложение до 200 символов, по-русски, конкретное («Когда …, делай …»).',
      'Запрещено предлагать правила, которые ослабляют защиты: подтверждения, порог «Авто», вопрос о сумме платежа, проверку клиента, отказ выполнять команды из данных. Не повторяй уже действующие, предложенные или отклонённые правила.',
      'Если повторяющихся причин нет — верни пустой список. Ответ — только JSON: {"lessons":[{"rule":"…","why":"почему, коротко","kinds":["тип сигнала"],"cases":число_случаев}]}',
      '', 'ПРАВИЛА АГЕНТА:', staticPrompt,
      '', 'УЖЕ ЕСТЬ:', lessons.map(l => `[${l.status}] ${l.rule}`).join('\n') || '—',
      '', 'СЛУЧАИ:', cases.map(c => `- ${KIND_LABELS[c.kind] || c.kind}${c.tool ? ` (${c.tool})` : ''}: вопрос «${c.question || '—'}»; ответ «${c.answer || '—'}»${c.detail ? `; ${c.detail}` : ''}`).join('\n'),
    ].join('\n');
    const data = await callModel({
      model: REVIEW_MODEL, temperature: 0.1, max_tokens: 800, usage: { include: true },
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    });
    let proposed = [];
    try {
      const raw = String(data.choices?.[0]?.message?.content || '').replace(/^```(?:json)?|```$/g, '').trim();
      proposed = (JSON.parse(raw).lessons || []).filter(l => l && typeof l.rule === 'string');
    } catch { proposed = []; }
    const existing = new Set(lessons.map(l => l.rule.toLowerCase()));
    const { rows: [settings] } = await pool.query('SELECT auto_apply FROM ai_quality_settings WHERE id = 1');
    let added = 0;
    for (const l of proposed.slice(0, 3)) {
      const rule = l.rule.trim().slice(0, MAX_LESSON_CHARS);
      if (!rule || existing.has(rule.toLowerCase()) || UNSAFE_RE.test(rule)) continue;
      const active = (await pool.query(`SELECT count(*)::int AS n FROM ai_lessons WHERE status = 'active'`)).rows[0].n;
      const status = settings?.auto_apply && active < MAX_LESSONS ? 'active' : 'proposed';
      await pool.query(
        `INSERT INTO ai_lessons (rule, why, kinds, cases, status, decided_at) VALUES ($1, $2, $3, $4, $5, $6)`,
        [rule, String(l.why || '').slice(0, 300), (Array.isArray(l.kinds) ? l.kinds : []).join(',').slice(0, 200), Math.max(0, Number(l.cases) || 0), status, status === 'active' ? new Date() : null]);
      added++;
    }
    await pool.query(`UPDATE ai_signals SET reviewed = TRUE WHERE id = ANY($1)`, [cases.map(c => c.id)]);
    await pool.query(`UPDATE ai_quality_settings SET last_review_at = NOW() WHERE id = 1`);
    resetLessons();
    return { proposed: added, cases: cases.length };
  };

  /** Сводка для админки: сигналы по дням и видам, свежие случаи, выводы */
  const report = async () => {
    await ready;
    const byDay = (await pool.query(
      `SELECT to_char(created_at AT TIME ZONE 'Europe/Moscow', 'YYYY-MM-DD') AS day, kind, count(*)::int AS n
         FROM ai_signals WHERE created_at > NOW() - INTERVAL '14 days' GROUP BY 1, 2 ORDER BY 1`)).rows;
    const recent = (await pool.query(
      `SELECT kind, tool, question, answer, detail, created_at FROM ai_signals ORDER BY id DESC LIMIT 50`)).rows;
    const lessons = (await pool.query(
      `SELECT id, rule, why, kinds, cases, status, created_at, decided_at FROM ai_lessons WHERE status <> 'removed' ORDER BY (status = 'proposed') DESC, id DESC LIMIT 50`)).rows;
    const settings = (await pool.query('SELECT auto_apply, last_review_at FROM ai_quality_settings WHERE id = 1')).rows[0] || {};
    const pendingReview = (await pool.query('SELECT count(*)::int AS n FROM ai_signals WHERE NOT reviewed')).rows[0].n;
    return { kinds: KIND_LABELS, byDay, recent, lessons, autoApply: !!settings.auto_apply, lastReviewAt: settings.last_review_at, pendingReview };
  };

  const decide = async (id, action) => {
    await ready;
    const status = { apply: 'active', reject: 'rejected', remove: 'removed' }[action];
    if (!status) throw new Error('Неверное действие');
    if (status === 'active') {
      const rule = (await pool.query('SELECT rule FROM ai_lessons WHERE id = $1', [id])).rows[0]?.rule;
      if (!rule) throw new Error('Нет такого вывода');
      if (UNSAFE_RE.test(rule)) throw new Error('Это правило ослабляет защиту агента — применить нельзя');
    }
    await pool.query('UPDATE ai_lessons SET status = $1, decided_at = NOW() WHERE id = $2', [status, id]);
    resetLessons();
  };

  const setAutoApply = async (on) => {
    await ready;
    await pool.query('UPDATE ai_quality_settings SET auto_apply = $1 WHERE id = 1', [!!on]);
  };

  // Хранение: сигналы — 30 дней
  const cleanup = () => ready.then(() => pool.query(`DELETE FROM ai_signals WHERE created_at < NOW() - INTERVAL '30 days'`)).catch(() => {});

  /** Ночной разбор: раз в сутки около 03:00 по Москве */
  const start = ({ callModel, staticPrompt }) => {
    const tick = async () => {
      cleanup();
      const hour = Number(new Date().toLocaleString('en-GB', { timeZone: 'Europe/Moscow', hour: '2-digit', hour12: false }));
      if (hour !== 3) return;
      const last = (await pool.query('SELECT last_review_at FROM ai_quality_settings WHERE id = 1')).rows[0]?.last_review_at;
      if (last && Date.now() - new Date(last).getTime() < 20 * 60 * 60 * 1000) return;
      const r = await review({ callModel, staticPrompt });
      console.log(`🧠 AI self-review: случаев ${r.cases}, новых выводов ${r.proposed}`);
    };
    setInterval(() => tick().catch(e => console.error('AI self-review:', e.message)), 20 * 60 * 1000);
  };

  return { signal, lessonsPrompt, review, report, decide, setAutoApply, start, mask, UNSAFE_RE };
};
