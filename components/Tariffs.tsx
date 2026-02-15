
import React, { useState } from 'react';
import { ICONS } from '../constants';
import { api } from '../services/api';
import { SubscriptionPlan } from '../types';

const Tariffs: React.FC = () => {
  const [duration, setDuration] = useState<1 | 3 | 6 | 12>(1);
  const [loading, setLoading] = useState<string | null>(null);

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

  const handlePay = async (planName: string, amount: number) => {
    setLoading(planName);
    const planKey: SubscriptionPlan = planName === 'Старт' ? 'START' : planName === 'Стандарт' ? 'STANDARD' : 'BUSINESS';

    try {
      // 1. Create Payment
      const response = await fetch(`${window.location.protocol}//${window.location.hostname}:5000/api/payment/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-auth-token': localStorage.getItem('token') || '' },
        body: JSON.stringify({
          amount: amount * duration,
          description: `Оплата тарифа ${planName} на ${duration} мес.`,
          returnUrl: window.location.href, // Redirect back to this page
          plan: planKey,
          months: duration
        })
      });

      const data = await response.json();
      
      if (data.confirmationUrl) {
        // Redirect user to YooKassa
        window.location.href = data.confirmationUrl;
      } else {
        alert("Ошибка инициализации платежа. Проверьте настройки сервера.");
      }
    } catch (error) {
      console.error("Payment Error:", error);
      alert("Ошибка соединения с сервером оплаты");
    } finally {
      setLoading(null);
    }
  };

  const plans = [
    {
      name: "Старт",
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
      basePrice: 100,
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
    <div className="space-y-6 animate-fade-in pb-20">
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

          return (
            <div 
              key={plan.name} 
              className={`relative rounded-2xl p-6 shadow-xl transition-transform hover:scale-[1.02] flex flex-col ${plan.color}`}
            >
              {plan.badge && (
                <div className="absolute top-0 right-0 bg-indigo-500 text-white text-xs font-bold px-3 py-1 rounded-bl-xl rounded-tr-xl">
                  {plan.badge}
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
                onClick={() => handlePay(plan.name, monthlyPrice)}
                disabled={!!loading}
                className={`w-full py-4 rounded-xl font-bold transition-opacity ${plan.btnColor} ${loading ? 'opacity-70 cursor-not-allowed' : 'hover:opacity-90'}`}
              >
                {loading === plan.name ? 'Загрузка...' : 'Выбрать'}
              </button>
            </div>
          );
        })}
      </div>
      
      <div className="text-center text-xs text-slate-400 mt-8">
        Оплата производится через безопасный шлюз ЮKassa. Активация происходит автоматически после подтверждения платежа.
      </div>
    </div>
  );
};

export default Tariffs;
