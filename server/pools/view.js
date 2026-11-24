// Другому участнику не раскрываем имена из сохранённого расчёта месяца.
function poolAccountForViewer(account, viewer) {
    if (!account.poolAccounting && !account.poolRequests)
        return account;
    const copy = structuredClone(account);
    if (copy.poolAccounting)
        delete copy.poolAccounting.requests;
    delete copy.poolRequests;
    if (viewer.role === 'investor')
        for (const month of copy.poolAccounting?.closed || [])
            for (const row of month.shares || [])
                if (row.investorId !== viewer.id)
                    row.name = 'Участник пула';
    return copy;
}
module.exports = { poolAccountForViewer };
