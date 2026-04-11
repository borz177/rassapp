const { app, BrowserWindow } = require("electron")
const path = require("path")
function createWindow() {
  const win = new BrowserWindow({
  width: 1300,
  height: 900,
  title: "FinUchet",
  autoHideMenuBar: true,
  icon: path.join(__dirname, "build", "icon.ico"),


   frame: false,

    // 🔹 Цвет фона при загрузке (должен совпадать с navbar.bg)
    backgroundColor: '#1e1b4b',

    // 🔹 Показывать окно после загрузки
    show: false,

})



  win.setMenu(null)

  win.loadURL("https://rassrochka.pro")
}

app.whenReady().then(createWindow)