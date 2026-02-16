
import React, { useState, useEffect } from 'react';
import { AppSettings, ViewState } from '../types';
import { ICONS, APP_VERSION } from '../constants';
import { PrivacyPolicy, DataProcessingAgreement } from './LegalDocs';
import { api } from '../services/api';

interface SettingsProps {
  appSettings: AppSettings;
  onUpdateSettings: (settings: AppSettings) => void;
  onNavigate: (view: ViewState) => void;
}

const Settings: React.FC<SettingsProps> = ({ appSettings, onUpdateSettings, onNavigate }) => {
  const [companyName, setCompanyName] = useState(appSettings.companyName);

  // Clear Data Modal State
  const [showClearModal, setShowClearModal] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  // Legal Docs View State
  const [legalView, setLegalView] = useState<'NONE' | 'PRIVACY' | 'AGREEMENT'>('NONE');

  useEffect(() => {
    setCompanyName(appSettings.companyName);
  }, [appSettings]);

  const handleSave = () => {
    onUpdateSettings({
        ...appSettings,
        companyName
    });
    alert("Настройки сохранены!");
  };

  const handleClearData = async () => {
      setIsClearing(true);
      try {
          await api.resetAccountData();
          localStorage.clear();
          window.location.reload();
      } catch (error) {
          console.error(error);
          alert("Ошибка при очистке данных на сервере. Попробуйте снова или перезайдите в аккаунт.");
          setIsClearing(false);
      }
  };

  const handleForceUpdate = () => {
      window.location.reload();
  }

  if (legalView === 'PRIVACY') {
      return <PrivacyPolicy onBack={() => setLegalView('NONE')} />;
  }

  if (legalView === 'AGREEMENT') {
      return <DataProcessingAgreement onBack={() => setLegalView('NONE')} />;
  }

  return (
    <div className="space-y-6 animate-fade-in pb-20">
      <header className="flex justify-between items-start">
        <div>
            <h2 className="text-2xl font-bold text-slate-800">Настройки</h2>
            <p className="text-slate-500 text-sm">Версия: {APP_VERSION}</p>
        </div>
        <button onClick={handleForceUpdate} className="text-xs bg-slate-100 text-slate-600 px-3 py-2 rounded-lg font-medium hover:bg-slate-200">
            Обновить приложение
        </button>
      </header>

      {/* Company Name */}
      <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
        <h3 className="text-lg font-semibold text-slate-800 mb-1">Название компании</h3>
        <p className="text-sm text-slate-500 mb-4">Отображается в заголовке и в сообщениях.</p>
        <div className="flex gap-2">
            <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="flex-1 p-3 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="Название вашей компании"
            />
            <button
                onClick={handleSave}
                className="bg-indigo-600 text-white px-4 rounded-xl font-bold hover:bg-indigo-700"
            >
                OK
            </button>
        </div>
      </div>

      {/* Tools & Integrations */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button
            onClick={() => onNavigate('INTEGRATIONS')}
            className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4 hover:shadow-md transition-all group text-left"
          >
              <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600 group-hover:scale-110 transition-transform">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
              </div>
              <div>
                  <h3 className="font-bold text-slate-800 text-lg">Интеграции</h3>
                  <p className="text-sm text-slate-500">WhatsApp, SMS и другое</p>
              </div>
          </button>

          <button
            onClick={() => onNavigate('CALCULATOR')}
            className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4 hover:shadow-md transition-all group text-left"
          >
              <div className="w-12 h-12 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600 group-hover:scale-110 transition-transform">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="16" y1="14" x2="16" y2="18"/><path d="M16 10h.01"/><path d="M12 10h.01"/><path d="M8 10h.01"/><path d="M12 14h.01"/><path d="M8 14h.01"/><path d="M12 18h.01"/><path d="M8 18h.01"/></svg>
              </div>
              <div>
                  <h3 className="font-bold text-slate-800 text-lg">Калькулятор</h3>
                  <p className="text-sm text-slate-500">Расчет рассрочки и ссылка</p>
              </div>
          </button>
      </div>

      {/* Legal Information Section */}
      <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
          <h3 className="text-lg font-semibold text-slate-800 mb-2">Правовая информация</h3>
          <div className="space-y-2">
              <button
                  onClick={() => setLegalView('AGREEMENT')}
                  className="w-full text-left p-3 rounded-xl hover:bg-slate-50 text-sm font-medium text-slate-700 flex justify-between items-center transition-colors"
              >
                  Согласие на обработку данных
                  <span className="text-slate-400">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                  </span>
              </button>
              <div className="h-px bg-slate-50 mx-2"></div>
              <button
                  onClick={() => setLegalView('PRIVACY')}
                  className="w-full text-left p-3 rounded-xl hover:bg-slate-50 text-sm font-medium text-slate-700 flex justify-between items-center transition-colors"
              >
                  Политика конфиденциальности
                  <span className="text-slate-400">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                  </span>
              </button>
          </div>
      </div>

      {/* Clear Data Section */}
      <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
          <h3 className="text-lg font-semibold text-slate-800 mb-1">Управление данными</h3>
          <p className="text-sm text-slate-500 mb-4">Сброс всех данных приложения. Используйте с осторожностью.</p>
          <button
              onClick={() => setShowClearModal(true)}
              className="w-full py-3 bg-red-50 text-red-600 font-bold rounded-xl hover:bg-red-100 border border-red-100 flex items-center justify-center gap-2 transition-colors"
          >
              {ICONS.Delete} Сбросить все данные
          </button>
      </div>

      {/* Clear Data Modal */}
      {showClearModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in" onClick={() => setShowClearModal(false)}>
              <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl p-6 text-center space-y-4" onClick={e => e.stopPropagation()}>
                  <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto text-3xl">
                      {ICONS.Alert}
                  </div>
                  <div>
                      <h3 className="text-xl font-bold text-slate-800">Вы уверены?</h3>
                      <p className="text-slate-500 text-sm mt-2">
                          Это действие удалит ВСЕ данные (клиентов, продажи, настройки) с этого устройства. Восстановить их будет невозможно.
                      </p>
                  </div>
                  <div className="flex gap-3 pt-2">
                      <button onClick={() => setShowClearModal(false)} className="flex-1 py-3 bg-slate-100 font-bold text-slate-600 rounded-xl">Отмена</button>
                      <button onClick={handleClearData} disabled={isClearing} className="flex-1 py-3 bg-red-600 text-white font-bold rounded-xl disabled:opacity-70">
                          {isClearing ? 'Удаление...' : 'Сбросить'}
                      </button>
                  </div>
              </div>
          </div>
      )}

    </div>
  );
};

export default Settings;
