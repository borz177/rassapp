import React, { useState, useEffect } from 'react';
import { AppSettings, ViewState } from '../types';
import { ICONS, APP_VERSION, THEMES } from '../constants';
import { PrivacyPolicy, DataProcessingAgreement } from './LegalDocs';
import { api } from '../services/api';
import DataImport from './DataImport';
import DataExport from './DataExport'; // 👈 Добавили импорт компонента экспорта

interface SettingsProps {
  appSettings: AppSettings;
  onUpdateSettings: (settings: AppSettings) => void;
  onNavigate: (view: ViewState) => void;
  onSettingsChanged?: () => void;
  currentUserId?: string;
}

const Settings: React.FC<SettingsProps> = ({ appSettings, onUpdateSettings, onNavigate, onSettingsChanged, currentUserId }) => {
  const [companyName, setCompanyName] = useState(appSettings.companyName);

  // Clear Data Modal State
  const [showClearModal, setShowClearModal] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [confirmCooldown, setConfirmCooldown] = useState(0);

  // 👇 ДОБАВИЛИ: состояния для модалок импорта и экспорта
  const [showImportModal, setShowImportModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);

  // Legal Docs View State
  const [legalView, setLegalView] = useState<'NONE' | 'PRIVACY' | 'AGREEMENT'>('NONE');

  useEffect(() => {
    setCompanyName(appSettings.companyName);
  }, [appSettings]);

  useEffect(() => {
    if (showClearModal) {
      setConfirmCooldown(10);

      const timer = setInterval(() => {
        setConfirmCooldown(prev => {
          if (prev <= 1) {
            clearInterval(timer);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return () => clearInterval(timer);
    }
  }, [showClearModal]);

  const handleSave = () => {
    onUpdateSettings({
        ...appSettings,
        companyName
    });
    onSettingsChanged?.();
    alert("Настройки сохранены!");
  };

  const handleThemeChange = (themeKey: 'PURPLE' | 'BLUE' | 'GREEN' | 'BLACK') => {
      onUpdateSettings({
          ...appSettings,
          theme: themeKey
      });
  };

  const handleClearData = async () => {
    if (confirmCooldown > 0 || isClearing) return;

    setIsClearing(true);
    try {
        await api.resetAccountData();

        if ('serviceWorker' in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            for (const registration of registrations) {
                await registration.unregister();
            }
        }

        if ('indexedDB' in window) {
            const dbNames = await window.indexedDB.databases?.().then(dbs => dbs.map(db => db.name)) || [];
            dbNames.forEach(dbName => {
                if (dbName) {
                    const request = window.indexedDB.deleteDatabase(dbName);
                    request.onerror = () => console.error('Failed to delete DB:', dbName);
                }
            });
        }

        localStorage.removeItem('token');
        localStorage.removeItem('user');
        sessionStorage.clear();

        if ('caches' in window) {
            const cacheNames = await caches.keys();
            await Promise.all(cacheNames.map(name => caches.delete(name)));
        }

        window.location.href = '/';

    } catch (error) {
        console.error('Clear data error:', error);
        alert("Ошибка при очистке данных. Попробуйте снова.");
        setIsClearing(false);
    }
  };

  const handleForceUpdate = () => {
      window.location.reload();
  };

  const handleCloseClearModal = () => {
      setShowClearModal(false);
      setConfirmCooldown(0);
  };

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

      {/* Display Settings */}
      <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
          <h3 className="text-lg font-semibold text-slate-800 mb-1">Отображение</h3>
          <div className="flex items-center justify-between">
              <div>
                  <p className="font-medium text-slate-700">Показывать копейки</p>
                  <p className="text-sm text-slate-500">Отображать дробную часть в суммах (например, 100.50 ₽)</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                  <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={appSettings.showCents ?? false}
                      onChange={(e) => onUpdateSettings({ ...appSettings, showCents: e.target.checked })}
                  />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
              </label>
          </div>
      </div>

      {/* Theme Selection */}
      <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
          <h3 className="text-lg font-semibold text-slate-800 mb-1">Цветовая тема</h3>
          <p className="text-sm text-slate-500 mb-4">Выберите основной цвет приложения.</p>
          <div className="grid grid-cols-2 gap-3">
              {(Object.keys(THEMES) as Array<keyof typeof THEMES>).map((themeKey) => (
                  <button
                      key={themeKey}
                      onClick={() => handleThemeChange(themeKey)}
                      className={`p-3 rounded-xl border-2 transition-all flex items-center gap-3 ${
                          (appSettings.theme || 'PURPLE') === themeKey 
                              ? 'border-indigo-600 bg-indigo-50' 
                              : 'border-slate-100 hover:border-indigo-200'
                      }`}
                  >
                      <div
                          className="w-8 h-8 rounded-full shadow-sm"
                          style={{ backgroundColor: THEMES[themeKey].primary[600] }}
                      ></div>
                      <span className={`text-sm font-medium ${
                          (appSettings.theme || 'PURPLE') === themeKey ? 'text-indigo-900' : 'text-slate-600'
                      }`}>
                          {THEMES[themeKey].name}
                      </span>
                  </button>
              ))}
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

      {/* 👇 ОБЪЕДИНЁННЫЙ БЛОК: Работа с данными (Экспорт + Импорт) */}
      <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
          <h3 className="text-lg font-semibold text-slate-800 mb-1">Работа с данными</h3>
          <p className="text-sm text-slate-500 mb-4">Выгружайте данные в Excel или загружайте из файла.</p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Кнопка ЭКСПОРТА */}
              <button
                  onClick={() => setShowExportModal(true)}
                  className="py-4 bg-emerald-50 text-emerald-700 font-bold rounded-xl hover:bg-emerald-100 border border-emerald-100 flex flex-col items-center justify-center gap-2 transition-colors group"
              >
                  <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                          <polyline points="7 10 12 15 17 10"/>
                          <line x1="12" y1="15" x2="12" y2="3"/>
                      </svg>
                  </div>
                  <span className="text-sm">Экспорт в Excel</span>
                  <span className="text-[10px] font-normal text-emerald-600/70">С фильтром по датам</span>
              </button>

              {/* Кнопка ИМПОРТА */}
              <button
                  onClick={() => setShowImportModal(true)}
                  className="py-4 bg-indigo-50 text-indigo-700 font-bold rounded-xl hover:bg-indigo-100 border border-indigo-100 flex flex-col items-center justify-center gap-2 transition-colors group"
              >
                  <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                          <polyline points="17 8 12 3 7 8"/>
                          <line x1="12" y1="3" x2="12" y2="15"/>
                      </svg>
                  </div>
                  <span className="text-sm">Импорт из Excel</span>
                  <span className="text-[10px] font-normal text-indigo-600/70">Клиенты, продажи, платежи</span>
              </button>
          </div>

          {/* Подсказка под кнопками */}
          <div className="mt-4 p-3 bg-amber-50 border border-amber-100 rounded-xl">
              <p className="text-xs text-amber-800 flex items-start gap-2">
                  <span className="text-base leading-none">💡</span>
                  <span>
                      <b>Совет:</b> Сначала сделайте экспорт — получите файл с актуальными данными.
                      Его можно использовать как шаблон для импорта на другом устройстве.
                  </span>
              </p>
          </div>
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
          <div
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in"
              onClick={handleCloseClearModal}
          >
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

                  {confirmCooldown > 0 && (
                      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                          <p className="text-amber-800 text-sm font-medium">
                              ⏳ Подождите <span className="font-bold text-lg">{confirmCooldown}</span> сек. для подтверждения
                          </p>
                      </div>
                  )}

                  <div className="flex gap-3 pt-2">
                      <button
                          onClick={handleCloseClearModal}
                          className="flex-1 py-3 bg-slate-100 font-bold text-slate-600 rounded-xl hover:bg-slate-200 transition-colors"
                      >
                          Отмена
                      </button>
                      <button
                          onClick={handleClearData}
                          disabled={confirmCooldown > 0 || isClearing}
                          className={`flex-1 py-3 font-bold rounded-xl transition-all flex items-center justify-center gap-2 ${
                              confirmCooldown > 0 || isClearing
                                  ? 'bg-red-300 text-red-100 cursor-not-allowed' 
                                  : 'bg-red-600 text-white hover:bg-red-700 hover:scale-[1.02]'
                          }`}
                      >
                          {isClearing ? (
                              <>
                                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                                  </svg>
                                  Удаление...
                              </>
                          ) : confirmCooldown > 0 ? (
                              `${confirmCooldown}с...`
                          ) : (
                              '✅ Сбросить'
                          )}
                      </button>
                  </div>

                  {confirmCooldown > 0 && (
                      <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                          <div
                              className="bg-amber-400 h-full transition-all duration-1000 ease-linear"
                              style={{ width: `${(confirmCooldown / 10) * 100}%` }}
                          />
                      </div>
                  )}
              </div>
          </div>
      )}

      {/* 👇 МОДАЛКА ЭКСПОРТА */}
      {showExportModal && (
        <DataExport onClose={() => setShowExportModal(false)} />
      )}

      {/* МОДАЛКА ИМПОРТА */}
      {showImportModal && (
        <DataImport
            onClose={() => setShowImportModal(false)}
            onImportSuccess={() => {
                setTimeout(() => {
                    setShowImportModal(false);
                    alert("✅ Данные успешно импортированы! Страница будет перезагружена.");
                    window.location.reload();
                }, 5000);
            }}
            currentUserId={currentUserId}
        />
      )}

    </div>
  );
};

export default Settings;