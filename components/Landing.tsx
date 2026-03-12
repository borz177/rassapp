import React from "react"

export default function Landing() {
    return (
        <div className="min-h-screen bg-white font-['Inter',sans-serif]">

            {/* Стили для шрифта и анимаций добавим через style блок или CDN — в React можно использовать глобальные стили или CSS-файл, но для примера оставим комментарий */}
            <style jsx>{`
                @import url('https://fonts.googleapis.com/css2?family=Inter:opsz@14..32&display=swap');
                .fade-up {
                    animation: fadeUp 0.6s ease-out both;
                }
                @keyframes fadeUp {
                    0% { opacity: 0; transform: translateY(12px); }
                    100% { opacity: 1; transform: translateY(0); }
                }
                .delay-1 { animation-delay: 0.1s; }
                .delay-2 { animation-delay: 0.2s; }
                .delay-3 { animation-delay: 0.3s; }
                .hover-grow {
                    transition: transform 0.2s ease, box-shadow 0.2s ease;
                }
                .hover-grow:hover {
                    transform: scale(1.02);
                    box-shadow: 0 25px 40px -15px rgba(0,0,0,0.2);
                }
                .btn-shadow {
                    box-shadow: 0 8px 20px -6px rgba(0,0,0,0.1);
                }
            `}</style>

            {/* НАВБАР с эффектом стекла */}
            <header className="fixed top-0 left-0 w-full z-50 backdrop-blur-md bg-white/70 border-b border-slate-200/60">
                <div className="flex justify-between items-center px-6 sm:px-8 py-4 max-w-7xl mx-auto">
                    <div className="text-2xl font-bold bg-gradient-to-r from-indigo-800 to-teal-700 bg-clip-text text-transparent tracking-tight">
                        FinUchet
                    </div>
                    <div className="flex gap-3 items-center">
                        <a
                            href="/app"
                            className="px-5 py-2.5 text-sm font-medium text-slate-700 hover:text-indigo-700 border border-slate-300 hover:border-indigo-300 rounded-full transition-all duration-200 bg-white/70 backdrop-blur-sm btn-shadow"
                        >
                            Войти
                        </a>
                        <a
                            href="/downloads/app-release.apk"
                            className="px-5 py-2.5 text-sm font-medium text-white bg-gradient-to-r from-indigo-800 to-teal-700 rounded-full shadow-lg hover:shadow-indigo-200/50 transition-transform hover:scale-105"
                        >
                            Скачать
                        </a>
                    </div>
                </div>
            </header>

            {/* Отступ под фиксированный хедер */}
            <div className="pt-20"></div>

            {/* HERO секция */}
            <section className="text-center py-20 px-6 bg-gradient-to-b from-white via-indigo-50/20 to-white">
                <div className="max-w-4xl mx-auto">
                    <h1 className="text-5xl md:text-6xl font-extrabold text-slate-900 leading-tight fade-up">
                        Управление рассрочками
                        <br />
                        <span className="bg-gradient-to-r from-indigo-700 to-teal-600 bg-clip-text text-transparent">
                            и клиентами
                        </span>
                    </h1>
                    <p className="text-xl text-slate-600 mt-6 max-w-2xl mx-auto leading-relaxed fade-up delay-1">
                        FinUchet помогает управлять договорами, платежами и инвесторами в одном элегантном приложении.
                    </p>
                    <div className="flex justify-center gap-4 mt-12 flex-wrap fade-up delay-2">
                        <a
                            href="/downloads/FinUchet Setup 1.0.exe"
                            className="group bg-black text-white px-7 py-3.5 rounded-full text-base font-medium shadow-xl hover:bg-slate-800 transition flex items-center gap-2"
                        >
                            <span>⬇️</span> Скачать для Windows
                        </a>
                        <a
                            href="/downloads/FinUchet.apk"
                            className="group bg-emerald-600 text-white px-7 py-3.5 rounded-full text-base font-medium shadow-xl hover:bg-emerald-700 transition flex items-center gap-2"
                        >
                            <span>📱</span> Скачать Android
                        </a>
                        <a
                            href="/app"
                            className="border border-slate-300 bg-white/80 backdrop-blur-sm px-7 py-3.5 rounded-full text-base font-medium text-slate-700 shadow-md hover:border-indigo-300 hover:text-indigo-700 transition"
                        >
                            Веб-версия
                        </a>
                    </div>
                </div>
            </section>

            {/* Секция интерфейса */}
            <section className="max-w-7xl mx-auto py-28 px-6">
                <h2 className="text-4xl font-bold text-center mb-6 text-slate-800">
                    Интерфейс, в котором приятно работать
                </h2>
                <p className="text-center text-slate-500 max-w-2xl mx-auto mb-16 text-lg">
                    Интуитивные экраны для контроля финансов, клиентов и рассрочек.
                </p>
                <div className="grid md:grid-cols-3 gap-8 lg:gap-10">
                    {/* Вместо изображений используем плейсхолдеры - замените на реальные пути /screens/dashboard.png и т.д. */}
                    <div className="rounded-2xl shadow-2xl bg-gradient-to-br from-slate-700 to-indigo-900 aspect-[4/3] flex items-center justify-center text-white text-opacity-40 text-2xl font-light hover-grow transition-all duration-300 border border-white/20">
                        📊 Дашборд
                    </div>
                    <div className="rounded-2xl shadow-2xl bg-gradient-to-br from-indigo-800 to-teal-700 aspect-[4/3] flex items-center justify-center text-white text-opacity-40 text-2xl font-light hover-grow transition-all duration-300 border border-white/20">
                        📄 Договоры
                    </div>
                    <div className="rounded-2xl shadow-2xl bg-gradient-to-br from-teal-700 to-emerald-600 aspect-[4/3] flex items-center justify-center text-white text-opacity-40 text-2xl font-light hover-grow transition-all duration-300 border border-white/20">
                        👥 Клиенты
                    </div>
                </div>
                {/* Пример с реальными изображениями (закомментировано, если нужны img-теги) */}
                {/* <img src="/screens/dashboard.png" className="rounded-xl shadow-xl" alt="dashboard" /> */}
            </section>

            {/* Преимущества */}
            <section className="bg-slate-50/80 py-28 backdrop-blur-sm">
                <div className="max-w-7xl mx-auto grid md:grid-cols-3 gap-12 px-6">
                    <div className="bg-white p-8 rounded-3xl shadow-md hover:shadow-xl transition-shadow border border-slate-100">
                        <div className="w-14 h-14 rounded-2xl bg-indigo-100 text-indigo-800 flex items-center justify-center text-3xl mb-6">
                            💰
                        </div>
                        <h3 className="font-bold text-2xl mb-2">Контроль платежей</h3>
                        <p className="text-slate-500 leading-relaxed">
                            Автоматический расчет долгов, пеней и графиков платежей. Никаких пропусков.
                        </p>
                    </div>
                    <div className="bg-white p-8 rounded-3xl shadow-md hover:shadow-xl transition-shadow border border-slate-100">
                        <div className="w-14 h-14 rounded-2xl bg-emerald-100 text-emerald-800 flex items-center justify-center text-3xl mb-6">
                            👤
                        </div>
                        <h3 className="font-bold text-2xl mb-2">Карточка клиента</h3>
                        <p className="text-slate-500 leading-relaxed">
                            Полная история покупок, контакты, напоминания — всё в одном окне.
                        </p>
                    </div>
                    <div className="bg-white p-8 rounded-3xl shadow-md hover:shadow-xl transition-shadow border border-slate-100">
                        <div className="w-14 h-14 rounded-2xl bg-amber-100 text-amber-800 flex items-center justify-center text-3xl mb-6">
                            📈
                        </div>
                        <h3 className="font-bold text-2xl mb-2">Инвесторы</h3>
                        <p className="text-slate-500 leading-relaxed">
                            Автоматический расчет прибыли инвесторов по каждому договору.
                        </p>
                    </div>
                </div>
            </section>

            {/* Секция загрузки + инструкция для iPhone */}
            <section className="py-28 text-center bg-gradient-to-b from-white to-indigo-50/30">
                <div className="max-w-3xl mx-auto px-6">
                    <h2 className="text-4xl font-bold text-slate-800">Скачать FinUchet</h2>
                    <p className="text-slate-500 mt-4 text-lg">
                        Выберите удобную платформу и начните управлять рассрочками за минуту.
                    </p>
                    <div className="flex flex-wrap justify-center gap-5 mt-12">
                        <a
                            href="/downloads/finuchet-setup.exe"
                            className="bg-black hover:bg-slate-800 text-white px-8 py-4 rounded-2xl text-lg shadow-2xl flex items-center gap-3 transition hover:scale-105"
                        >
                            <span className="text-2xl">🪟</span> Windows
                        </a>
                        <a
                            href="/downloads/FinUchet.apk"
                            className="bg-emerald-600 hover:bg-emerald-700 text-white px-8 py-4 rounded-2xl text-lg shadow-2xl flex items-center gap-3 transition hover:scale-105"
                        >
                            <span className="text-2xl">📲</span> Android
                        </a>
                        <a
                            href="/app"
                            className="border-2 border-indigo-200 bg-white/70 text-indigo-800 px-8 py-4 rounded-2xl text-lg shadow-lg flex items-center gap-3 transition hover:border-indigo-400 hover:bg-white"
                        >
                            <span className="text-2xl">🌐</span> Web-версия
                        </a>
                    </div>

                    {/* iPhone инструкция карточкой */}
                    <div className="mt-16 p-6 bg-white/80 backdrop-blur-sm rounded-3xl border border-slate-200/60 inline-block text-left shadow-xl">
                        <div className="flex items-center gap-3 text-slate-700">
                            <span className="text-3xl">📱</span>
                            <span className="font-semibold text-lg">Для iPhone:</span>
                        </div>
                        <ol className="list-decimal list-inside mt-3 text-slate-600 space-y-1 pl-4">
                            <li>
                                Нажмите кнопку <span className="bg-slate-100 px-2 py-0.5 rounded">Войти</span>
                            </li>
                            <li>
                                Нажмите <span className="bg-slate-100 px-2 py-0.5 rounded">Поделиться</span> в браузере
                            </li>
                            <li>
                                Выберите <span className="bg-slate-100 px-2 py-0.5 rounded">На экран «Домой»</span>
                            </li>
                        </ol>
                    </div>
                </div>
            </section>

            {/* Футер */}
            <footer className="text-center py-12 border-t border-slate-200 text-slate-400 text-sm bg-white">
                <div className="space-x-6 mb-3">
                    <a href="#" className="hover:text-indigo-600 transition">
                        Политика
                    </a>
                    <a href="#" className="hover:text-indigo-600 transition">
                        Поддержка
                    </a>
                    <a href="#" className="hover:text-indigo-600 transition">
                        Документация
                    </a>
                </div>
                <p>© 2026 FinUchet. Все права защищены.</p>
            </footer>

            {/* Декоративная полоска */}
            <div className="h-2 w-full bg-gradient-to-r from-indigo-200 via-teal-200 to-indigo-200"></div>
        </div>
    )
}