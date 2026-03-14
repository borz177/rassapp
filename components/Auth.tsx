import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { ICONS } from '../constants';
import { PrivacyPolicy, DataProcessingAgreement } from './LegalDocs';

interface AuthProps {
    onLogin: (user: any) => void;
}

type AuthMode = 'LOGIN' | 'REGISTER' | 'RESET';
type AuthStep = 'EMAIL' | 'CODE' | 'DETAILS' | 'NEW_PASSWORD';
type LegalView = 'NONE' | 'PRIVACY' | 'AGREEMENT';

const Auth: React.FC<AuthProps> = ({ onLogin }) => {
    const [mode, setMode] = useState<AuthMode>('LOGIN');
    const [step, setStep] = useState<AuthStep>('EMAIL');
    const [legalView, setLegalView] = useState<LegalView>('NONE');

    // Data
    const [email, setEmail] = useState('');
    const [code, setCode] = useState('');
    const [name, setName] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');

    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [resendTimer, setResendTimer] = useState(0);

    // Timer logic
    useEffect(() => {
        let interval: number;
        if (resendTimer > 0) {
            interval = window.setInterval(() => {
                setResendTimer(prev => prev - 1);
            }, 1000);
        }
        return () => window.clearInterval(interval);
    }, [resendTimer]);

    const handleSendCode = async () => {
        if (!email) { setError('Введите email'); return; }
        setIsLoading(true);
        setError('');
        try {
            await api.sendCode(email, mode === 'REGISTER' ? 'REGISTER' : 'RESET');
            setStep('CODE');
            setResendTimer(60); // 60s cooldown
        } catch (e: any) {
            setError(e.message);
        } finally {
            setIsLoading(false);
        }
    };

    const handleVerifyCodeStep = () => {
        if (!code || code.length !== 6) { setError('Введите 6-значный код'); return; }
        // For Registration: proceed to details.
        // For Reset: proceed to new password.
        setError('');
        if (mode === 'REGISTER') {
            setStep('DETAILS');
        } else if (mode === 'RESET') {
            setStep('NEW_PASSWORD');
        }
    };

    const handleRegister = async () => {
        if (!name || !password) { setError('Заполните все поля'); return; }
        setIsLoading(true);
        try {
            const user = await api.register({ name, email, password, code, role: 'manager' });
            onLogin(user);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setIsLoading(false);
        }
    };

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!email || !password) { setError('Заполните все поля'); return; }
        setIsLoading(true);
        try {
            const user = await api.login({ email, password });
            onLogin(user);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setIsLoading(false);
        }
    };

    const handleResetPassword = async () => {
        if (!password || password !== confirmPassword) { setError('Пароли не совпадают'); return; }
        setIsLoading(true);
        try {
            await api.resetPassword({ email, code, newPassword: password });
            alert('Пароль изменен! Теперь войдите.');
            setMode('LOGIN');
            setStep('EMAIL');
            setPassword('');
            setConfirmPassword('');
            setCode('');
        } catch (e: any) {
            setError(e.message);
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
    };

    if (legalView === 'PRIVACY') {
        return <PrivacyPolicy onBack={() => setLegalView('NONE')} />;
    }

    if (legalView === 'AGREEMENT') {
        return <DataProcessingAgreement onBack={() => setLegalView('NONE')} />;
    }

    return (
        <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
            <div className="bg-white p-8 rounded-2xl w-full max-w-sm shadow-xl animate-fade-in relative">

                {/* Header */}
                <div className="text-center mb-6">
                    <h1 className="text-3xl font-bold text-slate-800">FinUchet</h1>
                    <p className="text-slate-500 text-sm">
                        {mode === 'LOGIN' && 'Вход в систему'}
                        {mode === 'REGISTER' && 'Регистрация аккаунта'}
                        {mode === 'RESET' && 'Восстановление пароля'}
                    </p>
                </div>

                {/* Error Banner */}
                {error && <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm text-center mb-4">{error}</div>}

                {/* --- LOGIN MODE --- */}
                {mode === 'LOGIN' && (
                    <form onSubmit={handleLogin} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                            <input type="email" className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500" value={email} onChange={e => setEmail(e.target.value)} placeholder="mail@example.com" />
                        </div>
                        <div>
                            <div className="flex justify-between">
                                <label className="block text-sm font-medium text-slate-700 mb-1">Пароль</label>
                                <button type="button" onClick={() => switchMode('RESET')} className="text-xs text-indigo-600 hover:underline">Забыли пароль?</button>
                            </div>
                            <input type="password" className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••" />
                        </div>
                        <button type="submit" disabled={isLoading} className="w-full bg-indigo-600 text-white p-4 rounded-xl font-bold hover:bg-indigo-700 transition-colors disabled:opacity-70">
                            {isLoading ? 'Вход...' : 'Войти'}
                        </button>
                        <div className="text-center mt-4">
                            <button type="button" onClick={() => switchMode('REGISTER')} className="text-indigo-600 text-sm font-medium hover:underline">Нет аккаунта? Регистрация</button>
                        </div>
                    </form>
                )}

                {/* --- REGISTER / RESET FLOW --- */}
                {mode !== 'LOGIN' && (
                    <div className="space-y-4">

                        {/* Step 1: Email */}
                        {step === 'EMAIL' && (
                            <>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Ваш Email</label>
                                    <input type="email" className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500" value={email} onChange={e => setEmail(e.target.value)} placeholder="mail@example.com" />
                                </div>
                                <button onClick={handleSendCode} disabled={isLoading} className="w-full bg-indigo-600 text-white p-4 rounded-xl font-bold hover:bg-indigo-700 transition-colors disabled:opacity-70">
                                    {isLoading ? 'Отправка...' : 'Получить код'}
                                </button>
                            </>
                        )}

                        {/* Step 2: Code Verification */}
                        {step === 'CODE' && (
                            <div className="animate-fade-in">
                                <div className="mb-2 text-center text-sm text-slate-500">
                                    Мы отправили код на <span className="font-bold text-slate-700">{email}</span>
                                </div>
                                <div className="mb-4">
                                    <input type="text" maxLength={6} className="w-full p-3 text-center text-2xl tracking-widest border border-slate-200 rounded-xl outline-none focus:border-indigo-500 font-mono" value={code} onChange={e => setCode(e.target.value.replace(/\D/g,''))} placeholder="000000" />
                                </div>
                                <button onClick={handleVerifyCodeStep} className="w-full bg-indigo-600 text-white p-4 rounded-xl font-bold hover:bg-indigo-700 transition-colors mb-3">
                                    Подтвердить
                                </button>
                                <div className="text-center">
                                    {resendTimer > 0 ? (
                                        <span className="text-xs text-slate-400">Отправить повторно через {resendTimer}с</span>
                                    ) : (
                                        <button onClick={handleSendCode} className="text-xs text-indigo-600 font-bold hover:underline">Отправить код повторно</button>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Step 3: Registration Details */}
                        {step === 'DETAILS' && mode === 'REGISTER' && (
                            <div className="animate-fade-in space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Ваше Имя</label>
                                    <input type="text" className="w-full p-3 border border-slate-200 rounded-xl outline-none" value={name} onChange={e => setName(e.target.value)} placeholder="Иван Иванов" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Придумайте пароль</label>
                                    <input type="password" className="w-full p-3 border border-slate-200 rounded-xl outline-none" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••" />
                                </div>
                                <button onClick={handleRegister} disabled={isLoading} className="w-full bg-emerald-600 text-white p-4 rounded-xl font-bold hover:bg-emerald-700 transition-colors disabled:opacity-70">
                                    {isLoading ? 'Создание...' : 'Завершить регистрацию'}
                                </button>
                            </div>
                        )}

                        {/* Step 3: New Password (Reset) */}
                        {step === 'NEW_PASSWORD' && mode === 'RESET' && (
                            <div className="animate-fade-in space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Новый пароль</label>
                                    <input type="password" className="w-full p-3 border border-slate-200 rounded-xl outline-none" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Подтвердите пароль</label>
                                    <input type="password" className="w-full p-3 border border-slate-200 rounded-xl outline-none" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="••••••" />
                                </div>
                                <button onClick={handleResetPassword} disabled={isLoading} className="w-full bg-indigo-600 text-white p-4 rounded-xl font-bold hover:bg-indigo-700 transition-colors disabled:opacity-70">
                                    {isLoading ? 'Сохранение...' : 'Сменить пароль'}
                                </button>
                            </div>
                        )}

                        <div className="text-center mt-4 border-t border-slate-100 pt-4">
                            <button onClick={() => switchMode('LOGIN')} className="text-slate-500 text-sm hover:text-slate-800">
                                Вернуться ко входу
                            </button>
                        </div>
                    </div>
                )}

                {/* Legal Footer */}
                <div className="mt-6 text-[10px] text-center text-slate-400 leading-tight">
                    Продолжая, вы соглашаетесь с <br/>
                    <button onClick={() => setLegalView('PRIVACY')} className="text-indigo-500 hover:underline">Политикой конфиденциальности</button>
                    {' '}и{' '}
                    <button onClick={() => setLegalView('AGREEMENT')} className="text-indigo-500 hover:underline">Обработкой персональных данных</button>
                </div>
            </div>
        </div>
    );
};

export default Auth;