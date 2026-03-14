import React, { useState } from 'react';
import { ICONS } from '../constants';

interface SelectionItem {
  id: string;
  title: string;
  subtitle?: string;
}

interface SelectionListProps {
  title: string;
  items: SelectionItem[];
  onSelect: (id: string) => void;
  onCancel: () => void;
  onAddNew: (customerData: { name: string, phone: string, address: string }) => void;
}

const SelectionList: React.FC<SelectionListProps> = ({ title, items, onSelect, onCancel, onAddNew }) => {
  const [search, setSearch] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  // New Customer Form State
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newAddress, setNewAddress] = useState('');

  const filteredItems = items.filter(item =>
    item.title.toLowerCase().includes(search.toLowerCase()) ||
    (item.subtitle && item.subtitle.toLowerCase().includes(search.toLowerCase()))
  );

  const handleCreateSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      if (newName && newPhone) {
          onAddNew({ name: newName, phone: newPhone, address: newAddress });
          setIsCreating(false);
          setNewName('');
          setNewPhone('');
          setNewAddress('');
      }
  };

  return (
    <div className="space-y-4 h-full flex flex-col animate-fade-in">
      <div className="flex items-center gap-3 border-b border-slate-200 pb-4">
        <button onClick={onCancel} className="text-slate-500 hover:text-slate-800">
           <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>
        </button>
        <h2 className="text-xl font-bold text-slate-800">{title}</h2>
      </div>

      {!isCreating ? (
          <>
            <div className="relative">
                <input
                type="text"
                placeholder="Поиск..."
                className="w-full p-3 pl-10 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500"
                value={search}
                onChange={e => setSearch(e.target.value)}
                autoFocus
                />
                <div className="absolute left-3 top-3.5 text-slate-400">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                </div>
            </div>

            <button
                onClick={() => setIsCreating(true)}
                className="w-full py-3 bg-indigo-50 text-indigo-600 rounded-xl font-semibold flex items-center justify-center gap-2 hover:bg-indigo-100"
            >
                {ICONS.AddSmall} Добавить нового клиента
            </button>

            <div className="flex-1 overflow-y-auto space-y-2">
                {filteredItems.map(item => (
                <div
                    key={item.id}
                    onClick={() => onSelect(item.id)}
                    className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm active:bg-slate-50 cursor-pointer flex justify-between items-center"
                >
                    <div>
                    <h3 className="font-bold text-slate-800">{item.title}</h3>
                    {item.subtitle && <p className="text-sm text-slate-500">{item.subtitle}</p>}
                    </div>
                    <div className="text-slate-300">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                    </div>
                </div>
                ))}
                {filteredItems.length === 0 && (
                    <div className="text-center py-10 text-slate-400">Ничего не найдено</div>
                )}
            </div>
          </>
      ) : (
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 animate-fade-in">
              <div className="flex justify-between items-center mb-4">
                  <h3 className="font-bold text-lg text-slate-800">Новый клиент</h3>
                  <button onClick={() => setIsCreating(false)} className="text-sm text-red-500 font-medium">Отмена</button>
              </div>
              <form onSubmit={handleCreateSubmit} className="space-y-4">
                  <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase mb-1">ФИО</label>
                      <input
                          className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:border-indigo-500"
                          placeholder="Иванов Иван Иванович"
                          value={newName}
                          onChange={e => setNewName(e.target.value)}
                          required
                          autoFocus
                      />
                  </div>
                  <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Телефон</label>
                      <input
                          className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:border-indigo-500"
                          placeholder="+7"
                          value={newPhone}
                          onChange={e => setNewPhone(e.target.value)}
                          required
                      />
                  </div>
                  <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Адрес</label>
                      <textarea
                          className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:border-indigo-500 resize-none"
                          placeholder="Город,Село"
                          rows={2}
                          value={newAddress}
                          onChange={e => setNewAddress(e.target.value)}
                      />
                  </div>
                  <button type="submit" className="w-full py-3 bg-indigo-600 text-white font-bold rounded-xl shadow-lg shadow-indigo-200">
                      Сохранить и выбрать
                  </button>
              </form>
          </div>
      )}
    </div>
  );
};

export default SelectionList;