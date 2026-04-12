const { app, BrowserWindow } = require("electron")
const path = require("path")

function createWindow() {
  const win = new BrowserWindow({
    width: 1300,
    height: 900,
    title: "FinUchet",
    autoHideMenuBar: true,
    icon: path.join(__dirname, "build", "icon.ico"),

    // 🔹 Добавляем цвет заголовка окна (работает на Windows и Linux)
    titleBarOverlay: {
      color: '#4f46e5',        // Фон: ваш индиго (как в навбаре)
      symbolColor: '#ffffff',  // Иконки: белый цвет
      height: 45               // Высота панели (опционально)
    },

    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js") // если есть
    }
  })

  win.setMenu(null)
  win.loadURL("https://rassrochka.pro")
}

app.whenReady().then(createWindow)

// Для macOS: стандартный заголовок, titleBarOverlay игнорируется
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})