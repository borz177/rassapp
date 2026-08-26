import React, { useMemo, useState } from 'react';
import { Customer, Expense, Sale, Supplier } from '../types';
import { ICONS } from '../constants';
import TopBarBack from './TopBarBack';
import { formatCurrency, escapeHtml } from '../src/utils';

interface SupplierDetailsProps {
  supplier: Supplier;
  sales: Sale[];
  expenses: Expense[];
  customers: Customer[];
  showCents?: boolean;
  appSettings?: any;
  onBack: () => void;
  onPaySupplier: (sale: Sale) => void;
  onViewContract: (sale: Sale) => void;
}

const SupplierDetails: React.FC<SupplierDetailsProps> = ({ supplier, sales, expenses, customers, showCents, appSettings, onBack, onPaySupplier, onViewContract }) => {
  const [contractFilter, setContractFilter] = useState<'ALL' | 'DEBT' | 'PAID'>('ALL');
  const supplierSales = useMemo(
    () => sales.filter(s => s.supplierId === supplier.id).sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime()),
    [sales, supplier]
  );

  const payments = useMemo(
    () => expenses
      .filter(e => e.supplierId === supplier.id && e.category === 'Оплата партнёру')
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [expenses, supplier]
  );

  const totalDebt = useMemo(
    () => supplierSales.reduce((sum, s) => {
      if (s.isPartnerDebtPaid) return sum;
      return sum + Math.max(0, s.buyPrice - (s.partnerDebtPaidAmount || 0));
    }, 0),
    [supplierSales]
  );

  const totalVolume = useMemo(() => supplierSales.reduce((sum, s) => sum + (s.buyPrice || 0), 0), [supplierSales]);
  const totalPaid = useMemo(() => payments.reduce((sum, p) => sum + p.amount, 0), [payments]);
  const openContractsCount = useMemo(() => supplierSales.filter(s => !s.isPartnerDebtPaid && (s.buyPrice - (s.partnerDebtPaidAmount || 0)) > 0).length, [supplierSales]);
  const paidContractsCount = supplierSales.length - openContractsCount;

  const filteredSupplierSales = useMemo(() => {
    if (contractFilter === 'DEBT') return supplierSales.filter(s => !s.isPartnerDebtPaid && (s.buyPrice - (s.partnerDebtPaidAmount || 0)) > 0);
    if (contractFilter === 'PAID') return supplierSales.filter(s => s.isPartnerDebtPaid || (s.buyPrice - (s.partnerDebtPaidAmount || 0)) <= 0);
    return supplierSales;
  }, [supplierSales, contractFilter]);

  const handlePrintStatement = () => {
    const companyName = appSettings?.companyName || 'Компания';
    type StatementRow = { date: string; type: 'Договор' | 'Оплата'; title: string; debit: number; credit: number };
    const rows: StatementRow[] = [
      ...supplierSales.map(s => ({ date: s.startDate, type: 'Договор' as const, title: s.productName, debit: s.buyPrice || 0, credit: 0 })),
      ...payments.map(p => ({ date: p.date, type: 'Оплата' as const, title: p.title, debit: 0, credit: p.amount })),
    ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let running = 0;
    const rowsHtml = rows.map((r, idx) => {
      running += r.debit - r.credit;
      return `
        <tr>
          <td style="text-align:center;">${idx + 1}</td>
          <td style="text-align:center;">${new Date(r.date).toLocaleDateString('ru-RU')}</td>
          <td>${r.type}: ${r.title}</td>
          <td style="text-align:right;">${r.debit ? formatCurrency(r.debit, showCents) + ' ₽' : ''}</td>
          <td style="text-align:right;">${r.credit ? formatCurrency(r.credit, showCents) + ' ₽' : ''}</td>
          <td style="text-align:right; font-weight:bold;">${formatCurrency(running, showCents)} ₽</td>
        </tr>
      `;
    }).join('');

    const periodStart = rows.length > 0 ? new Date(rows[0].date).toLocaleDateString('ru-RU') : '-';
    const periodEnd = new Date().toLocaleDateString('ru-RU');

    const printWindow = window.open('', '_blank');
    if (!printWindow) { alert('Разрешите всплывающие окна для печати'); return; }

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Акт сверки — ${supplier.name}</title>
        <style>
          * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          body { font-family: 'Arial', Helvetica, sans-serif; font-size: 12pt; line-height: 1.5; padding: 20mm; max-width: 210mm; margin: 0 auto; }
          h1 { text-align: center; font-size: 15pt; font-weight: bold; margin: 0 0 10px 0; text-transform: uppercase; }
          .subtitle { text-align: center; font-size: 11pt; margin-bottom: 20px; color: #444; }
          .header-info { display: flex; justify-content: space-between; margin-bottom: 20px; font-size: 11pt; }
          table { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 10.5pt; }
          th, td { border: 1px solid #000; padding: 6px 8px; }
          th { font-weight: bold; background: #f9f9f9; text-align: center; }
          .totals { display: flex; justify-content: flex-end; margin-top: 15px; font-size: 12pt; font-weight: bold; }
          .no-print { position: fixed; top: 15px; right: 15px; padding: 10px 18px; background: #ef4444; color: white; border: none; border-radius: 6px; cursor: pointer; font-family: sans-serif; font-weight: 600; z-index: 1000; }
          @media print { @page { margin: 1.5cm; size: A4 portrait; } .no-print { display: none !important; } }
        </style>
      </head>
      <body>
        <button class="no-print" onclick="window.close()">✕ Закрыть</button>
        <h1>Акт сверки взаимных расчётов</h1>
        <div class="subtitle">${escapeHtml(companyName)} — ${escapeHtml(supplier.name)}</div>
        <div class="header-info">
          <span>Период: ${periodStart} — ${periodEnd}</span>
          <span>Договоров: ${supplierSales.length}</span>
        </div>
        <table>
          <thead>
            <tr><th style="width:5%;">№</th><th style="width:12%;">Дата</th><th>Операция</th><th style="width:15%;">Долг (+)</th><th style="width:15%;">Оплата (-)</th><th style="width:15%;">Остаток</th></tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
        <div class="totals">Текущий долг: ${formatCurrency(running, showCents)} ₽</div>
        <script>window.onload = function() { setTimeout(() => { window.print(); }, 300); }</script>
      </body>
      </html>
    `;
    printWindow.document.write(htmlContent);
    printWindow.document.close();
  };

  return (
    <div className="space-y-4 animate-fade-in pb-20">
      <div className="flex items-center gap-3 border-b border-slate-200 dark:border-slate-700 pb-4 pt-2">
        <TopBarBack onClick={onBack} />
        <h2 className="text-xl font-bold text-slate-800 dark:text-white flex-1">{supplier.name}</h2>
        <button
          onClick={handlePrintStatement}
          className="text-sm font-medium text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-900/50 px-3 py-1.5 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/30"
        >
          Печать акта сверки
        </button>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl p-5 shadow-sm border border-slate-100 dark:border-slate-700 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div><label className="text-xs text-slate-400 uppercase">Телефон</label><p className="font-medium text-slate-800 dark:text-white">{supplier.phone || '-'}</p></div>
          <div><label className="text-xs text-slate-400 uppercase">Email</label><p className="font-medium text-slate-800 dark:text-white">{supplier.email || '-'}</p></div>
          <div><label className="text-xs text-slate-400 uppercase">В базе с</label><p className="font-medium text-slate-800 dark:text-white">{supplier.createdAt ? new Date(supplier.createdAt).toLocaleDateString('ru-RU') : '-'}</p></div>
          <div><label className="text-xs text-slate-400 uppercase">Договоров</label><p className="font-medium text-slate-800 dark:text-white">{supplierSales.length} <span className="text-xs text-slate-400">({openContractsCount} с долгом)</span></p></div>
        </div>
        {supplier.notes && (
          <div><label className="text-xs text-slate-400 uppercase">Заметки</label><p className="text-sm text-slate-600 dark:text-slate-300">{supplier.notes}</p></div>
        )}
        <div className="pt-2">
          <label className="text-xs text-slate-400 uppercase">Текущий долг</label>
          <p className={`text-3xl font-bold mt-1 ${totalDebt > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
            {formatCurrency(totalDebt, showCents)} ₽
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-100 dark:border-slate-700">
          <h3 className="font-bold text-sm text-slate-800 dark:text-white mb-1">Общий объём закупа</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">За всё время</p>
          <p className="text-2xl font-bold text-slate-800 dark:text-white">{formatCurrency(totalVolume, showCents)} ₽</p>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-100 dark:border-slate-700">
          <h3 className="font-bold text-sm text-slate-800 dark:text-white mb-1">Всего оплачено</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">За всё время</p>
          <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(totalPaid, showCents)} ₽</p>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-slate-800 dark:text-white">Договоры</h3>
          <div className="flex bg-slate-100 dark:bg-slate-700 p-1 rounded-xl text-xs">
            <button
              onClick={() => setContractFilter('ALL')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all ${contractFilter === 'ALL' ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500 dark:text-slate-400'}`}
            >
              Все ({supplierSales.length})
            </button>
            <button
              onClick={() => setContractFilter('DEBT')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all ${contractFilter === 'DEBT' ? 'bg-white dark:bg-slate-800 text-red-600 dark:text-red-400 shadow-sm' : 'text-slate-500 dark:text-slate-400'}`}
            >
              С долгом ({openContractsCount})
            </button>
            <button
              onClick={() => setContractFilter('PAID')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all ${contractFilter === 'PAID' ? 'bg-white dark:bg-slate-800 text-emerald-600 dark:text-emerald-400 shadow-sm' : 'text-slate-500 dark:text-slate-400'}`}
            >
              Оплачено ({paidContractsCount})
            </button>
          </div>
        </div>
        {filteredSupplierSales.length === 0 && (<div className="text-center py-8 text-slate-400">Нет договоров по выбранному фильтру</div>)}
        {filteredSupplierSales.map(s => {
          const remaining = Math.max(0, s.buyPrice - (s.partnerDebtPaidAmount || 0));
          const customerName = customers.find(c => c.id === s.customerId)?.name || 'Клиент не найден';
          return (
            <div
              key={s.id}
              onClick={() => onViewContract(s)}
              className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-4 space-y-2 cursor-pointer hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors"
            >
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-bold text-slate-800 dark:text-white text-sm">{s.productName}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{customerName} · {new Date(s.startDate).toLocaleDateString()}</p>
                </div>
                <span className={`text-xs font-semibold px-2 py-1 rounded-full ${s.isPartnerDebtPaid ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400' : 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400'}`}>
                  {s.isPartnerDebtPaid ? 'Оплачено' : 'Долг'}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div><span className="text-slate-400 text-xs block">Закуп</span><span className="font-medium text-slate-800 dark:text-white">{formatCurrency(s.buyPrice, showCents)} ₽</span></div>
                <div><span className="text-slate-400 text-xs block">Оплачено</span><span className="font-medium text-slate-800 dark:text-white">{formatCurrency(s.partnerDebtPaidAmount || 0, showCents)} ₽</span></div>
                <div><span className="text-slate-400 text-xs block">Остаток</span><span className="font-medium text-red-600 dark:text-red-400">{formatCurrency(remaining, showCents)} ₽</span></div>
              </div>
              {!s.isPartnerDebtPaid && remaining > 0 && (
                <button
                  onClick={(e) => { e.stopPropagation(); onPaySupplier(s); }}
                  className="w-full mt-2 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold"
                >
                  Оплатить поставщику
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="space-y-3">
        <h3 className="font-bold text-slate-800 dark:text-white">История оплат</h3>
        {payments.length === 0 && (<div className="text-center py-8 text-slate-400">Оплат ещё не было</div>)}
        {payments.map(p => (
          <div key={p.id} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-4 flex justify-between items-center">
            <div>
              <p className="font-bold text-slate-800 dark:text-white text-sm">{p.title}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{new Date(p.date).toLocaleDateString()}</p>
            </div>
            <span className="font-bold text-red-600 dark:text-red-400">-{formatCurrency(p.amount, showCents)} ₽</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default SupplierDetails;
