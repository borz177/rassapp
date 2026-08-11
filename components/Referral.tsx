import React, { useState, useEffect } from 'react';
import { ICONS } from '../constants';
import { api } from '../services/api';
import { hapticSuccess } from './feedback';

interface ReferralProps {
    onBack: () => void;
}

interface ReferralStats {
    code: string;
    invited: number;
    paid: number;
    daysEarned: number;
    rewardDays: number;
}

const Referral: React.FC<ReferralProps> = ({ onBack }) => {
    const [stats, setStats] = useState<ReferralStats | null>(null);
    const [error, setError] = useState('');
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        api.getReferralStats()
           .then(setStats)
           .catch(e => setError(e?.message || 'Не удалось загрузить статистику'));
    }, []);

    const link = stats ? `${window.location.origin}/?ref=${stats.code}` : '';

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(link);
        } catch {
            // В WebView и части браузеров clipboard недоступен без разрешения —
            // без этого запасного пути кнопка молча ничего не делала бы.
            const el = document.createElement('textarea');
            el.value = link;
            document.body.appendChild(el);
            el.select();
            document.execCommand('copy');
            el.remove();
        }
        setCopied(true);
        hapticSuccess();
        setTimeout(() => setCopied(false), 2000);
    };

    const shareText = `Веду учёт рассрочек в FinUchet — клиенты, договоры, платежи, напоминания клиентам. Регистрируйся по моей ссылке: ${link}`;

    const handleShareWhatsApp = () => {
        window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank');
    };

    // Системное меню «Поделиться» есть не везде — показываем кнопку только когда оно доступно
    const canNativeShare = typeof navigator !== 'undefined' && !!(navigator as any).share;
    const handleNativeShare = () => {
        (navigator as any).share({ title: 'FinUchet', text: shareText }).catch(() => { /* пользователь закрыл меню */ });
    };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-900 animate-fade-in">
            <div className="sticky top-0 bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm border-b border-slate-100 dark:border-slate-700 p-4 flex items-center gap-3 z-10">
                <button onClick={onBack} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full text-slate-600 dark:text-slate-300 transition-colors">
                    {ICONS.Back}
                </button>
                <h2 className="font-bold text-slate-800 dark:text-white text-lg">Пригласить друга</h2>
            </div>

            <div className="max-w-lg mx-auto p-4 space-y-4">
                {error && (
                    <div className="bg-rose-50 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-900/50 rounded-xl p-4 text-sm text-rose-700 dark:text-rose-300">
                        {error}
                    </div>
                )}

                {!stats && !error && (
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 text-center text-slate-400 dark:text-slate-500 border border-slate-100 dark:border-slate-700">
                        <svg className="animate-spin h-6 w-6 mx-auto mb-2" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                        </svg>
                        <p className="text-sm">Загружаем…</p>
                    </div>
                )}

                {stats && (
                    <>
                        {/* Главное обещание — крупно и первым экраном */}
                        <div className="bg-gradient-to-br from-indigo-600 to-indigo-500 rounded-2xl p-6 text-white shadow-lg shadow-indigo-200 dark:shadow-indigo-900/30">
                            <p className="text-4xl font-bold">+{stats.rewardDays} дней</p>
                            <p className="text-indigo-100 mt-1 leading-snug">
                                подписки за каждого, кто зарегистрируется по вашей ссылке и оплатит тариф
                            </p>
                        </div>

                        {/* Статистика */}
                        <div className="grid grid-cols-3 gap-2">
                            {[
                                { value: stats.invited, label: 'приглашено', accent: false },
                                { value: stats.paid, label: 'оплатили', accent: false },
                                { value: `+${stats.daysEarned}`, label: 'дней получено', accent: true },
                            ].map(s => (
                                <div key={s.label} className={`rounded-2xl py-4 text-center border ${
                                    s.accent
                                        ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-100 dark:border-emerald-900/40'
                                        : 'bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700'
                                }`}>
                                    <p className={`text-2xl font-bold ${
                                        s.accent ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-800 dark:text-white'
                                    }`}>{s.value}</p>
                                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{s.label}</p>
                                </div>
                            ))}
                        </div>

                        {/* Ссылка */}
                        <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700 space-y-3">
                            <div>
                                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">Ваша ссылка</p>
                                <input
                                    readOnly
                                    value={link}
                                    onFocus={e => e.currentTarget.select()}
                                    className="w-full p-3 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-600 dark:text-white rounded-xl outline-none"
                                />
                            </div>

                            <button
                                onClick={handleCopy}
                                className="btn-press w-full py-3 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold rounded-xl hover:bg-slate-200 dark:hover:bg-slate-600 flex items-center justify-center gap-2"
                            >
                                {copied ? '✓ Скопировано' : 'Скопировать ссылку'}
                            </button>

                            <button
                                onClick={handleShareWhatsApp}
                                className="btn-press w-full py-3.5 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 shadow-lg shadow-emerald-200 dark:shadow-emerald-900/30 flex items-center justify-center gap-2"
                            >
                                {ICONS.Send} Отправить в WhatsApp
                            </button>

                            {canNativeShare && (
                                <button
                                    onClick={handleNativeShare}
                                    className="btn-press w-full py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 font-bold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700"
                                >
                                    Поделиться другим способом
                                </button>
                            )}
                        </div>

                        {/* Как это работает */}
                        <div className="bg-white dark:bg-slate-800 rounded-2xl p-5 border border-slate-100 dark:border-slate-700">
                            <h3 className="font-bold text-slate-800 dark:text-white mb-3">Как это работает</h3>
                            <ol className="space-y-3">
                                {[
                                    'Отправьте ссылку знакомому, который ведёт рассрочки.',
                                    'Он регистрируется по ней — мы запомним, что это ваш приглашённый.',
                                    `Как только он оплатит любой тариф, вам автоматически добавится ${stats.rewardDays} дней подписки.`,
                                ].map((text, i) => (
                                    <li key={i} className="flex gap-3">
                                        <span className="shrink-0 w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 text-xs font-bold flex items-center justify-center">
                                            {i + 1}
                                        </span>
                                        <span className="text-sm text-slate-600 dark:text-slate-300 leading-snug">{text}</span>
                                    </li>
                                ))}
                            </ol>
                            <p className="text-xs text-slate-400 dark:text-slate-500 mt-4 pt-3 border-t border-slate-100 dark:border-slate-700 leading-snug">
                                Награда начисляется один раз за каждого приглашённого — при его первой оплате.
                                Приглашать самого себя на второй аккаунт не получится: совпадение почты или
                                телефона проверяется автоматически.
                            </p>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default Referral;
