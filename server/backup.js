/**
 * Резервное копирование: раз в сутки/неделю/месяц собираем тот же Excel-отчёт,
 * что и кнопка «Скачать Excel» в приложении, и отправляем его пользователю на почту.
 *
 * Почему отдельный файл: index.js уже ~3400 строк, а здесь самодостаточный блок —
 * планировщик, четыре роута и сборка письма. Зависимости приходят параметрами
 * (pool, transporter, auth и т.д.), чтобы не тянуть index.js по кругу.
 *
 * Файл собирается общим модулем shared/excelReport.js — тем же, что использует фронт.
 * Он написан как ES-модуль (в корневом package.json стоит "type": "module"),
 * поэтому подключается через динамический import, а не require.
 */

const path = require('path');
const { pathToFileURL } = require('url');

const FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY'];

// Минимальный тариф разрешает только ежемесячную копию: ежедневная рассылка —
// это 30 писем с вложением в месяц на пользователя, и она вынесена в платные тарифы.
// Пробный период показывает возможности целиком, поэтому приравнен к Стандарту.
const PLAN_FREQUENCIES = {
    START: ['MONTHLY'],
    TRIAL: FREQUENCIES,
    STANDARD: FREQUENCIES,
    BUSINESS: FREQUENCIES,
    BUSINESS_PRO: FREQUENCIES,
};

// Письма уходят в 03:00 по Москве — ночью, когда никто не работает в приложении,
// и данные за сутки уже полные. МСК круглый год UTC+3, перевода часов нет,
// поэтому 03:00 МСК — это ровно 00:00 UTC, и отдельная возня с часовыми поясами не нужна.
const SEND_HOUR_UTC = 0;

// Потолок вложения. Gmail принимает 25 МБ, но часть почтовых служб режет раньше,
// а письмо, которое не дошло, хуже письма без файла.
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

// Предохранитель по размеру базы. SheetJS в бесплатной версии не умеет потоковую
// запись: весь XML собирается в памяти, и расход растёт линейно — замеры дают
// примерно 0,2 МБ на договор (1000 договоров ≈ +230 МБ, 5000 ≈ +950 МБ).
// На боевом сервере 2 ГБ памяти без swap, лимит кучи Node ~1 ГБ, и рядом работает
// PostgreSQL — при нехватке памяти ядро убьёт любой из процессов, не обязательно наш.
// Поэтому выше порога копия не собирается: пользователь получает письмо с просьбой
// выгрузить вручную. Порог поднимается через env, если сервер станет мощнее.
const MAX_CONTRACTS = Number(process.env.BACKUP_MAX_CONTRACTS) || 1500;

const CODE_TTL_MINUTES = 15;

// Пауза перед повторной отправкой кода. Каждый код — отдельное письмо, а суточный
// лимит Gmail общий с резервными копиями и восстановлением пароля.
const RESEND_COOLDOWN_SEC = 60;

// Пауза между письмами. Почта уходит через Gmail SMTP, а он ограничивает и суточный
// объём, и скорость: залп из сотни писем с вложениями подряд получает временную
// блокировку, и часть копий просто не доходит. Ночью торопиться некуда — 2 секунды
// на письмо растягивают рассылку на сотню пользователей в несколько минут.
const EMAIL_DELAY_MS = Number(process.env.BACKUP_EMAIL_DELAY_MS ?? 2000);
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const allowedFrequencies = (plan) => PLAN_FREQUENCIES[plan] || PLAN_FREQUENCIES.START;

/**
 * Следующий момент отправки после `from`. Всегда возвращает будущее время,
 * выровненное на SEND_HOUR_UTC: иначе просроченная задача выбиралась бы
 * планировщиком снова и снова в каждом тике.
 */
const computeNextRun = (frequency, from = new Date()) => {
    const next = new Date(Date.UTC(
        from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), SEND_HOUR_UTC, 0, 0, 0
    ));
    if (frequency === 'MONTHLY') {
        next.setUTCDate(1);
        while (next <= from) next.setUTCMonth(next.getUTCMonth() + 1);
        return next;
    }
    if (frequency === 'WEEKLY') {
        // Понедельник: getUTCDay() 0 — воскресенье, поэтому 1 — понедельник.
        const shift = (1 - next.getUTCDay() + 7) % 7;
        next.setUTCDate(next.getUTCDate() + shift);
        while (next <= from) next.setUTCDate(next.getUTCDate() + 7);
        return next;
    }
    while (next <= from) next.setUTCDate(next.getUTCDate() + 1);
    return next;
};

const FREQUENCY_LABEL = { DAILY: 'ежедневно', WEEKLY: 'еженедельно', MONTHLY: 'ежемесячно' };

module.exports = ({ pool, transporter, auth, getEffectivePlan, generateCode }) => {

    // Общий модуль сборки Excel грузим один раз и держим в памяти.
    let excelReportPromise = null;
    const getExcelReport = () => {
        if (!excelReportPromise) {
            const url = pathToFileURL(path.join(__dirname, '..', 'shared', 'excelReport.js')).href;
            excelReportPromise = import(url);
        }
        return excelReportPromise;
    };

    const getUserPlan = async (userId) => {
        const res = await pool.query(`SELECT email, name, subscription FROM users WHERE id = $1`, [userId]);
        const row = res.rows[0];
        if (!row) return null;
        const sub = typeof row.subscription === 'string' ? JSON.parse(row.subscription) : row.subscription;
        return {
            email: row.email,
            name: row.name,
            plan: getEffectivePlan(sub) || 'TRIAL',
        };
    };

    const getRow = async (userId) => {
        const res = await pool.query(`SELECT * FROM backup_settings WHERE user_id = $1`, [userId]);
        return res.rows[0] || null;
    };

    /**
     * Данные пользователя для отчёта. Повторяет ветку менеджера из GET /api/data:
     * менеджер видит свои записи плюс всё, что заведено под его инвесторов.
     */
    const loadUserData = async (userId) => {
        const res = await pool.query(`
            SELECT * FROM data_items WHERE user_id = $1
            UNION
            SELECT * FROM data_items WHERE type = 'investors' AND data->>'userId' = $1
            UNION
            SELECT d.* FROM data_items d
            INNER JOIN data_items inv ON d.data->>'ownerId' = inv.data->>'id'
            WHERE d.type IN ('accounts') AND inv.type = 'investors' AND inv.data->>'userId' = $1
            UNION
            SELECT d.* FROM data_items d
            INNER JOIN data_items acc ON d.data->>'accountId' = acc.data->>'id'
            INNER JOIN data_items inv ON acc.data->>'ownerId' = inv.data->>'id'
            WHERE d.type IN ('sales', 'expenses') AND inv.type = 'investors' AND inv.data->>'userId' = $1
        `, [userId]);

        const data = { customers: [], sales: [], accounts: [], investors: [] };
        for (const row of res.rows) {
            if (!data[row.type]) continue;
            // Менеджер видит только своих инвесторов — та же проверка, что в /api/data.
            if (row.type === 'investors' && row.data.userId !== undefined && row.data.userId !== userId) continue;
            data[row.type].push(row.data);
        }
        return data;
    };

    // Сборка книги идёт целиком в памяти и это самая тяжёлая операция во всём модуле:
    // на 1000 договоров пик доходит до ~230 МБ, на 5000 — почти до гигабайта
    // (SheetJS community не умеет потоковую запись, промежуточный XML держится в памяти).
    // Поэтому строго один отчёт за раз: иначе ночная рассылка нескольким пользователям
    // или кнопка «отправить сейчас» во время тика сложат пики и уронят процесс по OOM.
    let buildChain = Promise.resolve();
    const withBuildLock = (fn) => {
        const run = buildChain.then(fn, fn);
        buildChain = run.then(() => {}, () => {});
        return run;
    };

    /**
     * Дешёвый подсчёт договоров ДО загрузки данных. Считать после загрузки бессмысленно:
     * сам JSON всех продаж — уже заметный кусок памяти, а весь смысл проверки в том,
     * чтобы не начинать тяжёлую работу, которая не поместится.
     */
    const countSales = async (userId) => {
        const res = await pool.query(`
            SELECT COUNT(*)::int AS n FROM (
                SELECT id FROM data_items WHERE user_id = $1 AND type = 'sales'
                UNION
                SELECT d.id FROM data_items d
                INNER JOIN data_items acc ON d.data->>'accountId' = acc.data->>'id'
                INNER JOIN data_items inv ON acc.data->>'ownerId' = inv.data->>'id'
                WHERE d.type = 'sales' AND acc.type = 'accounts'
                  AND inv.type = 'investors' AND inv.data->>'userId' = $1
            ) t
        `, [userId]);
        return res.rows[0]?.n || 0;
    };

    const buildReport = (userId) => withBuildLock(async () => {
        // require здесь, а не наверху файла: xlsx занимает ~25 МБ в памяти процесса,
        // и платить их на каждом запуске сервера незачем — модуль нужен только
        // в момент сборки копии, дальше остаётся в кеше require.
        const XLSX = require('xlsx');
        const { buildExcelReport } = await getExcelReport();
        const data = await loadUserData(userId);
        const startedAt = Date.now();
        // Копия всегда за весь период: смысл резервной копии в том, чтобы в ней
        // лежало всё, а не срез за месяц.
        const result = buildExcelReport(XLSX, data, {});
        const heapMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
        console.log(`📦 Backup built for ${userId}: ${result.salesCount} договоров, ${Date.now() - startedAt} мс, RSS ${heapMb} МБ`);
        return result;
    });

    // Хелпер sendEmail в index.js при ненастроенном SMTP молча возвращает успех —
    // для кода подтверждения при разработке это удобно, но для резервной копии
    // «отправлено», которого не было, опаснее любой ошибки: человек будет уверен,
    // что копии есть. Поэтому здесь настройка проверяется явно.
    const assertMailConfigured = () => {
        if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
            throw new Error('Отправка почты не настроена на сервере (SMTP)');
        }
    };

    const sendBackupEmail = async ({ to, userName, frequency, base64, salesCount, skipReason }) => {
        assertMailConfigured();
        const dateStr = new Date().toLocaleDateString('ru-RU');
        const fileName = `FinUchet_backup_${new Date().toISOString().slice(0, 10)}.xlsx`;

        const SKIP_INTRO = {
            OVERSIZED: `<p>Резервная копия за ${dateStr} получилась слишком большой для письма (более 15 МБ), поэтому файл не вложен.</p>`,
            TOO_MANY: `<p>В вашей базе ${salesCount} договоров — это больше, чем можно собрать в письмо автоматически, поэтому копия за ${dateStr} не сформирована.</p>`,
        };
        const intro = skipReason
            ? `${SKIP_INTRO[skipReason]}<p>Выгрузите файл вручную: <b>Настройки → Экспорт данных</b>. В приложении ограничения нет.</p>`
            : `<p>Во вложении — резервная копия ваших данных на ${dateStr}. В файле ${salesCount} ${salesCount === 1 ? 'договор' : 'договоров'}: клиенты, платежи, итоги по инвесторам и сводка.</p>`;

        const html = `
            <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; font-size: 15px; color: #1e293b;">
                <p>Здравствуйте${userName ? ', ' + userName : ''}!</p>
                ${intro}
                <p style="color:#64748b; font-size:13px; margin-top:24px; border-top:1px solid #e2e8f0; padding-top:12px;">
                    Вы получили это письмо, потому что включили резервное копирование (${FREQUENCY_LABEL[frequency]}).
                    Отключить можно в приложении: Настройки → Резервное копирование.
                </p>
            </div>`;

        const text = skipReason
            ? `Резервную копию за ${dateStr} не удалось приложить к письму (договоров: ${salesCount}). Выгрузите её вручную: Настройки → Экспорт данных.`
            : `Во вложении резервная копия ваших данных на ${dateStr}. Договоров: ${salesCount}.`;

        await transporter.sendMail({
            from: `"FinUchet" <${process.env.SMTP_USER}>`,
            to,
            subject: `Резервная копия FinUchet — ${dateStr}`,
            text,
            html,
            attachments: skipReason ? [] : [{ filename: fileName, content: base64, encoding: 'base64' }],
            headers: {
                // Письмо служебное, а не рассылка. Заголовки ниже говорят почтовым службам
                // ровно это — без них регулярные письма с вложением легко уезжают в спам.
                'X-Mailer': 'FinUchet Backup',
                'Auto-Submitted': 'auto-generated',
                'List-Unsubscribe': '<https://rassrochka.pro/settings>',
            },
        });
    };

    /** Одна отправка. Возвращает статус для записи в last_status. */
    const runBackupFor = async (userId) => {
        const user = await getUserPlan(userId);
        if (!user) return { status: 'ERROR', error: 'Пользователь не найден' };

        const row = await getRow(userId);
        if (!row || !row.enabled) return { status: 'SKIPPED', error: null };

        // Тариф могли понизить уже после включения — тогда рассылка молча останавливается,
        // а в настройках пользователь видит причину.
        if (!allowedFrequencies(user.plan).includes(row.frequency)) {
            await pool.query(`UPDATE backup_settings SET enabled = FALSE WHERE user_id = $1`, [userId]);
            return { status: 'ERROR', error: `Частота «${FREQUENCY_LABEL[row.frequency]}» недоступна на тарифе ${user.plan}` };
        }

        const recipients = [user.email];
        if (row.extra_email && row.extra_email_verified) recipients.push(row.extra_email);
        const send = async (payload) => {
            for (let i = 0; i < recipients.length; i++) {
                if (i > 0) await sleep(EMAIL_DELAY_MS);
                await sendBackupEmail({ to: recipients[i], userName: user.name, frequency: row.frequency, ...payload });
            }
        };

        // Предохранитель срабатывает ДО сборки: если договоров слишком много,
        // тяжёлую работу вообще не начинаем, иначе рискуем положить процесс по памяти.
        const totalSales = await countSales(userId);
        if (totalSales > MAX_CONTRACTS) {
            console.warn(`⚠️ Backup skipped for ${userId}: ${totalSales} договоров > лимита ${MAX_CONTRACTS}`);
            await send({ base64: null, salesCount: totalSales, skipReason: 'TOO_MANY' });
            return { status: 'TOO_MANY', error: `Договоров ${totalSales}, автоматическая копия собирается до ${MAX_CONTRACTS}` };
        }

        const { base64, salesCount } = await buildReport(userId);
        if (!base64) return { status: 'EMPTY', error: null };

        // base64 длиннее исходника примерно на треть — считаем реальный размер файла.
        const bytes = Math.floor(base64.length * 3 / 4);
        const oversized = bytes > MAX_ATTACHMENT_BYTES;

        await send({ base64, salesCount, skipReason: oversized ? 'OVERSIZED' : null });
        return { status: oversized ? 'OVERSIZED' : 'OK', error: null };
    };

    // --- ПЛАНИРОВЩИК ---

    let ticking = false;
    const tick = async () => {
        if (ticking) return; // предыдущий проход ещё идёт — пропускаем, иначе задвоим письма
        ticking = true;
        try {
            const due = await pool.query(
                `SELECT user_id, frequency FROM backup_settings
                  WHERE enabled = TRUE AND (next_run_at IS NULL OR next_run_at <= NOW())`
            );
            if (due.rows.length > 1) {
                console.log(`📬 Backup: к отправке ${due.rows.length} копий`);
            }
            for (let i = 0; i < due.rows.length; i++) {
                const { user_id, frequency } = due.rows[i];
                // Пауза между пользователями — по той же причине, что и между адресами:
                // Gmail не любит залпы. Перед первым письмом ждать нечего.
                if (i > 0) await sleep(EMAIL_DELAY_MS);
                // Слот занимаем ДО отправки: если процесс упадёт на середине,
                // задача не будет выбираться в каждом следующем тике по кругу.
                await pool.query(
                    `UPDATE backup_settings SET next_run_at = $2 WHERE user_id = $1`,
                    [user_id, computeNextRun(frequency)]
                );
                let result;
                try {
                    result = await runBackupFor(user_id);
                } catch (e) {
                    console.error(`❌ Backup failed for ${user_id}:`, e.message);
                    result = { status: 'ERROR', error: e.message };
                }
                await pool.query(
                    `UPDATE backup_settings SET last_run_at = NOW(), last_status = $2, last_error = $3 WHERE user_id = $1`,
                    [user_id, result.status, result.error]
                );
            }
        } catch (e) {
            console.error('❌ Backup scheduler error:', e.message);
        } finally {
            ticking = false;
        }
    };

    const startScheduler = () => {
        // Раз в 15 минут: точнее не нужно (отправка привязана к часу), а реже —
        // и после перезапуска сервера пропущенная копия ждала бы слишком долго.
        setInterval(tick, 15 * 60 * 1000);
        setTimeout(tick, 60 * 1000); // догнать пропущенное после перезапуска
    };

    // --- РОУТЫ ---

    const publicView = (row, user) => ({
        enabled: row?.enabled ?? false,
        frequency: row?.frequency ?? 'MONTHLY',
        extraEmail: row?.extra_email ?? null,
        extraEmailVerified: row?.extra_email_verified ?? false,
        extraEmailPending: row?.extra_email_pending ?? null,
        nextRunAt: row?.next_run_at ?? null,
        lastRunAt: row?.last_run_at ?? null,
        lastStatus: row?.last_status ?? null,
        lastError: row?.last_error ?? null,
        accountEmail: user.email,
        plan: user.plan,
        allowedFrequencies: allowedFrequencies(user.plan),
    });

    const registerRoutes = (app) => {
        // Настройки резервного копирования принадлежат владельцу данных.
        // Сотрудник или инвестор не должен управлять рассылкой чужой базы себе на почту.
        const ownerOnly = (req, res, next) => {
            if (req.user.role === 'employee' || req.user.role === 'investor') {
                return res.status(403).json({ msg: 'Резервным копированием управляет владелец аккаунта' });
            }
            next();
        };

        app.get('/api/backup/settings', auth, ownerOnly, async (req, res) => {
            try {
                const user = await getUserPlan(req.user.id);
                if (!user) return res.status(404).json({ msg: 'Пользователь не найден' });
                res.json(publicView(await getRow(req.user.id), user));
            } catch (e) {
                console.error('Backup settings get error:', e);
                res.status(500).json({ msg: 'Server error' });
            }
        });

        app.put('/api/backup/settings', auth, ownerOnly, async (req, res) => {
            try {
                const { enabled, frequency } = req.body || {};
                if (!FREQUENCIES.includes(frequency)) {
                    return res.status(400).json({ msg: 'Недопустимая периодичность' });
                }
                const user = await getUserPlan(req.user.id);
                if (!user) return res.status(404).json({ msg: 'Пользователь не найден' });

                // Тариф проверяем здесь, а не только в интерфейсе: без этого ежедневную
                // копию можно было бы включить на минимальном тарифе прямым запросом к API.
                const allowed = allowedFrequencies(user.plan);
                if (enabled && !allowed.includes(frequency)) {
                    return res.status(403).json({
                        msg: `Периодичность «${FREQUENCY_LABEL[frequency]}» доступна с тарифа Стандарт`,
                        hint: 'На текущем тарифе доступна ежемесячная копия',
                    });
                }

                const nextRun = enabled ? computeNextRun(frequency) : null;
                await pool.query(`
                    INSERT INTO backup_settings (user_id, enabled, frequency, next_run_at, updated_at)
                    VALUES ($1, $2, $3, $4, NOW())
                    ON CONFLICT (user_id) DO UPDATE
                       SET enabled = $2, frequency = $3, next_run_at = $4, updated_at = NOW()
                `, [req.user.id, !!enabled, frequency, nextRun]);

                res.json(publicView(await getRow(req.user.id), user));
            } catch (e) {
                console.error('Backup settings put error:', e);
                res.status(500).json({ msg: 'Server error' });
            }
        });

        // Отправить копию прямо сейчас — чтобы человек увидел письмо и убедился,
        // что адрес рабочий, не дожидаясь ночи.
        app.post('/api/backup/run-now', auth, ownerOnly, async (req, res) => {
            try {
                const row = await getRow(req.user.id);
                if (!row) return res.status(400).json({ msg: 'Сначала включите резервное копирование' });

                // Сбой отправки — это тоже результат: его надо записать в last_status,
                // иначе в настройках останется состояние от прошлой удачной копии
                // и пользователь не увидит, что последняя попытка провалилась.
                let result;
                try {
                    result = await runBackupFor(req.user.id);
                } catch (e) {
                    console.error('Backup run-now failed:', e);
                    result = { status: 'ERROR', error: e.message || 'Не удалось отправить копию' };
                }
                await pool.query(
                    `UPDATE backup_settings SET last_run_at = NOW(), last_status = $2, last_error = $3 WHERE user_id = $1`,
                    [req.user.id, result.status, result.error]
                );
                if (result.status === 'EMPTY') {
                    return res.status(400).json({ msg: 'Нет данных для выгрузки — сначала заведите договоры' });
                }
                // TOO_MANY — это не успех: письмо ушло, но файла в нём нет.
                // Сказать «отправлено» здесь значило бы соврать про наличие копии.
                if (result.status === 'ERROR' || result.status === 'TOO_MANY') {
                    return res.status(400).json({ msg: result.error || 'Не удалось отправить копию' });
                }
                res.json({ ok: true, status: result.status });
            } catch (e) {
                console.error('Backup run-now error:', e);
                res.status(500).json({ msg: 'Не удалось отправить копию' });
            }
        });

        // Дополнительный адрес подтверждается кодом. Без подтверждения на него
        // ничего не уходит: иначе через угнанный аккаунт можно было бы настроить
        // регулярную утечку чужой базы на любой ящик.
        app.post('/api/backup/extra-email/request', auth, ownerOnly, async (req, res) => {
            try {
                const email = String(req.body?.email || '').trim().toLowerCase();
                if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                    return res.status(400).json({ msg: 'Некорректный адрес' });
                }
                assertMailConfigured();

                // Защита от повторных нажатий: каждый код — это письмо, а суточный лимит
                // Gmail общий с резервными копиями и кодами восстановления пароля.
                // Момент выдачи прошлого кода вычисляем из срока его действия — отдельная
                // колонка ради этого не нужна.
                const prev = await getRow(req.user.id);
                if (prev?.extra_email_code_expires) {
                    const issuedAt = new Date(prev.extra_email_code_expires).getTime() - CODE_TTL_MINUTES * 60 * 1000;
                    const waitSec = Math.ceil((issuedAt + RESEND_COOLDOWN_SEC * 1000 - Date.now()) / 1000);
                    if (waitSec > 0) {
                        return res.status(429).json({ msg: `Код уже отправлен. Повторить можно через ${waitSec} с.`, retryAfter: waitSec });
                    }
                }

                const code = generateCode();
                const expires = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);
                await pool.query(`
                    INSERT INTO backup_settings (user_id, extra_email_pending, extra_email_code, extra_email_code_expires, updated_at)
                    VALUES ($1, $2, $3, $4, NOW())
                    ON CONFLICT (user_id) DO UPDATE
                       SET extra_email_pending = $2, extra_email_code = $3, extra_email_code_expires = $4, updated_at = NOW()
                `, [req.user.id, email, code, expires]);

                await transporter.sendMail({
                    from: `"FinUchet" <${process.env.SMTP_USER}>`,
                    to: email,
                    subject: 'Подтверждение адреса для резервных копий FinUchet',
                    text: `Код подтверждения: ${code}. Он действует ${CODE_TTL_MINUTES} минут.`,
                    html: `<p>Ваш код подтверждения: <b style="font-size:20px">${code}</b></p>
                           <p style="color:#64748b;font-size:13px">Код действует ${CODE_TTL_MINUTES} минут.
                           Если вы не запрашивали его — просто проигнорируйте письмо, на этот адрес ничего отправляться не будет.</p>`,
                });
                res.json({ ok: true });
            } catch (e) {
                console.error('Backup extra-email request error:', e);
                res.status(500).json({ msg: e.message || 'Не удалось отправить код' });
            }
        });

        // Отмена начатого подтверждения. Без этого роута кнопка «Изменить адрес» чистила
        // только состояние в браузере, а extra_email_pending оставался в базе — и при
        // следующем открытии настроек карточка снова показывала ввод кода для старого
        // адреса. Со стороны это выглядело так, будто форма вообще не сбрасывается.
        // Подтверждённый адрес не трогаем: здесь отменяется только незавершённая попытка.
        app.post('/api/backup/extra-email/cancel', auth, ownerOnly, async (req, res) => {
            try {
                await pool.query(`
                    UPDATE backup_settings
                       SET extra_email_pending = NULL, extra_email_code = NULL,
                           extra_email_code_expires = NULL, updated_at = NOW()
                     WHERE user_id = $1
                `, [req.user.id]);
                res.json(publicView(await getRow(req.user.id), await getUserPlan(req.user.id)));
            } catch (e) {
                console.error('Backup extra-email cancel error:', e);
                res.status(500).json({ msg: 'Server error' });
            }
        });

        app.post('/api/backup/extra-email/confirm', auth, ownerOnly, async (req, res) => {
            try {
                const code = String(req.body?.code || '').trim();
                const row = await getRow(req.user.id);
                if (!row?.extra_email_pending || !row.extra_email_code) {
                    return res.status(400).json({ msg: 'Сначала запросите код' });
                }
                if (row.extra_email_code_expires && new Date(row.extra_email_code_expires) < new Date()) {
                    return res.status(400).json({ msg: 'Срок действия кода истёк, запросите новый' });
                }
                if (row.extra_email_code !== code) {
                    return res.status(400).json({ msg: 'Неверный код' });
                }
                await pool.query(`
                    UPDATE backup_settings
                       SET extra_email = extra_email_pending, extra_email_verified = TRUE,
                           extra_email_pending = NULL, extra_email_code = NULL, extra_email_code_expires = NULL,
                           updated_at = NOW()
                     WHERE user_id = $1
                `, [req.user.id]);
                res.json(publicView(await getRow(req.user.id), await getUserPlan(req.user.id)));
            } catch (e) {
                console.error('Backup extra-email confirm error:', e);
                res.status(500).json({ msg: 'Server error' });
            }
        });

        app.delete('/api/backup/extra-email', auth, ownerOnly, async (req, res) => {
            try {
                await pool.query(`
                    UPDATE backup_settings
                       SET extra_email = NULL, extra_email_verified = FALSE, extra_email_pending = NULL,
                           extra_email_code = NULL, extra_email_code_expires = NULL, updated_at = NOW()
                     WHERE user_id = $1
                `, [req.user.id]);
                res.json(publicView(await getRow(req.user.id), await getUserPlan(req.user.id)));
            } catch (e) {
                console.error('Backup extra-email delete error:', e);
                res.status(500).json({ msg: 'Server error' });
            }
        });
    };

    return { registerRoutes, startScheduler, computeNextRun, allowedFrequencies };
};
