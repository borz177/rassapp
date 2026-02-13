import React, { useState } from 'react';
import { Investor, InvestorPermissions } from '../types';
import { ICONS } from '../constants';

interface InvestorsProps {
  investors: Investor[];
  onAddInvestor: (name: string, phone: string, email: string, password: string, amount: number, profitPercentage: number, permissions: InvestorPermissions) => void;
  onUpdateInvestor?: (investor: Investor) => void;
  onDeleteInvestor?: (id: string) => void;
  onViewDetails?: (investor: Investor) => void;
}

const Investors: React.FC<InvestorsProps> = ({ 
    investors, onAddInvestor, onUpdateInvestor, onDeleteInvestor, onViewDetails 
}) => {
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

  const resetForm = () => {
      setFormName('');
      setFormPhone('');
      setFormEmail('');
      setFormPassword('');
      setFormAmount('');
      setFormProfitPercentage('');
      setFormPermissions({ canViewContracts: false, canViewHistory: false });
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
      setEditingId(inv.id);
      setIsAdding(true);
      setActiveMenuId(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if(formName.trim() && formEmail.trim()) {
        if (editingId && onUpdateInvestor) {
            const inv = investors.find(i => i.id === editingId);
            if (inv) {
                onUpdateInvestor({
                    ...inv,
                    name: formName,
                    phone: formPhone,
                    email: formEmail,
                    initialAmount: Number(formAmount),
                    profitPercentage: Number(formProfitPercentage),
                    permissions: formPermissions
                });
            }
        } else {
            if (!formPassword) {
                alert("Пароль обязателен для нового инвестора");
                return;
            }
            onAddInvestor(formName, formPhone, formEmail, formPassword, Number(formAmount), Number(formProfitPercentage), formPermissions);
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
            <h2 className="text-2xl font-bold text-slate-800">Инвесторы</h2>
            <p className="text-slate-500 text-sm">Партнеры и их счета</p>
        </div>
        {!isAdding && (
            <button 
                onClick={(e) => { e.stopPropagation(); setIsAdding(true); }} 
                className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-sm font-medium shadow-lg shadow-indigo-200"
            >
                {ICONS.AddSmall} Добавить
            </button>
        )}
      </header>

      {isAdding && (
          <form onSubmit={handleSubmit} onClick={e => e.stopPropagation()} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4 animate-fade-in">
              <h3 className="font-bold text-slate-800 border-b border-slate-100 pb-2">
                  {editingId ? 'Редактировать инвестора' : 'Новый инвестор'}
              </h3>
              
              <div className="space-y-3">
                  <input 
                    placeholder="Имя Фамилия" 
                    className="w-full p-3 border border-slate-200 rounded-xl outline-none"
                    value={formName}
                    onChange={e => setFormName(e.target.value)}
                    required
                  />
                  <input 
                    placeholder="Телефон" 
                    className="w-full p-3 border border-slate-200 rounded-xl outline-none"
                    value={formPhone}
                    onChange={e => setFormPhone(e.target.value)}
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <input 
                        type="email"
                        placeholder="Email (Логин)" 
                        className="w-full p-3 border border-slate-200 rounded-xl outline-none"
                        value={formEmail}
                        onChange={e => setFormEmail(e.target.value)}
                        required
                    />
                    {!editingId && (
                        <input 
                            type="text" // Visible for creation
                            placeholder="Пароль" 
                            className="w-full p-3 border border-slate-200 rounded-xl outline-none"
                            value={formPassword}
                            onChange={e => setFormPassword(e.target.value)}
                            required={!editingId}
                        />
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="relative">
                       <span className="absolute left-3 top-3.5 text-slate-400">₽</span>
                       <input 
                          type="number"
                          placeholder="Сумма инвестиций" 
                          className="w-full p-3 pl-8 border border-slate-200 rounded-xl outline-none font-bold"
                          value={formAmount}
                          onChange={e => setFormAmount(e.target.value)}
                          required
                      />
                    </div>
                     <div className="relative">
                       <span className="absolute right-4 top-3.5 text-slate-400">%</span>
                       <input 
                          type="number"
                          placeholder="Процент прибыли" 
                          className="w-full p-3 pr-8 border border-slate-200 rounded-xl outline-none font-bold"
                          value={formProfitPercentage}
                          onChange={e => setFormProfitPercentage(e.target.value)}
                          required
                      />
                    </div>
                  </div>

                  {/* Permissions */}
                  <div className="bg-slate-50 p-4 rounded-xl space-y-3">
                      <h4 className="text-sm font-bold text-slate-600">Права доступа</h4>
                      <div className="space-y-2">
                          <label className="flex items-center gap-3 cursor-pointer p-2 bg-white border border-slate-200 rounded-lg hover:border-indigo-400 transition-colors">
                              <input 
                                type="checkbox" 
                                className="w-5 h-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                checked={formPermissions.canViewContracts}
                                onChange={e => setFormPermissions({...formPermissions, canViewContracts: e.target.checked})}
                              />
                              <div className="text-sm">
                                  <span className="font-semibold text-slate-800 block">Просмотр договоров</span>
                                  <span className="text-xs text-slate-500">Доступ к странице "Договоры" (только свои)</span>
                              </div>
                          </label>
                          <label className="flex items-center gap-3 cursor-pointer p-2 bg-white border border-slate-200 rounded-lg hover:border-indigo-400 transition-colors">
                              <input 
                                type="checkbox" 
                                className="w-5 h-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                checked={formPermissions.canViewHistory}
                                onChange={e => setFormPermissions({...formPermissions, canViewHistory: e.target.checked})}
                              />
                              <div className="text-sm">
                                  <span className="font-semibold text-slate-800 block">Просмотр истории</span>
                                  <span className="text-xs text-slate-500">Доступ к странице "История операций" (только свои)</span>
                              </div>
                          </label>
                      </div>
                  </div>
              </div>

              <div className="flex gap-2 pt-2">
                  <button type="button" onClick={resetForm} className="flex-1 py-3 bg-slate-100 rounded-xl font-medium text-slate-600">Отмена</button>
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
        {investors.map(inv => (
            <div key={inv.id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm relative">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center font-bold text-lg">
                            {inv.name.charAt(0)}
                        </div>
                        <div>
                            <h3 className="font-bold text-slate-800">{inv.name}</h3>
                            <p className="text-xs text-slate-500">{inv.email}</p>
                        </div>
                    </div>
                    
                    <div className="flex items-center gap-3">
                        <div className="text-right mr-2 hidden sm:block">
                            <p className="text-xs text-slate-400">Процент</p>
                            <p className="text-sm font-bold text-indigo-600">{inv.profitPercentage}%</p>
                        </div>
                        <button 
                            onClick={(e) => {
                                e.stopPropagation();
                                setActiveMenuId(activeMenuId === inv.id ? null : inv.id);
                            }}
                            className="p-2 text-slate-400 hover:bg-slate-50 rounded-lg transition-colors"
                        >
                            {ICONS.More}
                        </button>
                    </div>
                </div>

                {/* Dropdown Menu */}
                {activeMenuId === inv.id && (
                    <div className="absolute right-4 top-14 bg-white shadow-xl border border-slate-100 rounded-xl z-20 w-40 overflow-hidden animate-fade-in">
                        <button 
                            onClick={(e) => { e.stopPropagation(); onViewDetails?.(inv); }}
                            className="w-full text-left px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                        >
                            <span className="text-indigo-500">{ICONS.File}</span> Инфо
                        </button>
                        <button 
                            onClick={(e) => { e.stopPropagation(); handleStartEdit(inv); }}
                            className="w-full text-left px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
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
        ))}
      </div>
    </div>
  );
};

export default Investors;