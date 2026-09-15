
import React, { useState } from 'react';
import { User, Investor, AppSettings, StockLocation } from '../types';
import { ICONS } from '../constants';

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

const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
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
    resetForm();
};

  const handleDelete = (id: string) => {
      if (window.confirm("Удалить сотрудника?")) {
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
          <form onSubmit={handleSubmit} className="bg-white dark:bg-slate-800 p-5 rounded-2xl shadow-md border border-slate-100 dark:border-slate-700 space-y-5 animate-fade-in">
              <h3 className="font-bold text-slate-800 dark:text-white border-b border-slate-100 dark:border-slate-700 pb-2">
                  {editingId ? 'Редактирование сотрудника' : 'Новый сотрудник'}
              </h3>

              <div className="space-y-3">
                  <input 
                    placeholder="Имя Фамилия"
                    className="w-full p-3 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-xl outline-none"
                    value={name}
                    onChange={e => setName(e.target.value)}
                  />
                  <div className="grid grid-cols-2 gap-3">
                      <input 
                        placeholder="Email (Логин)"
                        type="email"
                        className="w-full p-3 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-xl outline-none"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                      />
                      <input 
                        placeholder={editingId ? "Новый пароль (необяз.)" : "Пароль"}
                        type="text"
                        className="w-full p-3 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-xl outline-none"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                      />
                  </div>
              </div>

              {/* 💰 Мотивация: процент от прибыли */}
              <div className="bg-emerald-50/60 dark:bg-emerald-900/20 p-4 rounded-xl space-y-3 border border-emerald-100 dark:border-emerald-900/40">
                  <h4 className="text-sm font-bold text-slate-600 dark:text-slate-300">Процент от прибыли</h4>

                  <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        placeholder="не начисляется"
                        className="w-40 p-3 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-xl outline-none"
                        value={profitPercentage}
                        onChange={e => setProfitPercentage(e.target.value)}
                      />
                      <span className="text-slate-500 dark:text-slate-400 text-sm">% от прибыли</span>
                  </div>

                  {Number(profitPercentage) > 0 && (
                    <>
                      <div>
                          <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase mb-2">Считать от</p>
                          <div className="space-y-2">
                              {([
                                { key: 'CONTRACTS', label: 'Договоров, которые он оформил', hint: 'Премия капает со всех платежей его клиентов' },
                                { key: 'PAYMENTS', label: 'Платежей, которые он принял', hint: 'Мотивация на сбор денег' },
                                { key: 'ALL', label: 'Всей прибыли', hint: 'Доля со всего бизнеса' },
                              ] as const).map(opt => (
                                <label key={opt.key} className={`flex items-start gap-2.5 p-3 rounded-xl border-2 cursor-pointer ${
                                    profitBase === opt.key
                                      ? 'border-emerald-600 bg-white dark:bg-slate-900'
                                      : 'border-slate-200 dark:border-slate-600 bg-white/60 dark:bg-slate-900/40'
                                }`}>
                                    <input
                                      type="radio"
                                      name="profitBase"
                                      className="mt-0.5 w-4 h-4 text-emerald-600 focus:ring-emerald-500"
                                      checked={profitBase === opt.key}
                                      onChange={() => setProfitBase(opt.key)}
                                    />
                                    <span className="min-w-0">
                                        <span className="block text-sm font-medium text-slate-700 dark:text-slate-300">{opt.label}</span>
                                        <span className="block text-xs text-slate-500 dark:text-slate-400">{opt.hint}</span>
                                    </span>
                                </label>
                              ))}
                          </div>
                      </div>

                      <div>
                          <label className="block text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase mb-2">Начислять с даты</label>
                          <input
                            type="date"
                            className="w-full p-3 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-xl outline-none"
                            value={profitSince}
                            onChange={e => setProfitSince(e.target.value)}
                          />
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                              Платежи, поступившие раньше этой даты, в премию не идут.
                              {!profitSince && ' Если оставить пусто — начнём с сегодняшнего дня.'}
                          </p>
                      </div>

                      <div>
                          <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase mb-2">Из чьей прибыли платится</p>
                          <div className="space-y-2">
                              {([
                                { key: 'MANAGER', label: 'Из моей доли', hint: 'Сотрудник нанят вами — доли инвесторов не затрагиваются' },
                                { key: 'SHARED', label: 'Расход общего дела', hint: 'Вычитается из прибыли до распределения — ложится и на инвесторов. Только по договорённости с ними' },
                              ] as const).map(opt => (
                                <label key={opt.key} className={`flex items-start gap-2.5 p-3 rounded-xl border-2 cursor-pointer ${
                                    profitSource === opt.key
                                      ? 'border-emerald-600 bg-white dark:bg-slate-900'
                                      : 'border-slate-200 dark:border-slate-600 bg-white/60 dark:bg-slate-900/40'
                                }`}>
                                    <input
                                      type="radio"
                                      name="profitSource"
                                      className="mt-0.5 w-4 h-4 text-emerald-600 focus:ring-emerald-500"
                                      checked={profitSource === opt.key}
                                      onChange={() => setProfitSource(opt.key)}
                                    />
                                    <span className="min-w-0">
                                        <span className="block text-sm font-medium text-slate-700 dark:text-slate-300">{opt.label}</span>
                                        <span className="block text-xs text-slate-500 dark:text-slate-400">{opt.hint}</span>
                                    </span>
                                </label>
                              ))}
                          </div>
                          <p className="text-xs text-amber-700 dark:text-amber-400 mt-2">
                              Если ваша доля прибыли по счёту равна нулю, премия из неё платиться не может —
                              тогда единственный рабочий вариант это «расход общего дела», и он требует согласия инвесторов.
                          </p>
                      </div>

                      <label className="flex items-start gap-2.5 pt-1 cursor-pointer">
                          <input
                            type="checkbox"
                            className="mt-0.5 w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-emerald-600 focus:ring-emerald-500"
                            checked={profitReducesManager}
                            onChange={e => setProfitReducesManager(e.target.checked)}
                          />
                          <span className="min-w-0">
                              <span className="block text-sm font-medium text-slate-700 dark:text-slate-300">Сразу уменьшать мою прибыль</span>
                              <span className="block text-xs text-slate-500 dark:text-slate-400">
                                  Иначе прибыль уменьшится только когда зарплата будет фактически выплачена,
                                  а начисленное будет видно отдельно как долг перед сотрудником
                              </span>
                          </span>
                      </label>

                      <p className="text-xs text-slate-500 dark:text-slate-400 pt-1 border-t border-emerald-100 dark:border-emerald-900/40">
                          Начисляется по мере поступления платежей, по мере фактической оплаты клиентами.
                      </p>
                    </>
                  )}
              </div>

              {/* Permissions */}
              <div className="bg-slate-50 dark:bg-slate-700/50 p-4 rounded-xl space-y-3">
                  <h4 className="text-sm font-bold text-slate-600 dark:text-slate-300">Права доступа (CRUD)</h4>
                  {/* Три права плитками в сетку: строкой они не помещались в ширину
                      телефона, и «Удаление» уезжало за край карточки. */}
                  <div className="grid grid-cols-3 gap-2">
                      {([
                        ['canCreate', 'Создание'],
                        ['canEdit', 'Редактирование'],
                        ['canDelete', 'Удаление'],
                      ] as const).map(([key, label]) => (
                        <label key={key}
                               className={`min-w-0 flex flex-col sm:flex-row items-center justify-center gap-1.5 px-1.5 py-2.5 rounded-xl border-2 cursor-pointer text-center transition-colors ${
                                 permissions[key]
                                   ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30'
                                   : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800'
                               }`}>
                            <input
                              type="checkbox"
                              className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-indigo-600 focus:ring-indigo-500"
                              checked={permissions[key]}
                              onChange={e => setPermissions({...permissions, [key]: e.target.checked})}
                            />
                            <span className="text-[10px] tracking-tight sm:text-sm sm:tracking-normal leading-tight text-slate-700 dark:text-slate-300 break-words">{label}</span>
                        </label>
                      ))}
                  </div>

                  {/* Доступ к разделу, а не к действию, — поэтому отдельной
                      строкой под чертой, а не четвёртой галочкой в ряд с CRUD. */}
                  {showShop && (
                    <label className="flex items-start gap-3 cursor-pointer pt-3 border-t border-slate-200 dark:border-slate-600">
                        <input
                          type="checkbox"
                          className="w-5 h-5 mt-0.5 rounded border-slate-300 dark:border-slate-600 text-indigo-600 focus:ring-indigo-500"
                          checked={!!permissions.canUseShop}
                          onChange={e => setPermissions({...permissions, canUseShop: e.target.checked})}
                        />
                        <span className="text-sm">
                            <span className="font-semibold text-slate-800 dark:text-white block">Магазин и склад</span>
                            <span className="text-slate-500 dark:text-slate-400 text-xs">
                                Касса, товары, остатки и журнал документов. Без этого права разделы не видны,
                                а закупочные цены и остатки сотруднику недоступны.
                            </span>
                        </span>
                    </label>
                  )}

                  {/* Какие склады открыть. Только при доступе к магазину и если складов
                      несколько: с одним складом выбирать нечего. */}
                  {showShop && permissions.canUseShop && liveWarehouses.length > 1 && (
                    <div className="pl-8 space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                            {([['ALL', 'Все склады'], ['SELECTED', 'Выбранные']] as const).map(([mode, label]) => (
                              <button key={mode} type="button" onClick={() => setWarehouseMode(mode)}
                                      className={`py-2 rounded-xl border-2 text-xs font-bold transition-colors ${
                                        warehouseMode === mode
                                          ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                                          : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                                      }`}>
                                  {label}
                              </button>
                            ))}
                        </div>
                        {warehouseMode === 'ALL' ? (
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                              Доступны все склады, в том числе новые.
                          </p>
                        ) : (
                          <>
                            <div className="rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 divide-y divide-slate-100 dark:divide-slate-700">
                                {liveWarehouses.map(w => (
                                  <label key={w.id} className="flex items-center gap-3 px-3 py-2.5 cursor-pointer">
                                      <input
                                        type="checkbox"
                                        className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-indigo-600 focus:ring-indigo-500"
                                        checked={allowedWarehouseIds.includes(w.id)}
                                        onChange={() => setAllowedWarehouseIds(prev =>
                                          prev.includes(w.id) ? prev.filter(id => id !== w.id) : [...prev, w.id])}
                                      />
                                      <span className="min-w-0 flex-1 text-sm text-slate-700 dark:text-slate-200 truncate">{w.name}</span>
                                      {w.isMain && (
                                        <span className="shrink-0 px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 text-[10px] font-bold uppercase">
                                            Основной
                                        </span>
                                      )}
                                  </label>
                                ))}
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                Касса, остатки, приход и журнал — только по отмеченным складам.
                            </p>
                          </>
                        )}
                    </div>
                  )}
              </div>

              {/* Investor Access */}
              {/* Доступ к счетам */}
<div className="bg-slate-50 dark:bg-slate-700/50 p-4 rounded-xl space-y-3">
    <h4 className="text-sm font-bold text-slate-600 dark:text-slate-300">Доступ к счетам</h4>
    <p className="text-xs text-slate-500 dark:text-slate-400 -mt-2">
        По умолчанию сотрудник видит только созданные им самим записи. Включите «Видит все данные»,
        чтобы дать полный доступ ко всем операциям по счёту/инвестору.
    </p>

    {/* ГАЛОЧКА ДЛЯ ОСНОВНОГО СЧЕТА */}
    <div className="p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg space-y-2">
        <label className="flex items-center gap-3 cursor-pointer">
            <input
                type="checkbox"
                className="w-5 h-5 rounded border-slate-300 dark:border-slate-600 text-indigo-600 focus:ring-indigo-500"
                checked={allowMainAccount}
                onChange={e => {
                    setAllowMainAccount(e.target.checked);
                    if (!e.target.checked) setFullAccessMainAccount(false);
                }}
            />
            <div className="text-sm">
                <span className="font-semibold text-slate-800 dark:text-white block">Основной счет компании</span>
                <span className="text-slate-500 dark:text-slate-400 text-xs">Сотрудник сможет видеть и создавать операции на главном счете, даже если нет инвесторов.</span>
            </div>
        </label>
        {allowMainAccount && (
            <label className="flex items-center gap-2 pl-8 cursor-pointer">
                <input
                    type="checkbox"
                    className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-emerald-600 focus:ring-emerald-500"
                    checked={fullAccessMainAccount}
                    onChange={e => setFullAccessMainAccount(e.target.checked)}
                />
                <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Видит все данные по этому счёту</span>
            </label>
        )}
    </div>

    <p className="text-xs text-slate-500 dark:text-slate-400 mt-4 mb-2">Или выберите конкретных инвесторов:</p>
    <div className="max-h-56 overflow-y-auto space-y-2 border border-slate-200 dark:border-slate-600 rounded-lg p-2 bg-white dark:bg-slate-800">
        {investors.length === 0 && <p className="text-xs text-slate-400 dark:text-slate-500 p-2">Нет инвесторов</p>}
        {investors.map(inv => (
            <div key={inv.id} className="p-2 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg space-y-1.5">
                <label className="flex items-center gap-3 cursor-pointer">
                    <input
                        type="checkbox"
                        className="w-5 h-5 rounded border-slate-300 dark:border-slate-600 text-purple-600 focus:ring-purple-500"
                        checked={allowedInvestorIds.includes(inv.id)}
                        onChange={() => handleInvestorToggle(inv.id)}
                    />
                    <div className="text-sm">
                        <span className="font-semibold text-slate-800 dark:text-white block">{inv.name}</span>
                        <span className="text-slate-500 dark:text-slate-400 text-xs">{inv.email}</span>
                    </div>
                </label>
                {allowedInvestorIds.includes(inv.id) && (
                    <label className="flex items-center gap-2 pl-8 cursor-pointer">
                        <input
                            type="checkbox"
                            className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-emerald-600 focus:ring-emerald-500"
                            checked={fullAccessInvestorIds.includes(inv.id)}
                            onChange={() => handleFullAccessInvestorToggle(inv.id)}
                        />
                        <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Видит все данные по этому инвестору</span>
                    </label>
                )}
            </div>
        ))}
    </div>
</div>

              <div className="flex gap-3">
                  <button type="button" onClick={resetForm} className="flex-1 py-3 bg-slate-100 dark:bg-slate-700 rounded-xl font-bold text-slate-600 dark:text-slate-300">Отмена</button>
                  <button type="submit" className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold">
                      {editingId ? 'Сохранить изменения' : 'Создать сотрудника'}
                  </button>
              </div>
          </form>
      )}

      {/* Employee List */}
      <div className="grid gap-4">
          {employees.length === 0 && !isAdding && (
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
