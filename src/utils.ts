import { Account, Investor, InvestmentPeriod } from '../types';

export const escapeHtml = (str: unknown): string =>
  String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

// Участвовал ли инвестор в пуле на момент cutoff.
// Если задан investmentPeriods — проверяем по списку периодов (поддержка повторного входа).
// Иначе — legacy-поведение: один joinedDate / leftPoolDate.
const isPoolMemberActiveAt = (investor: Investor, cutoff: number): boolean => {
  if (investor.investmentPeriods && investor.investmentPeriods.length > 0) {
    return investor.investmentPeriods.some(p => {
      const joined = new Date(p.joinedDate).getTime();
      const left = p.leftPoolDate ? new Date(p.leftPoolDate).getTime() : Infinity;
      return joined <= cutoff && cutoff < left;
    });
  }
  if (new Date(investor.joinedDate).getTime() > cutoff) return false;
  if (investor.leftPoolDate && new Date(investor.leftPoolDate).getTime() <= cutoff) return false;
  return true;
};

// Сумма вложения инвестора на момент cutoff — из активного периода.
// Нужна при поддержке нескольких периодов (разные суммы в разные периоды).
const getInvestorAmountAt = (investor: Investor, cutoff: number): number => {
  if (investor.investmentPeriods && investor.investmentPeriods.length > 0) {
    const active = investor.investmentPeriods.find(p => {
      const joined = new Date(p.joinedDate).getTime();
      const left = p.leftPoolDate ? new Date(p.leftPoolDate).getTime() : Infinity;
      return joined <= cutoff && cutoff < left;
    });
    return active ? active.initialAmount : 0;
  }
  return investor.initialAmount;
};

// Возвращает активный период инвестора на момент cutoff (или undefined).
export const getActivePeriodAt = (investor: Investor, cutoff: number): InvestmentPeriod | null => {
  if (investor.investmentPeriods && investor.investmentPeriods.length > 0) {
    return investor.investmentPeriods.find(p => {
      const joined = new Date(p.joinedDate).getTime();
      const left = p.leftPoolDate ? new Date(p.leftPoolDate).getTime() : Infinity;
      return joined <= cutoff && cutoff < left;
    }) ?? null;
  }
  const legacy: InvestmentPeriod = {
    id: 'legacy',
    joinedDate: investor.joinedDate,
    leftPoolDate: investor.leftPoolDate,
    initialAmount: investor.initialAmount,
  };
  return isPoolMemberActiveAt(investor, cutoff) ? legacy : null;
};

// 🔒 Единая точка расчёта долей прибыли по счёту.
// Обычный счёт инвестора (ownerId) — доля равна его фиксированному profitPercentage, как и раньше.
// Общий пул (type === 'POOL', BUSINESS_PRO) — двухэтапно: (1) прибыль сначала делится между
// участниками ПРОПОРЦИОНАЛЬНО ИХ КАПИТАЛУ (какая часть общей прибыли "приходится" на деньги
// именно этого инвестора), (2) к этой капитал-части применяется ЕГО СОБСТВЕННЫЙ индивидуальный
// процент (Investor.profitPercentage) — у каждого инвестора пула свой процент, единого процента
// на весь пул нет. Итоговая доля инвестора от общей прибыли = (его_капитал / общий_капитал) ×
// его_процент. Доля менеджера — как и для обычного счёта — просто остаток до 100%.
//
// asOfDate — на какую дату считать состав и суммы пула. Это критично для истории:
// если инвестор присоединился к пулу позже, он не должен задним числом получать долю
// от прибыли, полученной ДО его вступления — поэтому при расчёте конкретного платежа
// нужно передавать дату этого платежа, а не "сегодня". Участники, чей joinedDate позже
// asOfDate, в расчёт не попадают вовсе (их ещё не было в пуле на тот момент).
export const getAccountShares = (
  account: Account | undefined,
  investors: Investor[],
  asOfDate?: string | number | Date
): { investor: Investor; percentage: number }[] => {
  if (!account) return [];
  if (account.type === 'POOL') {
    const cutoff = asOfDate ? new Date(asOfDate).getTime() : Date.now();
    const members = (account.poolMemberIds || [])
      .map(id => investors.find(i => i.id === id))
      .filter((i): i is Investor => !!i && isPoolMemberActiveAt(i, cutoff));
    const totalCapital = members.reduce((sum, inv) => sum + getInvestorAmountAt(inv, cutoff), 0);
    if (totalCapital <= 0) {
      // Суммы не заданы — используем profitPercentage как фиксированный процент напрямую
      return members.map(investor => ({ investor, percentage: investor.profitPercentage || 0 }));
    }
    return members.map(investor => {
      const capitalShare = getInvestorAmountAt(investor, cutoff) / totalCapital; // 0..1
      return { investor, percentage: capitalShare * (investor.profitPercentage || 0) };
    });
  }
  if (account.ownerId) {
    const investor = investors.find(i => i.id === account.ownerId);
    return investor ? [{ investor, percentage: investor.profitPercentage || 0 }] : [];
  }
  return [];
};

// Остаток % после долей всех инвесторов счёта (на дату asOfDate) — достаётся менеджеру.
// Единая формула для всех типов счёта, включая POOL: доля каждого инвестора там уже учитывает
// и его капитал-долю, и его личный процент (см. getAccountShares), поэтому остаток считается так же просто.
export const getManagerSharePercent = (account: Account | undefined, investors: Investor[], asOfDate?: string | number | Date): number => {
  const totalInvestorShare = getAccountShares(account, investors, asOfDate).reduce((sum, m) => sum + m.percentage, 0);
  return Math.max(0, 100 - totalInvestorShare);
};

// Доля КАПИТАЛА конкретного инвестора в счёте (0..1), в отличие от getAccountShares — без учёта
// его личного процента прибыли. Нужна, когда требуется выделить долю МЕНЕДЖЕРА, относящуюся именно
// к капиталу этого инвестора: profitFromPayment × capitalShare × (100% − его_процент) / 100 —
// см. использование в App.tsx reportData при фильтрации отчёта по одному инвестору из пула.
export const getInvestorCapitalShare = (
  account: Account | undefined,
  investorId: string,
  investors: Investor[],
  asOfDate?: string | number | Date
): number => {
  if (!account) return 0;
  if (account.type === 'POOL') {
    const cutoff = asOfDate ? new Date(asOfDate).getTime() : Date.now();
    const members = (account.poolMemberIds || [])
      .map(id => investors.find(i => i.id === id))
      .filter((i): i is Investor => !!i && isPoolMemberActiveAt(i, cutoff));
    const totalCapital = members.reduce((sum, inv) => sum + getInvestorAmountAt(inv, cutoff), 0);
    if (totalCapital <= 0) return 0;
    const investor = members.find(i => i.id === investorId);
    return investor ? getInvestorAmountAt(investor, cutoff) / totalCapital : 0;
  }
  return account.ownerId === investorId ? 1 : 0;
};

// Участвует ли данный инвестор в этом счёте — как единоличный владелец или как участник пула.
export const isAccountForInvestor = (account: Account, investorId: string): boolean => {
  return account.ownerId === investorId || (account.type === 'POOL' && (account.poolMemberIds || []).includes(investorId));
};

// Счёт, в котором участвует данный инвестор — свой отдельный (ownerId) или общий пул (poolMemberIds).
export const getInvestorAccount = (investorId: string, accounts: Account[]): Account | undefined => {
  return accounts.find(a => isAccountForInvestor(a, investorId));
};

export const formatCurrency = (amount: number | undefined | null, showCents: boolean = true): string => {
  if (amount === undefined || amount === null || isNaN(amount)) {
    return '0';
  }
  return amount.toLocaleString('ru-RU', {
    minimumFractionDigits: showCents ? 2 : 0,
    maximumFractionDigits: showCents ? 2 : 0,
  });
};

export const formatDate = (dateString: string | undefined | null): string => {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleDateString('ru-RU');
};

export const getSellerPhone = (user: any): string => {
  // 🔥 Читаем ПРЯМО СЕЙЧАС из localStorage
  const appSettings = JSON.parse(localStorage.getItem('appSettings') || '{}');
  
  // Приоритет: user.phone → appSettings.sellerPhone → appSettings.companyPhone → заглушка
  return user?.phone || 
         appSettings?.sellerPhone || 
         appSettings?.companyPhone || 
         "+7 (___) ___-__-__";
};

// Распределение УБЫТКА пула по принципу аль-гунм биль-гурм (الغنم بالغرم).
// В отличие от getAccountShares, здесь учитывается только КАПИТАЛ (без profitPercentage),
// т.к. по нормам мудараба/мушарака убыток несут вкладчики пропорционально капиталу.
// Менеджер (мудариб) несёт убыток трудом/временем — финансово не входит в расчёт.
export const getCapitalShares = (
  account: Account | undefined,
  investors: Investor[],
  asOfDate?: string | number | Date
): { investor: Investor; percentage: number }[] => {
  if (!account || account.type !== 'POOL') {
    if (account?.ownerId) {
      const inv = investors.find(i => i.id === account.ownerId);
      return inv ? [{ investor: inv, percentage: 100 }] : [];
    }
    return [];
  }
  const cutoff = asOfDate ? new Date(asOfDate).getTime() : Date.now();
  const members = (account.poolMemberIds || [])
    .map(id => investors.find(i => i.id === id))
    .filter((i): i is Investor => !!i && isPoolMemberActiveAt(i, cutoff));
  const totalCapital = members.reduce((sum, inv) => sum + getInvestorAmountAt(inv, cutoff), 0);
  if (totalCapital <= 0) return [];
  return members.map(investor => ({
    investor,
    percentage: getInvestorAmountAt(investor, cutoff) / totalCapital * 100,
  }));
};

// Добавьте эту функцию внутри компонента или вынесите в utils
const normalizePhoneForWhatsApp = (phone: string): string => {
  // Удаляем все нецифровые символы
  let cleaned = phone.replace(/[^0-9]/g, '');

  // Если номер начинается с 8 (российский формат), заменяем на 7
  if (cleaned.startsWith('8') && cleaned.length === 11) {
    cleaned = '7' + cleaned.slice(1);
  }

  // Если номер начинается с +7 (уже с плюсом, но мы удалили его), убеждаемся что первая цифра 7
  if (cleaned.startsWith('7') && cleaned.length === 11) {
    return cleaned;
  }

  // Если номер короче или длиннее 11 цифр — возвращаем как есть (возможно, международный)
  return cleaned;
};