import "./SplashScreen.css"

// 🔒 Этот компонент подхватывает эстафету у статического #static-splash (index.html), который
// виден мгновенно при открытии приложения ещё ДО загрузки JS — сюда логотип приходит уже полностью
// проявленным (без entrance-анимации), чтобы не было "скачка"/сброса в момент передачи. Проп
// closing включает плавное затухание перед тем, как App.tsx реально уберёт компонент из дерева.
export default function SplashScreen({ closing = false }: { closing?: boolean }) {
  return (
    <div className={`splash${closing ? ' closing' : ''}`}>
      <img src="/icon-192.png" className="logo" alt="App Logo" />
    </div>
  )
}