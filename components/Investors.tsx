import React, { useMemo, useState } from 'react';
import { Account, Investor, InvestorPermissions } from '../types';
import { ICONS } from '../constants';
import { getInvestorAccount, formatDate } from '../src/utils';

export type InvestorPoolChoice =
  | { mode: 'EXISTING'; accountId: string }
  | { mode: 'NEW'; name: string };

interface InvestorsProps {
  investors: Investor[];
  accounts?: Account[];
  showPools?: boolean;
  onAddInvestor: (name: string, phone: string, email: string, password: string, amount: number, profitPercentage: number, permissions: InvestorPermissions, poolChoice?: InvestorPoolChoice, joinedDate?: string) => void;
  onUpdateInvestor?: (investor: Investor, password?: string) => void;
  onDeleteInvestor?: (id: string) => void;
  onViewDetails?: (investor: Investor) => void;
}

const Investors: React.FC<InvestorsProps> = ({
    investors, accounts: accountsProp, showPools, onAddInvestor, onUpdateInvestor, onDeleteInvestor, onViewDetails
}) => {
  const accounts: Account[] = accountsProp || [];
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  // Form State
  const [formName, setFormName] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formProfitPercentage, setFormProfitPercentage] = useState('');
  const [formPermissions, setFormPermissions] = useState<InvestorPermissions>({
      canViewContracts: false,
      canViewHistory: false
  });

  // 🔹 Общий пул (BUSINESS_PRO) — только при создании нового инвестора
  const [poolMode, setPoolMode] = useState<'OWN' | 'EXISTING' | 'NEW'>('OWN');
  const [selectedPoolAccountId, setSelectedPoolAccountId] = useState('');
  const [newPoolName, setNewPoolName] = useState('');
  const [formJoinedDate, setFormJoinedDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [formLeftPoolDate, setFormLeftPoolDate] = useState('');

  const poolAccounts = useMemo(() => accounts.filter(a => a.type === 'POOL'), [accounts]);

  // Редактируем инвестора, который сейчас состоит в общем пуле — только тогда показываем поле "Дата выхода".
  const editingAccount = editingId ? getInvestorAccount(editingId, accounts) : undefined;
  const isEditingPoolMember = editingAccount?.type === 'POOL';

  // 🔹 Для контекста при выборе существующего пула — сколько в нём уже вложено другими участниками
  // (доля каждого инвестора считается по своему проценту от своей капитал-доли, единого "бюджета" на пул нет).
  const selectedPoolTotalCapital = useMemo(() => {
    if (poolMode !== 'EXISTING' || !selectedPoolAccountId) return 0;
    const acc = accounts.find(a => a.id === selectedPoolAccountId);
    return (acc?.poolMemberIds || [])
      .map(id => investors.find(i => i.id === id))
      .reduce((sum, inv) => sum + (inv?.initialAmount || 0), 0);
  }, [poolMode, selectedPoolAccountId, accounts, investors]);

  const resetForm = () => {
      setFormName('');
      setFormPhone('');
      setFormEmail('');
      setFormPassword('');
      setFormAmount('');
      setFormProfitPercentage('');
      setFormPermissions({ canViewContracts: false, canViewHistory: false });
      setPoolMode('OWN');
      setSelectedPoolAccountId('');
      setNewPoolName('');
      setFormJoinedDate(new Date().toISOString().split('T')[0]);
      setFormLeftPoolDate('');
      setEditingId(null);
      setIsAdding(false);
      setActiveMenuId(null);
  };

  const handleStartEdit = (inv: Investor) => {
      setFormName(inv.name);
      setFormPhone(inv.phone);
      setFormEmail(inv.email);
      setFormAmount(inv.initialAmount.toString());
      setFormProfitPercentage(inv.profitPercentage.toString());
      setFormPermissions(inv.permissions || { canViewContracts: false, canViewHistory: false });
      setFormPassword(''); // Password not typically editable directly or shown
      setFormJoinedDate((inv.joinedDate || new Date().toISOString()).split('T')[0]);
      setFormLeftPoolDate((inv.leftPoolDate || '').split('T')[0]);
      setEditingId(inv.id);
      setIsAdding(true);
      setActiveMenuId(null);
  };

  // 🔹 <input type="date"> не содержит времени — при сохранении превращается в полночь. Если выбрана
  // СЕГОДНЯШНЯЯ дата, берём реальный текущий момент (иначе инвестор, добавленный в конце дня, задним
  // числом получил бы долю от платежей, поступивших РАНЬШЕ в этот же день — getAccountShares сравнивает
  // joinedDate с датой каждого платежа). Для дат задним числом точное время всё равно неизвестно.
  const toJoinedDateIso = (dateStr: string): string => {
      const todayStr = new Date().toISOString().split('T')[0];
      return !dateStr || dateStr === todayStr ? new Date().toISOString() : new Date(dateStr).toISOString();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if(formName.trim()) {
        if (editingId && onUpdateInvestor) {
            const inv = investors.find(i => i.id === editingId);
            if (inv) {
                // 🔒 Пересчитываем joinedDate ТОЛЬКО если менеджер реально поменял дату в поле —
                // иначе (просто отредактировал %, например) сохраняем исходную дату один-в-один,
                // с точностью до времени. Раньше здесь joinedDate пересчитывался при КАЖДОМ
                // сохранении формы, и если исходная дата вступления была "сегодня", он превращался
                // в "прямо сейчас" — задним числом исключая инвестора из платежей, полученных
                // раньше в этот же день (см. getAccountShares), и обнуляя ему "полученную прибыль".
                const originalDateStr = (inv.joinedDate || '').split('T')[0];
                const joinedDate = formJoinedDate && formJoinedDate !== originalDateStr
                    ? toJoinedDateIso(formJoinedDate)
                    : inv.joinedDate;

                // 🔒 Та же защита, что и для joinedDate выше — пересчитываем ТОЛЬКО при реальном
                // изменении поля. Пустое значение = инвестор активен/выход отменён (leftPoolDate снят).
                const originalLeftDateStr = (inv.leftPoolDate || '').split('T')[0];
                const leftPoolDate = !formLeftPoolDate
                    ? undefined
                    : formLeftPoolDate !== originalLeftDateStr
                        ? toJoinedDateIso(formLeftPoolDate)
                        : inv.leftPoolDate;

                onUpdateInvestor({
                    ...inv,
                    name: formName,
                    phone: formPhone,
                    email: formEmail,
                    initialAmount: Number(formAmount) || inv.initialAmount, // 🔹 Фоллбэк на старое значение
                    profitPercentage: Number(formProfitPercentage),
                    joinedDate,
                    leftPoolDate,
                    permissions: formPermissions
                }, formPassword);
            }
        }  else {
    // 🔹 Email и пароль необязательны — без них инвестор просто не получит доступ в приложение
    // (учитывается только для распределения прибыли), логин можно добавить позже при редактировании.
    if (formEmail.trim() && !formPassword.trim()) {
        alert("Укажите пароль или очистите email, если инвестору не нужен доступ в приложение");
        return;
    }

    let poolChoice: InvestorPoolChoice | undefined;
    if (showPools && poolMode === 'EXISTING') {
        if (!selectedPoolAccountId) {
            alert("Выберите пул");
            return;
        }
        poolChoice = { mode: 'EXISTING', accountId: selectedPoolAccountId };
    } else if (showPools && poolMode === 'NEW') {
        if (!newPoolName.trim()) {
            alert("Укажите название нового пула");
            return;
        }
        poolChoice = { mode: 'NEW', name: newPoolName.trim() };
    }

    const joinedDateIso = toJoinedDateIso(formJoinedDate);

    // 🔹 Сумма теперь необязательна, по умолчанию 0
    onAddInvestor(formName, formPhone, formEmail, formPassword, Number(formAmount) || 0, Number(formProfitPercentage), formPermissions, poolChoice, joinedDateIso);
}
        resetForm();
    }
};

  const handleDelete = (id: string) => {
      if(window.confirm("Удалить инвестора?")) {
          onDeleteInvestor?.(id);
      }
      setActiveMenuId(null);
  }

  return (
    <div className="space-y-6 pb-20" onClick={() => setActiveMenuId(null)}>
      <header className="flex justify-between items-center">
        <div>
            <h2 className="text-2xl font-bold text-slate-800 dark:text-white">Инвесторы</h2>
            <p className="text-slate-500 dark:text-slate-400 text-sm">Партнеры и их счета</p>
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
                  {editingId ? 'Редактировать инвестора' : 'Новый инвестор'}
              </h3>

              <div className="space-y-3">
                  <input
                    placeholder="Имя Фамилия"
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
                  <div className="grid grid-cols-2 gap-3">
                    <input
                        type="email"
                        placeholder="Email (Логин, необязательно)"
                        className="w-full p-3 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-xl outline-none"
                        value={formEmail}
                        onChange={e => setFormEmail(e.target.value)}
                    />
                    <input
                        type="text" // Visible for creation
                        placeholder={editingId ? "Новый пароль (необязательно)" : "Пароль (если указан email)"}
                        className="w-full p-3 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-xl outline-none"
                        value={formPassword}
                        onChange={e => setFormPassword(e.target.value)}
                    />
                  </div>
                  {!editingId && (
                      <p className="text-xs text-slate-400 -mt-1">
                          Без email и пароля инвестор будет учитываться только для распределения прибыли, без доступа в приложение. Логин можно добавить позже.
                      </p>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                      {!editingId && (
                          <div className="relative">
                              <span className="absolute right-4 top-3.5 text-slate-400">₽</span>
                              <input
                                  type="number"
                                  placeholder="Сумма инвестиции"
                                  className="w-full p-3 pr-8 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-xl outline-none font-bold"
                                  value={formAmount}
                                  onChange={e => setFormAmount(e.target.value)}
                                  required={poolMode !== 'OWN'}
                              />
                          </div>
                      )}

                      {/* 🔹 Процент прибыли — личный процент этого инвестора. Для пула он применяется
                          не ко всей прибыли, а к части, приходящейся на его капитал (см. подсказку ниже). */}
                      <div className={`relative ${!editingId ? '' : 'col-span-2'}`}>
                          <span className="absolute right-4 top-3.5 text-slate-400">%</span>
                          <input
                              type="number"
                              placeholder="Процент прибыли"
                              className="w-full p-3 pr-8 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-xl outline-none font-bold"
                              value={formProfitPercentage}
                              onChange={e => setFormProfitPercentage(e.target.value)}
                              required
                          />
                      </div>
                  </div>
                  <div>
                      <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">Дата начала участия</label>
                      <input
                          type="date"
                          className="w-full p-3 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-xl outline-none"
                          value={formJoinedDate}
                          onChange={e => setFormJoinedDate(e.target.value)}
                          required
                      />
                  </div>
                  {editingId && isEditingPoolMember && (
                      <div>
                          <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">Дата выхода из пула (необязательно)</label>
                          <input
                              type="date"
                              className="w-full p-3 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-xl outline-none"
                              value={formLeftPoolDate}
                              onChange={e => setFormLeftPoolDate(e.target.value)}
                          />
                          <p className="text-xs text-slate-400 mt-1">
                              Инвестор перестанет получать долю будущей прибыли пула. История начислений до этой даты сохранится. Оставьте пустым, если инвестор ещё активен.
                          </p>
                      </div>
                  )}
                  {!editingId && poolMode !== 'OWN' && (
                      <p className="text-xs text-slate-400 -mt-1">
                          Для общего пула сумма вложения обязательна. Прибыль сначала делится между участниками пропорционально вложенной сумме, а затем к части каждого применяется именно его процент прибыли выше.
                      </p>
                  )}

                  {/* 🔹 Общий инвестиционный пул — только на BUSINESS_PRO, только при создании */}
                  {showPools && !editingId && (
                      <div className="bg-fuchsia-50 dark:bg-fuchsia-900/20 p-4 rounded-xl space-y-3 border border-fuchsia-100 dark:border-fuchsia-900/40">
                          <h4 className="text-sm font-bold text-fuchsia-700 dark:text-fuchsia-400">Счёт инвестора</h4>
                          <div className="grid grid-cols-3 gap-2">
                              {(['OWN', 'EXISTING', 'NEW'] as const).map(mode => (
                                  <button
                                      key={mode}
                                      type="button"
                                      onClick={() => setPoolMode(mode)}
                                      className={`py-2 px-2 rounded-lg text-xs font-bold transition-colors ${poolMode === mode ? 'bg-fuchsia-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600'}`}
                                  >
                                      {mode === 'OWN' ? 'Отдельный счёт' : mode === 'EXISTING' ? 'В общий пул' : '+ Новый пул'}
                                  </button>
                              ))}
                          </div>

                          {poolMode === 'EXISTING' && (
                              <div className="space-y-1">
                                  <select
                                      className="w-full p-3 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-xl outline-none"
                                      value={selectedPoolAccountId}
                                      onChange={e => setSelectedPoolAccountId(e.target.value)}
                                      required
                                  >
                                      <option value="">Выберите пул…</option>
                                      {poolAccounts.map(acc => (
                                          <option key={acc.id} value={acc.id}>{acc.name}</option>
                                      ))}
                                  </select>
                                  {selectedPoolAccountId && (
                                      <p className="text-xs text-slate-500 dark:text-slate-400">
                                          Уже вложено другими участниками: {selectedPoolTotalCapital.toLocaleString('ru-RU')} ₽. Ваш процент прибыли выше применяется к части прибыли, приходящейся именно на вложение этого инвестора.
                                      </p>
                                  )}
                              </div>
                          )}

                          {poolMode === 'NEW' && (
                              <input
                                  placeholder="Название пула (например, «Общий пул инвесторов»)"
                                  className="w-full p-3 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-xl outline-none"
                                  value={newPoolName}
                                  onChange={e => setNewPoolName(e.target.value)}
                                  required
                              />
                          )}

                          {poolMode !== 'OWN' && (
                              <p className="text-xs text-slate-500 dark:text-slate-400">Прибыль сначала делится между участниками пула пропорционально вложенной сумме, а затем к части каждого применяется его личный процент прибыли — остаток каждый раз достаётся вам как менеджеру.</p>
                          )}
                      </div>
                  )}

                  {/* Permissions */}
                  <div className="bg-slate-50 dark:bg-slate-700/50 p-4 rounded-xl space-y-3">
                      <h4 className="text-sm font-bold text-slate-600 dark:text-slate-300">Права доступа</h4>
                      <div className="space-y-2">
                          <label
                              className="flex items-center gap-3 cursor-pointer p-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg hover:border-indigo-400 dark:hover:border-indigo-500 transition-colors">
                              <input
                                  type="checkbox"
                                  className="w-5 h-5 rounded border-slate-300 dark:border-slate-600 text-indigo-600 focus:ring-indigo-500"
                                  checked={formPermissions.canViewContracts}
                                  onChange={e => setFormPermissions({
                                      ...formPermissions,
                                      canViewContracts: e.target.checked
                                  })}
                              />
                              <div className="text-sm">
                                  <span className="font-semibold text-slate-800 dark:text-white block">Просмотр договоров</span>
                                  <span
                                      className="text-xs text-slate-500 dark:text-slate-400">Доступ к странице "Договоры" (только свои)</span>
                              </div>
                          </label>
                          <label className="flex items-center gap-3 cursor-pointer p-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg hover:border-indigo-400 dark:hover:border-indigo-500 transition-colors">
                              <input
                                type="checkbox"
                                className="w-5 h-5 rounded border-slate-300 dark:border-slate-600 text-indigo-600 focus:ring-indigo-500"
                                checked={formPermissions.canViewHistory}
                                onChange={e => setFormPermissions({...formPermissions, canViewHistory: e.target.checked})}
                              />
                              <div className="text-sm">
                                  <span className="font-semibold text-slate-800 dark:text-white block">Просмотр истории</span>
                                  <span className="text-xs text-slate-500 dark:text-slate-400">Доступ к странице "История операций" (только свои)</span>
                              </div>
                          </label>
                      </div>
                  </div>
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
        {investors.length === 0 && !isAdding && (
            <div className="text-center py-8 text-slate-400">Нет инвесторов</div>
        )}
        {investors.map(inv => {
            const acc = getInvestorAccount(inv.id, accounts);
            const isPoolMember = acc?.type === 'POOL';
            return (
            <div key={inv.id} className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm relative">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 rounded-full flex items-center justify-center font-bold text-lg">
                            {inv.name.charAt(0)}
                        </div>
                        <div>
                            <h3 className="font-bold text-slate-800 dark:text-white">{inv.name}</h3>
                            <p className="text-xs text-slate-500 dark:text-slate-400">{inv.email}</p>
                            {isPoolMember && (
                                <span className="inline-block mt-1 text-[10px] font-bold text-fuchsia-600 dark:text-fuchsia-400 bg-fuchsia-50 dark:bg-fuchsia-900/30 px-2 py-0.5 rounded-full">Пул: {acc!.name}</span>
                            )}
                            {isPoolMember && inv.leftPoolDate && (
                                <span className="inline-block mt-1 ml-1 text-[10px] font-bold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 rounded-full">Вышел из пула: {formatDate(inv.leftPoolDate)}</span>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <div className="text-right mr-2 hidden sm:block">
                            <p className="text-xs text-slate-400">Процент</p>
                            <p className="text-sm font-bold text-indigo-600 dark:text-indigo-400">{inv.profitPercentage}%</p>
                        </div>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setActiveMenuId(activeMenuId === inv.id ? null : inv.id);
                            }}
                            className="p-2 text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg transition-colors"
                        >
                            {ICONS.More}
                        </button>
                    </div>
                </div>

                {/* Dropdown Menu */}
                {activeMenuId === inv.id && (
                    <div className="absolute right-4 top-14 bg-white dark:bg-slate-800 shadow-xl border border-slate-100 dark:border-slate-700 rounded-xl z-20 w-40 overflow-hidden animate-fade-in">
                        <button
                            onClick={(e) => { e.stopPropagation(); onViewDetails?.(inv); }}
                            className="w-full text-left px-4 py-3 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2"
                        >
                            <span className="text-indigo-500">{ICONS.File}</span> Инфо
                        </button>
                        <button
                            onClick={(e) => { e.stopPropagation(); handleStartEdit(inv); }}
                            className="w-full text-left px-4 py-3 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2"
                        >
                            <span className="text-slate-500">{ICONS.Edit}</span> Изменить
                        </button>
                        <button
                            onClick={(e) => { e.stopPropagation(); handleDelete(inv.id); }}
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

export default Investors;
