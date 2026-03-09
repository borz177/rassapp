import React from "react"

export default function Landing() {
    return (
        <div className="min-h-screen bg-white">

            {/* NAVBAR */}

            <header className="flex justify-between items-center px-8 py-6 max-w-7xl mx-auto">

                <div className="text-2xl font-bold">
                    FinUchet
                </div>

                <div className="flex gap-4">

                    <a
                        href="/app"
                        className="px-4 py-2 border rounded-lg"
                    >
                        Войти
                    </a>

                    <a
                        href="/downloads/app-release.apk"
                        className="px-4 py-2 bg-black text-white rounded-lg"
                    >
                        Скачать
                    </a>

                </div>

            </header>


            {/* HERO */}

            <section className="text-center py-24 px-6">

                <h1 className="text-5xl font-bold text-slate-900">
                    Управление рассрочками
                    <br/>
                    и клиентами
                </h1>

                <p className="text-xl text-slate-500 mt-6 max-w-xl mx-auto">
                    FinUchet помогает управлять договорами,
                    платежами и инвесторами в одном приложении
                </p>

                <div className="flex justify-center gap-4 mt-10 flex-wrap">

                    <a
                        href="/downloads/FinUchet Setup.exe"
                        className="bg-black text-white px-6 py-3 rounded-xl"
                    >
                        Скачать для Windows
                    </a>

                    <a
                        href="/downloads/app-release.apk"
                        className="bg-green-600 text-white px-6 py-3 rounded-xl"
                    >
                        Скачать Android
                    </a>

                    <a
                        href="/app"
                        className="border px-6 py-3 rounded-xl"
                    >
                        Войти в приложение
                    </a>

                </div>

            </section>


            <section className="max-w-6xl mx-auto py-24 px-6">

                <h2 className="text-3xl font-bold text-center mb-16">
                    Интерфейс приложения
                </h2>

                <div className="grid md:grid-cols-3 gap-8">

                    <img src="/screens/dashboard.png" className="rounded-xl shadow-xl"/>

                    <img src="/screens/contracts.png" className="rounded-xl shadow-xl"/>

                    <img src="/screens/customers.png" className="rounded-xl shadow-xl"/>

                </div>

            </section>


            <section className="bg-slate-50 py-24">

                <div className="max-w-6xl mx-auto grid md:grid-cols-3 gap-10 px-6">

                    <div>
                        <h3 className="font-bold text-xl">
                            Контроль платежей
                        </h3>
                        <p className="text-slate-500 mt-2">
                            Автоматический расчет долгов
                        </p>
                    </div>

                    <div>
                        <h3 className="font-bold text-xl">
                            Клиенты
                        </h3>
                        <p className="text-slate-500 mt-2">
                            Полная история покупок
                        </p>
                    </div>

                    <div>
                        <h3 className="font-bold text-xl">
                            Инвесторы
                        </h3>
                        <p className="text-slate-500 mt-2">
                            Автоматический расчет прибыли
                        </p>
                    </div>

                </div>

            </section>


            <section className="py-24 text-center">

                <h2 className="text-3xl font-bold">
                    Скачать FinUchet
                </h2>

                <div className="flex justify-center gap-6 mt-10 flex-wrap">

                    <section className="py-24 text-center">

                        <h2 className="text-3xl font-bold">
                            Скачать FinUchet
                        </h2>

                        <div className="flex justify-center gap-6 mt-10 flex-wrap">

                            ```
                            <a
                                href="/downloads/finuchet-setup.exe"
                                className="bg-black text-white px-8 py-4 rounded-xl"
                            >
                                Скачать для Windows
                            </a>

                            <a
                                href="/downloads/FinUchet.apk"
                                className="bg-green-600 text-white px-8 py-4 rounded-xl"
                            >
                                Скачать для Android
                            </a>

                            <a
                                href="/app"
                                className="border px-8 py-4 rounded-xl"
                            >
                                Открыть Web
                            </a>
                            ```

                        </div>

                    </section>


                </div>

            </section>
            <div className="text-sm text-slate-500 mt-6">

                Для iPhone:
                <br/>

                1. Нажмите кнопку <b>Войти</b>
                <br/>
                2. Нажмите <b>Поделиться</b>
                <br/>
                3. Выберите <b>На экран Домой</b>

            </div>


            <footer className="text-center py-10 text-slate-400">
                © 2026 FinUchet
            </footer>

        </div>
    )
}

