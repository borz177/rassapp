
import React, { useEffect, useRef, useState } from 'react';
import { User, Investor, AppSettings, StockLocation } from '../types';
import { ICONS } from '../constants';
import { appConfirm } from '../src/dialogs';
import GlassSheet, { SheetSection, SheetField, SheetToggle, SheetChoice, SheetSegmented, sheetInputClass } from './GlassSheet';

interface EmployeesProps {
  employees: User[];
  investors: Investor[];
  onAddEmployee: (data: any) => void;
  onUpdateEmployee: (data: User) => void;
  onDeleteEmployee: (id: string) => void;
  onSelectActivity: (id: string) => void;
  appSettings?: AppSettings;
  /** Магазин включён у менеджера — иначе право выдавать не за что */
  showShop?: boolean;
  /** Склады магазина — чтобы открыть сотруднику только часть из них */
  warehouses?: StockLocation[];
}

const Employees: React.FC<EmployeesProps> = ({
    employees, investors, onAddEmployee, onUpdateEmployee, onDeleteEmployee, onSelectActivity,
    showShop = false, warehouses = []
}) => {
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form State
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

const [allowMainAccount, setAllowMainAccount] = useState(false);
const [fullAccessMainAccount, setFullAccessMainAccount] = useState(false);

  const [permissions, setPermissions] = useState({
      canCreate: true,
      canEdit: false,
      canDelete: false,
      canUseShop: false
  });
  const [allowedInvestorIds, setAllowedInvestorIds] = useState<string[]>([]);
  // 💰 Мотивация: процент от прибыли, база расчёта и влияние на прибыль менеджера
  const [profitPercentage, setProfitPercentage] = useState<string>('');
  const [profitBase, setProfitBase] = useState<'CONTRACTS' | 'PAYMENTS' | 'ALL'>('CONTRACTS');
  const [profitReducesManager, setProfitReducesManager] = useState(true);
  const [profitSource, setProfitSource] = useState<'MANAGER' | 'SHARED'>('MANAGER');
  const [profitSince, setProfitSince] = useState<string>('');
  const [fullAccessInvestorIds, setFullAccessInvestorIds] = useState<string[]>([]);
  // Склады магазина: 'ALL' — все, в том числе заведённые позже; 'SELECTED' — только
  // отмеченные. Выбор показываем, только когда складов больше одного.
  const [warehouseMode, setWarehouseMode] = useState<'ALL' | 'SELECTED'>('ALL');
  const [allowedWarehouseIds, setAllowedWarehouseIds] = useState<string[]>([]);
  const liveWarehouses = warehouses.filter(w => !w.isArchived);

  const resetForm = () => {
    setName('');
    setEmail('');
    setPassword('');
    setPermissions({ canCreate: true, canEdit: false, canDelete: false, canUseShop: false });
    setAllowedInvestorIds([]);
    setFullAccessInvestorIds([]);
    setWarehouseMode('ALL');
    setAllowedWarehouseIds([]);
    setAllowMainAccount(false); // <-- СБРОС
    setFullAccessMainAccount(false);
    setProfitPercentage('');
    setProfitBase('CONTRACTS');
    setProfitReducesManager(true);
    setProfitSource('MANAGER');
    setProfitSince('');
    setEditingId(null);
    setIsAdding(false);
};

  const handleStartEdit = (emp: User) => {
    setName(emp.name);
    setEmail(emp.email);
    setPassword('');
    setPermissions({ canCreate: false, canEdit: false, canDelete: false, canUseShop: false, ...(emp.permissions || {}) });
    const warehouseIds = emp.permissions?.allowedWarehouseIds || [];
    setWarehouseMode(warehouseIds.length > 0 ? 'SELECTED' : 'ALL');
    setAllowedWarehouseIds(warehouseIds);

    const ids = emp.allowedInvestorIds || [];
    setAllowedInvestorIds(ids.filter((id: string) => id !== 'MAIN_ACCOUNT'));
    setAllowMainAccount(ids.includes('MAIN_ACCOUNT')); // <-- ЧТЕНИЕ

    const fullIds = (emp.fullAccessInvestorIds || []).filter(id => ids.includes(id));
    setFullAccessInvestorIds(fullIds.filter((id: string) => id !== 'MAIN_ACCOUNT'));
    setFullAccessMainAccount(fullIds.includes('MAIN_ACCOUNT'));

    setProfitPercentage(emp.profitPercentage != null ? String(emp.profitPercentage) : '');
    setProfitBase(emp.profitBase || 'CONTRACTS');
    setProfitReducesManager(emp.profitReducesManager !== false);
    setProfitSource(emp.profitSource === 'SHARED' ? 'SHARED' : 'MANAGER');
    setProfitSince(emp.profitSince || '');

    setEditingId(emp.id);
    setIsAdding(true);
};

  const handleInvestorToggle = (id: string) => {
      setAllowedInvestorIds(prev => {
          const next = prev.includes(id) ? prev.filter(pid => pid !== id) : [...prev, id];
          // Если доступ сняли — снимаем и полный доступ
          if (!next.includes(id)) setFullAccessInvestorIds(f => f.filter(fid => fid !== id));
          return next;
      });
  };

  const handleFullAccessInvestorToggle = (id: string) => {
      setFullAccessInvestorIds(prev =>
          prev.includes(id) ? prev.filter(pid => pid !== id) : [...prev, id]
      );
  };

// Сохранение из листа: закрывает его сам лист (close), а форму сбрасывает
// resetForm на его уходе — иначе лист пропадал бы мгновенно, без анимации.
const handleSubmit = (close: () => void) => {
    if (!name || !email) {
        alert("Заполните имя и email");
        return;
    }

    // Формируем итоговый массив: инвесторы + 'MAIN_ACCOUNT' если нужно
    const finalAllowedIds = allowMainAccount
        ? [...new Set([...allowedInvestorIds, 'MAIN_ACCOUNT'])]
        : allowedInvestorIds.filter((id: string) => id !== 'MAIN_ACCOUNT');

    // Полный доступ имеет смысл только для пунктов из finalAllowedIds
    const finalFullAccessIds = (fullAccessMainAccount ? [...new Set([...fullAccessInvestorIds, 'MAIN_ACCOUNT'])] : fullAccessInvestorIds)
        .filter((id: string) => finalAllowedIds.includes(id));

    // Склады — только при доступе к магазину и нескольких складах. Пустой список
    // означает «все склады»: новый склад тогда не остаётся без продавцов.
    const restrictWarehouses = !!permissions.canUseShop && liveWarehouses.length > 1 && warehouseMode === 'SELECTED';
    const finalWarehouseIds = allowedWarehouseIds.filter(id => liveWarehouses.some(w => w.id === id));
    if (restrictWarehouses && finalWarehouseIds.length === 0) {
        alert('Отметьте хотя бы один склад или выберите «Все склады»');
        return;
    }
    const { allowedWarehouseIds: _previousWarehouses, ...basePermissions } =
        permissions as typeof permissions & { allowedWarehouseIds?: string[] };
    const finalPermissions = restrictWarehouses
        ? { ...basePermissions, allowedWarehouseIds: finalWarehouseIds }
        : basePermissions;

    const employeeData = {
        name,
        email,
        permissions: finalPermissions,
        allowedInvestorIds: finalAllowedIds, // <-- ИСПОЛЬЗУЕМ ИТОГОВЫЙ МАССИВ
        fullAccessInvestorIds: finalFullAccessIds,
        // Пустое поле = процент не задан, а не ноль: сервер отличает null от 0
        profitPercentage: profitPercentage.trim() === '' ? null : Number(profitPercentage),
        profitBase,
        profitReducesManager,
        profitSource,
        // Пусто = сервер проставит сегодняшний день при первом включении процента
        profitSince: profitSince || undefined
    };

    if (editingId) {
        const original = employees.find(e => e.id === editingId);
        if (original) {
            const updated = {
                ...original,
                ...employeeData,
                password: password ? password : original.password
            };
            onUpdateEmployee(updated);
        }
    } else {
        if (!password) {
            alert("Для нового сотрудника нужен пароль");
            return;
        }
        onAddEmployee({ ...employeeData, password });
    }
    close();
};

  // Что было в форме при открытии — переспрашиваем при закрытии, только если что-то поменяли
  const formSnapshot = JSON.stringify({
    name, email, password, allowMainAccount, fullAccessMainAccount, permissions, allowedInvestorIds,
    fullAccessInvestorIds, profitPercentage, profitBase, profitReducesManager, profitSource, profitSince,
    warehouseMode, allowedWarehouseIds,
  });
  const openedWith = useRef('');
  useEffect(() => { if (isAdding) openedWith.current = formSnapshot; }, [isAdding, editingId]);
  const formDirty = isAdding && formSnapshot !== openedWith.current;

  const handleDelete = async (id: string) => {
      if (await appConfirm("Удалить сотрудника?")) {
          onDeleteEmployee(id);
      }
  };

  return (
    <div className="space-y-6 pb-20 animate-fade-in">
      <header className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 dark:text-white">Сотрудники</h2>
          <p className="text-slate-500 dark:text-slate-400 text-sm">Управление доступом</p>
        </div>
        {!isAdding && (
            <button 
              onClick={() => setIsAdding(true)}
              className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-sm font-medium"
            >
              {ICONS.AddSmall} Добавить
            </button>
        )}
      </header>

      {isAdding && (
        <GlassSheet
          title={editingId ? 'Сотрудник' : 'Новый сотрудник'}
          subtitle={editingId ? (name.trim() || email) : 'Войдёт в приложение по email и паролю'}
          onClose={resetForm}
          cancelLabel="Отмена"
          action={{
            label: editingId ? 'Готово' : 'Добавить',
            submit: true,
            disabled: !name.trim() || !email.trim() || (!editingId && !password) || (!!editingId && !formDirty),
          }}
          onSubmit={handleSubmit}
          confirmClose={() => !formDirty || appConfirm({
            title: editingId ? 'Закрыть без сохранения?' : 'Не добавлять сотрудника?',
            message: 'Введённые данные пропадут.',
            confirmLabel: 'Закрыть',
            cancelLabel: 'Остаться',
            destructive: true,
          })}
        >
          <div className="space-y-6">
            <SheetSection title="Вход в приложение">
              <SheetField label="Имя и фамилия">
                <input className={sheetInputClass} value={name} onChange={e => setName(e.target.value)}
                       autoComplete="off" autoCorrect="off" spellCheck={false} autoCapitalize="words"
                       enterKeyHint="next" placeholder="Анна Петрова" required />
              </SheetField>
              <SheetField label="Email — это логин">
                <input className={sheetInputClass} value={email} onChange={e => setEmail(e.target.value)}
                       type="email" inputMode="email" autoComplete="off" autoCapitalize="off" spellCheck={false}
                       enterKeyHint="next" placeholder="anna@example.com" required />
              </SheetField>
              <SheetField label={editingId ? 'Новый пароль' : 'Пароль'}
                          hint={editingId ? 'Оставьте пустым — пароль не изменится.' : 'Передайте его сотруднику — сменить можно здесь же.'}>
                <input className={`${sheetInputClass} ${password ? 'font-mono' : ''}`} value={password} onChange={e => setPassword(e.target.value)}
                       type="text" autoComplete="off" autoCapitalize="off" spellCheck={false}
                       placeholder={editingId ? 'Не менять' : 'Минимум 6 символов'} required={!editingId} />
              </SheetField>
            </SheetSection>

            <SheetSection title="Что может делать" hint="Без этих прав сотрудник только смотрит.">
              <SheetToggle tone="indigo" label="Создание" description="Договоры, платежи, клиенты, расходы"
                           checked={!!permissions.canCreate} onChange={v => setPermissions({ ...permissions, canCreate: v })} />
              <SheetToggle tone="indigo" label="Редактирование" description="Правка уже внесённых записей"
                           checked={!!permissions.canEdit} onChange={v => setPermissions({ ...permissions, canEdit: v })} />
              <SheetToggle tone="indigo" label="Удаление" description="Удаление и отмена записей"
                           checked={!!permissions.canDelete} onChange={v => setPermissions({ ...permissions, canDelete: v })} />
              {showShop && (
                <SheetToggle tone="indigo" label="Магазин и склад"
                             description="Касса, товары, остатки и журнал. Без права разделы не видны, закупочные цены скрыты."
                             checked={!!permissions.canUseShop} onChange={v => setPermissions({ ...permissions, canUseShop: v })} />
              )}
            </SheetSection>

            {/* Склады — только при доступе к магазину и если их несколько: с одним выбирать нечего */}
            {showShop && permissions.canUseShop && liveWarehouses.length > 1 && (
              <SheetSection title="Склады"
                            hint={warehouseMode === 'ALL' ? 'Доступны все склады, в том числе новые.' : 'Касса, остатки, приход и журнал — только по отмеченным складам.'}>
                <div className="px-4 py-3">
                  <SheetSegmented value={warehouseMode} onChange={setWarehouseMode}
                                  options={[{ id: 'ALL', label: 'Все склады' }, { id: 'SELECTED', label: 'Выбранные' }]} />
                </div>
                {warehouseMode === 'SELECTED' && liveWarehouses.map(w => (
                  <SheetToggle key={w.id} tone="indigo"
                               label={<span className="flex items-center gap-2">{w.name}{w.isMain && <span className="px-1.5 py-0.5 rounded-md bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 text-[10px] font-bold uppercase">Основной</span>}</span>}
                               checked={allowedWarehouseIds.includes(w.id)}
                               onChange={() => setAllowedWarehouseIds(prev => prev.includes(w.id) ? prev.filter(id => id !== w.id) : [...prev, w.id])} />
                ))}
              </SheetSection>
            )}

            <SheetSection title="Доступ к счетам"
                          hint="По умолчанию сотрудник видит только свои записи. «Все данные» открывают всё по счёту или инвестору.">
              <SheetToggle tone="indigo" label="Основной счёт компании"
                           description="Операции на главном счёте — даже если инвесторов нет"
                           checked={allowMainAccount}
                           onChange={v => { setAllowMainAccount(v); if (!v) setFullAccessMainAccount(false); }} />
              {allowMainAccount && (
                <div className="pl-4 bg-slate-50/60 dark:bg-slate-900/30">
                  <SheetToggle label="Видит все данные по счёту" checked={fullAccessMainAccount} onChange={setFullAccessMainAccount} />
                </div>
              )}
              {investors.map(inv => (
                <React.Fragment key={inv.id}>
                  <SheetToggle tone="indigo" label={inv.name} description={inv.email || 'Инвестор'}
                               checked={allowedInvestorIds.includes(inv.id)} onChange={() => handleInvestorToggle(inv.id)} />
                  {allowedInvestorIds.includes(inv.id) && (
                    <div className="pl-4 bg-slate-50/60 dark:bg-slate-900/30">
                      <SheetToggle label="Видит все данные по инвестору"
                                   checked={fullAccessInvestorIds.includes(inv.id)} onChange={() => handleFullAccessInvestorToggle(inv.id)} />
                    </div>
                  )}
                </React.Fragment>
              ))}
            </SheetSection>

            <SheetSection title="Процент от прибыли" hint={Number(profitPercentage) > 0
              ? 'Начисляется по мере того, как клиенты платят.'
              : 'Пусто — премия не начисляется.'}>
              <SheetField label="Процент">
                <span className="flex items-baseline gap-1">
                  <input className={`${sheetInputClass} w-24`} value={profitPercentage} onChange={e => setProfitPercentage(e.target.value)}
                         type="number" inputMode="decimal" min="0" max="100" step="0.1" placeholder="0" />
                  <span className="text-[16px] text-slate-400">%</span>
                </span>
              </SheetField>
            </SheetSection>

            {Number(profitPercentage) > 0 && (
              <>
                <SheetSection title="Считать от">
                  {([
                    { key: 'CONTRACTS', label: 'Договоров, которые он оформил', hint: 'Премия идёт со всех платежей его клиентов' },
                    { key: 'PAYMENTS', label: 'Платежей, которые он принял', hint: 'Мотивация на сбор денег' },
                    { key: 'ALL', label: 'Всей прибыли', hint: 'Доля со всего бизнеса' },
                  ] as const).map(opt => (
                    <SheetChoice key={opt.key} selected={profitBase === opt.key} label={opt.label} hint={opt.hint} onSelect={() => setProfitBase(opt.key)} />
                  ))}
                </SheetSection>

                <SheetSection title="Из чьей прибыли"
                              hint="Если ваша доля прибыли по счёту нулевая, премия из неё платиться не может — тогда подходит только «расход общего дела», и он требует согласия инвесторов.">
                  {([
                    { key: 'MANAGER', label: 'Из моей доли', hint: 'Доли инвесторов не затрагиваются' },
                    { key: 'SHARED', label: 'Расход общего дела', hint: 'Вычитается до распределения — ложится и на инвесторов' },
                  ] as const).map(opt => (
                    <SheetChoice key={opt.key} selected={profitSource === opt.key} label={opt.label} hint={opt.hint} onSelect={() => setProfitSource(opt.key)} />
                  ))}
                </SheetSection>

                <SheetSection hint="Иначе прибыль уменьшится, когда зарплату фактически выплатят, а начисленное будет видно как долг перед сотрудником.">
                  <SheetField label="Начислять с даты" hint={profitSince ? 'Платежи до этой даты в премию не идут.' : 'Пусто — с сегодняшнего дня.'}>
                    <input className={`${sheetInputClass} h-7 appearance-none [&::-webkit-date-and-time-value]:text-left`}
                           type="date" value={profitSince} onChange={e => setProfitSince(e.target.value)} />
                  </SheetField>
                  <SheetToggle label="Сразу уменьшать мою прибыль" checked={profitReducesManager} onChange={setProfitReducesManager} />
                </SheetSection>
              </>
            )}
          </div>
        </GlassSheet>
      )}

      {/* Employee List */}
      <div className="grid gap-4">
          {employees.length === 0 && (
              <div className="text-center py-10 text-slate-400 dark:text-slate-500">Нет сотрудников</div>
          )}
          {employees.map(emp => (
              // Кнопки справа от имени, метки строкой под ним: колонкой справа они
              // вместе с длинным email не помещались в ширину телефона.
              // min-w-0 обязателен: элемент сетки не сжимается уже своего содержимого,
              // и длинный email растягивал карточку за край экрана — обрезка не срабатывала.
              <div key={emp.id} className="min-w-0 bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
                  <div className="flex items-start gap-3">
                      <div className="w-12 h-12 shrink-0 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full flex items-center justify-center font-bold text-lg">
                          {emp.name.charAt(0)}
                      </div>
                      <div className="min-w-0 flex-1">
                          <h3 className="font-bold text-slate-800 dark:text-white truncate">{emp.name}</h3>
                          <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{emp.email}</p>
                      </div>
                      <div className="flex shrink-0 -mr-1.5 -mt-1">
                          <button onClick={() => onSelectActivity(emp.id)} title="Активность" aria-label="Активность" className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg">
                              {ICONS.Stats}
                          </button>
                          <button onClick={() => handleStartEdit(emp)} title="Изменить" aria-label="Изменить" className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg">
                              {ICONS.Edit}
                          </button>
                          <button onClick={() => handleDelete(emp.id)} title="Удалить" aria-label="Удалить" className="p-2 text-slate-400 hover:text-red-600 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg">
                              {ICONS.Delete}
                          </button>
                      </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5 mt-3 pl-[3.75rem]">
                      <span className="text-xs bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 px-2 py-1 rounded-full font-medium">
                          Инвесторов: {emp.allowedInvestorIds?.length || 0}
                      </span>
                      {!!emp.fullAccessInvestorIds?.length && (
                          <span className="text-xs bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 px-2 py-1 rounded-full font-medium">
                              Полный доступ: {emp.fullAccessInvestorIds.length}
                          </span>
                      )}
                      {showShop && emp.permissions?.canUseShop && (
                          <span className="text-xs bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-2 py-1 rounded-full font-medium">
                              {emp.permissions.allowedWarehouseIds?.length && liveWarehouses.length > 1
                                ? `Склады: ${emp.permissions.allowedWarehouseIds.filter(id => liveWarehouses.some(w => w.id === id)).length} из ${liveWarehouses.length}`
                                : 'Магазин'}
                          </span>
                      )}
                  </div>
              </div>
          ))}
      </div>
    </div>
  );
};

export default Employees;
