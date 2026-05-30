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
  // 🔹 Обновляем тип: добавляем паспортные данные (все необязательные)
  onAddNew: (customerData: {
    name: string;
    phone: string;
    address?: string;
    passportSeries?: string;
    passportNumber?: string;
    passportIssuedBy?: string;
  }) => void;
}

const SelectionList: React.FC<SelectionListProps> = ({ title, items, onSelect, onCancel, onAddNew }) => {
  const [search, setSearch] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  // New Customer Form State
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newAddress, setNewAddress] = useState('');

  // 🔹 НОВЫЕ: паспортные данные
  const [newPassportSeries, setNewPassportSeries] = useState('');
  const [newPassportNumber, setNewPassportNumber] = useState('');
  const [newPassportIssuedBy, setNewPassportIssuedBy] = useState('');

  const filteredItems = items.filter(item =>
    item.title.toLowerCase().includes(search.toLowerCase()) ||
    (item.subtitle && item.subtitle.toLowerCase().includes(search.toLowerCase()))
  );

  const handleCreateSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      if (newName && newPhone) {
          onAddNew({
              name: newName.trim(),
              phone: newPhone.trim(),
              address: newAddress.trim() || undefined,
              // 🔹 Передаём паспортные данные
              passportSeries: newPassportSeries.trim() || undefined,
              passportNumber: newPassportNumber.trim() || undefined,
              passportIssuedBy: newPassportIssuedBy.trim() || undefined,
          });
          setIsCreating(false);
          // 🔹 Сбрасываем ВСЕ поля
          setNewName('');
          setNewPhone('');
          setNewAddress('');
          setNewPassportSeries('');
          setNewPassportNumber('');
          setNewPassportIssuedBy('');
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

                  {/* 🔹 ОБЪЕДИНЕННЫЙ БЛОК: Адрес + Паспорт */}
                  <details className="group" open>
                    <summary className="flex items-center gap-2 text-sm font-medium cursor-pointer list-none text-indigo-600">
                      <span className="transition-transform group-open:rotate-90">▶</span>
                      📍 Адрес и документы
                    </summary>

                    <div className="mt-3 space-y-4 p-4 bg-slate-50 rounded-xl">
                      {/* Адрес */}
                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Адрес</label>
                        <textarea
                          className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:border-indigo-500 resize-none"
                          placeholder="Город, Село, Улица..."
                          rows={2}
                          value={newAddress}
                          onChange={e => setNewAddress(e.target.value)}
                        />
                      </div>

                      {/* Разделитель */}
                      <div className="border-t border-slate-200 pt-3">
                        <p className="text-xs font-medium text-slate-500 mb-3">
                          🪪 Паспортные данные <span className="font-normal text-slate-400">(необязательно)</span>
                        </p>

                        {/* Серия и Номер */}
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs text-slate-500 mb-1">Серия</label>
                            <input
                              type="text"
                              placeholder="4501"
                              className="w-full p-2.5 border border-slate-200 rounded-lg outline-none text-sm font-mono uppercase"
                              value={newPassportSeries}
                              onChange={e => setNewPassportSeries(e.target.value.replace(/[^0-9A-ZА-Я]/gi, '').toUpperCase().slice(0, 4))}
                              maxLength={4}
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-slate-500 mb-1">Номер</label>
                            <input
                              type="text"
                              placeholder="123456"
                              className="w-full p-2.5 border border-slate-200 rounded-lg outline-none text-sm font-mono"
                              value={newPassportNumber}
                              onChange={e => setNewPassportNumber(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                              maxLength={6}
                            />
                          </div>
                        </div>

                        {/* Кем выдан */}
                        <div className="mt-3">
                          <label className="block text-xs text-slate-500 mb-1">Кем выдан</label>
                          <input
                            type="text"
                            placeholder="УФМС России по г. Москве"
                            className="w-full p-2.5 border border-slate-200 rounded-lg outline-none text-sm"
                            value={newPassportIssuedBy}
                            onChange={e => setNewPassportIssuedBy(e.target.value)}
                            maxLength={100}
                          />
                        </div>
                      </div>

                      {/* Подсказка */}
                      <p className="text-[10px] text-slate-400 flex items-start gap-1">
                        <span>🔒</span>
                        Данные хранятся локально
                      </p>
                    </div>
                  </details>

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