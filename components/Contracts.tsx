import React, { useMemo, useState, useEffect } from 'react';
import { Sale, Customer, Account, User, AppSettings } from '../types';
import { ICONS } from '../constants';
import { Phone } from 'lucide-react';
import { formatCurrency, formatDate } from '../src/utils';
import { createPortal } from 'react-dom';

interface ContractsProps {
  sales: Sale[];
  customers: Customer[];
  accounts: Account[];
  activeTab: 'ACTIVE' | 'OVERDUE' | 'ARCHIVE';
  onTabChange: (tab: 'ACTIVE' | 'OVERDUE' | 'ARCHIVE') => void;
  onViewSchedule: (sale: Sale) => void;
  onEditSale: (sale: Sale) => void;
  onDeleteSale: (saleId: string) => void;
  readOnly?: boolean;
  user?: User | null;
  appSettings?: AppSettings;
}

const ContractInfoModal = ({ sale, customer, onClose, appSettings }: { sale: Sale, customer?: Customer, onClose: () => void, appSettings?: AppSettings }) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const monthlyPayment = sale.paymentPlan.length > 0 ? sale.paymentPlan[0].amount : 0;
    const paidMonths = sale.paymentPlan.filter(p => p.isPaid).length;

    let expectedPaidByNow = sale.downPayment;
    sale.paymentPlan.forEach(p => {
        if (new Date(p.date) < today) {
            expectedPaidByNow += p.amount;
        }
    });

    const actualPaidTotal = sale.totalAmount - sale.remainingAmount;
    const realOverdueAmount = Math.max(0, expectedPaidByNow - actualPaidTotal);

    const overduePaymentsList = sale.paymentPlan.filter(p => !p.isPaid && new Date(p.date) < today);
    const overdueMonths = overduePaymentsList.length;

    const nextUnpaidPayment = sale.paymentPlan.find(p => !p.isPaid && new Date(p.date) >= today);
    const nextPaymentDate = nextUnpaidPayment ? formatDate(nextUnpaidPayment.date) : (sale.remainingAmount > 0 ? 'Просрочен' : 'Закрыт');

    const handleCall = () => {
        if (customer?.phone) {
            window.open(`tel:${customer.phone}`);
        }
    };

    const handleWhatsApp = () => {
        if (customer?.phone) {
            const phone = customer.phone.replace(/[^0-9]/g, '');
            const text = `Здравствуйте, ${customer.name}. Напоминаем о задолженности по договору "${sale.productName}" в размере ${formatCurrency(realOverdueAmount, appSettings?.showCents)} ₽.`;
            window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank');
        }
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in" onClick={onClose}>
            <div className="bg-white w-full max-w-md rounded-2xl overflow-hidden shadow-xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="px-5 py-4 bg-blue-600 flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-white">Детали договора</h3>
                    <button onClick={onClose} className="text-white/80 hover:text-white text-2xl leading-none">&times;</button>
                </div>

                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                    <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Товар</p>
                        <p className="font-medium text-gray-900 text-base">{sale.productName}</p>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <p className="text-xs text-gray-500">Срок</p>
                            <p className="font-semibold text-gray-900">{sale.installments} мес.</p>
                        </div>
                        <div>
                            <p className="text-xs text-gray-500">Платеж/мес</p>
                            <p className="font-semibold text-gray-900">{formatCurrency(monthlyPayment, false)} ₽</p>
                        </div>
                        <div>
                            <p className="text-xs text-gray-500">Оплачено</p>
                            <p className="font-semibold text-emerald-600">{paidMonths} из {sale.installments}</p>
                        </div>
                        <div>
                            <p className="text-xs text-gray-500">След. платеж</p>
                            <p className="font-semibold text-blue-600 text-sm">{nextPaymentDate}</p>
                        </div>
                    </div>

                    <div className="bg-red-50 rounded-xl p-4 space-y-2">
                        <div className="flex justify-between items-center">
                            <p className="text-xs text-red-600 font-medium">Просрочка</p>
                            <p className="font-bold text-red-600 text-lg">{formatCurrency(realOverdueAmount, false)} ₽</p>
                        </div>
                        <div className="flex justify-between items-center pt-2 border-t border-red-100">
                            <p className="text-xs text-gray-600">Остаток долга</p>
                            <p className="font-semibold text-gray-800">{formatCurrency(sale.remainingAmount, false)} ₽</p>
                        </div>
                        {overdueMonths > 0 && (
                            <p className="text-xs text-red-500 mt-1">Просрочено {overdueMonths} платежей</p>
                        )}
                    </div>

                    {overduePaymentsList.length > 0 && (
                        <div>
                            <p className="text-xs font-medium text-gray-500 mb-2">Пропущенные платежи</p>
                            <div className="space-y-1 max-h-28 overflow-y-auto">
                                {overduePaymentsList.map(p => (
                                    <div key={p.id} className="flex justify-between text-sm py-1 border-b border-gray-100">
                                        <span className="text-gray-600">{formatDate(p.date)}</span>
                                        <span className="text-red-500 font-medium">{formatCurrency(p.amount, false)} ₽</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                <div className="p-4 border-t border-gray-100 flex gap-3">
                    <button onClick={handleCall} className="flex-1 py-3 bg-blue-500 text-white rounded-xl font-medium text-sm flex items-center justify-center gap-2 active:scale-95 transition-transform">
                        <Phone size={16} /> Звонок
                    </button>
                    <button onClick={handleWhatsApp} className="flex-1 py-3 bg-green-500 text-white rounded-xl font-medium text-sm flex items-center justify-center gap-2 active:scale-95 transition-transform">
                        {ICONS.Send} WhatsApp
                    </button>
                </div>
            </div>
        </div>
    );
};

const Contracts: React.FC<ContractsProps> = ({
    sales, customers, accounts, activeTab, onTabChange,
    onViewSchedule, onEditSale, onDeleteSale, readOnly = false,
    user, appSettings
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const [filterAccountId, setFilterAccountId] = useState('');
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [deletingSale, setDeletingSale] = useState<Sale | null>(null);
  const [selectedSaleForInfo, setSelectedSaleForInfo] = useState<Sale | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number, right: number } | null>(null);
  const [currentMenuSale, setCurrentMenuSale] = useState<Sale | null>(null);

  const getCustomerName = (id: string) => customers.find(c => c.id === id)?.name || 'Неизвестно';

  const calculateSaleOverdue = (sale: Sale) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let expectedTotal = sale.downPayment;
    sale.paymentPlan.forEach(p => {
        if (!p.isRealPayment && new Date(p.date) < today) {
            expectedTotal += p.amount;
        }
    });

    const totalPaid = sale.totalAmount - sale.remainingAmount;
    return Math.max(0, expectedTotal - totalPaid);
  };

  const { filteredList } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const active: Sale[] = [];
    const overdue: Sale[] = [];
    const archive: Sale[] = [];

    const customerIdSet = new Set(customers.map(c => c.id));
    const actualSales = sales.filter(sale => customerIdSet.has(sale.customerId));

    actualSales.forEach(sale => {
        if (sale.status === 'COMPLETED' || sale.remainingAmount === 0) {
            archive.push(sale);
            return;
        }
        if (calculateSaleOverdue(sale) > 0) overdue.push(sale);
        else active.push(sale);
    });

    let list = activeTab === 'ACTIVE' ? active : activeTab === 'OVERDUE' ? overdue : archive;

    if (searchTerm) {
        const lowerTerm = searchTerm.toLowerCase();
        list = list.filter(sale => {
            const customer = customers.find(c => c.id === sale.customerId);
            return (
                (customer && customer.name.toLowerCase().includes(lowerTerm)) ||
                (sale.productName.toLowerCase().includes(lowerTerm))
            );
        });
    }

    if (filterDate) list = list.filter(sale => sale.startDate.startsWith(filterDate));
    if (filterAccountId) list = list.filter(sale => sale.accountId === filterAccountId);

    return {
        filteredList: list.sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime()),
    };
  }, [sales, customers, activeTab, searchTerm, filterDate, filterAccountId]);

  const totalOverdueSum = useMemo(() => {
    if (activeTab !== 'OVERDUE') return 0;
    return filteredList.reduce((sum, s) => sum + calculateSaleOverdue(s), 0);
  }, [filteredList, activeTab]);

  const handleActionClick = (e: React.MouseEvent, sale: Sale) => {
      e.stopPropagation();

      if (activeMenuId === sale.id) {
          setActiveMenuId(null);
          setMenuPosition(null);
          setCurrentMenuSale(null);
          return;
      }

      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const menuHeight = 200;
      const spaceBelow = window.innerHeight - rect.bottom;

      const topPosition = spaceBelow < menuHeight
          ? rect.top + window.scrollY - menuHeight + 30
          : rect.bottom + window.scrollY + 8;

      setMenuPosition({
          top: topPosition,
          right: window.innerWidth - rect.right
      });

      setActiveMenuId(sale.id);
      setCurrentMenuSale(sale);
  };

  const handleDeleteConfirm = () => {
      if (deletingSale) {
          onDeleteSale(deletingSale.id);
          setDeletingSale(null);
      }
  }

  const ActionMenu = () => {
      if (!currentMenuSale || !menuPosition) return null;

      return (
          <div
              className="fixed bg-white rounded-xl shadow-xl z-[100] w-48 overflow-hidden border border-gray-100"
              style={{
                  top: `${menuPosition.top}px`,
                  right: `${menuPosition.right}px`
              }}
              onClick={e => e.stopPropagation()}
          >
              <button onClick={() => { setSelectedSaleForInfo(currentMenuSale); setActiveMenuId(null); }} className="w-full px-4 py-3 text-left text-sm hover:bg-gray-50 flex items-center gap-2">
                <span className="text-blue-500">{ICONS.File}</span> Инфо
              </button>
              <button onClick={() => { onViewSchedule(currentMenuSale); setActiveMenuId(null); }} className="w-full px-4 py-3 text-left text-sm hover:bg-gray-50 flex items-center gap-2">
                <span className="text-indigo-500">{ICONS.List}</span> График
              </button>
              <button onClick={() => { onEditSale(currentMenuSale); setActiveMenuId(null); }} className="w-full px-4 py-3 text-left text-sm hover:bg-gray-50 flex items-center gap-2">
                <span className="text-gray-500">{ICONS.Edit}</span> Редактировать
              </button>
              <button onClick={() => { setDeletingSale(currentMenuSale); setActiveMenuId(null); }} className="w-full px-4 py-3 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2 border-t border-gray-100">
                <span>{ICONS.Delete}</span> Удалить
              </button>
          </div>
      );
  };

  useEffect(() => {
      const handleClickOutside = () => {
          if (activeMenuId) {
              setActiveMenuId(null);
              setMenuPosition(null);
              setCurrentMenuSale(null);
          }
      };

      if (activeMenuId) {
          document.addEventListener('click', handleClickOutside);
      }

      return () => {
          document.removeEventListener('click', handleClickOutside);
      };
  }, [activeMenuId]);

  return (
    <div className="space-y-4 pb-20 px-4" onClick={() => setActiveMenuId(null)}>

      {activeTab === 'OVERDUE' && (
        <div className="bg-red-50 rounded-2xl p-4">
          <div className="flex justify-between items-center mb-2">
            <p className="text-sm font-medium text-red-600">Просроченные договоры</p>
            <span className="text-xs text-red-500">{filteredList.length} шт.</span>
          </div>
          <p className="text-2xl font-bold text-red-600">{formatCurrency(totalOverdueSum, false)} ₽</p>
        </div>
      )}

      {/* Компактная поисковая строка */}
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">{ICONS.Users}</span>
          <input
            type="text"
            placeholder="Поиск..."
            className="w-full pl-8 pr-3 py-2.5 bg-white rounded-xl border border-gray-200 text-sm focus:border-blue-500 focus:outline-none"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>
        <button className="px-3 py-2.5 bg-gray-100 rounded-xl text-gray-600 text-sm">
          {ICONS.Filter}
        </button>
      </div>

      {/* Компактные карточки */}
      <div className="space-y-3">
        {filteredList.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm">
            Нет договоров
          </div>
        ) : (
          filteredList.map((sale, index) => {
            const progress = sale.totalAmount > 0 ? ((sale.totalAmount - sale.remainingAmount) / sale.totalAmount) * 100 : 0;
            const overdueSum = calculateSaleOverdue(sale);
            const isOverdue = activeTab === 'OVERDUE';

            return (
              <div
                key={sale.id}
                className="bg-white rounded-xl shadow-sm border border-gray-100 active:bg-gray-50 transition-colors"
              >
                <div className="p-3">
                  {/* Верхняя часть с именем и суммой */}
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-gray-900 text-base truncate">
                        {getCustomerName(sale.customerId)}
                      </h3>
                      <p className="text-xs text-gray-500 truncate mt-0.5">{sale.productName}</p>
                    </div>

                    <div className="flex items-center gap-2 ml-2">
                      <div className="text-right">
                        {isOverdue ? (
                          <p className="font-bold text-red-600 text-sm">
                            {formatCurrency(overdueSum, false)} ₽
                          </p>
                        ) : (
                          <p className="font-semibold text-gray-900 text-sm">
                            {formatCurrency(sale.totalAmount, false)} ₽
                          </p>
                        )}
                        <p className="text-[10px] text-gray-400">{formatDate(sale.startDate)}</p>
                      </div>

                      {!readOnly && (
                        <button
                          onClick={(e) => handleActionClick(e, sale)}
                          className="p-1.5 text-gray-400 hover:text-blue-500 active:bg-gray-100 rounded-lg"
                        >
                          {ICONS.More}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Прогресс-бар */}
                  <div className="mt-2">
                    <div className="w-full bg-gray-100 rounded-full h-1.5">
                      <div
                        className={`h-1.5 rounded-full transition-all ${isOverdue ? 'bg-red-500' : 'bg-blue-500'}`}
                        style={{ width: `${Math.min(progress, 100)}%` }}
                      ></div>
                    </div>
                    <div className="flex justify-between text-[10px] text-gray-400 mt-1">
                      <span>{formatCurrency(sale.totalAmount - sale.remainingAmount, false)} ₽</span>
                      <span>{Math.round(progress)}%</span>
                      {!isOverdue && <span>{formatCurrency(sale.remainingAmount, false)} ₽</span>}
                    </div>
                  </div>

                  {/* Дополнительная информация */}
                  <div className="flex justify-between items-center mt-2 pt-2 border-t border-gray-50">
                    <div className="flex items-center gap-3 text-xs text-gray-500">
                      <span>{sale.installments} мес.</span>
                      <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
                      <span className="text-emerald-600">{sale.paymentPlan.filter(p => p.isPaid).length} оплачено</span>
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                      isOverdue ? 'bg-red-100 text-red-600' : 
                      sale.status === 'COMPLETED' ? 'bg-gray-100 text-gray-600' : 'bg-blue-100 text-blue-600'
                    }`}>
                      {isOverdue ? 'Просрочка' : sale.status === 'COMPLETED' ? 'Закрыт' : 'Активен'}
                    </span>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      {activeMenuId && menuPosition && createPortal(
        <ActionMenu />,
        document.body
      )}

      {deletingSale && !readOnly && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setDeletingSale(null)}>
          <div className="bg-white w-80 rounded-2xl p-6" onClick={e => e.stopPropagation()}>
            <div className="text-center mb-4">
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-3">
                {ICONS.Delete}
              </div>
              <h3 className="font-semibold text-gray-900">Удалить договор?</h3>
              <p className="text-xs text-gray-500 mt-1">Действие необратимо</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setDeletingSale(null)} className="flex-1 py-2.5 bg-gray-100 rounded-xl text-sm font-medium">
                Отмена
              </button>
              <button onClick={handleDeleteConfirm} className="flex-1 py-2.5 bg-red-500 text-white rounded-xl text-sm font-medium">
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedSaleForInfo && (
        <ContractInfoModal
          sale={selectedSaleForInfo}
          customer={customers.find(c => c.id === selectedSaleForInfo.customerId)}
          onClose={() => setSelectedSaleForInfo(null)}
          appSettings={appSettings}
        />
      )}
    </div>
  );
};

export default Contracts;