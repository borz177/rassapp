import React, { useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import { PrivacyPolicy, DataProcessingAgreement, ClientDataTerms, PublicOffer } from './LegalDocs';
import {
    normalizeEmail, emailError, newPasswordError, passwordStrength, STRENGTH_LABEL,
    cleanCode, codeError, humanAuthError, MIN_PASSWORD,
} from '../src/authValidation';

/**
 * Вход, регистрация и восстановление пароля.
 *
 * Экран переписан вокруг того, как люди на самом деле сюда попадают: с телефона,
 * одной рукой, с сохранённым в браузере паролем. Отсюда требования, которых
 * раньше не было:
 *
 * • поля объявляют себя менеджеру паролей (autocomplete, name, id) — без этого
 *   сохранённый пароль не подставляется и его приходится вспоминать;
 * • каждый шаг — настоящая <form>, поэтому Enter работает везде, а не только
 *   на входе;
 * • пароль можно показать: вслепую его набирают с ошибкой и винят систему;
 * • код из письма — числовая клавиатура и one-time-code, чтобы телефон
 *   предложил его подставить;
 * • ошибки сервера переводятся на человеческий (см. humanAuthError): «Неверные
 *   учетные данные» не подсказывает, что делать дальше.
 */

interface AuthProps {
    onLogin: (user: any) => void;
}

type AuthMode = 'LOGIN' | 'REGISTER' | 'RESET';
type AuthStep = 'EMAIL' | 'CODE' | 'DETAILS' | 'NEW_PASSWORD' | 'DONE';
type LegalView = 'NONE' | 'PRIVACY' | 'AGREEMENT' | 'CLIENT_DATA' | 'OFFER';

const EyeIcon: React.FC<{ off?: boolean }> = ({ off }) => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {off ? (
            <>
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                <line x1="1" y1="1" x2="23" y2="23" />
            </>
        ) : (
            <>
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
            </>
        )}
    </svg>
);

const Spinner = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="animate-spin">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
);

const FIELD = 'w-full p-3.5 border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 dark:text-white rounded-xl outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 transition-shadow';
const LABEL = 'block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5';
const PRIMARY = 'w-full p-4 rounded-xl font-bold text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2';

const Auth: React.FC<AuthProps> = ({ onLogin }) => {
    const [mode, setMode] = useState<AuthMode>('LOGIN');
    const [step, setStep] = useState<AuthStep>('EMAIL');
    const [legalView, setLegalView] = useState<LegalView>('NONE');
    // Согласие снято по умолчанию — предзаполненная галочка не считается выраженным согласием
    const [legalAccepted, setLegalAccepted] = useState(false);

    // 🎁 Код приглашения. Сам захват из адреса делает App при загрузке страницы
    // (capturePendingReferral) — здесь только читаем сохранённое. Так код переживает
    // и лендинг, и переход на /app, и подтверждение почты.
    const [referralCode, setReferralCode] = useState('');
    useEffect(() => {
        let code = '';
        try { code = localStorage.getItem('pending_referral') || ''; } catch { /* нет localStorage */ }
        if (code) {
            setReferralCode(code);
            setMode('REGISTER');   // пришёл по приглашению — сразу форма регистрации
        }
    }, []);

    const [email, setEmail] = useState('');
    const [code, setCode] = useState('');
    const [name, setName] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);

    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [capsLock, setCapsLock] = useState(false);
    const [resendTimer, setResendTimer] = useState(0);

    const emailRef = useRef<HTMLInputElement>(null);
    const codeRef = useRef<HTMLInputElement>(null);
    const nameRef = useRef<HTMLInputElement>(null);
    const newPasswordRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        let interval: number;
        if (resendTimer > 0) {
            interval = window.setInterval(() => setResendTimer(prev => prev - 1), 1000);
        }
        return () => window.clearInterval(interval);
    }, [resendTimer]);

    // Фокус ставим на то поле, которое человек сейчас и собирается заполнять:
    // иначе на каждом шаге приходится тянуться пальцем к полю.
    useEffect(() => {
        const target = step === 'CODE' ? codeRef.current
            : step === 'DETAILS' ? nameRef.current
            : step === 'NEW_PASSWORD' ? newPasswordRef.current
            : emailRef.current;
        const id = window.setTimeout(() => target?.focus(), 80);
        return () => window.clearTimeout(id);
    }, [step, mode]);

    const onPasswordKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
        // Caps Lock — самая частая причина «пароль не подходит, хотя он верный»
        setCapsLock(e.getModifierState?.('CapsLock') ?? false);
    };

    const handleSendCode = async (e?: React.FormEvent) => {
        e?.preventDefault();
        const problem = emailError(email);
        if (problem) { setError(problem); emailRef.current?.focus(); return; }
        setIsLoading(true);
        setError('');
        try {
            await api.sendCode(normalizeEmail(email), mode === 'REGISTER' ? 'REGISTER' : 'RESET');
            setStep('CODE');
            setResendTimer(60);
        } catch (e: any) {
            setError(humanAuthError(e, 'Не удалось отправить код. Попробуйте ещё раз'));
        } finally {
            setIsLoading(false);
        }
    };

    const handleVerifyCodeStep = (e?: React.FormEvent) => {
        e?.preventDefault();
        const problem = codeError(code);
        if (problem) { setError(problem); return; }
        setError('');
        setStep(mode === 'REGISTER' ? 'DETAILS' : 'NEW_PASSWORD');
    };

    const handleRegister = async (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!name.trim()) { setError('Как к вам обращаться?'); nameRef.current?.focus(); return; }
        const problem = newPasswordError(password);
        if (problem) { setError(problem); newPasswordRef.current?.focus(); return; }
        if (password !== confirmPassword) { setError('Пароли не совпадают'); return; }
        if (!legalAccepted) { setError('Нужно принять условия'); return; }

        setIsLoading(true);
        setError('');
        try {
            const user = await api.register({
                name: name.trim(), email: normalizeEmail(email), password, code: cleanCode(code), role: 'manager',
                referralCode: referralCode || undefined,
            });
            localStorage.removeItem('pending_referral');
            onLogin(user);
        } catch (e: any) {
            setError(humanAuthError(e, 'Не удалось создать аккаунт'));
        } finally {
            setIsLoading(false);
        }
    };

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        const problem = emailError(email);
        if (problem) { setError(problem); emailRef.current?.focus(); return; }
        if (!password) { setError('Введите пароль'); return; }

        setIsLoading(true);
        setError('');
        try {
            const user = await api.login({ email: normalizeEmail(email), password });
            onLogin(user);
        } catch (e: any) {
            setError(humanAuthError(e, 'Не удалось войти'));
        } finally {
            setIsLoading(false);
        }
    };

    const handleResetPassword = async (e?: React.FormEvent) => {
        e?.preventDefault();
        const problem = newPasswordError(password);
        if (problem) { setError(problem); newPasswordRef.current?.focus(); return; }
        if (password !== confirmPassword) { setError('Пароли не совпадают'); return; }

        setIsLoading(true);
        setError('');
        try {
            await api.resetPassword({ email: normalizeEmail(email), code: cleanCode(code), newPassword: password });
            // Раньше здесь был alert() — окно браузера поверх приложения. Экран
            // с подтверждением спокойнее и сразу ведёт обратно ко входу.
            setStep('DONE');
            setPassword('');
            setConfirmPassword('');
            setCode('');
        } catch (e: any) {
            setError(humanAuthError(e, 'Не удалось сменить пароль'));
        } finally {
            setIsLoading(false);
        }
    };

    const switchMode = (newMode: AuthMode) => {
        setMode(newMode);
        setStep('EMAIL');
        setError('');
        setCode('');
        setPassword('');
        setConfirmPassword('');
        setShowPassword(false);
        setCapsLock(false);
    };

    const goBack = () => {
        setError('');
        if (step === 'CODE') setStep('EMAIL');
        else if (step === 'DETAILS' || step === 'NEW_PASSWORD') setStep('CODE');
        else switchMode('LOGIN');
    };

    if (legalView === 'PRIVACY') return <PrivacyPolicy onBack={() => setLegalView('NONE')} />;
    if (legalView === 'AGREEMENT') return <DataProcessingAgreement onBack={() => setLegalView('NONE')} />;
    if (legalView === 'CLIENT_DATA') return <ClientDataTerms onBack={() => setLegalView('NONE')} />;
    if (legalView === 'OFFER') return <PublicOffer onBack={() => setLegalView('NONE')} />;

    const strength = passwordStrength(password);
    const strengthColor = strength === 'strong' ? 'bg-emerald-500'
        : strength === 'medium' ? 'bg-amber-500' : 'bg-slate-300 dark:bg-slate-600';
    const strengthWidth = strength === 'strong' ? '100%' : strength === 'medium' ? '60%' : '30%';

    const passwordField = (
        <div className="relative">
            <input
                ref={newPasswordRef}
                id="new-password"
                name="new-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className={`${FIELD} pr-12`}
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyUp={onPasswordKey}
                placeholder={`Не короче ${MIN_PASSWORD} символов`}
            />
            <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
            >
                <EyeIcon off={showPassword} />
            </button>
        </div>
    );

    return (
        <div className="min-h-screen bg-slate-900 flex items-center justify-center p-5">
            <div className="w-full max-w-sm">
                <div className="bg-white dark:bg-slate-800 p-7 rounded-2xl shadow-xl animate-fade-in">

                    <div className="text-center mb-6">
                        <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-2xl font-black">F</div>
                        <h1 className="text-2xl font-bold text-slate-800 dark:text-white">FinUchet</h1>
                        <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
                            {mode === 'LOGIN' && 'Вход в систему'}
                            {mode === 'REGISTER' && 'Создание аккаунта'}
                            {mode === 'RESET' && 'Восстановление пароля'}
                        </p>
                    </div>

                    {/* Вкладки вместо ссылки внизу: сразу видно, что регистрация
                        есть и где она. Во время восстановления их не показываем —
                        там свой путь с шагами. */}
                    {mode !== 'RESET' && (
                        <div className="flex p-1 bg-slate-100 dark:bg-slate-900 rounded-xl mb-5">
                            {([['LOGIN', 'Вход'], ['REGISTER', 'Регистрация']] as const).map(([value, label]) => (
                                <button
                                    key={value}
                                    type="button"
                                    onClick={() => switchMode(value)}
                                    className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                                        mode === value
                                            ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-white shadow-sm'
                                            : 'text-slate-500 dark:text-slate-400'
                                    }`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    )}

                    {referralCode && mode === 'REGISTER' && (
                        <div className="bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-900/50 rounded-xl p-3 mb-4 flex items-center gap-2">
                            <span className="text-lg">🎁</span>
                            <p className="text-xs text-emerald-800 dark:text-emerald-300">
                                Вы регистрируетесь по приглашению — код <span className="font-bold">{referralCode}</span>
                            </p>
                        </div>
                    )}

                    {/* role="alert" — чтобы экранный диктор прочитал ошибку сразу */}
                    {error && (
                        <div role="alert" className="bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 p-3 rounded-xl text-sm mb-4">
                            {error}
                        </div>
                    )}

                    {/* --- ВХОД --- */}
                    {mode === 'LOGIN' && (
                        <form onSubmit={handleLogin} noValidate className="space-y-4">
                            <div>
                                <label className={LABEL} htmlFor="login-email">Email</label>
                                <input
                                    ref={emailRef}
                                    id="login-email"
                                    name="email"
                                    type="email"
                                    autoComplete="username"
                                    inputMode="email"
                                    autoCapitalize="none"
                                    autoCorrect="off"
                                    spellCheck={false}
                                    className={FIELD}
                                    value={email}
                                    onChange={e => setEmail(e.target.value)}
                                    placeholder="mail@example.com"
                                />
                            </div>
                            <div>
                                <div className="flex justify-between items-center">
                                    <label className={LABEL} htmlFor="login-password">Пароль</label>
                                    <button type="button" onClick={() => switchMode('RESET')} className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline mb-1.5">
                                        Забыли пароль?
                                    </button>
                                </div>
                                <div className="relative">
                                    <input
                                        id="login-password"
                                        name="password"
                                        type={showPassword ? 'text' : 'password'}
                                        autoComplete="current-password"
                                        autoCapitalize="none"
                                        autoCorrect="off"
                                        spellCheck={false}
                                        className={`${FIELD} pr-12`}
                                        value={password}
                                        onChange={e => setPassword(e.target.value)}
                                        onKeyUp={onPasswordKey}
                                        placeholder="Ваш пароль"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(v => !v)}
                                        aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                                    >
                                        <EyeIcon off={showPassword} />
                                    </button>
                                </div>
                                {capsLock && (
                                    <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">Включён Caps Lock</p>
                                )}
                            </div>
                            <button type="submit" disabled={isLoading} className={`${PRIMARY} bg-indigo-600 hover:bg-indigo-700`}>
                                {isLoading && <Spinner />}
                                {isLoading ? 'Входим…' : 'Войти'}
                            </button>
                        </form>
                    )}

                    {/* --- РЕГИСТРАЦИЯ И ВОССТАНОВЛЕНИЕ --- */}
                    {mode !== 'LOGIN' && (
                        <div className="space-y-4">

                            {/* Шаг 1 — почта */}
                            {step === 'EMAIL' && (
                                <form onSubmit={handleSendCode} noValidate className="space-y-4">
                                    <div>
                                        <label className={LABEL} htmlFor="auth-email">Ваш email</label>
                                        <input
                                            ref={emailRef}
                                            id="auth-email"
                                            name="email"
                                            type="email"
                                            autoComplete="username"
                                            inputMode="email"
                                            autoCapitalize="none"
                                            autoCorrect="off"
                                            spellCheck={false}
                                            className={FIELD}
                                            value={email}
                                            onChange={e => setEmail(e.target.value)}
                                            placeholder="mail@example.com"
                                        />
                                        <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">
                                            Пришлём код для подтверждения
                                        </p>
                                    </div>
                                    <button type="submit" disabled={isLoading} className={`${PRIMARY} bg-indigo-600 hover:bg-indigo-700`}>
                                        {isLoading && <Spinner />}
                                        {isLoading ? 'Отправляем…' : 'Получить код'}
                                    </button>
                                </form>
                            )}

                            {/* Шаг 2 — код из письма */}
                            {step === 'CODE' && (
                                <form onSubmit={handleVerifyCodeStep} noValidate className="animate-fade-in space-y-4">
                                    <p className="text-center text-sm text-slate-500 dark:text-slate-400">
                                        Код отправлен на <span className="font-semibold text-slate-700 dark:text-slate-300">{normalizeEmail(email)}</span>
                                    </p>
                                    <input
                                        ref={codeRef}
                                        id="auth-code"
                                        name="one-time-code"
                                        type="text"
                                        inputMode="numeric"
                                        autoComplete="one-time-code"
                                        maxLength={6}
                                        className={`${FIELD} text-center text-2xl tracking-[0.4em] font-mono`}
                                        value={code}
                                        onChange={e => {
                                            const next = cleanCode(e.target.value);
                                            setCode(next);
                                            setError('');
                                        }}
                                        placeholder="000000"
                                    />
                                    <button type="submit" className={`${PRIMARY} bg-indigo-600 hover:bg-indigo-700`}>
                                        Подтвердить
                                    </button>
                                    <div className="text-center">
                                        {resendTimer > 0 ? (
                                            <span className="text-xs text-slate-400 dark:text-slate-500">Отправить ещё раз через {resendTimer} с</span>
                                        ) : (
                                            <button type="button" onClick={() => handleSendCode()} className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline">
                                                Отправить код повторно
                                            </button>
                                        )}
                                    </div>
                                    <p className="text-center text-xs text-slate-400 dark:text-slate-500">
                                        Письма нет? Загляните в «Спам»
                                    </p>
                                </form>
                            )}

                            {/* Шаг 3 — имя и пароль */}
                            {step === 'DETAILS' && mode === 'REGISTER' && (
                                <form onSubmit={handleRegister} noValidate className="animate-fade-in space-y-4">
                                    <div>
                                        <label className={LABEL} htmlFor="reg-name">Ваше имя</label>
                                        <input
                                            ref={nameRef}
                                            id="reg-name"
                                            name="name"
                                            type="text"
                                            autoComplete="name"
                                            className={FIELD}
                                            value={name}
                                            onChange={e => setName(e.target.value)}
                                            placeholder="Иван Иванов"
                                        />
                                    </div>
                                    <div>
                                        <label className={LABEL} htmlFor="new-password">Придумайте пароль</label>
                                        {passwordField}
                                        {password && (
                                            <div className="mt-2 flex items-center gap-2">
                                                <div className="h-1 flex-1 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                                                    <div className={`h-full rounded-full transition-all ${strengthColor}`} style={{ width: strengthWidth }} />
                                                </div>
                                                <span className="text-xs text-slate-400 dark:text-slate-500 shrink-0">{STRENGTH_LABEL[strength]}</span>
                                            </div>
                                        )}
                                        {capsLock && <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">Включён Caps Lock</p>}
                                    </div>
                                    <div>
                                        <label className={LABEL} htmlFor="reg-confirm">Повторите пароль</label>
                                        <input
                                            id="reg-confirm"
                                            name="confirm-password"
                                            type={showPassword ? 'text' : 'password'}
                                            autoComplete="new-password"
                                            autoCapitalize="none"
                                            autoCorrect="off"
                                            spellCheck={false}
                                            className={FIELD}
                                            value={confirmPassword}
                                            onChange={e => setConfirmPassword(e.target.value)}
                                            placeholder="Тот же пароль ещё раз"
                                        />
                                        {confirmPassword && confirmPassword !== password && (
                                            <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">Пароли пока не совпадают</p>
                                        )}
                                    </div>

                                    {/* 🔒 Согласие по 152-ФЗ должно быть «конкретным, предметным,
                                        информированным, сознательным и однозначным» (ч. 1 ст. 9).
                                        Формулировка «продолжая, вы соглашаетесь» этому не отвечает:
                                        Роскомнадзор считает такое согласие невыраженным. Нужно
                                        отдельное действие — снятая по умолчанию галочка. */}
                                    <label className="flex items-start gap-2.5 cursor-pointer select-none">
                                        <input
                                            type="checkbox"
                                            checked={legalAccepted}
                                            onChange={e => setLegalAccepted(e.target.checked)}
                                            className="mt-0.5 w-4 h-4 shrink-0 accent-emerald-600 cursor-pointer"
                                        />
                                        <span className="text-xs text-slate-600 dark:text-slate-400 leading-snug">
                                            Принимаю условия{' '}
                                            <button type="button" onClick={() => setLegalView('OFFER')} className="text-indigo-500 hover:underline">Публичной оферты</button>,
                                            даю{' '}
                                            <button type="button" onClick={() => setLegalView('AGREEMENT')} className="text-indigo-500 hover:underline">согласие на обработку персональных данных</button>,
                                            ознакомлен(а) с{' '}
                                            <button type="button" onClick={() => setLegalView('PRIVACY')} className="text-indigo-500 hover:underline">Политикой обработки персональных данных</button>
                                            {' '}и{' '}
                                            <button type="button" onClick={() => setLegalView('CLIENT_DATA')} className="text-indigo-500 hover:underline">Условиями обработки данных клиентов</button>.
                                        </span>
                                    </label>

                                    <button type="submit" disabled={isLoading || !legalAccepted} className={`${PRIMARY} bg-emerald-600 hover:bg-emerald-700`}>
                                        {isLoading && <Spinner />}
                                        {isLoading ? 'Создаём…' : 'Создать аккаунт'}
                                    </button>
                                </form>
                            )}

                            {/* Шаг 3 — новый пароль */}
                            {step === 'NEW_PASSWORD' && mode === 'RESET' && (
                                <form onSubmit={handleResetPassword} noValidate className="animate-fade-in space-y-4">
                                    <div>
                                        <label className={LABEL} htmlFor="new-password">Новый пароль</label>
                                        {passwordField}
                                        {password && (
                                            <div className="mt-2 flex items-center gap-2">
                                                <div className="h-1 flex-1 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                                                    <div className={`h-full rounded-full transition-all ${strengthColor}`} style={{ width: strengthWidth }} />
                                                </div>
                                                <span className="text-xs text-slate-400 dark:text-slate-500 shrink-0">{STRENGTH_LABEL[strength]}</span>
                                            </div>
                                        )}
                                    </div>
                                    <div>
                                        <label className={LABEL} htmlFor="reset-confirm">Повторите пароль</label>
                                        <input
                                            id="reset-confirm"
                                            name="confirm-password"
                                            type={showPassword ? 'text' : 'password'}
                                            autoComplete="new-password"
                                            autoCapitalize="none"
                                            autoCorrect="off"
                                            spellCheck={false}
                                            className={FIELD}
                                            value={confirmPassword}
                                            onChange={e => setConfirmPassword(e.target.value)}
                                            placeholder="Тот же пароль ещё раз"
                                        />
                                        {confirmPassword && confirmPassword !== password && (
                                            <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">Пароли пока не совпадают</p>
                                        )}
                                    </div>
                                    <button type="submit" disabled={isLoading} className={`${PRIMARY} bg-indigo-600 hover:bg-indigo-700`}>
                                        {isLoading && <Spinner />}
                                        {isLoading ? 'Сохраняем…' : 'Сменить пароль'}
                                    </button>
                                </form>
                            )}

                            {/* Пароль сменён */}
                            {step === 'DONE' && (
                                <div className="animate-fade-in text-center py-4">
                                    <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                                        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                                    </div>
                                    <p className="font-bold text-slate-800 dark:text-white">Пароль изменён</p>
                                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 mb-5">Войдите с новым паролем</p>
                                    <button onClick={() => switchMode('LOGIN')} className={`${PRIMARY} bg-indigo-600 hover:bg-indigo-700`}>
                                        Перейти ко входу
                                    </button>
                                </div>
                            )}

                            {step !== 'DONE' && (
                                <div className="text-center pt-2 border-t border-slate-100 dark:border-slate-700">
                                    <button onClick={goBack} className="mt-3 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200">
                                        {step === 'EMAIL' ? 'Вернуться ко входу' : 'Назад'}
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Документы должны быть доступны в любой момент, а не только при регистрации:
                    ч. 2 ст. 18.1 152-ФЗ требует неограниченного доступа к политике. */}
                <div className="mt-5 text-[11px] text-center text-slate-500 leading-tight">
                    <button onClick={() => setLegalView('OFFER')} className="hover:underline">Оферта</button>
                    {' · '}
                    <button onClick={() => setLegalView('PRIVACY')} className="hover:underline">Политика обработки ПДн</button>
                    {' · '}
                    <button onClick={() => setLegalView('CLIENT_DATA')} className="hover:underline">Данные клиентов</button>
                </div>
            </div>
        </div>
    );
};

export default Auth;
