import { APP_NAME, APP_VERSION } from '../constants';

/**
 * Экран загрузки, который React показывает, пока проверяется сессия и тянутся данные.
 *
 * Разметка и классы намеренно повторяют статический сплеш из index.html, а стили
 * не импортируются из отдельного CSS — они уже объявлены глобально в <head>, чтобы
 * появиться в первом кадре, до загрузки бандла. Благодаря общим классам передача
 * эстафеты от статической разметки к React проходит незаметно: раньше стили были
 * скопированы в двух местах, и логотип успевал проиграть анимацию появления дважды.
 *
 * Модификатор --settled отключает вступительную анимацию: к моменту, когда рендерится
 * этот компонент, логотип уже «прилетел» в статическом сплеше.
 */
export default function SplashScreen() {
  return (
    <div className="splash-screen splash-screen--settled">
      <div className="splash-brand">
        <img src="/splash.png" alt="" className="splash-logo" width={104} height={104} />
        <div style={{ textAlign: 'center' }}>
          <h1 className="splash-title">{APP_NAME}</h1>
          <p className="splash-subtitle">Учёт рассрочек и платежей</p>
        </div>
      </div>
      <div className="splash-progress" role="progressbar" aria-label="Загрузка приложения" />
      <span className="splash-version">{APP_VERSION}</span>
    </div>
  );
}
