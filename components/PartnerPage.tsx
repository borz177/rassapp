import React from 'react';
import PartnerEarnings from './PartnerEarnings';
import TopBarBack from './TopBarBack';

/**
 * Страница бизнес-партнёра.
 *
 * Раньше блок с заработком жил на реферальной странице, среди бонусных дней.
 * Это разные вещи: дни — массовая программа для всех, деньги — договорённость с
 * конкретным человеком. Смешанные на одном экране, они путали и то и другое,
 * поэтому у партнёрства теперь своя страница.
 */
const PartnerPage: React.FC<{ onBack: () => void }> = ({ onBack }) => (
  <div className="space-y-5 pb-10">
    <div className="flex items-center gap-3">
      <TopBarBack onClick={onBack} />
      <div className="min-w-0">
        <h2 className="text-xl font-bold text-slate-800 dark:text-white">Бизнес-партнёр</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">Ваш заработок с приведённых клиентов</p>
      </div>
    </div>

    <PartnerEarnings />
  </div>
);

export default PartnerPage;
