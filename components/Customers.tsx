import React, { useState, useMemo } from 'react'; // Добавили useMemo
import ViewModeToggle, { useViewMode } from './ViewModeToggle';
import { isMacShell } from '../src/platform';
import { calculateSaleOverdue, formatCurrency } from '../src/utils';
import { Customer, Sale } from '../types';
import { ICONS } from '../constants';
import { useScrollRestoration } from '../src/hooks/useScrollRestoration';
import CustomerFormSheet from './CustomerFormSheet';

interface CustomersProps {
  customers: Customer[];
  onAddCustomer: (data: {
    name: string;
    phone: string;
    photo?: string;
    address?: string;
    passportSeries?: string;
    passportNumber?: string;
    passportIssuedBy?: string;
    birthDate?: string;
  }) => Promise<Customer>;
  onSelectCustomer: (id: string) => void;
  /** Распознавание паспорта — только там, где его разрешает тариф */
  canScanPassport?: boolean;
  /** true, когда эта страница видна поверх остальных — включая случай, когда карточка
      клиента (открытая поверх списка) только что закрылась и список снова на переднем плане. */
  isActive?: boolean;
  /** Договоры — для долга и просрочки на карточке (приложение Mac/Windows) */
  sales?: Sale[];
}


const Customers: React.FC<CustomersProps> = ({
  customers,
  onAddCustomer,
  onSelectCustomer,
  canScanPassport = false,
  isActive = true,
  sales = [],
}) => {
  const macShell = isMacShell();
  const [viewMode, setViewMode] = useViewMode('customers');
  const tiles = macShell && viewMode === 'tiles';
  // Сколько клиент должен и сколько из этого просрочено — по активным договорам
  const debtByCustomer = useMemo(() => {
    const map = new Map<string, { debt: number; overdue: number }>();
    if (!macShell) return map;
    for (const s of sales) {
      if (s.status !== 'ACTIVE') continue;
      const e = map.get(s.customerId) || { debt: 0, overdue: 0 };
      e.debt += Number(s.remainingAmount) || 0;
      e.overdue += calculateSaleOverdue(s);
      map.set(s.customerId, e);
    }
    return map;
  }, [sales, macShell]);
  // Список не размонтируется, пока открыта карточка клиента (она выезжает поверх него),
  // поэтому обычной прокрутки окна должно хватать сама по себе — но переустанавливаем её
  // явно при каждом возврате в фокус, а не полагаемся на то, что браузер её не тронет.
  useScrollRestoration('CUSTOMERS', undefined, isActive);

  // Новый клиент — листом (CustomerFormSheet): та же форма, что и при правке
  const [isAdding, setIsAdding] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // === ЛОГИКА ФИЛЬТРАЦИИ И СОРТИРОВКИ ОТ А ДО Я ===
  const sortedFilteredCustomers = useMemo(() => {
    return customers
      .filter(c =>
        c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.phone.includes(searchTerm)
      )
      .sort((a, b) => a.name.localeCompare(b.name)); // Сортировка по алфавиту
  }, [customers, searchTerm]);


  return (
    <div className="space-y-4 pb-20 animate-fade-in">
      <header className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 dark:text-white">Клиенты</h2>
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            {sortedFilteredCustomers.length} из {customers.length}
          </p>
        </div>
        <div className="flex items-center gap-3">
        {macShell && <ViewModeToggle value={viewMode} onChange={setViewMode} />}
        <button
          onClick={() => setIsAdding(true)}
          className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-sm font-medium shadow-lg shadow-indigo-200 dark:shadow-indigo-900/30 active:scale-95 transition-transform"
        >
          + Добавить
        </button>
        </div>
      </header>

      {/* Search Bar */}
      {(
          <div className="relative">
              <input autoComplete="off" autoCorrect="off" spellCheck={false}
                type="text"
                placeholder="Поиск по имени или телефону..."
                className="w-full pl-10 p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:border-indigo-500 text-slate-800 dark:text-white"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
              <span className="absolute left-3 top-3.5 text-slate-400 dark:text-slate-500 scale-90">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              </span>
          </div>
      )}

      {isAdding && (
        <CustomerFormSheet
          canScanPassport={canScanPassport}
          onClose={() => setIsAdding(false)}
          onCreate={async data => {
            const created = await onAddCustomer(data);
            // Сразу в карточку нового клиента — за ней его и заводили
            if (created?.id) onSelectCustomer(created.id);
          }}
        />
      )}

      {tiles ? (
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {sortedFilteredCustomers.length === 0 && (
            <div className="col-span-full text-center py-8 text-slate-400 dark:text-slate-500">Клиенты не найдены</div>
        )}
        {sortedFilteredCustomers.map(c => {
          const d = debtByCustomer.get(c.id);
          const tone = !d || d.debt <= 0 ? '#10b981' : d.overdue > 0 ? '#ef4444' : '#f59e0b';
          return (
          <button key={c.id} type="button" onClick={() => onSelectCustomer(c.id)}
                  className="mac-tile bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-5 flex flex-col items-center text-center">
            <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden ring-4 ring-white/70 dark:ring-white/5 shadow-sm">
              {c.photo
                ? <img src={c.photo} alt="" className="w-full h-full object-cover" />
                : <div className="w-full h-full flex items-center justify-center text-slate-500 dark:text-slate-300 font-bold text-xl">{c.name.charAt(0)}</div>}
            </div>
            <h3 className="mt-3 font-semibold text-[15px] text-slate-800 dark:text-white leading-tight line-clamp-2">{c.name}</h3>
            <p className="mt-0.5 text-[12px] text-slate-500 dark:text-slate-400">{c.phone}</p>
            <span className="mt-3 block h-[3px] w-7 rounded-full opacity-85" style={{ background: tone }} />
            <p className="mt-2.5 text-[17px] font-semibold tabular-nums text-slate-900 dark:text-white">
              {d && d.debt > 0 ? `${formatCurrency(d.debt, false)} ₽` : 'Долгов нет'}
            </p>
            <p className={`text-[12px] ${d && d.overdue > 0 ? 'text-rose-600 dark:text-rose-400 font-semibold' : 'text-slate-400'}`}>
              {d && d.overdue > 0 ? `просрочено ${formatCurrency(d.overdue, false)} ₽` : d && d.debt > 0 ? 'долг по договорам' : 'все договоры закрыты'}
            </p>
          </button>
          );
        })}
      </div>
      ) : (
      <div className="grid gap-3">
        {sortedFilteredCustomers.length === 0 && (
            <div className="text-center py-8 text-slate-400 dark:text-slate-500">Клиенты не найдены</div>
        )}
        {sortedFilteredCustomers.map(c => (
          <div
            key={c.id}
            onClick={() => onSelectCustomer(c.id)}
            className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-100 dark:border-slate-700 shadow-sm flex items-center gap-4 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
          >
            <div className="w-12 h-12 rounded-full bg-slate-200 dark:bg-slate-700 flex-shrink-0 overflow-hidden">
                {c.photo ? (
                    <img src={c.photo} alt={c.name} className="w-full h-full object-cover" />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-500 dark:text-slate-400 font-bold text-lg">
                        {c.name.charAt(0)}
                    </div>
                )}
            </div>
            <div>
              <h3 className="font-bold text-slate-800 dark:text-white">{c.name}</h3>
              <p className="text-slate-500 dark:text-slate-400 text-sm">{c.phone}</p>
            </div>
            <div className="ml-auto text-slate-300 dark:text-slate-600">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </div>
          </div>
        ))}
      </div>
      )}
    </div>
  );
};

export default Customers;
