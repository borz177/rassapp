const { app, BrowserWindow } = require("electron")
const path = require("path")
function createWindow() {
  const win = new BrowserWindow({
  width: 1300,
  height: 900,
  title: "FinUchet",
  autoHideMenuBar: true,
  icon: path.join(__dirname, "build", "icon.ico")
})

  win.setMenu(null)

  win.loadURL("https://rassrochka.pro")
}

app.whenReady().then(createWindow)