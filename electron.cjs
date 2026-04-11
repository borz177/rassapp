const { app, BrowserWindow } = require("electron")
const path = require("path")

function createWindow() {
  const win = new BrowserWindow({
    width: 1300,
    height: 900,
    title: "FinUchet",
    autoHideMenuBar: true,
    icon: path.join(__dirname, "build", "icon.ico"),

    // 🔹 Убираем стандартную рамку Windows
    frame: false,

    // 🔹 Цвет фона окна (должен совпадать с --navbar-bg вашей темы)
    // Для темы PURPLE/BLUE используем тёмный цвет, чтобы не было белой вспышки при загрузке
    backgroundColor: '#1e1b4b',

    // 🔹 Опционально: делаем окно чуть прозрачным при загрузке для плавности
    show: false,

    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js") // если есть
    }
  })

  win.setMenu(null)
  win.loadURL("https://rassrochka.pro")

  // 🔹 Показываем окно после загрузки, чтобы избежать мерцания
  win.once('ready-to-show', () => {
    win.show()
  })
}

app.whenReady().then(createWindow)

// Стандартные обработчики для macOS (если нужно)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})