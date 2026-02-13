import React, { useState } from 'react';
import { Customer } from '../types';
import { ICONS } from '../constants';

interface CustomersProps {
  customers: Customer[];
  onAddCustomer: (name: string, phone: string, photo: string) => void;
  onSelectCustomer: (id: string) => void;
}

const Customers: React.FC<CustomersProps> = ({ customers, onAddCustomer, onSelectCustomer }) => {
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newPhoto, setNewPhoto] = useState('');

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setNewPhoto(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newName && newPhone) {
      onAddCustomer(newName, newPhone, newPhoto);
      setNewName('');
      setNewPhone('');
      setNewPhoto('');
      setIsAdding(false);
    }
  };

  return (
    <div className="space-y-6 pb-20 animate-fade-in">
      <header className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Клиенты</h2>
          <p className="text-slate-500 text-sm">{customers.length} человек</p>
        </div>
        <button 
          onClick={() => setIsAdding(!isAdding)}
          className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-sm font-medium shadow-lg shadow-indigo-200"
        >
          {isAdding ? 'Отмена' : '+ Добавить'}
        </button>
      </header>

      {isAdding && (
        <form onSubmit={handleSubmit} className="bg-white p-5 rounded-2xl shadow-md border border-slate-100 space-y-4 animate-fade-in">
          <div className="flex items-center gap-4">
            <label className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center cursor-pointer border-2 border-dashed border-slate-300 hover:border-indigo-400 overflow-hidden">
                {newPhoto ? (
                    <img src={newPhoto} alt="Preview" className="w-full h-full object-cover" />
                ) : (
                    <span className="text-slate-400 text-xs text-center">Фото</span>
                )}
                <input type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
            </label>
            <div className="flex-1 space-y-2">
                <input 
                    placeholder="ФИО Клиента"
                    className="w-full p-3 border border-slate-200 rounded-xl outline-none"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    required
                />
            </div>
          </div>
          <input 
            placeholder="Номер телефона"
            className="w-full p-3 border border-slate-200 rounded-xl outline-none"
            value={newPhone}
            onChange={e => setNewPhone(e.target.value)}
            required
          />
          <button type="submit" className="w-full bg-indigo-600 text-white py-3 rounded-xl font-bold">
            Сохранить клиента
          </button>
        </form>
      )}

      <div className="grid gap-3">
        {customers.map(c => (
          <div 
            key={c.id} 
            onClick={() => onSelectCustomer(c.id)}
            className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm flex items-center gap-4 cursor-pointer hover:bg-slate-50 transition-colors"
          >
            <div className="w-12 h-12 rounded-full bg-slate-200 flex-shrink-0 overflow-hidden">
                {c.photo ? (
                    <img src={c.photo} alt={c.name} className="w-full h-full object-cover" />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-500 font-bold text-lg">
                        {c.name.charAt(0)}
                    </div>
                )}
            </div>
            <div>
              <h3 className="font-bold text-slate-800">{c.name}</h3>
              <p className="text-slate-500 text-sm">{c.phone}</p>
            </div>
            <div className="ml-auto text-slate-300">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Customers;
