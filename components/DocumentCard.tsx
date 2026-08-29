import React, { useState } from 'react';
import type { Account, AppSettings, Customer, RetailSale, StockMovement, Supplier, User } from '../types';
import { formatCurrency, retailPaidAmount } from '../src/utils';
import { KIND_LABEL, printJournalDoc, type JournalDoc } from '../src/journalDocs';
import TopBarBack from './TopBarBack';
import TabPill from './TabPill';
import ModalPortal from './ModalPortal';

interface DocumentCardProps {
  doc: JournalDoc;
  accounts: Account[];
  appSettings: AppSettings;
  employees?: User[];
  user?: User | null;
  onBack: () => void;
  onSelectCustomer?: (id: string) => void;
  onAcceptPayment?: (sale: RetailSale) => void;
  customers?: Customer[];
  suppliers?: Supplier[];
  /** Правка чека: номер, дата, комментарий, покупатель, счёт, оплата */
  onUpdateSale?: (sale: RetailSale) => Promise<void> | void;
  /** Правка складского документа: те же поля сразу у всех его движений */
  onUpdateStockDoc?: (movements: StockMovement[]) => Promise<void> | void;
}

/**
 * Карточка документа: состав, контрагенты, оплата.
 *
 * Отдельным компонентом, а не куском журнала: тот же документ открывают из
 * истории товара, и вторая копия разметки разошлась бы с первой на первой же
 * правке — один экран показывал бы не то, что другой.
 */
const DocumentCard: React.FC<DocumentCardProps> = ({
  doc, accounts, appSettings, employees = [], user, onBack, onSelectCustomer, onAcceptPayment,
  customers = [], suppliers = [], onUpdateSale, onUpdateStockDoc,
}) => {
  const [tab, setTab] = useState<'INFO' | 'PAY'>('INFO');
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    number: '', date: '', note: '', customerId: '', accountId: '', supplierId: '', isCredit: false,
  });
  const cents = appSettings.showCents;

  const canEdit = doc.kind === 'SALE' ? !!onUpdateSale : !!onUpdateStockDoc;
  // Признак оплаты трогать нельзя, когда деньги по документу уже приняты:
  // переключение обнулило бы поступления, которые реально были.
  const canSwitchPaid = doc.kind === 'SALE' && (doc.sale?.payments || []).length === 0;

  const openEdit = () => {
    setForm({
      number: doc.number,
      // input[type=date] понимает только YYYY-MM-DD, поэтому режем, а время
      // документа сохраняем отдельно при записи — иначе порядок продаж внутри
      // дня схлопнулся бы в полночь.
      date: new Date(doc.date).toISOString().slice(0, 10),
      note: doc.note || '',
      customerId: doc.sale?.customerId || '',
      accountId: doc.sale?.accountId || '',
      supplierId: doc.supplierId || '',
      isCredit: !!doc.sale?.isCredit,
    });
    setEditOpen(true);
  };

  const saveEdit = async () => {
    setSaving(true);
    try {
      const [y, m, d] = form.date.split('-').map(Number);
      const old = new Date(doc.date);
      const date = new Date(y, (m || 1) - 1, d || 1, old.getHours(), old.getMinutes(), old.getSeconds()).toISOString();

      if (doc.kind === 'SALE' && doc.sale && onUpdateSale) {
        await onUpdateSale({
          ...doc.sale,
          docNumber: form.number.trim() || doc.sale.docNumber,
          date,
          note: form.note.trim() || undefined,
          customerId: form.customerId || undefined,
          accountId: form.accountId || doc.sale.accountId,
          // Долг без покупателя не с кого спрашивать — снимаем вместе с клиентом.
          isCredit: canSwitchPaid ? (!!form.customerId && form.isCredit) : doc.sale.isCredit,
        });
      } else if (doc.movements && onUpdateStockDoc) {
        await onUpdateStockDoc(doc.movements.map(mv => ({
          ...mv,
          docNumber: form.number.trim() || mv.docNumber,
          date,
          note: form.note.trim() || undefined,
          supplierId: doc.kind === 'IN' ? (form.supplierId || undefined) : mv.supplierId,
        })));
      }
      setEditOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const input = 'w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-200 outline-none focus:border-indigo-400';

  const paid = doc.sale ? retailPaidAmount(doc.sale) : 0;
  const author = doc.authorId
    ? (doc.authorId === user?.id ? user?.name : employees.find(e => e.id === doc.authorId)?.name)
    : null;
  const accountName = doc.sale
    ? accounts.find(a => a.id === doc.sale!.accountId)?.name || 'Счёт удалён'
    : null;

  const row = (label: string, value: React.ReactNode, sub?: string) => (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="font-semibold text-slate-800 dark:text-white truncate">{value}</p>
        <p className="text-[11px] text-slate-500 dark:text-slate-400">{sub || label}</p>
      </div>
    </div>
  );

  return (
    <div className="space-y-4 pb-10">
      <div className="flex items-center gap-3">
        <TopBarBack onClick={onBack} />
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-bold text-slate-800 dark:text-white truncate">
            {KIND_LABEL[doc.kind]} №{doc.number}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {new Date(doc.date).toLocaleString('ru-RU', {
              day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
            })}
          </p>
        </div>
        {canEdit && (
          <button onClick={openEdit} aria-label="Редактировать"
                  className="shrink-0 w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 flex items-center justify-center">
            ✎
          </button>
        )}
        <button onClick={() => printJournalDoc(doc)}
                className="shrink-0 px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-sm font-bold">
          Печать
        </button>
      </div>

      {/* Вкладка оплаты нужна только там, где деньги вообще есть: у списания
          или перемещения она была бы пустой страницей с прочерками. */}
      {doc.kind === 'SALE' && (
        <div className="relative flex p-1 rounded-[24px] bg-white/60 dark:bg-slate-800/60 border border-white/70 dark:border-slate-700 shadow-sm">
          <TabPill index={tab === 'INFO' ? 0 : 1} count={2} pad={4} />
          {([['INFO', 'Информация'], ['PAY', 'Оплата']] as const).map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
                    className={`relative z-10 flex-1 min-w-0 py-2.5 text-sm font-bold rounded-xl transition-colors ${
                      tab === id ? 'text-indigo-600 dark:text-indigo-300' : 'text-slate-500 dark:text-slate-400'
                    }`}>{label}</button>
          ))}
        </div>
      )}

      {(doc.kind !== 'SALE' || tab === 'INFO') && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700">
            <div className="flex items-center gap-3 px-4 py-3">
              <div className={`w-9 h-9 shrink-0 rounded-xl flex items-center justify-center text-white ${
                doc.debt > 0 ? 'bg-amber-500' : 'bg-emerald-500'
              }`}>✓</div>
              <div>
                <p className="font-semibold text-slate-800 dark:text-white">
                  {doc.debt > 0 ? 'Проведён, есть долг' : 'Проведён'}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">Статус документа</p>
              </div>
            </div>
            {author && row('Автор', author)}
          </div>

          <div>
            <p className="text-xs font-bold text-indigo-600 dark:text-indigo-400 mb-2 px-1">Контрагенты</p>
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700">
              {row(doc.kind === 'IN' ? 'Поставщик' : 'Откуда', doc.from,
                   doc.kind === 'IN' ? 'Поставщик' : doc.kind === 'SALE' ? 'Продавец' : 'Откуда')}
              {doc.customerId && onSelectCustomer ? (
                <button onClick={() => onSelectCustomer(doc.customerId!)}
                        className="w-full text-left active:bg-slate-50 dark:active:bg-slate-700/50">
                  {row('Клиент', doc.to, 'Клиент · открыть карточку')}
                </button>
              ) : row('Куда', doc.to, doc.kind === 'SALE' ? 'Покупатель' : 'Куда')}
              {accountName && row('Счёт', accountName, 'Счёт')}
            </div>
          </div>

          <div>
            <p className="text-xs font-bold text-indigo-600 dark:text-indigo-400 mb-2 px-1">Товары</p>
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700">
              {doc.lines.map((l, i) => (
                <div key={`${l.name}_${i}`} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-800 dark:text-white truncate">{l.name}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {l.quantity} {l.unit || 'шт'}{l.price > 0 ? ` × ${formatCurrency(l.price, cents)} ₽` : ''}
                    </p>
                  </div>
                  {l.price > 0 && (
                    <p className="font-bold text-slate-800 dark:text-white shrink-0">
                      {formatCurrency(l.quantity * l.price, cents)} ₽
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-4">
            {doc.discount > 0 && (
              <div className="flex justify-between text-sm mb-1">
                <span className="text-slate-500 dark:text-slate-400">Скидка</span>
                <span className="font-semibold text-amber-600 dark:text-amber-400">
                  −{formatCurrency(doc.discount, cents)} ₽
                </span>
              </div>
            )}
            <div className="flex justify-between items-end">
              <span className="text-slate-500 dark:text-slate-400 text-sm">Итого</span>
              <span className="text-2xl font-extrabold text-slate-800 dark:text-white">
                {formatCurrency(doc.total, cents)} ₽
              </span>
            </div>
          </div>

          {doc.note && <p className="text-sm text-slate-500 dark:text-slate-400 px-1">{doc.note}</p>}
        </div>
      )}

      {doc.kind === 'SALE' && tab === 'PAY' && doc.sale && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-500 dark:text-slate-400">Сумма документа</span>
              <span className="font-bold text-slate-800 dark:text-white">{formatCurrency(doc.total, cents)} ₽</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500 dark:text-slate-400">Оплачено</span>
              <span className="font-bold text-emerald-600 dark:text-emerald-400">
                {formatCurrency(doc.sale.isCredit ? paid : doc.total, cents)} ₽
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500 dark:text-slate-400">Долг</span>
              <span className={`font-bold ${doc.debt > 0 ? 'text-rose-500' : 'text-slate-400'}`}>
                {formatCurrency(doc.debt, cents)} ₽
              </span>
            </div>
          </div>

          {doc.sale.isCredit ? (
            <div>
              <p className="text-xs font-bold text-indigo-600 dark:text-indigo-400 mb-2 px-1">Поступления</p>
              {(doc.sale.payments || []).length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400 px-1">Оплат пока не было.</p>
              ) : (
                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700">
                  {doc.sale.payments!.map(pm => (
                    <div key={pm.id} className="px-4 py-3">
                      <p className="font-semibold text-emerald-600 dark:text-emerald-400">
                        +{formatCurrency(pm.amount, cents)} ₽
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {new Date(pm.date).toLocaleDateString('ru-RU')}
                        {' · '}{accounts.find(a => a.id === pm.accountId)?.name || 'Счёт удалён'}
                        {pm.note ? ` · ${pm.note}` : ''}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400 px-1">
              Оплачено при продаже — деньги поступили на счёт сразу.
            </p>
          )}

          {doc.debt > 0 && onAcceptPayment && (
            <button onClick={() => onAcceptPayment(doc.sale!)}
                    className="w-full py-3.5 rounded-2xl bg-amber-600 text-white font-bold active:scale-[0.99] transition-transform">
              Принять оплату
            </button>
          )}
        </div>
      )}
      {editOpen && (
        <ModalPortal onClose={() => setEditOpen(false)}>
          <div className="fixed inset-0 z-modal flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm"
               onClick={() => setEditOpen(false)}>
            <div className="bg-white dark:bg-slate-800 w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[85vh] overflow-y-auto p-5 space-y-3"
                 onClick={e => e.stopPropagation()}>
              <h3 className="font-bold text-slate-800 dark:text-white">
                {KIND_LABEL[doc.kind]} №{doc.number}
              </h3>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Номер</label>
                  <input value={form.number} onChange={e => setForm({ ...form, number: e.target.value })} className={`${input} mt-1`} />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Дата</label>
                  <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className={`${input} mt-1`} />
                </div>
              </div>

              {doc.kind === 'SALE' && (
                <>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Покупатель</label>
                    <select value={form.customerId} onChange={e => setForm({ ...form, customerId: e.target.value })} className={`${input} mt-1`}>
                      <option value="">Розничный покупатель</option>
                      {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Счёт</label>
                    <select value={form.accountId} onChange={e => setForm({ ...form, accountId: e.target.value })} className={`${input} mt-1`}>
                      {accounts.filter(a => !a.isArchived || a.id === form.accountId)
                               .map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </div>
                  {canSwitchPaid ? (
                    form.customerId ? (
                      <div className="relative flex p-1 rounded-2xl bg-slate-100 dark:bg-slate-700">
                        {([[false, 'Оплачено'], [true, 'В долг']] as const).map(([v, label]) => (
                          <button key={label} type="button" onClick={() => setForm({ ...form, isCredit: v })}
                                  className={`flex-1 min-w-0 py-2 rounded-xl text-xs font-bold transition-colors ${
                                    form.isCredit === v
                                      ? 'bg-white dark:bg-slate-800 text-slate-800 dark:text-white shadow-sm'
                                      : 'text-slate-500 dark:text-slate-400'
                                  }`}>{label}</button>
                        ))}
                      </div>
                    ) : null
                  ) : (
                    <p className="text-[11px] text-slate-400 dark:text-slate-500">
                      Оплату уже принимали — признак долга менять нельзя, иначе поступления повиснут без документа.
                    </p>
                  )}
                </>
              )}

              {doc.kind === 'IN' && (
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Поставщик</label>
                  <select value={form.supplierId} onChange={e => setForm({ ...form, supplierId: e.target.value })} className={`${input} mt-1`}>
                    <option value="">Не указан</option>
                    {suppliers.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                </div>
              )}

              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Комментарий</label>
                <input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} className={`${input} mt-1`} />
              </div>

              {/* Количества правятся не здесь: остаток объясняется движениями, и
                  переписать проведённый документ значит изменить историю склада
                  так, что расхождение будет нечем объяснить. */}
              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                Состав и количества документа не меняются. Ошибку в количестве
                исправляют {doc.kind === 'SALE' ? 'возвратом или инвентаризацией' : 'списанием или инвентаризацией'} —
                так остаток остаётся объяснимым.
              </p>

              <div className="flex gap-2 pt-1">
                <button onClick={() => setEditOpen(false)}
                        className="flex-1 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold text-sm">
                  Отмена
                </button>
                <button disabled={saving} onClick={saveEdit}
                        className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white font-bold text-sm disabled:opacity-50">
                  Сохранить
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
};

export default DocumentCard;
