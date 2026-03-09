import "./SplashScreen.css"

interface Props {
  progress: number
}

export default function SplashScreen({ progress }: Props) {

  return (
    <div className="splash">

      <img src="/icon-512.png" className="logo" />

      <div className="loader">

        <div
          className="bar"
          style={{ width: progress + "%" }}
        />

      </div>

      <div className="text">

        {progress < 40 && "Подключение..."}
        {progress >= 40 && progress < 90 && "Загрузка данных..."}
        {progress >= 90 && "Почти готово..."}

      </div>

    </div>
  )
}