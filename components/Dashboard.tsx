import React, { useMemo, useState } from 'react';
import { Sale, Customer } from '../types';
import { ICONS } from '../constants';

interface DashboardProps {
  sales: Sale[];
  customers: Customer[];
  stats: {
    totalRevenue: number;
    totalOutstanding: number;
    overdueCount: number;
    installmentSalesTotal: number;
  };
  workingCapital: number;
  onAction: (action: string) => void;
  onSelectCustomer: (id: string) => void;
  onInitiatePayment: (sale: Sale, amount: number) => void;
}

const SaleDetailsModal = ({ sale, customerName, onClose }: { sale: Sale, customerName: string, onClose: () => void }) => {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in" onClick={onClose}>
            <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="p-5 border-b border-slate-200 bg-slate-50">
                    <h3 className="text-lg font-bold text-slate-800">{sale.productName}</h3>
                    <p className="text-sm text-slate-500">Клиент: {customerName}</p>
                </div>
                <div className="p-5 space-y-3 max-h-[60vh] overflow-y-auto">
                    <div className="flex justify-between text-sm"><span className="text-slate-500">Дата оформления</span><span className="font-medium">{new Date(sale.startDate).toLocaleDateString()}</span></div>
                    <div className="flex justify-between text-sm"><span className="text-slate-500">Общая сумма</span><span className="font-bold text-indigo-600">{sale.totalAmount.toLocaleString()} ₽</span></div>
                    <div className="flex justify-between text-sm"><span className="text-slate-500">Первый взнос</span><span className="font-medium">{sale.downPayment.toLocaleString()} ₽</span></div>
                    <div className="flex justify-between text-sm"><span className="text-slate-500">Остаток долга</span><span className="font-bold text-amber-600">{sale.remainingAmount.toLocaleString()} ₽</span></div>
                    <div className="flex justify-between text-sm"><span className="text-slate-500">Срок</span><span className="font-medium">{sale.installments} мес.</span></div>
                    <div className="flex justify-between text-sm"><span className="text-slate-500">Статус</span><span className={`font-bold ${sale.status === 'COMPLETED' ? 'text-emerald-600' : 'text-blue-600'}`}>{sale.status}</span></div>
                </div>
                <div className="p-4 border-t border-slate-100"><button onClick={onClose} className="w-full py-3 bg-slate-100 text-slate-700 font-bold rounded-xl hover:bg-slate-200">Закрыть</button></div>
            </div>
        </div>
    );
};

const Dashboard: React.FC<DashboardProps> = ({ sales, customers, stats, workingCapital, onAction, onSelectCustomer, onInitiatePayment }) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'upcoming'>('overview');
  const [selectedSaleForModal, setSelectedSaleForModal] = useState<Sale | null>(null);
  const [activeActionMenu, setActiveActionMenu] = useState<string | null>(null);

  const lastFiveSales = useMemo(() => {
      return [...sales]
          .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime())
          .slice(0, 5);
  }, [sales]);

  const upcomingAndOverduePayments = useMemo(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const tomorrowEnd = new Date(tomorrow);
    tomorrowEnd.setHours(23, 59, 59, 999);

    const today = new Date();
    
    const payments: { sale: Sale, customerName: string, totalDue: number, isTomorrow: boolean }[] = [];

    sales.forEach(sale => {
      if (sale.status !== 'ACTIVE') return;

      let overdueAmount = 0;
      let tomorrowAmount = 0;
      let isTomorrowPayment = false;

      sale.paymentPlan.forEach(p => {
        if (!p.isPaid) {
          const paymentDate = new Date(p.date);
          if (paymentDate < today) {
            overdueAmount += p.amount;
          } else if (paymentDate >= tomorrow && paymentDate <= tomorrowEnd) {
            tomorrowAmount += p.amount;
            isTomorrowPayment = true;
          }
        }
      });
      
      const totalDue = overdueAmount + tomorrowAmount;

      if (totalDue > 0) {
        payments.push({
          sale: sale,
          customerName: customers.find(c => c.id === sale.customerId)?.name || 'Неизвестный клиент',
          totalDue: totalDue,
          isTomorrow: isTomorrowPayment && overdueAmount === 0,
        });
      }
    });

    return payments.sort((a,b) => a.totalDue - b.totalDue);
  }, [sales, customers]);

  const handleActionClick = (e: React.MouseEvent, saleId: string) => {
      e.stopPropagation();
      setActiveActionMenu(prev => prev === saleId ? null : saleId);
  }

  return (
    <div className="space-y-6 animate-fade-in pb-20 w-full">
      <header className="mb-4">
        <h2 className="text-2xl font-bold text-slate-800">Главная</h2>
        <p className="text-slate-500 text-sm">Панель управления бизнесом</p>
      </header>
      
      {/* Tabs */}
      <div className="flex bg-slate-100 p-1 rounded-xl">
        <button onClick={() => setActiveTab('overview')} className={`flex-1 py-2.5 text-sm font-bold rounded-lg transition-all ${activeTab === 'overview' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}>Обзор</button>
        <button onClick={() => setActiveTab('upcoming')} className={`flex-1 py-2.5 text-sm font-bold rounded-lg transition-all relative ${activeTab === 'upcoming' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}>
          Платежи
          {upcomingAndOverduePayments.length > 0 && <span className="absolute top-1 right-2 w-5 h-5 bg-red-500 text-white text-[10px] rounded-full flex items-center justify-center">{upcomingAndOverduePayments.length}</span>}
        </button>
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
          <div className="space-y-6 animate-fade-in">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="bg-white p-6 rounded-2xl shadow-sm"><p className="text-sm font-medium text-slate-500">Собрано средств</p><p className="text-2xl font-bold text-emerald-600">{stats.totalRevenue.toLocaleString()} ₽</p></div>
                <div className="bg-white p-6 rounded-2xl shadow-sm"><p className="text-sm font-medium text-slate-500">Долг клиентов</p><p className="text-2xl font-bold text-amber-600">{stats.totalOutstanding.toLocaleString()} ₽</p></div>
                <div className="bg-white p-6 rounded-2xl shadow-sm"><p className="text-sm font-medium text-slate-500">Продажи в рассрочку</p><p className="text-2xl font-bold text-indigo-600">{stats.installmentSalesTotal.toLocaleString()} ₽</p></div>
                <div className="bg-white p-6 rounded-2xl shadow-sm"><p className="text-sm font-medium text-slate-500">Оборотные средства</p><p className="text-2xl font-bold text-sky-600">{workingCapital.toLocaleString()} ₽</p></div>
                <div className="bg-white p-6 rounded-2xl shadow-sm"><p className="text-sm font-medium text-slate-500">Рискованные сделки</p><p className="text-2xl font-bold text-red-600">{stats.overdueCount}</p></div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white p-6 rounded-2xl shadow-sm">
                    <h3 className="text-lg font-semibold text-slate-700 mb-4">Последние 5 договоров</h3>
                    <div className="space-y-3">
                        {lastFiveSales.map(sale => (
                            <div key={sale.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                                <div>
                                    <p className="font-bold text-sm text-slate-800">{customers.find(c=>c.id === sale.customerId)?.name}</p>
                                    <p className="text-xs text-slate-500">{sale.productName} • {new Date(sale.startDate).toLocaleDateString()}</p>
                                </div>
                                <button onClick={() => setSelectedSaleForModal(sale)} className="text-xs bg-indigo-100 text-indigo-700 px-3 py-2 rounded-lg font-semibold">Детали</button>
                            </div>
                        ))}
                    </div>
                </div>
                
                <div className="bg-white p-6 rounded-2xl shadow-sm">
                     <h3 className="text-lg font-semibold text-slate-700 mb-4">Быстрые действия</h3>
                     <div className="space-y-4">
                        <button onClick={() => onAction('CREATE_SALE')} className="w-full flex items-center justify-center gap-2 bg-indigo-600 text-white py-4 rounded-xl font-semibold shadow-lg shadow-indigo-200">{ICONS.AddSmall} Новая рассрочка</button>
                        <div className="grid grid-cols-2 gap-4">
                            <button onClick={() => onAction('ADD_CUSTOMER')} className="w-full bg-slate-100 text-slate-700 py-4 rounded-xl font-medium">+ Клиент</button>
                            <button onClick={() => onAction('ADD_PRODUCT')} className="w-full bg-slate-100 text-slate-700 py-4 rounded-xl font-medium">+ Товар</button>
                        </div>
                     </div>
                </div>
              </div>
          </div>
      )}

      {/* Upcoming Payments Tab */}
      {activeTab === 'upcoming' && (
        <div className="space-y-4 animate-fade-in" onClick={() => setActiveActionMenu(null)}>
            {upcomingAndOverduePayments.length === 0 ? (
                <div className="text-center py-16 bg-white rounded-2xl border border-dashed border-slate-200 text-slate-400">Нет просроченных или ближайших платежей.</div>
            ) : (
                upcomingAndOverduePayments.map(p => (
                    <div key={p.sale.id} className="bg-white p-4 rounded-xl shadow-sm relative">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className={`p-3 rounded-full ${p.isTomorrow ? 'bg-amber-100 text-amber-600' : 'bg-red-100 text-red-600'}`}>
                                    {p.isTomorrow ? ICONS.Clock : ICONS.Alert}
                                </div>
                                <div>
                                    <p className="font-bold text-slate-800">{p.customerName}</p>
                                    <p className="text-xs text-slate-500">{p.sale.productName}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="text-right">
                                    <p className="text-lg font-bold text-indigo-600">{p.totalDue.toLocaleString()} ₽</p>
                                    {!p.isTomorrow && <p className="text-[10px] font-bold text-red-500">ЕСТЬ ДОЛГ</p>}
                                </div>
                                <button onClick={(e) => handleActionClick(e, p.sale.id)} className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg">{ICONS.More}</button>
                            </div>
                        </div>

                        {activeActionMenu === p.sale.id && (
                             <div className="absolute right-4 top-14 bg-white shadow-xl rounded-xl z-20 w-48 overflow-hidden animate-fade-in">
                                <button onClick={() => onSelectCustomer(p.sale.customerId)} className="w-full text-left px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-3"><span className="text-indigo-500">{ICONS.Customers}</span> Инфо</button>
                                <button onClick={() => onInitiatePayment(p.sale, p.totalDue)} className="w-full text-left px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-3"><span className="text-emerald-500">{ICONS.AddSmall}</span> Добавить платеж</button>
                            </div>
                        )}
                    </div>
                ))
            )}
        </div>
      )}

      {selectedSaleForModal && (
          <SaleDetailsModal 
              sale={selectedSaleForModal}
              customerName={customers.find(c => c.id === selectedSaleForModal.customerId)?.name || ''}
              onClose={() => setSelectedSaleForModal(null)}
          />
      )}
    </div>
  );
};

export default Dashboard;