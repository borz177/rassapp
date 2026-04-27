export default function SplashScreen() {
  return (
    <div className="splash">
      <div className="logo-container">
        {/* Пульсирующие кольца */}
        <div className="pulse-ring"></div>
        <div className="pulse-ring"></div>
        <div className="pulse-ring"></div>

        {/* Свечение */}
        <div className="glow"></div>

        {/* Вращающаяся градиентная рамка */}
        <div className="gradient-border"></div>

        {/* Логотип */}
        <img src="/splash.png" className="logo" alt="App Logo" />
      </div>
    </div>
  )
}