import React, { useState, useMemo } from 'react'; // Добавили useMemo
import { Customer, Sale, Account, Investor, Payment, AppSettings } from '../types';
import { ICONS } from '../constants';
import CustomerDetails from './CustomerDetails';

interface CustomersProps {
  customers: Customer[];
  accounts: Account[];
  investors: Investor[];
  sales: Sale[];
  appSettings: AppSettings;
  onAddCustomer: (data: {
  name: string;
  phone: string;
  photo?: string;
  address?: string;
  passportSeries?: string;
  passportNumber?: string;
  passportIssuedBy?: string;
}) => void;
  onSelectCustomer: (id: string) => void; 
  onInitiatePayment: (sale: Sale, payment: Payment) => void;
  onUndoPayment: (saleId: string, paymentId: string) => void;
  onEditPayment: (saleId: string, paymentId: string, newDate: string) => void;
  onUpdateCustomer: (customer: Customer) => void;
  onDeleteCustomer: (customerId: string) => void;
}

const Customers: React.FC<CustomersProps> = ({
  customers,
  accounts,
  investors,
  sales,
  appSettings,
  onAddCustomer,
  onSelectCustomer,
  onInitiatePayment,
  onUndoPayment,
  onEditPayment,
  onUpdateCustomer,
  onDeleteCustomer
}) => {
  const [isAdding, setIsAdding] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [newPhoto, setNewPhoto] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [newPassportSeries, setNewPassportSeries] = useState('');
const [newPassportNumber, setNewPassportNumber] = useState('');
const [newPassportIssuedBy, setNewPassportIssuedBy] = useState('');

  // === ЛОГИКА ФИЛЬТРАЦИИ И СОРТИРОВКИ ОТ А ДО Я ===
  const sortedFilteredCustomers = useMemo(() => {
    return customers
      .filter(c =>
        c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.phone.includes(searchTerm)
      )
      .sort((a, b) => a.name.localeCompare(b.name)); // Сортировка по алфавиту
  }, [customers, searchTerm]);

  if (selectedCustomerId) {
    const customer = customers.find(c => c.id === selectedCustomerId);
    if (customer) {
      return (
        <CustomerDetails
          customer={customer}
          sales={sales}
          accounts={accounts}
          investors={investors}
          appSettings={appSettings}
          onBack={() => setSelectedCustomerId(null)}
          onInitiatePayment={onInitiatePayment}
          onUndoPayment={onUndoPayment}
          onEditPayment={onEditPayment}
          onUpdateCustomer={onUpdateCustomer}
          onDeleteCustomer={onDeleteCustomer}
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
    onAddCustomer({
      name: newName.trim(),
      phone: newPhone.trim(),
      photo: newPhoto || undefined,
      address: newAddress.trim() || undefined,

      // 🔹 Паспортные данные (только если заполнены)
      passportSeries: newPassportSeries.trim() || undefined,
      passportNumber: newPassportNumber.trim() || undefined,
      passportIssuedBy: newPassportIssuedBy.trim() || undefined,
    });

    // 🔹 Сброс ВСЕХ полей формы
    setNewName('');
    setNewPhone('');
    setNewAddress('');
    setNewPhoto('');
    setNewPassportSeries('');
    setNewPassportNumber('');
    setNewPassportIssuedBy('');
    setIsAdding(false);
  }
};

  return (
    <div className="space-y-4 pb-20 animate-fade-in">
      <header className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Клиенты</h2>
          <p className="text-slate-500 text-sm">
            {sortedFilteredCustomers.length} из {customers.length}
          </p>
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

    {/* === БЛОК 1: Фото + ФИО + Телефон === */}
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

    {/* === БЛОК 2: Адрес + Паспорт (в одном раскрывающемся) === */}
    <details className="group" open> {/* 🔹 open — чтобы блок был раскрыт по умолчанию */}
      <summary className="flex items-center gap-2 text-sm font-medium cursor-pointer list-none text-indigo-600">
        <span className="transition-transform group-open:rotate-90">▶</span>
        📍 Адрес и документы
      </summary>

      <div className="mt-3 space-y-4 p-4 bg-slate-50 rounded-xl">

        {/* 🔹 Адрес (перенесён сюда) */}
        <div>
          <label className="block text-xs text-slate-500 mb-1">Адрес</label>
          <input
            type="text"
            placeholder="г. Москва, ул. Ленина, д. 1, кв. 10"
            className="w-full p-2.5 border border-slate-200 rounded-lg outline-none text-sm"
            value={newAddress}
            onChange={e => setNewAddress(e.target.value)}
          />
        </div>

        {/* 🔹 Разделитель */}
        <div className="border-t border-slate-200 pt-3">
          <p className="text-xs font-medium text-slate-500 mb-3">🪪 Паспортные данные <span className="font-normal text-slate-400">(необязательно)</span></p>

          {/* Серия и номер */}
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

        {/* Подсказка о безопасности */}
        <p className="text-[10px] text-slate-400 flex items-start gap-1">
          <span>🔒</span>
          Данные хранятся локально и не передаются третьим лицам
        </p>
      </div>
    </details>

    <button type="submit" className="w-full bg-indigo-600 text-white py-3 rounded-xl font-bold">
      Сохранить клиента
    </button>
  </form>
)}

      <div className="grid gap-3">
        {sortedFilteredCustomers.length === 0 && !isAdding && (
            <div className="text-center py-8 text-slate-400">Клиенты не найдены</div>
        )}
        {sortedFilteredCustomers.map(c => (
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
