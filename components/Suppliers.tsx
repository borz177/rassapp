import React, { useMemo, useState } from 'react';
import { Sale, Supplier } from '../types';
import { ICONS } from '../constants';
import { formatCurrency } from '../src/utils';

interface SuppliersProps {
  suppliers: Supplier[];
  sales: Sale[];
  showCents?: boolean;
  onAddSupplier: (data: { name: string; phone?: string; email?: string; notes?: string }) => void;
  onUpdateSupplier: (supplier: Supplier) => void;
  onDeleteSupplier: (id: string) => void;
  onViewDetails: (supplier: Supplier) => void;
}

const Suppliers: React.FC<SuppliersProps> = ({
  suppliers, sales, showCents, onAddSupplier, onUpdateSupplier, onDeleteSupplier, onViewDetails
}) => {
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  const [formName, setFormName] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formNotes, setFormNotes] = useState('');

  const debtBySupplier = useMemo(() => {
    const map: Record<string, number> = {};
    sales.forEach(s => {
      if (!s.supplierId || !s.buyPrice) return;
      if (s.isPartnerDebtPaid) return;
      const remaining = s.buyPrice - (s.partnerDebtPaidAmount || 0);
      if (remaining <= 0) return;
      map[s.supplierId] = (map[s.supplierId] || 0) + remaining;
    });
    return map;
  }, [sales]);

  const statsBySupplier = useMemo(() => {
    const map: Record<string, { count: number; volume: number; lastDate: string | null }> = {};
    sales.forEach(s => {
      if (!s.supplierId) return;
      if (!map[s.supplierId]) map[s.supplierId] = { count: 0, volume: 0, lastDate: null };
      const stat = map[s.supplierId];
      stat.count += 1;
      stat.volume += s.buyPrice || 0;
      if (!stat.lastDate || new Date(s.startDate) > new Date(stat.lastDate)) {
        stat.lastDate = s.startDate;
      }
    });
    return map;
  }, [sales]);

  const resetForm = () => {
    setFormName('');
    setFormPhone('');
    setFormEmail('');
    setFormNotes('');
    setEditingId(null);
    setIsAdding(false);
    setActiveMenuId(null);
  };

  const handleStartEdit = (s: Supplier) => {
    setFormName(s.name);
    setFormPhone(s.phone || '');
    setFormEmail(s.email || '');
    setFormNotes(s.notes || '');
    setEditingId(s.id);
    setIsAdding(true);
    setActiveMenuId(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) return;

    if (editingId) {
      const existing = suppliers.find(s => s.id === editingId);
      if (existing) {
        onUpdateSupplier({ ...existing, name: formName, phone: formPhone, email: formEmail, notes: formNotes });
      }
    } else {
      onAddSupplier({ name: formName, phone: formPhone, email: formEmail, notes: formNotes });
    }
    resetForm();
  };

  const handleDelete = (s: Supplier) => {
    const debt = debtBySupplier[s.id] || 0;
    if (debt > 0) {
      alert(`Нельзя удалить поставщика с непогашенным долгом (${formatCurrency(debt, showCents)} ₽).`);
      setActiveMenuId(null);
      return;
    }
    if (window.confirm('Удалить поставщика?')) {
      onDeleteSupplier(s.id);
    }
    setActiveMenuId(null);
  };

  return (
    <div className="space-y-6 pb-20" onClick={() => setActiveMenuId(null)}>
      <header className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 dark:text-white">Партнеры</h2>
          <p className="text-slate-500 dark:text-slate-400 text-sm">Поставщики и долги по закупу</p>
        </div>
        {!isAdding && (
          <button
            onClick={(e) => { e.stopPropagation(); setIsAdding(true); }}
            className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-sm font-medium"
          >
            {ICONS.AddSmall} Добавить
          </button>
        )}
      </header>

      {isAdding && (
        <form onSubmit={handleSubmit} onClick={e => e.stopPropagation()} className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-4 animate-fade-in">
          <h3 className="font-bold text-slate-800 dark:text-white border-b border-slate-100 dark:border-slate-700 pb-2">
            {editingId ? 'Редактировать поставщика' : 'Новый поставщик'}
          </h3>
          <div className="space-y-3">
            <input
              placeholder="Название / ФИО"
              className="w-full p-3 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-xl outline-none"
              value={formName}
              onChange={e => setFormName(e.target.value)}
              required
            />
            <input
              placeholder="Телефон"
              className="w-full p-3 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-xl outline-none"
              value={formPhone}
              onChange={e => setFormPhone(e.target.value)}
            />
            <input
              type="email"
              placeholder="Email"
              className="w-full p-3 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-xl outline-none"
              value={formEmail}
              onChange={e => setFormEmail(e.target.value)}
            />
            <textarea
              placeholder="Заметки"
              className="w-full p-3 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-xl outline-none resize-none"
              rows={2}
              value={formNotes}
              onChange={e => setFormNotes(e.target.value)}
            />
          </div>
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={resetForm} className="flex-1 py-3 bg-slate-100 dark:bg-slate-700 rounded-xl font-medium text-slate-600 dark:text-slate-300">Отмена</button>
            <button type="submit" className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold">
              {editingId ? 'Сохранить' : 'Создать'}
            </button>
          </div>
        </form>
      )}

      <div className="grid gap-4">
        {suppliers.length === 0 && !isAdding && (
          <div className="text-center py-8 text-slate-400">Нет поставщиков</div>
        )}
        {suppliers.map(s => {
          const debt = debtBySupplier[s.id] || 0;
          const stat = statsBySupplier[s.id] || { count: 0, volume: 0, lastDate: null };
          return (
            <div key={s.id} className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm relative cursor-pointer" onClick={() => onViewDetails(s)}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 rounded-full flex items-center justify-center font-bold text-lg">
                    {s.name.charAt(0)}
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-800 dark:text-white">{s.name}</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{s.phone || s.email || 'Без контактов'}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-right mr-2 hidden sm:block">
                    <p className="text-xs text-slate-400">Долг</p>
                    <p className={`text-sm font-bold ${debt > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                      {formatCurrency(debt, showCents)} ₽
                    </p>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); setActiveMenuId(activeMenuId === s.id ? null : s.id); }}
                    className="p-2 text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg transition-colors"
                  >
                    {ICONS.More}
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-4 mt-3 pt-3 border-t border-slate-50 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400">
                <span>Договоров: <span className="font-semibold text-slate-700 dark:text-slate-300">{stat.count}</span></span>
                {stat.lastDate && <span>Посл. договор: <span className="font-semibold text-slate-700 dark:text-slate-300">{new Date(stat.lastDate).toLocaleDateString('ru-RU')}</span></span>}
              </div>

              {activeMenuId === s.id && (
                <div className="absolute right-4 top-14 bg-white dark:bg-slate-800 shadow-xl border border-slate-100 dark:border-slate-700 rounded-xl z-20 w-40 overflow-hidden animate-fade-in" onClick={e => e.stopPropagation()}>
                  <button
                    onClick={() => onViewDetails(s)}
                    className="w-full text-left px-4 py-3 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2"
                  >
                    <span className="text-indigo-500">{ICONS.File}</span> Инфо
                  </button>
                  <button
                    onClick={() => handleStartEdit(s)}
                    className="w-full text-left px-4 py-3 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2"
                  >
                    <span className="text-slate-500">{ICONS.Edit}</span> Изменить
                  </button>
                  <button
                    onClick={() => handleDelete(s)}
                    className="w-full text-left px-4 py-3 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                  >
                    <span>{ICONS.Delete}</span> Удалить
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default Suppliers;
