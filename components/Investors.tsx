import React, { useEffect, useMemo, useRef, useState } from 'react';
import { percentError } from '../src/investorPercent';
import { Account, Investor, InvestorPermissions } from '../types';
import { ICONS } from '../constants';
import { getInvestorAccount, formatDate, participationDates, participationDatesError, withParticipationDates } from '../src/utils';
import { SuccessCheck, hapticSuccess, haptic } from './feedback';
import GlassSheet, { SheetSection, SheetField, SheetToggle, SheetSegmented, sheetInputClass } from './GlassSheet';
import { appConfirm } from '../src/dialogs';

export type InvestorPoolChoice =
  | { mode: 'EXISTING'; accountId: string }
  | { mode: 'NEW'; name: string };

interface InvestorsProps {
  investors: Investor[];
  accounts?: Account[];
  showPools?: boolean;
  onAddInvestor: (name: string, phone: string, email: string, password: string, amount: number, profitPercentage: number, permissions: InvestorPermissions, poolChoice?: InvestorPoolChoice, joinedDate?: string, leftPoolDate?: string) => void;
  onUpdateInvestor?: (investor: Investor, password?: string) => void;
  onDeleteInvestor?: (id: string) => void;
  onViewDetails?: (investor: Investor) => void;
  /** Инвесторы сверх лимита тарифа — блокируются до его повышения, данные сохраняются */
  lockedInvestorIds?: string[];
}

const Investors: React.FC<InvestorsProps> = ({
    investors, accounts: accountsProp, showPools, onAddInvestor, onUpdateInvestor, onDeleteInvestor, onViewDetails,
    lockedInvestorIds = []
}) => {
  const accounts: Account[] = accountsProp || [];
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  // Создание инвестора — событие того же веса, что оформление договора: заходят деньги,
  // фиксируется доля в прибыли. Показываем, что именно записалось.
  const [createdInvestor, setCreatedInvestor] = useState<{ name: string; amount: number; percent: number } | null>(null);
  // Правку показываем тише — короткой подсветкой карточки в списке, без модалки
  const [savedId, setSavedId] = useState<string | null>(null);
  // Удаление: своя модалка вместо системного window.confirm, который не показывал,
  // кого именно удаляют, и не предупреждал о последствиях.
  const [deletingInvestor, setDeletingInvestor] = useState<Investor | null>(null);

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
  };

  const handleStartEdit = (inv: Investor) => {
      setFormName(inv.name);
      setFormPhone(inv.phone);
      setFormEmail(inv.email);
      setFormAmount(inv.initialAmount.toString());
      setFormProfitPercentage(inv.profitPercentage.toString());
      setFormPermissions(inv.permissions || { canViewContracts: false, canViewHistory: false });
      setFormPassword(''); // Password not typically editable directly or shown
      // Даты — действующие, из периодов участия, если они есть: именно их читает
      // расчёт долей, а верхние поля у такого инвестора устаревают.
      const dates = participationDates(inv);
      setFormJoinedDate((dates.joinedDate || new Date().toISOString()).split('T')[0]);
      setFormLeftPoolDate((dates.leftPoolDate || '').split('T')[0]);
      setEditingId(inv.id);
      setIsAdding(true);
  };

  // 🔹 <input type="date"> не содержит времени — при сохранении превращается в полночь. Если выбрана
  // СЕГОДНЯШНЯЯ дата, берём реальный текущий момент (иначе инвестор, добавленный в конце дня, задним
  // числом получил бы долю от платежей, поступивших РАНЬШЕ в этот же день — getAccountShares сравнивает
  // joinedDate с датой каждого платежа). Для дат задним числом точное время всё равно неизвестно.
  const toJoinedDateIso = (dateStr: string): string => {
      const todayStr = new Date().toISOString().split('T')[0];
      return !dateStr || dateStr === todayStr ? new Date().toISOString() : new Date(dateStr).toISOString();
  };

  // Сохранение из листа: закрывает его сам лист (close), а форму сбрасывает
  // resetForm на его уходе — иначе лист пропадал бы мгновенно, без анимации.
  const handleSubmit = (close: () => void) => {

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
                // Сравниваем с действующими датами — у инвестора с периодами это даты
                // периодов, а не верхние поля.
                const current = participationDates(inv);
                const joinedChanged = !!formJoinedDate && formJoinedDate !== (current.joinedDate || '').split('T')[0];
                const joinedDate = joinedChanged ? toJoinedDateIso(formJoinedDate) : current.joinedDate;

                // 🔒 Та же защита, что и для joinedDate выше — пересчитываем ТОЛЬКО при реальном
                // изменении поля. Пустое значение = инвестор активен/выход отменён (leftPoolDate снят).
                const leftChanged = formLeftPoolDate !== (current.leftPoolDate || '').split('T')[0];
                const leftPoolDate = !formLeftPoolDate
                    ? null
                    : leftChanged ? toJoinedDateIso(formLeftPoolDate) : current.leftPoolDate;

                const problem = participationDatesError(inv, joinedDate, leftPoolDate);
                if (problem) { alert(problem); return; }

                // Даты пишем и в карточку, и в периоды участия: раньше менялись только верхние
                // поля, и у инвестора с периодами новая дата входа молча не влияла на прибыль.
                onUpdateInvestor(withParticipationDates({
                    ...inv,
                    name: formName,
                    phone: formPhone,
                    email: formEmail,
                    // Сумму здесь не меняем: поле при редактировании скрыто. Пополнение — через
                    // «Приход», возврат — расходом «Из инвестиций»: у них есть дата и деньги.
                    initialAmount: inv.initialAmount,
                    profitPercentage: Number(formProfitPercentage),
                    permissions: formPermissions
                }, {
                    ...(joinedChanged ? { joinedDate } : {}),
                    ...(leftChanged ? { leftPoolDate } : {}),
                }), formPassword);

                // Рутинная правка — подсвечиваем строку и идём дальше
                setSavedId(inv.id);
                haptic();
                setTimeout(() => setSavedId(prev => (prev === inv.id ? null : prev)), 1500);
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
    const leftPoolDateIso = formLeftPoolDate ? new Date(formLeftPoolDate).toISOString() : undefined;
    onAddInvestor(formName, formPhone, formEmail, formPassword, Number(formAmount) || 0, Number(formProfitPercentage), formPermissions, poolChoice, joinedDateIso, leftPoolDateIso);

    setCreatedInvestor({
        name: formName,
        amount: Number(formAmount) || 0,
        percent: Number(formProfitPercentage) || 0,
    });
    hapticSuccess();
    setTimeout(() => setCreatedInvestor(null), 1900);
}
        close();
    }
};

  // Что было в форме при открытии — переспрашиваем при закрытии, только если что-то поменяли
  const formSnapshot = JSON.stringify({
    formName, formPhone, formEmail, formPassword, formAmount, formProfitPercentage, formPermissions,
    poolMode, selectedPoolAccountId, newPoolName, formJoinedDate, formLeftPoolDate,
  });
  const openedWith = useRef('');
  useEffect(() => { if (isAdding) openedWith.current = formSnapshot; }, [isAdding, editingId]);
  const formDirty = isAdding && formSnapshot !== openedWith.current;

  const handleDelete = (id: string) => {
      const inv = investors.find(i => i.id === id);
      if (inv) setDeletingInvestor(inv);
  };

  const confirmDeleteInvestor = () => {
      if (!deletingInvestor) return;
      onDeleteInvestor?.(deletingInvestor.id);
      setDeletingInvestor(null);
  };

  return (
    <div className="space-y-6 pb-20">
      <header className="flex justify-between items-center">
        <div>
            <h2 className="text-2xl font-bold text-slate-800 dark:text-white">Инвесторы</h2>
            <p className="text-slate-500 dark:text-slate-400 text-sm">Партнеры и их счета</p>
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

      {investors.length > 0 && (
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input autoComplete="off" autoCorrect="off" spellCheck={false}
            type="text"
            placeholder="Поиск по имени, email, телефону…"
            className="w-full pl-9 pr-4 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-700 dark:text-white placeholder-slate-400 outline-none focus:border-indigo-400 dark:focus:border-indigo-500 transition-colors"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          )}
        </div>
      )}

      {isAdding && (
        <GlassSheet
          title={editingId ? 'Инвестор' : 'Новый инвестор'}
          subtitle={editingId ? (formName.trim() || 'Без имени') : 'Деньги, процент и доступ в приложение'}
          onClose={resetForm}
          cancelLabel="Отмена"
          action={{
            label: editingId ? 'Готово' : 'Добавить',
            submit: true,
            disabled: !formName.trim() || formProfitPercentage === '' || !!percentError(formProfitPercentage) || (!!editingId && !formDirty),
          }}
          onSubmit={handleSubmit}
          confirmClose={() => !formDirty || appConfirm({
            title: editingId ? 'Закрыть без сохранения?' : 'Не добавлять инвестора?',
            message: 'Введённые данные пропадут.',
            confirmLabel: 'Закрыть',
            cancelLabel: 'Остаться',
            destructive: true,
          })}
        >
          <div className="space-y-6">
            <SheetSection>
              <SheetField label="Имя и фамилия">
                <input className={sheetInputClass} value={formName} onChange={e => setFormName(e.target.value)}
                       autoComplete="off" autoCorrect="off" spellCheck={false} autoCapitalize="words"
                       enterKeyHint="next" placeholder="Иван Петров" required />
              </SheetField>
              <SheetField label="Телефон">
                <input className={sheetInputClass} value={formPhone} onChange={e => setFormPhone(e.target.value)}
                       type="tel" inputMode="tel" autoComplete="off" enterKeyHint="next" placeholder="+7 900 000-00-00" />
              </SheetField>
            </SheetSection>

            <SheetSection title="Условия"
                          hint={!editingId && poolMode !== 'OWN'
                            ? 'Для общего пула сумма обязательна: прибыль сначала делится между участниками по вложенным суммам, затем к части каждого применяется его процент.'
                            : editingId ? 'Сумму здесь не меняют: пополнение — через «Приход», возврат — расходом «Из инвестиций».' : undefined}>
              {!editingId && (
                <SheetField label="Сумма вложения">
                  <span className="flex items-baseline gap-1">
                    <input className={`${sheetInputClass} font-semibold`} value={formAmount} onChange={e => setFormAmount(e.target.value)}
                           type="number" inputMode="decimal" placeholder="0" required={poolMode !== 'OWN'} />
                    <span className="text-[16px] text-slate-400">₽</span>
                  </span>
                </SheetField>
              )}
              <SheetField label="Процент прибыли" hint={percentError(formProfitPercentage)}>
                <span className="flex items-baseline gap-1">
                  <input className={`${sheetInputClass} font-semibold`} value={formProfitPercentage} onChange={e => setFormProfitPercentage(e.target.value)}
                         type="number" inputMode="decimal" min={0} max={100} placeholder="0" required />
                  <span className="text-[16px] text-slate-400">%</span>
                </span>
              </SheetField>
              <SheetField label="Дата начала участия"
                          hint={editingId && isEditingPoolMember
                            ? 'С этой даты инвестор участвует в прибыли кассы. Начальный депозит переедет на эту же дату.'
                            : !editingId && formJoinedDate < new Date().toISOString().split('T')[0]
                              ? 'Дата в прошлом: вложение запишется в кассу этой датой, и с неё инвестор участвует в прибыли.'
                              : undefined}>
                <input className={`${sheetInputClass} h-7 appearance-none [&::-webkit-date-and-time-value]:text-left`}
                       type="date" value={formJoinedDate} onChange={e => setFormJoinedDate(e.target.value)}
                       max={new Date().toISOString().split('T')[0]} required />
              </SheetField>
              {((!editingId && poolMode !== 'OWN') || (editingId && isEditingPoolMember)) && (
                <SheetField label="Дата выхода из пула"
                            hint={editingId
                              ? 'С этой даты инвестор не получает долю будущей прибыли пула; история до неё сохранится. Пусто — ещё активен.'
                              : 'Пусто — инвестор ещё активен.'}>
                  <span className="relative block">
                    {!formLeftPoolDate && (
                      <span className="pointer-events-none absolute inset-0 flex items-center text-[16px] text-slate-300 dark:text-slate-600">Не указана</span>
                    )}
                    <input className={`${sheetInputClass} h-7 appearance-none [&::-webkit-date-and-time-value]:text-left ${formLeftPoolDate ? '' : 'text-transparent'}`}
                           type="date" value={formLeftPoolDate} onChange={e => setFormLeftPoolDate(e.target.value)} />
                  </span>
                </SheetField>
              )}
            </SheetSection>

            {/* Общий инвестиционный пул — только на BUSINESS_PRO и только при создании */}
            {showPools && !editingId && (
              <SheetSection title="Счёт инвестора"
                            hint={poolMode !== 'OWN' ? 'Остаток прибыли после долей участников каждый раз достаётся вам как менеджеру.' : 'У инвестора будет свой отдельный счёт.'}>
                <div className="px-4 py-3">
                  <SheetSegmented value={poolMode} onChange={setPoolMode}
                                  options={[{ id: 'OWN', label: 'Отдельный' }, { id: 'EXISTING', label: 'В пул' }, { id: 'NEW', label: 'Новый пул' }]} />
                </div>
                {poolMode === 'EXISTING' && (
                  <SheetField label="Пул"
                              hint={selectedPoolAccountId ? `Уже вложено другими: ${selectedPoolTotalCapital.toLocaleString('ru-RU')} ₽. Процент инвестора применяется к части прибыли на его вложение.` : undefined}>
                    <select className={`${sheetInputClass} h-7 appearance-none`} value={selectedPoolAccountId}
                            onChange={e => setSelectedPoolAccountId(e.target.value)} required>
                      <option value="">Выберите пул…</option>
                      {poolAccounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name}</option>)}
                    </select>
                  </SheetField>
                )}
                {poolMode === 'NEW' && (
                  <SheetField label="Название пула">
                    <input className={sheetInputClass} value={newPoolName} onChange={e => setNewPoolName(e.target.value)}
                           autoComplete="off" autoCorrect="off" spellCheck={false} placeholder="Общий пул инвесторов" required />
                  </SheetField>
                )}
              </SheetSection>
            )}

            <SheetSection title="Вход в приложение"
                          hint={editingId
                            ? 'Новый пароль — только если хотите сменить. Пусто — останется прежний.'
                            : 'Необязательно. Без email и пароля инвестор учитывается только в распределении прибыли — доступ можно дать позже.'}>
              <SheetField label="Email — это логин">
                <input className={sheetInputClass} value={formEmail} onChange={e => setFormEmail(e.target.value)}
                       type="email" inputMode="email" autoComplete="off" autoCapitalize="off" spellCheck={false}
                       placeholder="investor@example.com" />
              </SheetField>
              <SheetField label={editingId ? 'Новый пароль' : 'Пароль'}>
                <input className={`${sheetInputClass} ${formPassword ? 'font-mono' : ''}`} value={formPassword} onChange={e => setFormPassword(e.target.value)}
                       type="text" autoComplete="off" autoCapitalize="off" spellCheck={false}
                       placeholder={editingId ? 'Не менять' : 'Нужен, если указан email'} />
              </SheetField>
            </SheetSection>

            <SheetSection title="Что видит в приложении" hint="Только свои договоры и операции — чужие данные инвестору недоступны.">
              <SheetToggle tone="indigo" label="Договоры" description="Страница «Договоры»"
                           checked={!!formPermissions.canViewContracts}
                           onChange={v => setFormPermissions({ ...formPermissions, canViewContracts: v })} />
              <SheetToggle tone="indigo" label="История операций" description="Страница «История операций»"
                           checked={!!formPermissions.canViewHistory}
                           onChange={v => setFormPermissions({ ...formPermissions, canViewHistory: v })} />
            </SheetSection>
          </div>
        </GlassSheet>
      )}

      <div className="grid gap-4">
        {investors.length === 0 && (
            <div className="text-center py-8 text-slate-400">Нет инвесторов</div>
        )}
        {investors.length > 0 && search && investors.filter(inv => {
            const q = search.toLowerCase();
            return inv.name.toLowerCase().includes(q) || (inv.email || '').toLowerCase().includes(q) || (inv.phone || '').toLowerCase().includes(q);
        }).length === 0 && (
            <div className="text-center py-8 text-slate-400">Ничего не найдено по «{search}»</div>
        )}
        {/* Тариф понизили — часть инвесторов оказалась сверх лимита. Объясняем, что
            данные целы, и что нужно сделать, чтобы снова с ними работать. */}
        {lockedInvestorIds.length > 0 && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/40 rounded-xl p-4 flex gap-3 items-start">
                <span className="text-amber-500 shrink-0 text-lg">🔒</span>
                <div>
                    <p className="text-sm font-bold text-amber-900 dark:text-amber-200">
                        {lockedInvestorIds.length === 1
                            ? '1 инвестор заблокирован'
                            : `Заблокировано инвесторов: ${lockedInvestorIds.length}`}
                    </p>
                    <p className="text-xs text-amber-800 dark:text-amber-300 mt-1 leading-snug">
                        Они сверх лимита вашего тарифа. Все данные и расчёты сохранены —
                        операции с ними станут доступны сразу после повышения тарифа.
                    </p>
                </div>
            </div>
        )}

        {investors.filter(inv => {
            if (!search) return true;
            const q = search.toLowerCase();
            return inv.name.toLowerCase().includes(q) || (inv.email || '').toLowerCase().includes(q) || (inv.phone || '').toLowerCase().includes(q);
        }).map(inv => {
            const acc = getInvestorAccount(inv.id, accounts);
            const isPoolMember = acc?.type === 'POOL';
            // Сверх лимита тарифа: данные сохранены, но работать с инвестором нельзя
            const isLocked = lockedInvestorIds.includes(inv.id);
            return (
            <div key={inv.id}
                onClick={() => { if (!isLocked) onViewDetails?.(inv); }}
                className={`bg-white dark:bg-slate-800 p-4 rounded-xl border shadow-sm transition-all ${
                    isLocked
                        ? 'border-amber-200 dark:border-amber-900/50 opacity-70 cursor-not-allowed'
                        : 'border-slate-200 dark:border-slate-700 cursor-pointer hover:border-indigo-300 dark:hover:border-indigo-600 hover:shadow-md active:scale-[0.99]'
                } ${savedId === inv.id ? 'animate-row-saved' : ''}`}>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 rounded-full flex items-center justify-center font-bold text-lg shrink-0">
                            {inv.name.charAt(0)}
                        </div>
                        <div className="min-w-0">
                            <h3 className="font-bold text-slate-800 dark:text-white truncate">{inv.name}</h3>
                            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{inv.email}</p>
                            <div className="flex flex-wrap gap-1 mt-1">
                                {isLocked && (
                                    <span className="text-[10px] font-bold text-amber-800 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 rounded-full">
                                        🔒 Сверх лимита тарифа
                                    </span>
                                )}
                                {isPoolMember && (
                                    <span className="text-[10px] font-bold text-fuchsia-600 dark:text-fuchsia-400 bg-fuchsia-50 dark:bg-fuchsia-900/30 px-2 py-0.5 rounded-full">Пул: {acc!.name}</span>
                                )}
                                {isPoolMember && inv.leftPoolDate && (
                                    new Date(inv.leftPoolDate) <= new Date()
                                        ? <span className="text-[10px] font-bold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 rounded-full">Вышел: {formatDate(inv.leftPoolDate)}</span>
                                        : <span className="text-[10px] font-bold text-sky-700 dark:text-sky-400 bg-sky-50 dark:bg-sky-900/20 px-2 py-0.5 rounded-full">Выйдет: {formatDate(inv.leftPoolDate)}</span>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                        <div className="text-right">
                            <p className="text-xs text-slate-400">Процент</p>
                            <p className="text-sm font-bold text-indigo-600 dark:text-indigo-400">{inv.profitPercentage}%</p>
                        </div>
                        <svg className="text-slate-300 dark:text-slate-600 shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
                    </div>
                </div>
            </div>
            );
        })}
      </div>

      {/* Инвестор заведён — что именно записалось */}
      {createdInvestor && (
        <div className="fixed inset-0 z-modal flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white dark:bg-slate-800 w-full max-w-sm rounded-2xl shadow-2xl p-6 text-center space-y-5 animate-dialog-in">
            <SuccessCheck />
            <div className="animate-stage-in" style={{ animationDelay: '0.55s' }}>
              <h3 className="text-xl font-bold text-slate-800 dark:text-white">Инвестор добавлен</h3>
              <p className="text-slate-600 dark:text-slate-300 font-semibold mt-1 break-words">{createdInvestor.name}</p>
              <div className="flex justify-center gap-6 mt-4">
                <div>
                  <p className="text-xs text-slate-400">Вложено</p>
                  <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                    {createdInvestor.amount.toLocaleString('ru-RU')} ₽
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Процент</p>
                  <p className="text-lg font-bold text-indigo-600 dark:text-indigo-400">{createdInvestor.percent}%</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Удаление инвестора: раньше это был системный confirm без единой детали о том,
          кого удаляют и что при этом теряется. */}
      {deletingInvestor && (
        <div className="fixed inset-0 z-modal flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in"
             onClick={() => setDeletingInvestor(null)}>
          <div className="bg-white dark:bg-slate-800 w-full max-w-sm p-6 rounded-3xl shadow-2xl animate-dialog-in"
               onClick={e => e.stopPropagation()}>
            <div className="w-14 h-14 bg-rose-500 text-white rounded-2xl flex items-center justify-center mx-auto mb-4 scale-150">
              {ICONS.Delete}
            </div>
            <h3 className="text-lg font-bold text-slate-800 dark:text-white text-center mb-1.5">
              Удалить инвестора?
            </h3>
            <p className="text-center text-slate-600 dark:text-slate-300 font-semibold break-words mb-3">
              {deletingInvestor.name}
            </p>

            <div className="bg-slate-50 dark:bg-slate-900/50 rounded-xl p-3 space-y-1.5 text-sm mb-4 border border-slate-100 dark:border-slate-700">
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Вложено:</span>
                <span className="font-bold text-slate-800 dark:text-white">
                  {(deletingInvestor.initialAmount || 0).toLocaleString('ru-RU')} ₽
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Доля в прибыли:</span>
                <span className="font-bold text-slate-800 dark:text-white">{deletingInvestor.profitPercentage}%</span>
              </div>
            </div>

            <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-900/50 rounded-lg p-3 flex gap-2 items-start mb-5">
              <span className="text-amber-500 shrink-0 mt-0.5">⚠️</span>
              <p className="text-xs text-amber-800 dark:text-amber-300">
                История вложений и начисленной прибыли будет потеряна. Если инвестор просто выходит
                из пула — вместо удаления проставьте ему дату выхода.
              </p>
            </div>

            <div className="flex gap-2.5">
              <button onClick={() => setDeletingInvestor(null)}
                      className="btn-press flex-1 py-2.5 bg-slate-100 dark:bg-slate-700 rounded-xl font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600">
                Отмена
              </button>
              <button onClick={confirmDeleteInvestor}
                      className="btn-press flex-1 py-2.5 bg-rose-500 text-white rounded-xl font-bold hover:bg-rose-600">
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Investors;
