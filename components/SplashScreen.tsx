import "./SplashScreen.css"
import { useEffect, useState } from "react"

export default function SplashScreen() {
  const [isVisible, setIsVisible] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(false)
      // Здесь переход на главный экран
    }, 2000) // 2 секунды

    return () => clearTimeout(timer)
  }, [])

  if (!isVisible) return null

  return (
    <div className="splash">
      <img src="/splash.png" className="logo" alt="Logo" />
    </div>
  )
}