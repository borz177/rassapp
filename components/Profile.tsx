import React, { useState } from 'react';
import { User } from '../types';
import { ICONS } from '../constants';

interface ProfileProps {
  user: User;
  onUpdateProfile: (data: any) => void;
  onBack: () => void;
  onLogout: () => void;
}

const Profile: React.FC<ProfileProps> = ({ user, onUpdateProfile, onBack, onLogout }) => {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [phone, setPhone] = useState(user.phone || '');
  
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const handleProfileSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateProfile({ name, email, phone });
  };

  const handlePasswordSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      if (newPassword !== confirmPassword) {
          alert("Новые пароли не совпадают.");
          return;
      }
      if (!currentPassword || !newPassword) {
          alert("Заполните все поля для смены пароля.");
          return;
      }
      onUpdateProfile({ currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
  };

  return (
    <div className="space-y-6 animate-fade-in pb-20">
      <header className="flex items-center gap-3">
        <button onClick={onBack} className="text-slate-500 hover:text-slate-800">{ICONS.Back}</button>
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Мой профиль</h2>
          <p className="text-slate-500 text-sm">Управление личными данными</p>
        </div>
      </header>

      {/* Profile Info Form */}
      <form onSubmit={handleProfileSubmit} className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 space-y-4">
        <h3 className="text-lg font-semibold text-slate-800">Личные данные</h3>
        <div>
          <label className="text-sm font-medium text-slate-600 mb-1 block">Имя</label>
          <input 
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full p-3 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label className="text-sm font-medium text-slate-600 mb-1 block">Email (Логин)</label>
          <input 
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full p-3 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
         <div>
          <label className="text-sm font-medium text-slate-600 mb-1 block">Телефон</label>
          <input 
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full p-3 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="+7 (XXX) XXX-XX-XX"
          />
        </div>
        <button type="submit" className="w-full py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700">
          Сохранить изменения
        </button>
      </form>

      {/* Change Password Form */}
      <form onSubmit={handlePasswordSubmit} className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 space-y-4">
        <h3 className="text-lg font-semibold text-slate-800">Смена пароля</h3>
        <div>
          <label className="text-sm font-medium text-slate-600 mb-1 block">Текущий пароль</label>
          <input 
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="w-full p-3 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="••••••"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium text-slate-600 mb-1 block">Новый пароль</label>
            <input 
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full p-3 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="••••••"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-600 mb-1 block">Подтвердите</label>
            <input 
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full p-3 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="••••••"
            />
          </div>
        </div>
        <button type="submit" className="w-full py-3 bg-slate-800 text-white font-bold rounded-xl hover:bg-slate-900">
          Изменить пароль
        </button>
      </form>
      
      <div className="pt-4">
          <button onClick={onLogout} className="w-full p-4 bg-red-50 text-red-600 rounded-xl font-medium">Выйти из системы</button>
      </div>

    </div>
  );
};

export default Profile;