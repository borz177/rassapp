import "./SplashScreen.css"

interface Props {
  progress: number
}

export default function SplashScreen({ progress }: Props) {

  return (
    <div className="splash">

      <img src="/splash.png" className="logo" />

      <div className="loader">

        <div
          className="bar"
          style={{ width: progress + "%" }}
        />

      </div>

     

    </div>
  )
}
