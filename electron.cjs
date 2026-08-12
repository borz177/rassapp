const { app, BrowserWindow } = require("electron")
const path = require("path")
function createWindow() {
  const win = new BrowserWindow({
  width: 1300,
  height: 900,
  title: "FinUchet",
  autoHideMenuBar: true,
  icon: path.join(__dirname, "build", "icon.ico"),

  webPreferences: {
    // Chromium по умолчанию душит таймеры в свёрнутом или перекрытом окне, и фоновая
    // синхронизация раз в 5 минут фактически переставала работать: приложение открыто,
    // но данные не обновлялись, пока окно не развернут. Для настольного приложения,
    // которое весь день висит рядом, это неверное поведение.
    backgroundThrottling: false,
  },

})



  win.setMenu(null)

  // Открываем сразу приложение, а не «/»: по корню отдаётся рекламный лендинг, и человек,
  // запустивший настольную программу, каждый раз видел страницу с предложением её скачать,
  // а до учёта добирался через кнопку «Войти».
  win.loadURL("https://rassrochka.pro/app")
}

app.whenReady().then(createWindow)