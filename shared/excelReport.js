/**
 * Сборка Excel-отчёта по продажам.
 *
 * Модуль общий для браузера и сервера: из интерфейса его вызывает components/DataExport.tsx
 * (кнопка «Скачать Excel»), а с сервера — планировщик резервного копирования
 * (server/index.js), которому надо собрать ровно тот же файл без открытого приложения.
 * Держать эту логику в двух местах нельзя: таблица считается по десятку правил
 * (исключения системных записей, просрочка, прибыль только по договорам с закупом),
 * и две копии разойдутся на первой же правке.
 *
 * Библиотека xlsx приходит параметром, а не импортом: во фронте она грузится лениво
 * (`await import('xlsx')`), чтобы не тянуть ~900 КБ в основной бандл, а на сервере
 * подключается обычным require. Файл при этом остаётся без собственных зависимостей
 * и одинаково работает в обеих средах.
 */

const MONEY_FORMAT = '#,##0';

/** Колонки листа «Обзор клиентов», которые показываем с разделителем тысяч. */
const OVERVIEW_MONEY_COLUMNS = [
    'Цена закупа', 'Цена рассрочки', 'Прибыль', 'Взнос', 'Остаток долга', 'Просрочка'
];
const INVESTOR_MONEY_COLUMNS = [
    'Сумма договоров', 'Закуп', 'Прибыль', 'Получено', 'Остаток долга'
];

const calculateColumnWidths = (data) => {
    if (!data || data.length === 0) return [];
    const colWidths = new Map();
    // Ключи берём из первой строки, чтобы порядок колонок не зависел от того,
    // в какой строке какое поле впервые встретилось.
    for (const key of Object.keys(data[0])) colWidths.set(key, key.length);
    for (const row of data) {
        for (const [key, value] of Object.entries(row)) {
            const cellValue = value === null || value === undefined ? '' : String(value);
            const currentMax = colWidths.get(key) || key.length;
            colWidths.set(key, Math.max(currentMax, cellValue.length));
        }
    }
    // Потолок 30: длинные адреса иначе растягивают таблицу так, что цифры уезжают за экран.
    return Array.from(colWidths.values()).map(width => ({ wch: Math.min(Math.max(width + 2, 9), 30) }));
};

// Денежные колонки показываем как 37 800, а не 37800. Формат ячейки (cell.z) —
// это не оформление, поэтому community-версия SheetJS его записывает.
const applyMoneyFormat = (XLSX, ws, rows, moneyColumns) => {
    if (!rows.length) return;
    Object.keys(rows[0]).forEach((key, colIdx) => {
        if (!moneyColumns.includes(key)) return;
        for (let r = 1; r <= rows.length; r++) {
            const cell = ws[XLSX.utils.encode_cell({ c: colIdx, r })];
            if (cell && cell.t === 'n') cell.z = MONEY_FORMAT;
        }
    });
};

const autofilterRef = (XLSX, rows) =>
    ({ ref: `A1:${XLSX.utils.encode_col(rows[0] ? Object.keys(rows[0]).length - 1 : 0)}1` });

/**
 * SheetJS community игнорирует ws['!views'] — в файл попадает только пустой
 * <sheetView workbookViewId="0"/>, из-за чего закрепление шапки не работает,
 * а буквенные заголовки столбцов (A, B, C…) отключить штатно нечем.
 * Дописываем настройки прямо в xml листов уже в собранном архиве: xlsx — это zip,
 * а XLSX.CFB умеет его прочитать и собрать обратно.
 */
const applySheetViewSettings = (XLSX, base64) => {
    try {
        const cfb = XLSX.CFB.read(base64, { type: 'base64' });
        const decoder = new TextDecoder('utf-8');
        const encoder = new TextEncoder();
        const sheetView = '<sheetViews><sheetView showRowColHeaders="0" workbookViewId="0">'
            + '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
            + '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>'
            + '</sheetView></sheetViews>';
        for (const file of cfb.FileIndex) {
            if (!/^sheet\d+\.xml$/i.test(file.name || '')) continue;
            const xml = decoder.decode(new Uint8Array(file.content))
                .replace(/<sheetViews>[\s\S]*?<\/sheetViews>/, sheetView);
            file.content = encoder.encode(xml);
            file.size = file.content.length;
        }
        return XLSX.CFB.write(cfb, { type: 'base64', fileType: 'zip' });
    } catch {
        // Не смогли пропатчить — отдаём обычный файл. Косметика не повод ронять экспорт.
        return base64;
    }
};

/**
 * Считает строки всех листов. Вынесено отдельно от сборки книги, чтобы логику
 * можно было проверить без библиотеки xlsx.
 *
 * @param {{customers: any[], sales: any[], accounts: any[], investors: any[]}} data
 * @param {{startDate?: string, endDate?: string, onlyActive?: boolean, includePlanned?: boolean, now?: number}} options
 */
export function buildReportRows(data, options = {}) {
    const customers = data.customers || [];
    const sales = data.sales || [];
    const accounts = data.accounts || [];
    const investors = data.investors || [];
    const { startDate, endDate, onlyActive = false, includePlanned = false } = options;
    const nowTs = options.now || Date.now();

    // Пустые даты означают «весь период»: 0 <= saleDate <= Infinity истинно всегда.
    const filterStart = startDate ? new Date(startDate + 'T00:00:00').getTime() : 0;
    const filterEnd = endDate ? new Date(endDate + 'T23:59:59').getTime() : Infinity;

    const overviewData = [];
    const paymentsData = [];
    // Для каждой строки «Обзора клиентов» — с какого индекса в paymentsData начинаются
    // её платежи. По этим индексам ниже строятся гиперссылки «клиент → его платежи».
    const paymentAnchors = [];
    let filteredSalesCount = 0;

    let totalPeriodPayments = 0;
    let totalClientDebt = 0;
    // Итоги считаем по тем же правилам, что и главная страница (Dashboard):
    // «Сумма договоров» — только рассрочки (type === 'INSTALLMENT'), «Сумма закупа» —
    // все продажи с заполненным закупом. Прибыль копится только по продажам
    // с buyPrice > 0, иначе продажи без закупа засчитались бы как чистая прибыль.
    let totalContractsAmount = 0;
    let totalBuyPrice = 0;
    let totalProfit = 0;

    const investorTotals = new Map();

    // Те же исключения, что на главной: системные записи и «продажи», у которых
    // в роли клиента выступает инвестор — это внутренние движения денег, а не договоры.
    const investorIds = new Set(investors.map(i => i.id));

    for (const sale of sales) {
        if (String(sale.customerId || '').startsWith('system_')) continue;
        if (investorIds.has(sale.customerId)) continue;
        if (onlyActive && sale.status === 'COMPLETED') continue;

        const saleDate = new Date(sale.startDate).getTime();
        if (saleDate < filterStart || saleDate > filterEnd) continue;

        filteredSalesCount++;
        const customer = customers.find(c => c.id === sale.customerId);
        const account = accounts.find(a => a.id === sale.accountId);
        const investor = account?.ownerId ? investors.find(i => i.id === account.ownerId) : undefined;

        const statusStr = sale.status === 'COMPLETED' ? 'Завершен' : (sale.status === 'DRAFT' ? 'Оформлен' : 'Активен');
        const paymentPlan = sale.paymentPlan || [];

        const totalRealPaid = paymentPlan
            .filter(p => p.isRealPayment && p.isPaid)
            .reduce((sum, p) => sum + (p.amount || 0), 0);

        const currentDebt = Math.max(0, (sale.totalAmount || 0) - (sale.downPayment || 0) - totalRealPaid);
        totalClientDebt += currentDebt;

        const revenue = sale.totalAmount || 0;
        const buyPrice = sale.buyPrice || 0;
        const hasBuyPrice = buyPrice > 0;
        const profit = hasBuyPrice ? revenue - buyPrice : 0;

        if (sale.type === 'INSTALLMENT') totalContractsAmount += revenue;
        if (hasBuyPrice) {
            totalBuyPrice += buyPrice;
            totalProfit += profit;
        }

        // Просрочка: сколько по графику должно было быть оплачено к сегодняшнему дню
        // (плановые строки, дата которых уже прошла) против фактически полученных денег.
        // Первый непокрытый месяц даёт дату, от которой считаются дни задержки.
        const scheduledSorted = paymentPlan
            .filter(p => !p.isRealPayment)
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        let dueByNow = 0;
        let cumulative = 0;
        let firstUnpaidDate = null;
        for (const m of scheduledSorted) {
            if (new Date(m.date).getTime() <= nowTs) dueByNow += m.amount || 0;
            cumulative += m.amount || 0;
            if (!firstUnpaidDate && cumulative > totalRealPaid + 0.01) firstUnpaidDate = m.date;
        }
        const overdueAmount = Math.max(0, dueByNow - totalRealPaid);
        let overdueDays = 0;
        if (sale.status !== 'COMPLETED' && overdueAmount > 0.01 && firstUnpaidDate) {
            overdueDays = Math.max(0, Math.floor((nowTs - new Date(firstUnpaidDate).getTime()) / 86400000));
        }

        const investorName = investor?.name || 'Без инвестора';
        const agg = investorTotals.get(investorName)
            || { sales: 0, contracts: 0, buyPrice: 0, profit: 0, paid: 0, debt: 0 };
        agg.sales += 1;
        if (sale.type === 'INSTALLMENT') agg.contracts += revenue;
        if (hasBuyPrice) {
            agg.buyPrice += buyPrice;
            agg.profit += profit;
        }
        agg.paid += totalRealPaid;
        agg.debt += currentDebt;
        investorTotals.set(investorName, agg);

        // Порядок колонок: сначала кто и что, затем деньги одним блоком
        // (закуп → цена → прибыль → взнос → долг → просрочка), потом сроки и статус,
        // а редко нужные текстовые поля — в конец, чтобы не разрывать цифры.
        overviewData.push({
            'Клиент': customer?.name || 'Неизвестный клиент',
            'Телефон': customer?.phone || '',
            'Товар': sale.productName || '',
            'Цена закупа': buyPrice,
            'Цена рассрочки': revenue,
            'Прибыль': profit,
            'Взнос': sale.downPayment || 0,
            'Остаток долга': currentDebt,
            'Просрочка': overdueDays > 0 ? Math.round(overdueAmount) : 0,
            'Срок, мес': sale.installments || 0,
            'Оформлен': new Date(sale.startDate).toLocaleDateString('ru-RU'),
            '1-й платёж': paymentPlan.length > 0
                ? new Date(paymentPlan[0].date).toLocaleDateString('ru-RU')
                : '',
            'Статус': statusStr,
            'Инвестор': investor?.name || '-',
            // Имя и телефон поручителя в одной ячейке — минус целая колонка.
            'Поручитель': [sale.guarantorName, sale.guarantorPhone].filter(Boolean).join(', '),
            'Адрес': customer?.address || ''
        });

        paymentAnchors.push(paymentsData.length);

        const paymentsToExport = (includePlanned ? paymentPlan : paymentPlan.filter(p => p.isRealPayment))
            .filter(p => {
                const pDate = new Date(p.date).getTime();
                return pDate >= filterStart && pDate <= filterEnd;
            });

        if (paymentsToExport.length === 0) {
            paymentsData.push({
                'Клиент': customer?.name || 'Неизвестный клиент',
                'Товар': sale.productName || '',
                'Статус товара': statusStr,
                'Сумма': 0,
                'Дата платежа': '',
                'Платёж': 'Нет платежей в периоде'
            });
        } else {
            for (const payment of paymentsToExport) {
                if (payment.isRealPayment && payment.isPaid) {
                    totalPeriodPayments += payment.amount || 0;
                }
                paymentsData.push({
                    'Клиент': customer?.name || 'Неизвестный клиент',
                    'Товар': sale.productName || '',
                    'Статус товара': statusStr,
                    'Сумма': payment.amount || 0,
                    'Дата платежа': new Date(payment.date).toLocaleDateString('ru-RU'),
                    'Платёж': payment.note || (payment.isRealPayment ? 'Оплата' : 'План')
                });
            }
        }
    }

    if (filteredSalesCount === 0) {
        return { filteredSalesCount: 0, overviewData: [], paymentsData: [], investorData: [], summaryData: [], paymentAnchors: [] };
    }

    paymentsData.push({});
    paymentsData.push({
        'Клиент': 'ИТОГО:',
        'Товар': `Продаж: ${filteredSalesCount}`,
        'Статус товара': '',
        'Сумма': totalPeriodPayments,
        'Дата платежа': '',
        'Платёж': ''
    });

    const periodText = (!startDate && !endDate)
        ? 'Весь период (с начала работы)'
        : `${new Date(filterStart).toLocaleDateString('ru-RU')} — ${new Date(filterEnd).toLocaleDateString('ru-RU')}`;

    const summaryData = [
        { 'Параметр': '📅 Период выгрузки', 'Значение': periodText },
        { 'Параметр': '', 'Значение': '' },
        { 'Параметр': '💳 Получено платежей', 'Значение': `${totalPeriodPayments.toLocaleString('ru-RU')} ₽` },
        { 'Параметр': '📉 Общий долг клиентов', 'Значение': `${totalClientDebt.toLocaleString('ru-RU')} ₽` },
        { 'Параметр': '', 'Значение': '' },
        { 'Параметр': '🏷 Сумма договоров (рассрочка)', 'Значение': `${totalContractsAmount.toLocaleString('ru-RU')} ₽` },
        { 'Параметр': '📦 Сумма закупа', 'Значение': `${totalBuyPrice.toLocaleString('ru-RU')} ₽` },
        { 'Параметр': '📈 Прибыль (по договорам с закупом)', 'Значение': `${totalProfit.toLocaleString('ru-RU')} ₽` },
        { 'Параметр': '', 'Значение': '' },
        { 'Параметр': '🕐 Дата формирования', 'Значение': new Date(nowTs).toLocaleString('ru-RU') }
    ];

    const investorData = Array.from(investorTotals.entries())
        .sort((a, b) => b[1].contracts - a[1].contracts)
        .map(([name, t]) => ({
            'Инвестор': name,
            'Продаж': t.sales,
            'Сумма договоров': t.contracts,
            'Закуп': t.buyPrice,
            'Прибыль': t.profit,
            'Получено': t.paid,
            'Остаток долга': t.debt
        }));

    if (investorData.length > 0) {
        const sum = (key) => investorData.reduce((s, r) => s + (Number(r[key]) || 0), 0);
        investorData.push({
            'Инвестор': 'ИТОГО:',
            'Продаж': sum('Продаж'),
            'Сумма договоров': totalContractsAmount,
            'Закуп': totalBuyPrice,
            'Прибыль': totalProfit,
            'Получено': sum('Получено'),
            'Остаток долга': sum('Остаток долга')
        });
    }

    return { filteredSalesCount, overviewData, paymentsData, investorData, summaryData, paymentAnchors };
}

/**
 * Собирает книгу Excel и отдаёт её в base64 — единый формат и для скачивания
 * в браузере, и для вложения в письмо на сервере.
 *
 * @param {any} XLSX библиотека xlsx (передаётся снаружи, см. комментарий вверху файла)
 * @returns {{base64: string|null, salesCount: number}} base64 === null, если данных нет
 */
export function buildExcelReport(XLSX, data, options = {}) {
    const rows = buildReportRows(data, options);
    if (rows.filteredSalesCount === 0) return { base64: null, salesCount: 0 };

    const { overviewData, paymentsData, investorData, summaryData, paymentAnchors } = rows;
    const wb = XLSX.utils.book_new();

    const ws1 = XLSX.utils.json_to_sheet(overviewData);
    ws1['!cols'] = calculateColumnWidths(overviewData);
    ws1['!autofilter'] = autofilterRef(XLSX, overviewData);
    applyMoneyFormat(XLSX, ws1, overviewData, OVERVIEW_MONEY_COLUMNS);

    // Клик по имени клиента переносит на его первую строку в «Истории платежей».
    // В xlsx внутренние ссылки задаются через Target с ведущим «#» — это штатная
    // возможность формата, работает и в Excel, и в Google Sheets.
    // +2 к индексу: строка 1 — заголовок, а нумерация строк в Excel начинается с 1.
    overviewData.forEach((_, i) => {
        const addr = `A${i + 2}`;
        if (!ws1[addr]) return;
        ws1[addr].l = {
            Target: `#'История платежей'!A${paymentAnchors[i] + 2}`,
            Tooltip: 'Перейти к платежам этого клиента'
        };
    });
    XLSX.utils.book_append_sheet(wb, ws1, 'Обзор клиентов');

    const ws2 = XLSX.utils.json_to_sheet(paymentsData);
    ws2['!cols'] = calculateColumnWidths(paymentsData);
    ws2['!autofilter'] = autofilterRef(XLSX, paymentsData);
    applyMoneyFormat(XLSX, ws2, paymentsData, ['Сумма']);

    // Обратные ссылки: с первой строки платежей клиента — назад в «Обзор клиентов».
    paymentAnchors.forEach((anchor, i) => {
        const addr = `A${anchor + 2}`;
        if (!ws2[addr]) return;
        ws2[addr].l = {
            Target: `#'Обзор клиентов'!A${i + 2}`,
            Tooltip: 'Вернуться к карточке продажи'
        };
    });
    XLSX.utils.book_append_sheet(wb, ws2, 'История платежей');

    if (investorData.length > 0) {
        const ws4 = XLSX.utils.json_to_sheet(investorData);
        ws4['!cols'] = calculateColumnWidths(investorData);
        applyMoneyFormat(XLSX, ws4, investorData, INVESTOR_MONEY_COLUMNS);
        XLSX.utils.book_append_sheet(wb, ws4, 'По инвесторам');
    }

    const ws3 = XLSX.utils.json_to_sheet(summaryData);
    ws3['!cols'] = [{ wch: 45 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, ws3, 'Сводка');

    const base64 = applySheetViewSettings(XLSX, XLSX.write(wb, { type: 'base64', bookType: 'xlsx' }));
    return { base64, salesCount: rows.filteredSalesCount };
}
