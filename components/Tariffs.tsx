
import React, { useState } from 'react';
import { ICONS } from '../constants';
import { api } from '../services/api';
import { SubscriptionPlan, User } from '../types';

interface TariffsProps {
    user?: User | null;
}

const Tariffs: React.FC<TariffsProps> = ({ user }) => {
  const [duration, setDuration] = useState<1 | 3 | 6 | 12>(1);
  const [loading, setLoading] = useState<string | null>(null);

  // State for Confirmation Modal
  const [confirmData, setConfirmData] = useState<{name: string, monthlyPrice: number, basePrice: number} | null>(null);

  const getDiscount = (months: number) => {
    switch(months) {
      case 3: return 0.05;
      case 6: return 0.10;
      case 12: return 0.20;
      default: return 0;
    }
  };

  const calculatePrice = (basePrice: number) => {
    const discount = getDiscount(duration);
    const monthlyPrice = basePrice * (1 - discount);
    return Math.ceil(monthlyPrice);
  };

  const handleSelectPlan = (name: string, monthlyPrice: number, basePrice: number) => {
      setConfirmData({ name, monthlyPrice, basePrice });
  };

  const proceedToPayment = async () => {
    if (!confirmData) return;

    const { name, monthlyPrice } = confirmData;
    setLoading(name);

    const planKey: SubscriptionPlan = name === 'Старт' ? 'START' : name === 'Стандарт' ? 'STANDARD' : 'BUSINESS';
    const amount = monthlyPrice * duration;

    try {
      // Use API service which handles the correct URL (proxy vs localhost)
      const data = await api.createPayment({
          amount: amount,
          description: `Оплата тарифа ${name} на ${duration} мес.`,
          returnUrl: 'https://rassrochka.pro',// Redirect back to this page
          plan: planKey,
          months: duration
      });

      if (data.confirmationUrl) {
        window.location.href = data.confirmationUrl;
      } else {
        alert("Ошибка инициализации платежа. Проверьте настройки сервера.");
        setLoading(null);
        setConfirmData(null);
      }
    } catch (error: any) {
      console.error("Payment Error:", error);
      alert(`Ошибка: ${error.message || 'Не удалось создать платеж'}`);
      setLoading(null);
      setConfirmData(null);
    }
  };

  const plans = [
    {
      name: "Старт",
      key: "START",
      basePrice: 990,
      features: [
        "Базовый учет продаж",
        "1 инвестор",
        "База клиентов (до 100)",
        "Учет расходов",
        "Без напоминаний WhatsApp"
      ],
      color: "bg-slate-100",
      textColor: "text-slate-800",
      btnColor: "bg-slate-800",
      highlight: false
    },
    {
      name: "Стандарт",
      key: "STANDARD",
      basePrice: 1490,
      features: [
        "Все функции Старт",
        "5 инвесторов",
        "Авто-напоминания WhatsApp",
        "Печать договоров (PDF)",
        "База клиентов (до 1000)"
      ],
      color: "bg-indigo-50 border-2 border-indigo-500",
      textColor: "text-indigo-900",
      btnColor: "bg-indigo-600",
      highlight: true,
      badge: "Популярный"
    },
    {
      name: "Бизнес",
      key: "BUSINESS",
      basePrice: 1990,
      features: [
        "Все функции Стандарт",
        "Безлимит инвесторов",
        "ИИ Аналитика рисков",
        "Сотрудники и права доступа",
        "Приоритетная поддержка"
      ],
      color: "bg-gradient-to-br from-slate-900 to-slate-800 text-white",
      textColor: "text-white",
      btnColor: "bg-white text-slate-900",
      highlight: false
    }
  ];

  return (
    <div className="space-y-6 animate-fade-in pb-20 relative">
      <header className="text-center">
        <h2 className="text-3xl font-bold text-slate-800">Тарифы</h2>
        <p className="text-slate-500 mt-2">Выберите подходящий план для вашего бизнеса</p>
      </header>

      {/* Duration Switcher */}
      <div className="flex justify-center">
        <div className="bg-white p-1 rounded-xl shadow-sm border border-slate-200 inline-flex">
          {[1, 3, 6, 12].map((m) => (
            <button
              key={m}
              onClick={() => setDuration(m as any)}
              className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                duration === m 
                  ? 'bg-slate-800 text-white shadow-md' 
                  : 'text-slate-500 hover:bg-slate-50'
              }`}
            >
              {m} мес. {m > 1 && <span className="text-[10px] opacity-70">-{getDiscount(m)*100}%</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Plans Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-6xl mx-auto px-2">
        {plans.map((plan) => {
          const monthlyPrice = calculatePrice(plan.basePrice);
          const totalPrice = monthlyPrice * duration;

          const isCurrentPlan = user?.subscription?.plan === plan.key;

          return (
            <div
              key={plan.name}
              className={`relative rounded-2xl p-6 shadow-xl transition-transform hover:scale-[1.02] flex flex-col ${plan.color} ${isCurrentPlan ? 'ring-4 ring-emerald-400 ring-offset-2' : ''}`}
            >
              {plan.badge && !isCurrentPlan && (
                <div className="absolute top-0 right-0 bg-indigo-500 text-white text-xs font-bold px-3 py-1 rounded-bl-xl rounded-tr-xl">
                  {plan.badge}
                </div>
              )}

              {isCurrentPlan && (
                <div className="absolute top-0 right-0 bg-emerald-500 text-white text-xs font-bold px-3 py-1 rounded-bl-xl rounded-tr-xl flex items-center gap-1">
                  {ICONS.Check} Ваш текущий план
                </div>
              )}

              <h3 className={`text-xl font-bold mb-2 ${plan.highlight ? 'text-indigo-900' : plan.textColor}`}>
                {plan.name}
              </h3>

              <div className="mb-6">
                <span className={`text-4xl font-bold ${plan.highlight ? 'text-indigo-900' : plan.textColor}`}>
                  {monthlyPrice} ₽
                </span>
                <span className={`text-sm opacity-70 ${plan.textColor}`}>/мес</span>
                {duration > 1 && (
                   <p className={`text-xs mt-1 opacity-60 ${plan.textColor}`}>
                     Оплата сразу: {totalPrice} ₽
                   </p>
                )}
              </div>

              <ul className="space-y-3 mb-8 flex-1">
                {plan.features.map((feature, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm">
                    <span className={plan.name === 'Бизнес' ? 'text-emerald-400' : 'text-emerald-600'}>
                      {ICONS.Check}
                    </span>
                    <span className={`${plan.name === 'Бизнес' ? 'text-slate-300' : 'text-slate-600'}`}>
                      {feature}
                    </span>
                  </li>
                ))}
              </ul>

              <button
                onClick={() => !isCurrentPlan && handleSelectPlan(plan.name, monthlyPrice, plan.basePrice)}
                disabled={isCurrentPlan}
                className={`w-full py-4 rounded-xl font-bold transition-opacity ${
                    isCurrentPlan 
                    ? 'bg-emerald-600 text-white cursor-default' 
                    : `${plan.btnColor} hover:opacity-90`
                }`}
              >
                {isCurrentPlan ? 'Активен' : 'Выбрать'}
              </button>
            </div>
          );
        })}
      </div>

      <div className="text-center text-xs text-slate-400 mt-8">
        Оплата производится через безопасный шлюз ЮKassa. Активация происходит автоматически после подтверждения платежа.
      </div>

      {/* Confirmation Modal */}
      {confirmData && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in" onClick={() => !loading && setConfirmData(null)}>
              <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl p-6 relative overflow-hidden" onClick={e => e.stopPropagation()}>

                  {/* Decorative Background Element */}
                  <div className="absolute -top-10 -right-10 w-32 h-32 bg-indigo-50 rounded-full opacity-50 pointer-events-none"></div>

                  <h3 className="text-xl font-bold text-slate-800 mb-1">Подтверждение заказа</h3>
                  <p className="text-sm text-slate-500 mb-6">Проверьте детали перед оплатой</p>

                  <div className="bg-slate-50 p-4 rounded-xl space-y-3 border border-slate-100 mb-6">
                      <div className="flex justify-between items-center">
                          <span className="text-slate-500 text-sm">Тариф</span>
                          <span className="font-bold text-slate-800">{confirmData.name}</span>
                      </div>
                      <div className="flex justify-between items-center">
                          <span className="text-slate-500 text-sm">Период</span>
                          <span className="font-medium text-slate-800">{duration} мес.</span>
                      </div>
                      <div className="border-t border-slate-200 my-2"></div>
                      <div className="flex justify-between items-center text-xs text-slate-400">
                          <span>Цена за месяц</span>
                          <span>{confirmData.monthlyPrice} ₽</span>
                      </div>
                      {confirmData.basePrice > confirmData.monthlyPrice && (
                          <div className="flex justify-between items-center text-xs text-emerald-600 font-medium">
                              <span>Скидка ({(1 - confirmData.monthlyPrice / confirmData.basePrice) * 100}%)</span>
                              <span>-{(confirmData.basePrice * duration - confirmData.monthlyPrice * duration).toLocaleString()} ₽</span>
                          </div>
                      )}
                      <div className="flex justify-between items-end pt-2">
                          <span className="text-slate-800 font-bold">Итого к оплате:</span>
                          <span className="text-2xl font-bold text-indigo-600">{(confirmData.monthlyPrice * duration).toLocaleString()} ₽</span>
                      </div>
                  </div>

                  <div className="space-y-3">
                      <button
                          onClick={proceedToPayment}
                          disabled={!!loading}
                          className="w-full py-3.5 bg-indigo-600 text-white rounded-xl font-bold shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all flex justify-center items-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                      >
                          {loading ? (
                              <>
                                  <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                  </svg>
                                  Переход к оплате...
                              </>
                          ) : (
                              'Оплатить через ЮKassa'
                          )}
                      </button>

                      <button
                          onClick={() => setConfirmData(null)}
                          disabled={!!loading}
                          className="w-full py-3 bg-white text-slate-500 rounded-xl font-medium hover:bg-slate-50 transition-colors"
                      >
                          Отмена
                      </button>
                  </div>

                  <div className="mt-4 flex justify-center opacity-50">
                      <span className="text-[10px] text-slate-400">Безопасный платеж • SSL Encrypted</span>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default Tariffs;
