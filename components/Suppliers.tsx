import React, { useMemo, useState } from 'react';
import { Expense, Product, Sale, StockMovement, Supplier } from '../types';
import { ICONS } from '../constants';
import { formatCurrency } from '../src/utils';
import { supplierBalance, supplierSupplies } from '../src/supplierLedger';
import { appConfirm } from '../src/dialogs';
import GlassSheet, { SheetSection, SheetField, sheetInputClass } from './GlassSheet';

interface SuppliersProps {
  suppliers: Supplier[];
  sales: Sale[];
  /** Приходы со склада — второй источник долга перед партнёром */
  movements?: StockMovement[];
  products?: Product[];
  expenses?: Expense[];
  showCents?: boolean;
  onAddSupplier: (data: { name: string; phone?: string; email?: string; notes?: string }) => void;
  onUpdateSupplier: (supplier: Supplier) => void;
  onDeleteSupplier: (id: string) => void;
  onViewDetails: (supplier: Supplier) => void;
  /** Отдать долг: форма расхода с уже выбранным поставщиком */
  onPayDebt?: (supplier: Supplier, debt: number) => void;
}

const Suppliers: React.FC<SuppliersProps> = ({
  suppliers, sales, movements = [], products = [], expenses = [], showCents, onAddSupplier, onUpdateSupplier, onDeleteSupplier, onViewDetails, onPayDebt
}) => {
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  const [formName, setFormName] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formNotes, setFormNotes] = useState('');

  // Сальдо по партнёру со знаком: плюс — мы должны, минус — переплатили.
  const balanceBySupplier = useMemo(() => {
    const map: Record<string, number> = {};
    suppliers.forEach(sup => {
      map[sup.id] = supplierBalance(sales, movements, products, expenses, sup.id);
    });
    return map;
  }, [suppliers, sales, movements, products, expenses]);

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
    suppliers.forEach(sup => {
      const supplies = supplierSupplies(movements, products, sup.id);
      if (supplies.length === 0) return;
      if (!map[sup.id]) map[sup.id] = { count: 0, volume: 0, lastDate: null };
      const stat = map[sup.id];
      stat.count += supplies.length;
      stat.volume += supplies.reduce((sum, d) => sum + d.total, 0);
      const newest = supplies[0].date;
      if (!stat.lastDate || new Date(newest) > new Date(stat.lastDate)) stat.lastDate = newest;
    });
    return map;
  }, [sales, suppliers, movements, products]);

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

  // Сохранение из листа: закрывает его сам лист (close), а форму сбрасывает
  // resetForm на его уходе — иначе лист пропадал бы мгновенно, без анимации.
  const handleSubmit = (close: () => void) => {
    if (!formName.trim()) return;
    const data = { name: formName.trim(), phone: formPhone.trim(), email: formEmail.trim(), notes: formNotes };
    if (editingId) {
      const existing = suppliers.find(s => s.id === editingId);
      if (existing) onUpdateSupplier({ ...existing, ...data });
    } else {
      onAddSupplier(data);
    }
    close();
  };

  // Что было в форме при открытии — чтобы переспрашивать, только если что-то поменяли
  const editingSupplier = editingId ? suppliers.find(s => s.id === editingId) : undefined;
  const formDirty =
    formName !== (editingSupplier?.name || '') || formPhone !== (editingSupplier?.phone || '') ||
    formEmail !== (editingSupplier?.email || '') || formNotes !== (editingSupplier?.notes || '');

  const handleDelete = async (s: Supplier) => {
    // Незакрытый расчёт — это и долг, и переплата: в обе стороны за партнёром
    // числятся деньги, и удалять его, теряя след, нельзя.
    const balance = balanceBySupplier[s.id] || 0;
    if (Math.abs(balance) > 0.005) {
      alert(balance > 0
        ? `Нельзя удалить поставщика с непогашенным долгом (${formatCurrency(balance, showCents)} ₽).`
        : `Нельзя удалить поставщика с переплатой (${formatCurrency(-balance, showCents)} ₽). Зачтите её поставкой или верните деньги.`);
      setActiveMenuId(null);
      return;
    }
    if (await appConfirm('Удалить поставщика?')) {
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
        {(
          <button
            onClick={(e) => { e.stopPropagation(); setIsAdding(true); }}
            className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-sm font-medium"
          >
            {ICONS.AddSmall} Добавить
          </button>
        )}
      </header>

      {isAdding && (
        <GlassSheet
          title={editingId ? 'Поставщик' : 'Новый поставщик'}
          subtitle={editingId ? (formName.trim() || 'Без названия') : 'Обязательно только название'}
          onClose={resetForm}
          cancelLabel="Отмена"
          action={{ label: editingId ? 'Готово' : 'Добавить', submit: true, disabled: !formName.trim() || (!!editingId && !formDirty) }}
          onSubmit={handleSubmit}
          confirmClose={() => !formDirty || appConfirm({
            title: editingId ? 'Закрыть без сохранения?' : 'Не добавлять поставщика?',
            message: 'Введённые данные пропадут.',
            confirmLabel: 'Закрыть',
            cancelLabel: 'Остаться',
            destructive: true,
          })}
        >
          <div className="space-y-6">
            <SheetSection>
              <SheetField label="Название или ФИО">
                <input className={sheetInputClass} value={formName} onChange={e => setFormName(e.target.value)}
                       autoComplete="off" autoCorrect="off" spellCheck={false} autoCapitalize="words"
                       enterKeyHint="next" placeholder="ООО «Поставка» или Иванов Иван" required />
              </SheetField>
            </SheetSection>
            <SheetSection title="Контакты">
              <SheetField label="Телефон">
                <input className={sheetInputClass} value={formPhone} onChange={e => setFormPhone(e.target.value)}
                       type="tel" inputMode="tel" autoComplete="off" enterKeyHint="next" placeholder="+7 900 000-00-00" />
              </SheetField>
              <SheetField label="Email">
                <input className={sheetInputClass} value={formEmail} onChange={e => setFormEmail(e.target.value)}
                       type="email" inputMode="email" autoComplete="off" autoCapitalize="off" enterKeyHint="next"
                       placeholder="supply@example.com" />
              </SheetField>
            </SheetSection>
            <SheetSection title="Заметки" hint="Условия, реквизиты, контактное лицо — что пригодится при следующем закупе.">
              <textarea
                className="block w-full px-4 py-3 bg-transparent outline-none resize-none text-[16px] text-slate-900 dark:text-white placeholder:text-slate-300 dark:placeholder:text-slate-600"
                rows={3} value={formNotes} onChange={e => setFormNotes(e.target.value)}
                placeholder="Например: отсрочка 14 дней, менеджер Анна"
              />
            </SheetSection>
          </div>
        </GlassSheet>
      )}

      <div className="grid gap-4">
        {suppliers.length === 0 && (
          <div className="text-center py-8 text-slate-400">Нет поставщиков</div>
        )}
        {suppliers.map(s => {
          const balance = balanceBySupplier[s.id] || 0;
          const debt = Math.max(0, balance);
          // Отдали больше, чем были должны: показываем это плюсом и зелёным —
          // деньги наши и зачтутся в следующую поставку.
          const overpaid = Math.max(0, -balance);
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
                    <p className="text-xs text-slate-400">{overpaid > 0 ? 'Переплата' : 'Долг'}</p>
                    <p className={`text-sm font-bold ${debt > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                      {overpaid > 0 ? `+${formatCurrency(overpaid, showCents)}` : formatCurrency(debt, showCents)} ₽
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

              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 mt-3 pt-3 border-t border-slate-50 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span>Договоров: <span className="font-semibold text-slate-700 dark:text-slate-300">{stat.count}</span></span>
                  {stat.lastDate && <span>Посл. договор: <span className="font-semibold text-slate-700 dark:text-slate-300">{new Date(stat.lastDate).toLocaleDateString('ru-RU')}</span></span>}
                  {/* На телефоне долг справа от имени скрыт — показываем его здесь,
                      рядом с кнопкой, которой его отдают. */}
                  {debt > 0 && (
                    <span className="sm:hidden">Долг: <span className="font-bold text-red-600 dark:text-red-400">{formatCurrency(debt, showCents)} ₽</span></span>
                  )}
                  {overpaid > 0 && (
                    <span className="sm:hidden">Переплата: <span className="font-bold text-emerald-600 dark:text-emerald-400">+{formatCurrency(overpaid, showCents)} ₽</span></span>
                  )}
                </div>
              </div>

              {activeMenuId === s.id && (
                <div className="absolute right-4 top-14 bg-white dark:bg-slate-800 shadow-xl border border-slate-100 dark:border-slate-700 rounded-xl z-20 w-40 overflow-hidden animate-fade-in" onClick={e => e.stopPropagation()}>
                  <button
                    onClick={() => onViewDetails(s)}
                    className="w-full text-left px-4 py-3 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2"
                  >
                    <span className="text-indigo-500">{ICONS.File}</span> Инфо
                  </button>
                  {/* Отдать долг — в меню действий карточки: форма расхода откроется
                      сразу с этим поставщиком, искать его в списке не нужно. */}
                  {debt > 0 && onPayDebt && (
                    <button
                      onClick={() => { setActiveMenuId(null); onPayDebt(s, debt); }}
                      className="w-full text-left px-4 py-3 text-sm font-semibold text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 flex items-center gap-2"
                    >
                      <span className="w-5 text-center font-bold">₽</span> Отдать долг
                    </button>
                  )}
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
