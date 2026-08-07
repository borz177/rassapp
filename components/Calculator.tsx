import React, { useState, useMemo, useEffect } from 'react';
import { ICONS } from '../constants';
import { AppSettings, TermRate } from '../types';
import { api } from '../services/api';

const MONTHS_RU = ['января','февраля','марта','апреля','мая','июня',
                   'июля','августа','сентября','октября','ноября','декабря'];

const fmtMoney = (n: number) => Math.round(n).toLocaleString('ru-RU');

// Платёж без округления почти всегда получается дробным (50 000 / 3 = 16 666,67).
// Показывать его округлённым нельзя: сумма платежей тогда не сойдётся с «Итого»,
// и клиент справедливо спросит, откуда взялась разница.
const fmtPayment = (n: number) =>
  Number.isInteger(n)
    ? n.toLocaleString('ru-RU')
    : n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate  = (d: Date)   => `${d.getDate()} ${MONTHS_RU[d.getMonth()]} ${d.getFullYear()}`;

// Верхний предел срока: график строится построчно, и без ограничения опечатка вроде
// «1200» подвесила бы страницу тысячей строк.
const MAX_MONTHS = 120;

const ROUND_OPTIONS: { value: number; label: string }[] = [
  { value: 0,    label: 'Как есть' },
  { value: 100,  label: '100 ₽' },
  { value: 500,  label: '500 ₽' },
  { value: 1000, label: '1000 ₽' },
];

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

function drawRRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

interface CalculatorProps {
  isPublic?: boolean;
  appSettings?: AppSettings;
  userPhone?: string;
  onBack?: () => void;
  onSaveSettings?: (settings: any) => void;
}

const Calculator: React.FC<CalculatorProps> = ({ isPublic = false, appSettings, userPhone, onBack, onSaveSettings }) => {
  const searchParams = new URLSearchParams(window.location.search);
  const pathName = window.location.pathname;
  const configId = searchParams.get('cfg');

  let publicCompany = searchParams.get('c') || searchParams.get('company') || appSettings?.companyName || 'Наша Компания';
  if (pathName.startsWith('/calc/')) {
    const parts = pathName.split('/');
    if (parts.length >= 3 && parts[2]) publicCompany = decodeURIComponent(parts[2]);
  }

  const { publicRate, publicRules } = useMemo(() => {
    const rate = parseFloat(searchParams.get('r') || searchParams.get('rate') || '30');
    const rulesParam = searchParams.get('rules');
    const shortRulesParam = searchParams.get('l');
    let rules: TermRate[] = [];
    try {
      if (rulesParam) {
        rules = JSON.parse(decodeURIComponent(rulesParam));
      } else if (shortRulesParam) {
        rules = shortRulesParam.split(',').map(pair => {
          const [m, r] = pair.split(':').map(Number);
          return { months: m, rate: r };
        }).filter(r => !isNaN(r.months) && !isNaN(r.rate));
      }
    } catch (e) {}
    return { publicRate: rate, publicRules: rules };
  }, [searchParams.toString()]);

  const [price, setPrice]           = useState<string>('');
  const [months, setMonths]         = useState<number>(3);
  // 0 — платёж как есть; 100/500/1000 — округление до этого шага
  const [roundStep, setRoundStep]   = useState<number>(0);
  // Куда округлять: вверх (продавец добирает) или вниз (уступка клиенту)
  const [roundDir, setRoundDir]     = useState<'up' | 'down'>('up');
  // Наценка начисляется только на остаток после первого взноса
  const [markupOnRemainder, setMarkupOnRemainder] = useState<boolean>(false);
  const [downPayment, setDownPayment] = useState<string>('');
  const [customRate, setCustomRate] = useState<string>('');
  const [startDate, setStartDate]   = useState<string>(todayISO);
  const [showSchedule, setShowSchedule] = useState(true);
  const [isSharing, setIsSharing]   = useState(false);

  const [defaultRate, setDefaultRate] = useState<string>(appSettings?.calculator?.defaultInterestRate?.toString() || '30');
  const [termRates, setTermRates]     = useState<TermRate[]>(appSettings?.calculator?.termRates || []);
  const [showSettings, setShowSettings] = useState(false);
  const [isLoadingConfig, setIsLoadingConfig] = useState(false);
  const [newRuleMonth, setNewRuleMonth] = useState<number>(3);
  const [newRuleRate, setNewRuleRate]   = useState<string>('');
  const [sellerPhone, setSellerPhone]   = useState<string>('');

  useEffect(() => {
    if (configId && !isLoadingConfig) {
      setIsLoadingConfig(true);
      api.getCalculatorConfig(configId)
        .then(config => {
          if (config) {
            setDefaultRate(config.defaultRate.toString());
            setTermRates(config.termRates || []);
            setSellerPhone(config.sellerPhone || '');
            // Правила расчёта берём из ссылки, чтобы клиент увидел ровно ту сумму,
            // которую посчитал менеджер
            if (config.roundStep !== undefined) setRoundStep(config.roundStep);
            if (config.roundDir !== undefined) setRoundDir(config.roundDir);
            if (config.markupOnRemainder !== undefined) setMarkupOnRemainder(config.markupOnRemainder);
          }
        })
        .catch(() => {
          if (publicRate) setDefaultRate(publicRate.toString());
          if (publicRules.length > 0) setTermRates(publicRules);
        })
        .finally(() => setIsLoadingConfig(false));
    }
  }, [configId]);

  const activeRate = useMemo(() => {
    const ratesToUse = isPublic ? (termRates.length > 0 ? termRates : publicRules) : termRates;
    const baseRate   = parseFloat(defaultRate);
    const specific   = ratesToUse?.find(r => r.months === months);
    return specific ? specific.rate : baseRate;
  }, [months, termRates, defaultRate, isPublic, publicRules]);

  // Если пользователь ввёл свою наценку — используем её, иначе из настроек ставок
  const effectiveRate = customRate !== '' ? (parseFloat(customRate) || 0) : activeRate;

  const result = useMemo(() => {
    const p  = parseFloat(price) || 0;
    const dp = Math.min(parseFloat(downPayment) || 0, p); // взнос не может быть больше цены
    const rate = effectiveRate / 100;

    // Два способа начислить наценку:
    //  • markupOnRemainder — только на то, что реально уходит в рассрочку (цена минус взнос).
    //    Клиент не переплачивает за часть, которую уже оплатил наличными.
    //  • обычный — на всю цену товара, взнос лишь уменьшает остаток к выплате.
    const markupBase = markupOnRemainder ? p - dp : p;
    const markup     = markupBase * rate;
    const remaining  = markupOnRemainder ? (p - dp) + markup : (p + markup) - dp;

    const monthly = months > 0 ? remaining / months : 0;
    // step === 0 — платёж как есть, без подгонки. Округление вниз не должно уводить
    // платёж в ноль на маленьких суммах, поэтому держим минимум в один шаг.
    const roundedMonthly = roundStep > 0
      ? (roundDir === 'down'
          ? Math.max(Math.floor(monthly / roundStep) * roundStep, monthly > 0 ? roundStep : 0)
          : Math.ceil(monthly / roundStep) * roundStep)
      : monthly;

    return {
      markup,
      total:        p + markup,          // полная стоимость товара с наценкой
      monthly:      roundedMonthly,
      totalPayable: roundedMonthly * months + dp,
      // Сколько клиент заплатил бы без округления — разница с totalPayable и есть надбавка
      exactTotal:   monthly * months + dp,
    };
  }, [price, months, downPayment, effectiveRate, roundStep, roundDir, markupOnRemainder]);

  // График платежей
  const paymentSchedule = useMemo(() => {
    const p = parseFloat(price);
    if (!p || p <= 0 || months <= 0 || result.monthly <= 0) return [];
    const base    = new Date(startDate);
    const baseDay = base.getDate(); // день начала — сохраняем для клампинга (30 → последний день февраля)
    const dp      = parseFloat(downPayment || '0');
    const rows: { num: number; date: Date; amount: number; isDownPayment: boolean }[] = [];
    if (dp > 0) {
      rows.push({ num: 0, date: new Date(base), amount: dp, isDownPayment: true });
    }
    for (let i = 0; i < months; i++) {
      const d = new Date(base);
      d.setDate(1); // сбрасываем до 1-го, чтобы не было переполнения месяца
      d.setMonth(d.getMonth() + i + 1);
      // Клампим день: если в целевом месяце меньше дней (напр. февраль), берём последний день
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(baseDay, lastDay));
      rows.push({ num: i + 1, date: d, amount: result.monthly, isDownPayment: false });
    }
    return rows;
  }, [price, months, startDate, downPayment, result.monthly]);

  // Генерация изображения для "Поделиться"
  const handleShare = async () => {
    if (!parseFloat(price)) { alert('Введите стоимость товара'); return; }
    setIsSharing(true);
    try {
      const canvas = document.createElement('canvas');
      // 2× разрешение для чёткости на Retina/высокоплотных экранах
      const SCALE = 2;
      const W  = 640;
      const PH = 56;
      const H  = 130 + 150 + 60 + paymentSchedule.length * PH + 24;
      canvas.width  = W * SCALE;
      canvas.height = H * SCALE;
      canvas.style.width  = `${W}px`;
      canvas.style.height = `${H}px`;
      const ctx = canvas.getContext('2d')!;
      ctx.scale(SCALE, SCALE);

      // Фон
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(0, 0, W, H);

      // ── Шапка ────────────────────────────────────────────────────
      const hGrad = ctx.createLinearGradient(0, 0, W, 0);
      hGrad.addColorStop(0, '#4f46e5');
      hGrad.addColorStop(1, '#7c3aed');
      ctx.fillStyle = hGrad;
      ctx.fillRect(0, 0, W, 120);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 24px Arial, sans-serif';
      ctx.fillText(publicCompany, 36, 52);

      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = '14px Arial, sans-serif';
      ctx.fillText(`${months} мес. • Ставка ${effectiveRate}%`, 36, 80);

      // Нижняя полоса шапки — ежемесячный платёж
      const mGrad = ctx.createLinearGradient(0, 90, 0, 120);
      mGrad.addColorStop(0, 'rgba(0,0,0,0)');
      mGrad.addColorStop(1, 'rgba(0,0,0,0.2)');
      ctx.fillStyle = mGrad;
      ctx.fillRect(0, 90, W, 30);

      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = '12px Arial, sans-serif';
      ctx.fillText('Ежемесячный платёж:', 36, 110);

      ctx.fillStyle = '#6ee7b7';
      ctx.font = 'bold 22px Arial, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(`${fmtPayment(result.monthly)} ₽/мес`, W - 36, 110);
      ctx.textAlign = 'left';

      // ── Сводка ───────────────────────────────────────────────────
      ctx.fillStyle = '#ffffff';
      drawRRect(ctx, 20, 134, W - 40, 136, 14);
      ctx.fill();

      const rows2 = [
        { label: 'Стоимость товара',        val: `${fmtMoney(parseFloat(price || '0'))} ₽`, color: '#1e293b' },
        { label: `Наценка (${effectiveRate}%)`, val: `+${fmtMoney(result.total - parseFloat(price || '0'))} ₽`, color: '#f59e0b' },
        { label: 'Первый взнос',             val: parseFloat(downPayment || '0') > 0 ? `${fmtMoney(parseFloat(downPayment))} ₽` : '—', color: '#64748b' },
        { label: 'Итого к выплате',          val: `${fmtMoney(result.totalPayable)} ₽`, color: '#4f46e5' },
      ];
      rows2.forEach((r, i) => {
        const ry = 158 + i * 28;
        ctx.fillStyle = '#94a3b8';
        ctx.font = '13px Arial, sans-serif';
        ctx.fillText(r.label, 36, ry);
        ctx.fillStyle = r.color;
        ctx.font = 'bold 13px Arial, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(r.val, W - 36, ry);
        ctx.textAlign = 'left';
      });

      // ── Заголовок графика ─────────────────────────────────────────
      const schTop = 290;
      ctx.fillStyle = '#1e293b';
      ctx.font = 'bold 15px Arial, sans-serif';
      ctx.fillText('График платежей', 36, schTop + 22);

      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(36, schTop + 32);
      ctx.lineTo(W - 36, schTop + 32);
      ctx.stroke();

      // ── Строки графика ────────────────────────────────────────────
      paymentSchedule.forEach((p, i) => {
        const ry = schTop + 40 + i * PH;
        ctx.fillStyle = i % 2 === 0 ? '#f1f5f9' : '#ffffff';
        ctx.fillRect(20, ry, W - 40, PH - 4);

        if (p.isDownPayment) {
          ctx.fillStyle = '#f59e0b';
          drawRRect(ctx, 32, ry + 10, 58, 24, 12);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 11px Arial, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('Взнос', 61, ry + 27);
        } else {
          const pillGrad = ctx.createLinearGradient(32, 0, 88, 0);
          pillGrad.addColorStop(0, '#4f46e5');
          pillGrad.addColorStop(1, '#7c3aed');
          ctx.fillStyle = pillGrad;
          ctx.beginPath();
          ctx.arc(54, ry + 22, 17, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 13px Arial, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(String(p.num), 54, ry + 27);
        }
        ctx.textAlign = 'left';

        ctx.fillStyle = '#334155';
        ctx.font = '14px Arial, sans-serif';
        ctx.fillText(fmtDate(p.date), p.isDownPayment ? 100 : 82, ry + 27);

        ctx.fillStyle = '#1e293b';
        ctx.font = 'bold 15px Arial, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(`${fmtPayment(p.amount)} ₽`, W - 28, ry + 27);
        ctx.textAlign = 'left';
      });

      // Поделиться / скачать
      await new Promise<void>((resolve) => {
        canvas.toBlob(async (blob) => {
          if (!blob) { resolve(); return; }
          const file = new File([blob], 'rassrochka.png', { type: 'image/png' });
          try {
            if (navigator.share && (navigator as any).canShare?.({ files: [file] })) {
              await navigator.share({
                files: [file],
                title: 'Расчёт рассрочки',
                text: `${publicCompany} — рассрочка ${fmtPayment(result.monthly)} ₽/мес × ${months} мес.`,
              });
            } else {
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url; a.download = 'rassrochka.png'; a.click();
              URL.revokeObjectURL(url);
            }
          } catch (e) {}
          resolve();
        }, 'image/png');
      });
    } finally {
      setIsSharing(false);
    }
  };

  const handleCopyLink = async () => {
    const companyName = encodeURIComponent(appSettings?.companyName || 'Company');
    try {
      const cfgId = await api.saveCalculatorConfig({
        defaultRate: parseFloat(defaultRate),
        termRates: termRates.map(r => ({ months: r.months, rate: r.rate })),
        roundStep,
        roundDir,
        markupOnRemainder,
      });
      if (onSaveSettings && appSettings) {
        onSaveSettings({
          ...appSettings,
          whatsapp: { ...appSettings.whatsapp, calculator: {
            defaultInterestRate: parseFloat(defaultRate),
            termRates: termRates.map(r => ({ months: r.months, rate: r.rate })),
            minDownPayment: 0,
          }},
        });
      }
      const cleanUrl = `${window.location.origin}/calc/${companyName}?cfg=${cfgId}`;
      const copied = await copyToClipboard(cleanUrl);
      if (copied) alert('✨ Ссылка скопирована!');
      else alert(`📋 Скопируйте ссылку вручную:\n\n${cleanUrl}`);
    } catch {
      alert('❌ Ошибка сохранения настроек.');
    }
  };

  const copyToClipboard = async (text: string): Promise<boolean> => {
    if (navigator.clipboard?.writeText) {
      try { await navigator.clipboard.writeText(text); return true; } catch {}
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px';
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch { return false; }
  };

  const handleSaveConfig = () => {
    if (onSaveSettings) {
      onSaveSettings({ ...appSettings, calculator: {
        defaultInterestRate: parseFloat(defaultRate),
        maxMonths: 12,
        termRates,
      }});
      setShowSettings(false);
      alert('Настройки калькулятора сохранены');
    }
  };

  const addRule = () => {
    if (!newRuleRate) return;
    const rate = parseFloat(newRuleRate);
    if (isNaN(rate)) return;
    setTermRates(prev => [...prev.filter(r => r.months !== newRuleMonth), { months: newRuleMonth, rate }].sort((a,b) => a.months - b.months));
    setNewRuleRate('');
  };

  const removeRule = (month: number) => setTermRates(prev => prev.filter(r => r.months !== month));

  const availableTerms = useMemo(() => {
    if (!isPublic) return [1,2,3,4,5,6,7,8,9,10,11,12];
    if (termRates?.length > 0) return Array.from(new Set(termRates.map(r => r.months))).sort((a: number, b: number) => a - b);
    return [1,2,3,4,5,6,7,8,9,10,11,12];
  }, [termRates, isPublic]);

  const hasPrice = parseFloat(price) > 0;

  return (
    <div className={`min-h-screen ${isPublic ? 'bg-gradient-to-br from-slate-100 to-indigo-50 dark:from-slate-900 dark:to-slate-800 flex items-start justify-center p-4 pt-6' : 'animate-fade-in pb-24'}`}>
      <div className={`bg-white dark:bg-slate-800 w-full ${isPublic ? 'max-w-md rounded-3xl shadow-2xl overflow-hidden' : 'rounded-3xl overflow-hidden'}`}>

        {/* Шапка */}
        <div className={`p-6 pb-5 ${isPublic ? 'bg-gradient-to-br from-indigo-600 to-violet-600' : ''}`}>
          <div className="flex items-center gap-3">
            {!isPublic && onBack && (
              <button onClick={onBack} className="text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200">
                {ICONS.Back}
              </button>
            )}
            <div>
              <h2 className={`text-2xl font-bold ${isPublic ? 'text-white' : 'text-slate-800 dark:text-white'}`}>
                {isPublic ? 'Калькулятор рассрочки' : 'Калькулятор'}
              </h2>
              {isPublic
                ? <p className="text-indigo-200 text-sm mt-0.5">{publicCompany}</p>
                : <p className="text-slate-500 dark:text-slate-400 text-sm">Расчёт условий и ссылка для клиента</p>}
            </div>
          </div>
        </div>

        <div className={`space-y-4 ${isPublic ? 'p-5 pt-4' : ''}`}>

          {/* Индикатор загрузки */}
          {isLoadingConfig && (
            <div className="flex items-center justify-center py-3 text-indigo-600">
              <svg className="animate-spin h-5 w-5 mr-2" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              Загрузка настроек...
            </div>
          )}

          {/* ── Поля ввода ── */}
          <div className="bg-white dark:bg-slate-800 p-5 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-700 space-y-4 overflow-hidden">

            {/* Стоимость + Наценка */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">Стоимость</label>
                <div className="relative">
                  <input
                    type="number"
                    className="w-full p-4 pr-12 text-xl font-bold border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-xl outline-none focus:border-indigo-500 transition-colors"
                    placeholder="0"
                    value={price}
                    onChange={e => setPrice(e.target.value)}
                  />
                  <span className="absolute right-4 top-4 text-slate-400 font-bold">₽</span>
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">
                  Наценка
                  {customRate === '' && <span className="ml-1 font-normal text-indigo-400 normal-case">({activeRate}%)</span>}
                </label>
                <div className="relative">
                  <input
                    type="number"
                    className="w-full p-4 pr-8 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-xl outline-none focus:border-indigo-500 transition-colors font-semibold"
                    placeholder={String(activeRate)}
                    value={customRate}
                    onChange={e => setCustomRate(e.target.value)}
                  />
                  <span className="absolute right-3 top-4 text-slate-400 text-sm">%</span>
                </div>
              </div>
            </div>

            {/* Срок + Взнос */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">Срок</label>
                {/* В публичной ссылке с правилами ставок срок выбирается только из тех,
                    для которых менеджер задал ставку — свободный ввод дал бы клиенту
                    условия, которых у продавца нет. В остальных случаях — любое число. */}
                {isPublic && termRates.length > 0 ? (
                  <select
                    className="w-full p-4 border border-slate-200 dark:border-slate-600 rounded-xl outline-none bg-white dark:bg-slate-900 dark:text-white font-semibold"
                    value={months}
                    onChange={e => setMonths(parseInt(e.target.value))}
                  >
                    {availableTerms.map(m => <option key={m} value={m}>{m} мес.</option>)}
                  </select>
                ) : (
                  <div className="relative">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={MAX_MONTHS}
                      className="w-full p-4 pr-12 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-xl outline-none focus:border-indigo-500 transition-colors font-semibold"
                      value={months || ''}
                      onChange={e => {
                        const v = parseInt(e.target.value);
                        setMonths(isNaN(v) ? 0 : Math.min(Math.max(v, 0), MAX_MONTHS));
                      }}
                    />
                    <span className="absolute right-3 top-4 text-slate-400 text-sm">мес.</span>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">Первый взнос</label>
                <div className="relative">
                  <input
                    type="number"
                    className="w-full p-4 pr-8 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-xl outline-none focus:border-indigo-500 transition-colors font-semibold"
                    placeholder="0"
                    value={downPayment}
                    onChange={e => setDownPayment(e.target.value)}
                  />
                  <span className="absolute right-3 top-4 text-slate-400 text-sm">₽</span>
                </div>
              </div>
            </div>

            {/* Дата начала — НОВОЕ */}
            <div>
              <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">Дата начала</label>
              <input
                type="date"
                className="w-full p-4 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-xl outline-none focus:border-indigo-500 transition-colors font-semibold"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
              />
              <p className="text-xs text-slate-400 mt-1.5">Первый платёж по графику — со следующего месяца</p>
            </div>

            {/* Быстрый выбор срока — чтобы частые варианты не набирать руками */}
            {!(isPublic && termRates.length > 0) && (
              <div className="flex flex-wrap gap-2">
                {[3, 6, 9, 12, 18, 24].map(m => (
                  <button
                    key={m}
                    onClick={() => setMonths(m)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                      months === m
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                    }`}
                  >
                    {m} мес.
                  </button>
                ))}
              </div>
            )}

            {/* Округление платежа */}
            <div>
              <div className="flex items-center justify-between mb-1.5 gap-2">
                <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  Округление платежа
                </label>
                {/* Направление нужно только при включённом округлении — иначе прячем,
                    чтобы не занимать место лишним переключателем */}
                {roundStep > 0 && (
                  <div className="flex rounded-lg bg-slate-100 dark:bg-slate-700 p-0.5 shrink-0">
                    {([['up', '↑ Вверх'], ['down', '↓ Вниз']] as const).map(([dir, label]) => (
                      <button
                        key={dir}
                        onClick={() => setRoundDir(dir)}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors ${
                          roundDir === dir
                            ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm'
                            : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                {ROUND_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setRoundStep(opt.value)}
                    className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-colors ${
                      roundStep === opt.value
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-400 mt-1.5">
                {roundStep === 0
                  ? 'Платёж считается точно, без подгонки'
                  : roundDir === 'up'
                    ? `Платёж округляется вверх до ${roundStep} ₽ — итоговая сумма немного вырастет`
                    : `Платёж округляется вниз до ${roundStep} ₽ — вы уступаете клиенту разницу`}
              </p>
            </div>

            {/* Откуда считать наценку */}
            <label className="flex items-start justify-between gap-3 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 cursor-pointer">
              <span className="flex items-start gap-3 min-w-0">
                <input
                  type="checkbox"
                  className="mt-0.5 w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-indigo-600 focus:ring-indigo-500 shrink-0"
                  checked={markupOnRemainder}
                  onChange={e => setMarkupOnRemainder(e.target.checked)}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-slate-700 dark:text-slate-200">
                    Наценка на остаток после взноса
                  </span>
                  <span className="block text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                    {markupOnRemainder
                      ? 'Начисляется только на сумму, уходящую в рассрочку'
                      : 'Сейчас начисляется на всю цену товара'}
                  </span>
                </span>
              </span>
            </label>
          </div>

          {/* ── Результат ── */}
          <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-3xl p-6 text-white shadow-lg overflow-hidden">
            <div className="flex justify-between items-start mb-5">
              <div>
                <p className="text-slate-400 text-xs uppercase tracking-wide mb-1">Ежемесячный платёж</p>
                <p className="text-4xl font-black text-emerald-400 tracking-tight">
                  {hasPrice ? fmtPayment(result.monthly) : '—'} <span className="text-2xl text-emerald-500">₽</span>
                </p>
              </div>
              {hasPrice && (
                <div className="text-right">
                  <p className="text-slate-400 text-xs uppercase tracking-wide mb-1">Итого</p>
                  <p className="text-xl font-bold">{fmtMoney(result.totalPayable)} ₽</p>
                </div>
              )}
            </div>
            {hasPrice && (
              <div className="border-t border-slate-700 pt-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-400">Цена товара</span>
                  <span className="font-medium">{fmtMoney(parseFloat(price))} ₽</span>
                </div>
                {parseFloat(downPayment || '0') > 0 && (
                  <div className="flex justify-between">
                    <span className="text-slate-400">Первый взнос</span>
                    <span className="text-indigo-300 font-medium">−{fmtMoney(parseFloat(downPayment))} ₽</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-slate-400">
                    Наценка ({effectiveRate}%)
                    {markupOnRemainder && parseFloat(downPayment || '0') > 0 && (
                      <span className="block text-[11px] text-slate-500">на остаток после взноса</span>
                    )}
                  </span>
                  <span className="text-amber-400 font-medium">+{fmtMoney(result.markup)} ₽</span>
                </div>
                {roundStep > 0 && Math.abs(result.totalPayable - result.exactTotal) >= 1 && (
                  <div className="flex justify-between">
                    <span className="text-slate-400">
                      {result.totalPayable > result.exactTotal ? 'Надбавка за округление' : 'Скидка за округление'}
                    </span>
                    <span className={`font-medium ${result.totalPayable > result.exactTotal ? 'text-slate-300' : 'text-emerald-400'}`}>
                      {result.totalPayable > result.exactTotal ? '+' : '−'}{fmtMoney(Math.abs(result.totalPayable - result.exactTotal))} ₽
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── График платежей ── НОВОЕ */}
          {hasPrice && paymentSchedule.length > 0 && (
            <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden">
              {/* Заголовок */}
              <button
                onClick={() => setShowSchedule(s => !s)}
                className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-600 dark:text-indigo-400">
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                    </svg>
                  </div>
                  <span className="font-bold text-slate-800 dark:text-white">График платежей</span>
                  <span className="text-xs text-slate-400 bg-slate-100 dark:bg-slate-700 rounded-full px-2 py-0.5">{months} мес.</span>
                </div>
                <svg
                  className={`w-5 h-5 text-slate-400 transition-transform duration-200 ${showSchedule ? 'rotate-180' : ''}`}
                  viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                >
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>

              {showSchedule && (
                <div className="border-t border-slate-100 dark:border-slate-700">
                  <div className="divide-y divide-slate-50 dark:divide-slate-700/50">
                    {paymentSchedule.map((row, i) => (
                      <div key={i} className={`flex items-center gap-3 px-5 py-3.5 ${i % 2 === 0 ? '' : 'bg-slate-50/60 dark:bg-slate-700/20'}`}>
                        {/* Номер / взнос */}
                        {row.isDownPayment ? (
                          <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-amber-600 dark:text-amber-400">
                              <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
                            </svg>
                          </div>
                        ) : (
                          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center flex-shrink-0 shadow-sm shadow-indigo-200 dark:shadow-indigo-900/30">
                            <span className="text-white font-bold text-sm">{row.num}</span>
                          </div>
                        )}

                        {/* Дата */}
                        <div className="flex-1 min-w-0">
                          {row.isDownPayment ? (
                            <>
                              <p className="text-xs font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wide">Первый взнос</p>
                              <p className="text-sm text-slate-500 dark:text-slate-400">{fmtDate(row.date)}</p>
                            </>
                          ) : (
                            <>
                              <p className="text-sm font-semibold text-slate-800 dark:text-white">{fmtDate(row.date)}</p>
                              <p className="text-xs text-slate-400">{row.num} из {months}</p>
                            </>
                          )}
                        </div>

                        {/* Сумма */}
                        <div className="text-right flex-shrink-0">
                          <p className={`text-base font-black ${row.isDownPayment ? 'text-amber-600 dark:text-amber-400' : 'text-slate-800 dark:text-white'}`}>
                            {fmtPayment(row.amount)} ₽
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Итого */}
                  <div className="flex items-center justify-between px-5 py-4 bg-gradient-to-r from-indigo-50 to-violet-50 dark:from-indigo-950/40 dark:to-violet-950/40 border-t border-indigo-100 dark:border-indigo-900/50">
                    <span className="text-sm font-bold text-slate-600 dark:text-slate-300">Итого к выплате</span>
                    <span className="text-lg font-black text-indigo-700 dark:text-indigo-300">{fmtMoney(result.totalPayable)} ₽</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Кнопка Поделиться ── только в режиме менеджера */}
          {hasPrice && !isPublic && (
            <button
              onClick={handleShare}
              disabled={isSharing}
              className="w-full py-4 bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 text-white font-bold rounded-3xl shadow-lg shadow-indigo-200 dark:shadow-indigo-900/30 flex items-center justify-center gap-3 transition-all active:scale-95 disabled:opacity-70"
            >
              {isSharing ? (
                <>
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  Создание...
                </>
              ) : (
                <>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
                  </svg>
                  Поделиться расчётом
                </>
              )}
            </button>
          )}

          {/* ── Настройки (только для админа) ── */}
          {!isPublic && (
            <div className="bg-indigo-50 dark:bg-indigo-950/40 p-5 rounded-3xl border border-indigo-100 dark:border-indigo-900/50 animate-fade-in overflow-hidden">
              <div className="flex justify-between items-center mb-3">
                <h3 className="font-bold text-indigo-900 dark:text-indigo-300">Настройки ставок</h3>
                <button onClick={() => setShowSettings(!showSettings)} className="text-xs text-indigo-600 dark:text-indigo-400 underline font-bold">
                  {showSettings ? 'Свернуть' : 'Развернуть'}
                </button>
              </div>

              {showSettings ? (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-indigo-400 uppercase mb-1">Базовая ставка (%)</label>
                    <input
                      type="number"
                      className="w-full p-3 border border-indigo-200 dark:border-indigo-900/50 dark:bg-slate-900 dark:text-white rounded-xl outline-none"
                      value={defaultRate}
                      onChange={e => setDefaultRate(e.target.value)}
                      placeholder="30"
                    />
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">Применяется, если для срока нет отдельного правила.</p>
                  </div>

                  <div className="bg-white dark:bg-slate-800 p-3 rounded-xl border border-indigo-100 dark:border-indigo-900/50">
                    <label className="block text-xs font-bold text-indigo-400 uppercase mb-2">Специальные ставки по срокам</label>
                    <div className="space-y-2 mb-3">
                      {termRates.map(rule => (
                        <div key={rule.months} className="flex justify-between items-center bg-indigo-50 dark:bg-indigo-950/40 p-2 rounded-lg text-sm">
                          <span className="font-bold text-indigo-900 dark:text-indigo-300">{rule.months} мес.</span>
                          <div className="flex items-center gap-3">
                            <span className="font-bold text-indigo-600 dark:text-indigo-400">{rule.rate}%</span>
                            <button onClick={() => removeRule(rule.months)} className="text-red-400 hover:text-red-600">{ICONS.Close}</button>
                          </div>
                        </div>
                      ))}
                      {termRates.length === 0 && <p className="text-center text-xs text-slate-400 dark:text-slate-500 py-2">Нет специальных правил</p>}
                    </div>
                    <div className="flex gap-2 items-end">
                      <div className="flex-1">
                        <label className="text-[10px] text-slate-400 dark:text-slate-500 block mb-1">Срок</label>
                        <select
                          className="w-full p-2 border border-slate-200 dark:border-slate-600 rounded-lg text-sm bg-slate-50 dark:bg-slate-900 dark:text-white outline-none"
                          value={newRuleMonth}
                          onChange={e => setNewRuleMonth(parseInt(e.target.value))}
                        >
                          {[1,2,3,4,5,6,7,8,9,10,11,12].map(m => <option key={m} value={m}>{m} мес</option>)}
                        </select>
                      </div>
                      <div className="w-20">
                        <label className="text-[10px] text-slate-400 dark:text-slate-500 block mb-1">Ставка %</label>
                        <input
                          type="number"
                          className="w-full p-2 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-lg text-sm outline-none"
                          value={newRuleRate}
                          onChange={e => setNewRuleRate(e.target.value)}
                          placeholder="%"
                        />
                      </div>
                      <button onClick={addRule} className="p-2 bg-indigo-600 text-white rounded-lg h-[38px] w-[38px] flex items-center justify-center">
                        {ICONS.AddSmall}
                      </button>
                    </div>
                  </div>

                  <button onClick={handleSaveConfig} className="w-full py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 shadow-lg shadow-indigo-200 dark:shadow-indigo-900/30">
                    Сохранить настройки
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <button
                    onClick={handleCopyLink}
                    disabled={isLoadingConfig}
                    className={`w-full py-3 bg-white dark:bg-slate-800 border-2 border-indigo-200 dark:border-indigo-900/50 text-indigo-700 dark:text-indigo-400 font-bold rounded-xl hover:bg-indigo-50 dark:hover:bg-indigo-900/40 flex items-center justify-center gap-2 transition-colors ${isLoadingConfig ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {isLoadingConfig ? (
                      <><svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> Сохранение...</>
                    ) : (
                      <><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> Копировать ссылку</>
                    )}
                  </button>
                  <p className="text-center text-xs text-indigo-400">Ссылка будет вида: rassrochka.pro/calc/ВашаКомпания</p>
                </div>
              )}
            </div>
          )}

          {/* ── Контакты (публичный режим) ── */}
          {isPublic && (
            <div className="space-y-3 pt-1">
              {sellerPhone ? (
                <>
                  <a
                    href={`tel:${sellerPhone}`}
                    className="w-full py-4 bg-blue-500 text-white font-bold rounded-xl shadow-lg shadow-blue-200 flex items-center justify-center gap-2 hover:bg-blue-600 transition-colors"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
                    </svg>
                    Позвонить: {sellerPhone.replace(/(\d)(\d{3})(\d{3})(\d{2})(\d{2})/, '+$1 ($2) $3-$4-$5')}
                  </a>
                  <a
                    href={`https://wa.me/${sellerPhone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent('Здравствуйте! Хочу узнать подробнее о рассрочке')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full py-4 bg-emerald-500 text-white font-bold rounded-xl shadow-lg shadow-emerald-200 flex items-center justify-center gap-2 hover:bg-emerald-600 transition-colors"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
                    </svg>
                    Написать в WhatsApp
                  </a>
                </>
              ) : (
                <div className="py-3 text-center text-xs text-slate-400 dark:text-slate-500">
                  Контакты не указаны
                </div>
              )}
              <p className="text-center text-xs text-slate-400 dark:text-slate-500 pb-2">
                Расчёт является предварительным. {publicCompany}
              </p>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default Calculator;
