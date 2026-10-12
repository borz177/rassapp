import type { Payment, Sale } from '../types';
import { addMonthsClamped } from './utils';

const isReconcileSlot = (p: Payment) => String(p.id || '').startsWith('pay_reconcile_');

/**
 * Лишние плановые строки: их больше, чем installments, и вместе они просят
 * больше, чем осталось после первого взноса. Так бывало после старой сверки —
 * к полному графику она достраивала pay_reconcile_*, и оплаченный договор
 * показывал неоплаченные платежи и «просрочку» при остатке 0 ₽.
 *
 * Убираем сначала достроенные сверкой, потом остальные — с поздних, и только
 * пока график не стал меньше нужного: график, где строк больше, но сумма
 * сходится (разбили платёж на части), не трогаем.
 */
export const dropExtraSlots = (sorted: Payment[], installments: number, totalDue: number): Payment[] => {
    let rows = sorted;
    let sum = rows.reduce((s, p) => s + p.amount, 0);
    if (rows.length <= installments || sum <= totalDue + 0.01) return rows;
    const candidates = [
        ...rows.filter(isReconcileSlot).reverse(),
        ...rows.filter(p => !isReconcileSlot(p)).reverse(),
    ];
    for (const p of candidates) {
        if (rows.length <= installments || sum <= totalDue + 0.01) break;
        if (sum - p.amount < totalDue - 0.01) continue;
        rows = rows.filter(x => x !== p);
        sum -= p.amount;
    }
    return rows;
};

// 🔒 Единая функция приведения графика платежей (paymentPlan) и remainingAmount к согласованному
// виду. Раньше "остаток долга" и "график платежей" считались и обновлялись независимо друг от
// друга в трёх разных местах (handleSaveSale, handleIncomeSubmit, handleUndoPayment) — при
// офлайн-сохранении, гонке с фоновой синхронизацией или редактировании договора без явного
// изменения полей графика эти два числа расходились: то плановый платёж не создавался вообще
// (paymentPlan короче, чем installments), то remainingAmount не совпадал с суммой того, что
// реально показывает график. Теперь ЛЮБОЕ сохранение договора проходит через эту функцию —
// несогласованное состояние просто не может быть записано, независимо от причины.
export const reconcileSalePaymentPlan = (sale: Sale): Sale => {
    if (sale.type !== 'INSTALLMENT' || !Array.isArray(sale.paymentPlan)) return sale;

    const realPaidEntries = sale.paymentPlan.filter((p: Payment) => p.isPaid && p.isRealPayment !== false);
    const totalRealPaid = realPaidEntries.reduce((sum: number, p: Payment) => sum + p.amount, 0);
    // 🆕 Скидка при полном погашении (handleIncomeSubmit) "гасит" долг без реальных денег —
    // считаем её наравне с реальной оплатой, иначе остаток долга не дойдёт до нуля.
    const totalDiscounts = realPaidEntries.reduce((sum: number, p: Payment) => sum + ((p as any).discountAmount || 0), 0);

    const existingScheduled = sale.paymentPlan.filter((p: Payment) => p.isRealPayment !== true);
    const totalDue = Math.max(0, sale.totalAmount - sale.downPayment);
    const installments = Math.max(1, sale.installments || existingScheduled.length || 1);
    const monthlyAmount = Math.round((totalDue / installments) * 100) / 100;

    // 🔒 Определяем, каким КАЛЕНДАРНЫМ месяцам вообще должны соответствовать плановые слоты
    // (от даты первого платежа — startDate+1 месяц, день = paymentDay — и дальше по одному
    // месяцу на installment), и для каждого либо берём существующую запись за этот месяц
    // (сохраняя её id/isPaid/note как есть), либо создаём новую. Раньше недостающий платёж
    // просто добавлялся ПОСЛЕ последней записи в массиве — если реально пропущенные месяцы
    // были более РАННИМИ (а не последними), новый слот вставал не на своё место (например,
    // "довесок" за первые 9 месяцев уезжал на 9 месяцев ВПЕРЁД относительно последних трёх
    // уже существовавших) и график показывал совсем не те даты, что нужно.
    let firstPaymentDate: Date | null = new Date(sale.startDate);
    if (isNaN(firstPaymentDate.getTime())) {
        firstPaymentDate = null;
    } else {
        firstPaymentDate = addMonthsClamped(firstPaymentDate, 1);
        if (sale.paymentDay) {
            const daysInMonth = new Date(firstPaymentDate.getFullYear(), firstPaymentDate.getMonth() + 1, 0).getDate();
            firstPaymentDate.setDate(Math.min(sale.paymentDay, daysInMonth));
        }
    }

    let scheduled: Payment[];
    if (existingScheduled.length >= installments) {
        // 🔒 Уже есть столько же (или больше) плановых записей, сколько установлено
        // installments — значит ничего не пропущено, ничего достраивать не нужно. Берём
        // существующие как есть, НЕ пытаясь угадать календарные месяцы через startDate.
        // У Sale нет отдельного поля "дата первого платежа" (только paymentDay — день месяца),
        // поэтому startDate+1 месяц — лишь предположение; если договор редактировали и
        // реальная дата первого платежа съехала (например, при редактировании явно указали
        // другую дату первого платежа), предположение расходится с тем, что уже в графике, и
        // код (до этой правки) считал существующие месяцы "непонятными" и задваивал их лишней
        // записью, хотя всё уже было на месте.
        scheduled = existingScheduled.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        scheduled = dropExtraSlots(scheduled, installments, totalDue);
    } else if (existingScheduled.length > 0) {
        // 🔒 Не хватает части плановых слотов, но хотя бы один уже есть — опираемся на ЕГО
        // дату (она отражает реальную дату первого платежа, которую выбрали при
        // оформлении/редактировании), а не на startDate+1 месяц вслепую. Достраиваем
        // недостающие месяцы либо ДО существующего блока, либо ПОСЛЕ — направление определяем
        // по знаку "лишних" реальных денег: если реально оплачено больше, чем покрывают
        // существующие слоты, — значит недостающие месяцы более РАННИЕ (деньгам просто некуда
        // деваться против только поздних слотов); иначе — недостающие месяцы более ПОЗДНИЕ
        // (обычный случай "не хватает хвоста графика").
        const sortedExisting = existingScheduled
            .slice()
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        const existingSum = sortedExisting.reduce((sum, p) => sum + p.amount, 0);
        const missingCount = installments - sortedExisting.length;
        const extendBefore = totalRealPaid + totalDiscounts > existingSum + 0.01;

        const rebuilt: Payment[] = [];
        if (extendBefore) {
            const anchor = new Date(sortedExisting[0].date);
            for (let i = missingCount; i >= 1; i--) {
                const slotDate = addMonthsClamped(anchor, -i);
                rebuilt.push({
                    id: `pay_reconcile_${Date.now()}_${missingCount - i}`,
                    saleId: sale.id,
                    date: slotDate.toISOString(),
                    amount: monthlyAmount,
                    isPaid: false,
                    isRealPayment: false
                });
            }
            scheduled = [...rebuilt, ...sortedExisting];
        } else {
            const anchor = new Date(sortedExisting[sortedExisting.length - 1].date);
            for (let i = 1; i <= missingCount; i++) {
                const slotDate = addMonthsClamped(anchor, i);
                rebuilt.push({
                    id: `pay_reconcile_${Date.now()}_${i}`,
                    saleId: sale.id,
                    date: slotDate.toISOString(),
                    amount: monthlyAmount,
                    isPaid: false,
                    isRealPayment: false
                });
            }
            scheduled = [...sortedExisting, ...rebuilt];
        }
    } else if (firstPaymentDate) {
        // 🔙 Плановых слотов нет вообще (пустой график, installments:0-стиль договор) —
        // единственный случай, где реально приходится вычислять дату первого платежа из
        // startDate, потому что опереться не на что.
        const rebuilt: Payment[] = [];
        for (let i = 0; i < installments; i++) {
            const slotDate = addMonthsClamped(firstPaymentDate, i);
            rebuilt.push({
                id: `pay_reconcile_${Date.now()}_${i}`,
                saleId: sale.id,
                date: slotDate.toISOString(),
                amount: monthlyAmount,
                isPaid: false,
                isRealPayment: false
            });
        }
        scheduled = rebuilt;
    } else {
        // 🔙 Не удалось разобрать startDate — подстраховка: старое поведение (докинуть
        // недостающую сумму одним слотом после последней записи), лучше грубо, чем никак.
        scheduled = existingScheduled.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        const totalScheduledAmount = scheduled.reduce((sum, p) => sum + p.amount, 0);
        const missingAmount = Math.round((totalDue - totalScheduledAmount) * 100) / 100;
        if (missingAmount > 0.01) {
            const lastDate = scheduled.length > 0 ? new Date(scheduled[scheduled.length - 1].date) : new Date();
            const newDate = addMonthsClamped(lastDate, 1);
            scheduled = [...scheduled, {
                id: `pay_reconcile_${Date.now()}_${scheduled.length}`,
                saleId: sale.id,
                date: newDate.toISOString(),
                amount: missingAmount,
                isPaid: false,
                isRealPayment: false
            }];
        }
    }

    // 🔹 Пересчитываем isPaid плановых слотов от факта реальных платежей (по датам, от раннего
    // к позднему) — не доверяем унаследованным флагам: они могут "зависнуть" в isPaid:true после
    // удаления покрывавшего их реального платежа (см. handleUndoPayment).
    let surplus = totalRealPaid + totalDiscounts;
    const reconciledScheduled = scheduled.map((p: Payment) => {
        const covered = surplus >= p.amount - 0.01;
        if (covered) surplus = Math.max(0, surplus - p.amount);
        return { ...p, isPaid: covered };
    });

    const realPayments = sale.paymentPlan.filter((p: Payment) => p.isRealPayment === true);
    const correctRemaining = Math.max(0, Math.round((totalDue - totalRealPaid - totalDiscounts) * 100) / 100);

    return {
        ...sale,
        paymentPlan: [...reconciledScheduled, ...realPayments],
        remainingAmount: correctRemaining
    };
};
