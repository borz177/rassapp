
import React, { useState } from 'react';
import { Customer, Sale, Account, Investor, Payment } from '../types';
import { ICONS } from '../constants';
import CustomerDetails from './CustomerDetails';

interface CustomersProps {
  customers: Customer[];
  accounts: Account[];
  investors: Investor[];
  sales: Sale[];
  onAddCustomer: (name: string, phone: string, photo: string, address: string) => void;
  onSelectCustomer: (id: string) => void; // Kept for compatibility but unused for internal nav
  onInitiatePayment: (sale: Sale, payment: Payment) => void;
  onUndoPayment: (saleId: string, paymentId: string) => void;
  onEditPayment: (saleId: string, paymentId: string, newDate: string) => void;
  onUpdateCustomer: (customer: Customer) => void;
}

const Customers: React.FC<CustomersProps> = ({
  customers,
  accounts,
  investors,
  sales,
  onAddCustomer,
  onSelectCustomer,
  onInitiatePayment,
  onUndoPayment,
  onEditPayment,
  onUpdateCustomer
}) => {
  const [isAdding, setIsAdding] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [newPhoto, setNewPhoto] = useState('');

  // Search State
  const [searchTerm, setSearchTerm] = useState('');

  if (selectedCustomerId) {
    const customer = customers.find(c => c.id === selectedCustomerId);
    if (customer) {
      return (
        <CustomerDetails
          customer={customer}
          sales={sales}
          accounts={accounts}
          investors={investors}
          onBack={() => setSelectedCustomerId(null)}
          onInitiatePayment={onInitiatePayment}
          onUndoPayment={onUndoPayment}
          onEditPayment={onEditPayment}
          onUpdateCustomer={onUpdateCustomer}
        />
      );
    }
  }

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
      onAddCustomer(newName, newPhone, newPhoto, newAddress);
      setNewName('');
      setNewPhone('');
      setNewAddress('');
      setNewPhoto('');
      setIsAdding(false);
    }
  };

  const filteredCustomers = customers.filter(c =>
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.phone.includes(searchTerm)
  );

  return (
    <div className="space-y-4 pb-20 animate-fade-in">
      <header className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Клиенты</h2>
          <p className="text-slate-500 text-sm">{filteredCustomers.length} из {customers.length}</p>
        </div>
        <button
          onClick={() => setIsAdding(!isAdding)}
          className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-sm font-medium shadow-lg shadow-indigo-200"
        >
          {isAdding ? 'Отмена' : '+ Добавить'}
        </button>
      </header>

      {/* Search Bar */}
      {!isAdding && (
          <div className="relative">
              <input
                type="text"
                placeholder="Поиск по имени или телефону..."
                className="w-full pl-10 p-3 bg-white border border-slate-200 rounded-xl outline-none focus:border-indigo-500 text-slate-800"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
              <span className="absolute left-3 top-3.5 text-slate-400 scale-90">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              </span>
          </div>
      )}

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
          <input
            placeholder="Адрес (необязательно)"
            className="w-full p-3 border border-slate-200 rounded-xl outline-none"
            value={newAddress}
            onChange={e => setNewAddress(e.target.value)}
          />
          <button type="submit" className="w-full bg-indigo-600 text-white py-3 rounded-xl font-bold">
            Сохранить клиента
          </button>
        </form>
      )}

      <div className="grid gap-3">
        {filteredCustomers.length === 0 && !isAdding && (
            <div className="text-center py-8 text-slate-400">Клиенты не найдены</div>
        )}
        {filteredCustomers.map(c => (
          <div
            key={c.id}
            onClick={() => setSelectedCustomerId(c.id)}
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
