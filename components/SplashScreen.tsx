import "./SplashScreen.css"

// Если вам нужно убрать сплеш-скрин через время, добавьте таймер в useEffect
// Если он должен висеть вечно (пока приложение грузится), оставьте так.

export default function SplashScreen() {
  return (
    <div className="splash">
      {/* Убедитесь, что путь к картинке правильный */}
      <img src="/splash.png" className="logo" alt="App Logo" />
    </div>
  )
}
