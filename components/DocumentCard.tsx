import React, { useState } from 'react';
import type { Account, AppSettings, RetailSale, User } from '../types';
import { formatCurrency, retailPaidAmount } from '../src/utils';
import { KIND_LABEL, printJournalDoc, type JournalDoc } from '../src/journalDocs';
import TopBarBack from './TopBarBack';
import TabPill from './TabPill';

interface DocumentCardProps {
  doc: JournalDoc;
  accounts: Account[];
  appSettings: AppSettings;
  employees?: User[];
  user?: User | null;
  onBack: () => void;
  onSelectCustomer?: (id: string) => void;
  onAcceptPayment?: (sale: RetailSale) => void;
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
}) => {
  const [tab, setTab] = useState<'INFO' | 'PAY'>('INFO');
  const cents = appSettings.showCents;

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
    </div>
  );
};

export default DocumentCard;
