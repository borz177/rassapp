
import React, { useState } from 'react';
import { User, Investor } from '../types';
import { ICONS } from '../constants';

interface EmployeesProps {
  employees: User[];
  investors: Investor[];
  onAddEmployee: (data: any) => void;
  onUpdateEmployee: (data: User) => void;
  onDeleteEmployee: (id: string) => void;
}

const Employees: React.FC<EmployeesProps> = ({ 
    employees, investors, onAddEmployee, onUpdateEmployee, onDeleteEmployee 
}) => {
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form State
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

const [allowMainAccount, setAllowMainAccount] = useState(false);

  const [permissions, setPermissions] = useState({
      canCreate: true,
      canEdit: false,
      canDelete: false
  });
  const [allowedInvestorIds, setAllowedInvestorIds] = useState<string[]>([]);

  const resetForm = () => {
    setName('');
    setEmail('');
    setPassword('');
    setPermissions({ canCreate: true, canEdit: false, canDelete: false });
    setAllowedInvestorIds([]);
    setAllowMainAccount(false); // <-- СБРОС
    setEditingId(null);
    setIsAdding(false);
};

  const handleStartEdit = (emp: User) => {
    setName(emp.name);
    setEmail(emp.email);
    setPassword(''); 
    setPermissions(emp.permissions || { canCreate: false, canEdit: false, canDelete: false });
    
    const ids = emp.allowedInvestorIds || [];
    setAllowedInvestorIds(ids.filter((id: string) => id !== 'MAIN_ACCOUNT'));
    setAllowMainAccount(ids.includes('MAIN_ACCOUNT')); // <-- ЧТЕНИЕ
    
    setEditingId(emp.id);
    setIsAdding(true);
};

  const handleInvestorToggle = (id: string) => {
      setAllowedInvestorIds(prev => 
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

    const employeeData = {
        name,
        email,
        permissions,
        allowedInvestorIds: finalAllowedIds // <-- ИСПОЛЬЗУЕМ ИТОГОВЫЙ МАССИВ
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
              className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-sm font-medium shadow-lg shadow-indigo-200"
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

              {/* Permissions */}
              <div className="bg-slate-50 dark:bg-slate-700/50 p-4 rounded-xl space-y-3">
                  <h4 className="text-sm font-bold text-slate-600 dark:text-slate-300">Права доступа (CRUD)</h4>
                  <div className="flex gap-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            className="w-5 h-5 rounded border-slate-300 dark:border-slate-600 text-indigo-600 focus:ring-indigo-500"
                            checked={permissions.canCreate}
                            onChange={e => setPermissions({...permissions, canCreate: e.target.checked})}
                          />
                          <span className="text-sm text-slate-700 dark:text-slate-300">Создание</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            className="w-5 h-5 rounded border-slate-300 dark:border-slate-600 text-indigo-600 focus:ring-indigo-500"
                            checked={permissions.canEdit}
                            onChange={e => setPermissions({...permissions, canEdit: e.target.checked})}
                          />
                          <span className="text-sm text-slate-700 dark:text-slate-300">Редактирование</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            className="w-5 h-5 rounded border-slate-300 dark:border-slate-600 text-indigo-600 focus:ring-indigo-500"
                            checked={permissions.canDelete}
                            onChange={e => setPermissions({...permissions, canDelete: e.target.checked})}
                          />
                          <span className="text-sm text-slate-700 dark:text-slate-300">Удаление</span>
                      </label>
                  </div>
              </div>

              {/* Investor Access */}
              {/* Доступ к счетам */}
<div className="bg-slate-50 dark:bg-slate-700/50 p-4 rounded-xl space-y-3">
    <h4 className="text-sm font-bold text-slate-600 dark:text-slate-300">Доступ к счетам</h4>

    {/* ГАЛОЧКА ДЛЯ ОСНОВНОГО СЧЕТА */}
    <label className="flex items-center gap-3 p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
        <input
            type="checkbox"
            className="w-5 h-5 rounded border-slate-300 dark:border-slate-600 text-indigo-600 focus:ring-indigo-500"
            checked={allowMainAccount}
            onChange={e => setAllowMainAccount(e.target.checked)}
        />
        <div className="text-sm">
            <span className="font-semibold text-slate-800 dark:text-white block">Основной счет компании</span>
            <span className="text-slate-500 dark:text-slate-400 text-xs">Сотрудник сможет видеть и создавать операции на главном счете, даже если нет инвесторов.</span>
        </div>
    </label>

    <p className="text-xs text-slate-500 dark:text-slate-400 mt-4 mb-2">Или выберите конкретных инвесторов:</p>
    <div className="max-h-40 overflow-y-auto space-y-2 border border-slate-200 dark:border-slate-600 rounded-lg p-2 bg-white dark:bg-slate-800">
        {investors.length === 0 && <p className="text-xs text-slate-400 dark:text-slate-500 p-2">Нет инвесторов</p>}
        {investors.map(inv => (
            <label key={inv.id} className="flex items-center gap-3 p-2 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg cursor-pointer">
                <input
                    type="checkbox"
                    className="w-5 h-5 rounded border-slate-300 dark:border-slate-600 text-purple-600 focus:ring-purple-500"
                    checked={allowedInvestorIds.includes(inv.id)}
                    onChange={() => {
                        setAllowedInvestorIds(prev =>
                            prev.includes(inv.id) ? prev.filter(pid => pid !== inv.id) : [...prev, inv.id]
                        );
                    }}
                />
                <div className="text-sm">
                    <span className="font-semibold text-slate-800 dark:text-white block">{inv.name}</span>
                    <span className="text-slate-500 dark:text-slate-400 text-xs">{inv.email}</span>
                </div>
            </label>
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
              <div key={emp.id} className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex items-center justify-between">
                  <div className="flex items-center gap-3">
                      <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full flex items-center justify-center font-bold text-lg">
                          {emp.name.charAt(0)}
                      </div>
                      <div>
                          <h3 className="font-bold text-slate-800 dark:text-white">{emp.name}</h3>
                          <p className="text-xs text-slate-500 dark:text-slate-400">{emp.email}</p>

                      </div>
                  </div>

                  <div className="text-right flex flex-col items-end gap-2">
                      <span className="text-xs bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 px-2 py-1 rounded-full font-medium">
                          Инвесторов: {emp.allowedInvestorIds?.length || 0}
                      </span>
                      <div className="flex gap-2">
                          <button onClick={() => handleStartEdit(emp)} className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-slate-50 dark:hover:bg-slate-700 rounded">
                              {ICONS.Edit}
                          </button>
                          <button onClick={() => handleDelete(emp.id)} className="p-2 text-slate-400 hover:text-red-600 hover:bg-slate-50 dark:hover:bg-slate-700 rounded">
                              {ICONS.Delete}
                          </button>
                      </div>
                  </div>
              </div>
          ))}
      </div>
    </div>
  );
};

export default Employees;
