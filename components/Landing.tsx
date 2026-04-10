import React, { useEffect, useState } from "react"

export default function Landing() {
    const [scrolled, setScrolled] = useState(false)

    useEffect(() => {
        const handleScroll = () => {
            setScrolled(window.scrollY > 20)
        }
        window.addEventListener('scroll', handleScroll)
        return () => window.removeEventListener('scroll', handleScroll)
    }, [])

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50/30 font-['Inter',sans-serif] text-slate-900">
            <style jsx>{`
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');
                
                @keyframes float {
                    0%, 100% { transform: translateY(0px); }
                    50% { transform: translateY(-20px); }
                }
                @keyframes float-delayed {
                    0%, 100% { transform: translateY(0px); }
                    50% { transform: translateY(-15px); }
                }
                @keyframes glow {
                    0%, 100% { opacity: 0.5; transform: scale(1); }
                    50% { opacity: 0.8; transform: scale(1.1); }
                }
                @keyframes slideInLeft {
                    from { opacity: 0; transform: translateX(-30px); }
                    to { opacity: 1; transform: translateX(0); }
                }
                @keyframes slideInRight {
                    from { opacity: 0; transform: translateX(30px); }
                    to { opacity: 1; transform: translateX(0); }
                }
                
                .fade-up {
                    animation: fadeUp 0.8s cubic-bezier(0.2, 0.8, 0.2, 1) both;
                }
                .fade-up-slow {
                    animation: fadeUp 1s cubic-bezier(0.2, 0.8, 0.2, 1) both;
                }
                @keyframes fadeUp {
                    0% { opacity: 0; transform: translateY(30px); filter: blur(10px); }
                    100% { opacity: 1; transform: translateY(0); filter: blur(0); }
                }
                
                .delay-1 { animation-delay: 0.1s; }
                .delay-2 { animation-delay: 0.2s; }
                .delay-3 { animation-delay: 0.3s; }
                .delay-4 { animation-delay: 0.4s; }
                .delay-5 { animation-delay: 0.5s; }
                
                .glass-nav {
                    backdrop-filter: blur(20px);
                    background: rgba(255, 255, 255, 0.8);
                    border-bottom: 1px solid rgba(255, 255, 255, 0.2);
                }
                .glass-nav-scrolled {
                    background: rgba(255, 255, 255, 0.95);
                    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05);
                }
                
                .screen-card {
                    transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);
                    transform-style: preserve-3d;
                }
                .screen-card:hover {
                    transform: translateY(-12px) scale(1.02);
                    box-shadow: 0 30px 60px -20px rgba(0,0,0,0.2);
                }
                
                .feature-card {
                    transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
                }
                .feature-card:hover {
                    transform: translateY(-8px);
                    background: rgba(255,255,255,0.1);
                }
                
                .floating-icon {
                    animation: float 6s ease-in-out infinite;
                }
                .floating-icon-delayed {
                    animation: float-delayed 6s ease-in-out 1s infinite;
                }
                
                .btn-glow {
                    transition: all 0.3s ease;
                }
                .btn-glow:hover {
                    box-shadow: 0 0 25px rgba(99, 102, 241, 0.5);
                }
                
                .gradient-border {
                    position: relative;
                    background: linear-gradient(135deg, rgba(99,102,241,0.1), rgba(14,165,233,0.1));
                    border: 2px solid transparent;
                    background-clip: padding-box;
                }
                .gradient-border::before {
                    content: '';
                    position: absolute;
                    top: -2px;
                    left: -2px;
                    right: -2px;
                    bottom: -2px;
                    background: linear-gradient(135deg, #6366f1, #0ea5e9, #8b5cf6);
                    border-radius: inherit;
                    opacity: 0;
                    transition: opacity 0.3s ease;
                    z-index: -1;
                }
                .gradient-border:hover::before {
                    opacity: 1;
                }
            `}</style>

            {/* Animated Background */}
            <div className="fixed inset-0 overflow-hidden pointer-events-none -z-10">
                <div className="absolute top-20 left-10 w-72 h-72 bg-indigo-300 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-pulse"></div>
                <div className="absolute bottom-20 right-10 w-96 h-96 bg-blue-300 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-pulse delay-1000"></div>
                <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-purple-300 rounded-full mix-blend-multiply filter blur-3xl opacity-10 animate-pulse delay-2000"></div>
            </div>

            {/* NAVBAR */}
            <header className={`fixed top-0 left-0 w-full z-50 transition-all duration-300 ${scrolled ? 'glass-nav-scrolled' : 'glass-nav'}`}>
                <div className="flex justify-between items-center px-6 sm:px-12 py-4 max-w-7xl mx-auto">
                    <div className="group cursor-pointer">
                        <div className="text-3xl font-black tracking-tighter bg-gradient-to-r from-indigo-600 via-purple-600 to-teal-600 bg-clip-text text-transparent hover:scale-105 transition-transform">
                            FinUchet
                        </div>
                        <div className="h-0.5 bg-gradient-to-r from-indigo-600 to-teal-600 scale-x-0 group-hover:scale-x-100 transition-transform origin-left"></div>
                    </div>
                    <div className="flex gap-3 items-center">
                        <a href="/app" className="relative px-5 py-2.5 text-sm font-semibold text-slate-600 hover:text-indigo-600 transition-all group">
                            Войти
                            <span className="absolute bottom-0 left-1/2 w-0 h-0.5 bg-indigo-600 group-hover:w-full group-hover:left-0 transition-all"></span>
                        </a>
                        <a
                            href="/downloads/finuchet.apk"
                            download
                            className="relative px-7 py-2.5 text-sm font-bold text-white bg-gradient-to-r from-indigo-600 to-indigo-700 rounded-full shadow-lg shadow-indigo-200/50 hover:shadow-indigo-300/50 transition-all hover:-translate-y-0.5 active:translate-y-0 overflow-hidden group"
                        >
                            <span className="relative z-10">Скачать</span>
                            <div className="absolute inset-0 bg-gradient-to-r from-indigo-700 to-indigo-800 transform translate-y-full group-hover:translate-y-0 transition-transform"></div>
                        </a>
                    </div>
                </div>
            </header>

            {/* HERO SECTION */}
            <section className="relative pt-32 pb-20 px-6 overflow-hidden">
                <div className="max-w-6xl mx-auto text-center">
                    {/* Badge */}
                    <div className="inline-flex items-center gap-2 bg-indigo-50 border border-indigo-200 rounded-full px-4 py-2 mb-8 fade-up">
                        <span className="w-2 h-2 bg-indigo-600 rounded-full animate-pulse"></span>
                        <span className="text-sm font-semibold text-indigo-700">✨ Новая версия 2.0</span>
                    </div>

                    <h1 className="text-6xl md:text-8xl font-black tracking-tight leading-[1.1] fade-up">
                        Учет рассрочек
                        <div className="relative inline-block ml-4">
                            <span className="bg-gradient-to-r from-indigo-600 via-purple-600 to-teal-600 bg-clip-text text-transparent animate-gradient">
                                без суеты
                            </span>
                            <div className="absolute -bottom-2 left-0 w-full h-3 bg-gradient-to-r from-indigo-200 to-teal-200 rounded-full blur-sm"></div>
                        </div>
                    </h1>

                    <p className="text-xl md:text-2xl text-slate-500 mt-8 max-w-3xl mx-auto leading-relaxed fade-up delay-1 font-medium">
                        Управляйте договорами, отслеживайте платежи и считайте прибыль
                        <br className="hidden md:block" />
                        инвесторов в современном интерфейсе.
                    </p>

                    <div className="flex justify-center gap-4 mt-12 flex-wrap fade-up delay-2">
                        <a
                            href="/downloads/finuchet.apk"
                            download
                            className="btn-glow flex items-center gap-3 bg-gradient-to-r from-slate-900 to-slate-800 text-white px-8 py-4 rounded-2xl font-bold shadow-2xl hover:shadow-indigo-500/25 transition-all hover:scale-105 active:scale-95 group"
                        >
                            <span className="text-2xl group-hover:animate-bounce">📱</span>
                            <span>Скачать для Android</span>
                            <span className="text-xs opacity-60">APK</span>
                        </a>
                        <a
                            href="/downloads/finuchet-setup.exe"
                            download
                            className="flex items-center gap-3 bg-white/80 backdrop-blur-sm text-slate-900 border-2 border-slate-200 px-8 py-4 rounded-2xl font-bold shadow-sm hover:border-indigo-400 hover:shadow-xl transition-all hover:scale-105 active:scale-95 group"
                        >
                            <span className="text-2xl group-hover:rotate-12 transition-transform">🪟</span>
                            <span>Windows</span>
                        </a>
                    </div>

                    {/* Stats */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mt-20 pt-8 border-t border-slate-200">
                        {[
                            { value: "100+", label: "Активных пользователей", icon: "👥" },
                            { value: "₽50M+", label: "Учтено средств", icon: "💰" },
                            { value: "99.9%", label: "Доступность", icon: "⚡" },
                            { value: "24/7", label: "Поддержка", icon: "🎧" }
                        ].map((stat, idx) => (
                            <div key={idx} className={`text-center fade-up delay-${idx + 3}`}>
                                <div className="text-3xl mb-2">{stat.icon}</div>
                                <div className="text-2xl md:text-3xl font-black text-slate-900">{stat.value}</div>
                                <div className="text-sm text-slate-500 mt-1">{stat.label}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* SCREENSHOTS SECTION */}
            <section className="max-w-7xl mx-auto py-20 px-6">
                <div className="text-center mb-16">
                    <span className="inline-block px-4 py-1 bg-indigo-50 text-indigo-600 font-bold tracking-wider uppercase text-sm rounded-full fade-up">
                        Интерфейс
                    </span>
                    <h2 className="text-4xl md:text-5xl font-black mt-4 fade-up delay-1">
                        Всё под контролем
                    </h2>
                    <p className="text-xl text-slate-500 mt-4 fade-up delay-2">
                        Интуитивно понятный интерфейс для эффективной работы
                    </p>
                </div>

                <div className="grid md:grid-cols-3 gap-8 lg:gap-12">
                    {[
                        { title: "Аналитика продаж", desc: "Интерактивные графики и отчеты", icon: "📊", img: "/screens/dashboard.png" },
                        { title: "Управление договорами", desc: "Автоматические напоминания", icon: "📄", img: "/screens/contracts.png" },
                        { title: "База клиентов", desc: "Полная история взаимодействий", icon: "👤", img: "/screens/customers.png" }
                    ].map((item, idx) => (
                        <div key={idx} className={`group fade-up delay-${idx + 1}`}>
                            <div className="screen-card rounded-3xl overflow-hidden bg-white shadow-xl relative">
                                <div className="absolute inset-0 bg-gradient-to-t from-indigo-600/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity z-10"></div>
                                <img src={item.img} alt={item.title} className="w-full h-auto transform group-hover:scale-105 transition-transform duration-500" />
                                <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity z-20">
                                    <p className="text-white font-medium">{item.desc}</p>
                                </div>
                            </div>
                            <div className="text-center mt-6">
                                <div className="text-3xl mb-2">{item.icon}</div>
                                <h3 className="font-bold text-xl group-hover:text-indigo-600 transition-colors">
                                    {item.title}
                                </h3>
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            {/* FEATURES SECTION */}
            <section className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 py-24 text-white relative overflow-hidden">
                <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500 rounded-full filter blur-3xl opacity-10"></div>
                <div className="absolute bottom-0 left-0 w-96 h-96 bg-purple-500 rounded-full filter blur-3xl opacity-10"></div>

                <div className="max-w-7xl mx-auto px-6 relative z-10">
                    <div className="text-center mb-16">
                        <span className="inline-block px-4 py-1 bg-white/10 text-indigo-300 font-bold tracking-wider uppercase text-sm rounded-full backdrop-blur-sm">
                            Преимущества
                        </span>
                        <h2 className="text-4xl md:text-5xl font-black mt-4">
                            Почему выбирают FinUchet
                        </h2>
                    </div>

                    <div className="grid md:grid-cols-3 gap-8">
                        {[
                            { icon: "⚡", title: "Мгновенный старт", desc: "Импортируйте данные и начинайте работу за 5 минут. Без сложного обучения и настройки.", color: "from-yellow-500 to-orange-500" },
                            { icon: "☁️", title: "Облачная синхронизация", desc: "Данные всегда под рукой на любом устройстве. Работайте офлайн — синхронизация автоматическая.", color: "from-blue-500 to-cyan-500" },
                            { icon: "🔒", title: "Безопасность данных", desc: "SSL шифрование, двухфакторная аутентификация и разграничение прав доступа.", color: "from-green-500 to-emerald-500" }
                        ].map((feature, idx) => (
                            <div key={idx} className="feature-card group relative bg-white/5 backdrop-blur-sm rounded-2xl p-8 border border-white/10 hover:border-indigo-500/50 transition-all">
                                <div className={`absolute inset-0 bg-gradient-to-br ${feature.color} opacity-0 group-hover:opacity-10 rounded-2xl transition-opacity`}></div>
                                <div className="relative">
                                    <div className="text-5xl mb-4 floating-icon">{feature.icon}</div>
                                    <h3 className="text-2xl font-bold mb-3">{feature.title}</h3>
                                    <p className="text-slate-300 leading-relaxed">{feature.desc}</p>
                                    <div className="mt-6 h-0.5 w-12 bg-gradient-to-r from-indigo-500 to-transparent group-hover:w-full transition-all"></div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* IOS PWA SECTION */}
            <section className="py-24 flex justify-center px-6 relative">
                <div className="max-w-3xl w-full bg-gradient-to-br from-indigo-600 via-purple-600 to-indigo-700 rounded-[3rem] p-12 md:p-16 text-center text-white shadow-2xl relative overflow-hidden group">
                    <div className="absolute -top-40 -right-40 w-80 h-80 bg-white/10 rounded-full blur-3xl"></div>
                    <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-purple-500/20 rounded-full blur-3xl"></div>

                    <div className="relative z-10">
                        <div className="text-6xl mb-6 floating-icon">📱</div>
                        <h2 className="text-4xl md:text-5xl font-bold mb-4">Используете iPhone?</h2>
                        <p className="text-indigo-100 text-lg mb-8">FinUchet работает как PWA — устанавливайте на главный экран за пару касаний</p>

                        <div className="inline-flex flex-col items-start gap-4 text-left bg-white/10 p-6 rounded-2xl backdrop-blur-md border border-white/20">
                            {[
                                "Нажмите «Войти» в навигации",
                                "Кнопка «Поделиться» (квадрат со стрелкой)",
                                "Выберите «На экран Домой»"
                            ].map((step, idx) => (
                                <div key={idx} className="flex items-center gap-4 group/item">
                                    <div className="w-10 h-10 rounded-full bg-white text-indigo-600 flex items-center justify-center font-bold text-lg group-hover/item:scale-110 transition-transform">
                                        {idx + 1}
                                    </div>
                                    <span className="text-white/90 group-hover/item:text-white transition-colors">
                                        {step}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </section>

            {/* CTA SECTION */}
            <section className="py-20 px-6">
                <div className="max-w-4xl mx-auto text-center">
                    <div className="gradient-border rounded-3xl p-12 md:p-16">
                        <h2 className="text-3xl md:text-4xl font-black mb-4">
                            Готовы оптимизировать учет?
                        </h2>
                        <p className="text-xl text-slate-600 mb-8">
                            Присоединяйтесь к тысячам компаний, которые уже используют FinUchet
                        </p>
                        <div className="flex justify-center gap-4 flex-wrap">
                            <a
                                href="/downloads/finuchet.apk"
                                download
                                className="px-8 py-4 bg-gradient-to-r from-indigo-600 to-indigo-700 text-white rounded-xl font-bold shadow-lg hover:shadow-xl transition-all hover:-translate-y-1"
                            >
                                Начать бесплатно
                            </a>
                            <a
                                href="/demo"
                                className="px-8 py-4 bg-white border-2 border-slate-200 text-slate-700 rounded-xl font-bold hover:border-indigo-400 transition-all"
                            >
                                Демо-версия
                            </a>
                        </div>
                    </div>
                </div>
            </section>

            {/* FOOTER */}
            <footer className="py-12 border-t border-slate-200 bg-white/50 backdrop-blur-sm">
                <div className="max-w-7xl mx-auto px-6">
                    <div className="flex flex-col md:flex-row justify-between items-center gap-6">
                        <div className="text-2xl font-black bg-gradient-to-r from-indigo-600 to-teal-600 bg-clip-text text-transparent">
                            FinUchet
                        </div>
                        <div className="flex gap-8">
                            {["О нас", "Блог", "Поддержка", "Политика"].map(item => (
                                <a key={item} href="#" className="text-slate-500 hover:text-indigo-600 transition-colors text-sm font-medium">
                                    {item}
                                </a>
                            ))}
                        </div>
                        <div className="flex gap-4">
                            {["🐦", "💼", "📘"].map((social, idx) => (
                                <a key={idx} href="#" className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center hover:bg-indigo-100 hover:scale-110 transition-all">
                                    <span className="text-lg">{social}</span>
                                </a>
                            ))}
                        </div>
                    </div>
                    <div className="text-center mt-8 pt-8 border-t border-slate-100">
                        <p className="text-slate-400 text-sm">
                            © 2026 FinUchet. Сделано для эффективного бизнеса. Все права защищены.
                        </p>
                    </div>
                </div>
            </footer>
        </div>
    )
}