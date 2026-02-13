
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
      setEditingId(null);
      setIsAdding(false);
  };

  const handleStartEdit = (emp: User) => {
      setName(emp.name);
      setEmail(emp.email);
      setPassword(''); // Keep empty unless changing
      setPermissions(emp.permissions || { canCreate: false, canEdit: false, canDelete: false });
      setAllowedInvestorIds(emp.allowedInvestorIds || []);
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

      const employeeData = {
          name,
          email,
          permissions,
          allowedInvestorIds
      };

      if (editingId) {
          // Update
          const original = employees.find(e => e.id === editingId);
          if (original) {
              const updated = {
                  ...original,
                  ...employeeData,
                  // Only update password if provided
                  password: password ? password : original.password 
              };
              onUpdateEmployee(updated);
          }
      } else {
          // Create
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
          <h2 className="text-2xl font-bold text-slate-800">Сотрудники</h2>
          <p className="text-slate-500 text-sm">Управление доступом</p>
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
          <form onSubmit={handleSubmit} className="bg-white p-5 rounded-2xl shadow-md border border-slate-100 space-y-5 animate-fade-in">
              <h3 className="font-bold text-slate-800 border-b border-slate-100 pb-2">
                  {editingId ? 'Редактирование сотрудника' : 'Новый сотрудник'}
              </h3>

              <div className="space-y-3">
                  <input 
                    placeholder="Имя Фамилия"
                    className="w-full p-3 border border-slate-200 rounded-xl outline-none"
                    value={name}
                    onChange={e => setName(e.target.value)}
                  />
                  <div className="grid grid-cols-2 gap-3">
                      <input 
                        placeholder="Email (Логин)"
                        type="email"
                        className="w-full p-3 border border-slate-200 rounded-xl outline-none"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                      />
                      <input 
                        placeholder={editingId ? "Новый пароль (необяз.)" : "Пароль"}
                        type="text"
                        className="w-full p-3 border border-slate-200 rounded-xl outline-none"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                      />
                  </div>
              </div>

              {/* Permissions */}
              <div className="bg-slate-50 p-4 rounded-xl space-y-3">
                  <h4 className="text-sm font-bold text-slate-600">Права доступа (CRUD)</h4>
                  <div className="flex gap-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                          <input 
                            type="checkbox" 
                            className="w-5 h-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                            checked={permissions.canCreate}
                            onChange={e => setPermissions({...permissions, canCreate: e.target.checked})}
                          />
                          <span className="text-sm text-slate-700">Создание</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                          <input 
                            type="checkbox" 
                            className="w-5 h-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                            checked={permissions.canEdit}
                            onChange={e => setPermissions({...permissions, canEdit: e.target.checked})}
                          />
                          <span className="text-sm text-slate-700">Редактирование</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                          <input 
                            type="checkbox" 
                            className="w-5 h-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                            checked={permissions.canDelete}
                            onChange={e => setPermissions({...permissions, canDelete: e.target.checked})}
                          />
                          <span className="text-sm text-slate-700">Удаление</span>
                      </label>
                  </div>
              </div>

              {/* Investor Access */}
              <div className="bg-slate-50 p-4 rounded-xl space-y-3">
                  <h4 className="text-sm font-bold text-slate-600">Доступ к инвесторам</h4>
                  <p className="text-xs text-slate-500 mb-2">Отметьте инвесторов, данные которых будет видеть этот сотрудник.</p>
                  
                  <div className="max-h-40 overflow-y-auto space-y-2 border border-slate-200 rounded-lg p-2 bg-white">
                      {investors.length === 0 && <p className="text-xs text-slate-400 p-2">Нет инвесторов</p>}
                      {investors.map(inv => (
                          <label key={inv.id} className="flex items-center gap-3 p-2 hover:bg-slate-50 rounded-lg cursor-pointer">
                              <input 
                                type="checkbox"
                                className="w-5 h-5 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                                checked={allowedInvestorIds.includes(inv.id)}
                                onChange={() => handleInvestorToggle(inv.id)}
                              />
                              <div className="text-sm">
                                  <span className="font-semibold text-slate-800 block">{inv.name}</span>
                                  <span className="text-slate-500 text-xs">{inv.email}</span>
                              </div>
                          </label>
                      ))}
                  </div>
              </div>

              <div className="flex gap-3">
                  <button type="button" onClick={resetForm} className="flex-1 py-3 bg-slate-100 rounded-xl font-bold text-slate-600">Отмена</button>
                  <button type="submit" className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold">
                      {editingId ? 'Сохранить изменения' : 'Создать сотрудника'}
                  </button>
              </div>
          </form>
      )}

      {/* Employee List */}
      <div className="grid gap-4">
          {employees.length === 0 && !isAdding && (
              <div className="text-center py-10 text-slate-400">Нет сотрудников</div>
          )}
          {employees.map(emp => (
              <div key={emp.id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
                  <div className="flex items-center gap-3">
                      <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold text-lg">
                          {emp.name.charAt(0)}
                      </div>
                      <div>
                          <h3 className="font-bold text-slate-800">{emp.name}</h3>
                          <p className="text-xs text-slate-500">{emp.email}</p>
                          <div className="flex gap-2 mt-1">
                              {emp.permissions?.canCreate && <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded">Create</span>}
                              {emp.permissions?.canEdit && <span className="text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">Edit</span>}
                              {emp.permissions?.canDelete && <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded">Delete</span>}
                          </div>
                      </div>
                  </div>
                  
                  <div className="text-right flex flex-col items-end gap-2">
                      <span className="text-xs bg-purple-50 text-purple-600 px-2 py-1 rounded-full font-medium">
                          Инвесторов: {emp.allowedInvestorIds?.length || 0}
                      </span>
                      <div className="flex gap-2">
                          <button onClick={() => handleStartEdit(emp)} className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-slate-50 rounded">
                              {ICONS.Edit}
                          </button>
                          <button onClick={() => handleDelete(emp.id)} className="p-2 text-slate-400 hover:text-red-600 hover:bg-slate-50 rounded">
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
