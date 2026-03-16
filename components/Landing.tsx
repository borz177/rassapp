import React from "react"

export default function Landing() {
    return (
        <div className="min-h-screen bg-white font-['Inter',sans-serif] text-slate-900">
            <style jsx>{`
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
                
                .fade-up {
                    animation: fadeUp 0.8s cubic-bezier(0.2, 0.8, 0.2, 1) both;
                }
                @keyframes fadeUp {
                    0% { opacity: 0; transform: translateY(20px); }
                    100% { opacity: 1; transform: translateY(0); }
                }
                .delay-1 { animation-delay: 0.15s; }
                .delay-2 { animation-delay: 0.3s; }
                
                .screen-card {
                    transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
                }
                .screen-card:hover {
                    transform: translateY(-8px) scale(1.01);
                    box-shadow: 0 30px 60px -12px rgba(0,0,0,0.15);
                }
                .glass-nav {
                    backdrop-filter: blur(12px);
                    background: rgba(255, 255, 255, 0.75);
                }
            `}</style>

            {/* НАВБАР */}
            <header className="fixed top-0 left-0 w-full z-50 glass-nav border-b border-slate-200/50">
                <div className="flex justify-between items-center px-6 sm:px-12 py-4 max-w-7xl mx-auto">
                    <div className="text-2xl font-extrabold tracking-tighter bg-gradient-to-r from-indigo-700 to-teal-600 bg-clip-text text-transparent">
                        FinUchet
                    </div>
                    <div className="flex gap-4 items-center">
                        <a href="/app" className="text-sm font-semibold text-slate-600 hover:text-indigo-600 transition-colors">
                            Войти
                        </a>
                        <a
                            href="/downloads/finuchet.apk"
                            download
                            className="px-6 py-2.5 text-sm font-bold text-white bg-indigo-600 rounded-full shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all hover:-translate-y-0.5"
                        >
                            Скачать
                        </a>
                    </div>
                </div>
            </header>

            {/* HERO */}
            <section className="relative pt-32 pb-20 px-6 overflow-hidden">
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-indigo-50/50 via-transparent to-transparent -z-10"></div>

                <div className="max-w-5xl mx-auto text-center">
                    <h1 className="text-5xl md:text-7xl font-[800] text-slate-900 tracking-tight leading-[1.1] fade-up">
                        Учет рассрочек <br/>
                        <span className="text-indigo-600">без лишней суеты</span>
                    </h1>
                    <p className="text-xl text-slate-500 mt-8 max-w-2xl mx-auto leading-relaxed fade-up delay-1 font-medium">
                        Управляйте договорами, отслеживайте платежи и считайте прибыль инвесторов в одном интерфейсе.
                    </p>

                    <div className="flex justify-center gap-4 mt-12 flex-wrap fade-up delay-2">
                        <a
                            href="/downloads/finuchet.apk"
                            download
                            className="flex items-center gap-3 bg-slate-900 text-white px-8 py-4 rounded-2xl font-bold shadow-2xl hover:bg-slate-800 transition-all hover:scale-105 active:scale-95"
                        >
                            <span className="text-xl">📱</span> Android APK
                        </a>
                        <a
                            href="/downloads/finuchet-setup.exe"
                            download
                            className="flex items-center gap-3 bg-white text-slate-900 border-2 border-slate-200 px-8 py-4 rounded-2xl font-bold shadow-sm hover:border-indigo-400 transition-all hover:scale-105 active:scale-95"
                        >
                            <span className="text-xl">🪟</span> Windows
                        </a>
                    </div>
                </div>
            </section>

            {/* ВИЗУАЛИЗАЦИЯ ИНТЕРФЕЙСА */}
            <section className="max-w-7xl mx-auto py-20 px-6">
                <div className="text-center mb-16">
                    <span className="text-indigo-600 font-bold tracking-widest uppercase text-sm">Скриншоты</span>
                    <h2 className="text-4xl font-extrabold mt-2">Всё под контролем</h2>
                </div>

                <div className="grid md:grid-cols-3 gap-8">
                    {/* Dashboard */}
                    <div className="group">
                        <div className="screen-card rounded-3xl overflow-hidden border border-slate-200 bg-slate-50 shadow-xl">
                            <img src="/screens/dashboard.png" alt="Dashboard" className="w-full h-auto" />
                        </div>
                        <h3 className="text-center mt-6 font-bold text-lg group-hover:text-indigo-600 transition-colors text-slate-700">Аналитика продаж</h3>
                    </div>

                    {/* Contracts */}
                    <div className="group">
                        <div className="screen-card rounded-3xl overflow-hidden border border-slate-200 bg-slate-50 shadow-xl">
                            <img src="/screens/contracts.png" alt="Contracts" className="w-full h-auto" />
                        </div>
                        <h3 className="text-center mt-6 font-bold text-lg group-hover:text-indigo-600 transition-colors text-slate-700">Управление договорами</h3>
                    </div>

                    {/* Customers */}
                    <div className="group">
                        <div className="screen-card rounded-3xl overflow-hidden border border-slate-200 bg-slate-50 shadow-xl">
                            <img src="/screens/customers.png" alt="Customers" className="w-full h-auto" />
                        </div>
                        <h3 className="text-center mt-6 font-bold text-lg group-hover:text-indigo-600 transition-colors text-slate-700">База клиентов</h3>
                    </div>
                </div>
            </section>

            {/* ПРЕИМУЩЕСТВА */}
            <section className="bg-slate-900 py-24 text-white">
                <div className="max-w-7xl mx-auto px-6 grid md:grid-cols-3 gap-12">
                    <div className="space-y-4">
                        <div className="text-4xl">⚡</div>
                        <h4 className="text-xl font-bold">Быстрый старт</h4>
                        <p className="text-slate-400">Импортируйте базу клиентов и начните работу за 5 минут без сложного обучения.</p>
                    </div>
                    <div className="space-y-4">
                        <div className="text-4xl">☁️</div>
                        <h4 className="text-xl font-bold">Облачная синхронизация</h4>
                        <p className="text-slate-400">Данные всегда под рукой: на ПК, планшете или телефоне. Работайте офлайн, синхронизация произойдет автоматически.</p>
                    </div>
                    <div className="space-y-4">
                        <div className="text-4xl">🔒</div>
                        <h4 className="text-xl font-bold">Безопасность</h4>
                        <p className="text-slate-400">Разграничение прав доступа для менеджеров и инвесторов. Ваши данные под надежной защитой.</p>
                    </div>
                </div>
            </section>

            {/* КАРТОЧКА IPHONE */}
            <section className="py-24 flex justify-center px-6">
                <div className="max-w-2xl w-full bg-gradient-to-br from-indigo-600 to-indigo-800 rounded-[3rem] p-10 md:p-16 text-center text-white shadow-2xl relative overflow-hidden">
                    <div className="relative z-10">
                        <h2 className="text-3xl md:text-4xl font-bold mb-6">Используете iPhone?</h2>
                        <p className="text-indigo-100 mb-10 text-lg">FinUchet работает как PWA. Установите его на главный экран за пару касаний.</p>

                        <div className="inline-flex flex-col items-start gap-4 text-left bg-white/10 p-6 rounded-2xl backdrop-blur-md border border-white/20">
                            <div className="flex items-center gap-3">
                                <span className="w-8 h-8 rounded-full bg-white text-indigo-600 flex items-center justify-center font-bold">1</span>
                                <span>Нажмите «Войти» в навигации</span>
                            </div>
                            <div className="flex items-center gap-3">
                                <span className="w-8 h-8 rounded-full bg-white text-indigo-600 flex items-center justify-center font-bold">2</span>
                                <span>Кнопка «Поделиться» (квадрат со стрелкой)</span>
                            </div>
                            <div className="flex items-center gap-3">
                                <span className="w-8 h-8 rounded-full bg-white text-indigo-600 flex items-center justify-center font-bold">3</span>
                                <span>Выберите «На экран Домой»</span>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* FOOTER */}
            <footer className="py-12 border-t border-slate-100 text-center">
                <p className="text-slate-400 font-medium">© 2026 FinUchet. Сделано для эффективного бизнеса.</p>
            </footer>
        </div>
    )
}