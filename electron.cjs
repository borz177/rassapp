const { app, BrowserWindow, Menu, shell } = require("electron")
const path = require("path")

const APP_URL = "https://rassrochka.pro/app"
const isMac = process.platform === "darwin"

let win = null

function createWindow() {
  win = new BrowserWindow({
  width: 1300,
  height: 900,
  minWidth: 380,
  title: "FinUchet",
  autoHideMenuBar: true,
  // На Mac иконка берётся из сборки (.icns), а не из окна
  icon: isMac ? undefined : path.join(__dirname, "build", "icon.ico"),

  webPreferences: {
    // Chromium по умолчанию душит таймеры в свёрнутом или перекрытом окне, и фоновая
    // синхронизация раз в 5 минут фактически переставала работать: приложение открыто,
    // но данные не обновлялись, пока окно не развернут. Для настольного приложения,
    // которое весь день висит рядом, это неверное поведение.
    backgroundThrottling: false,
  },

})

  // На Windows меню не нужно. На Mac без него не работают Cmd+C / Cmd+V / Cmd+Q —
  // там оно своё, см. ниже.
  if (!isMac) win.setMenu(null)

  // Ссылки наружу (WhatsApp, оплата, документы) — в обычном браузере, а не новым
  // голым окном программы без адресной строки и кнопок «назад».
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url) && !url.startsWith("https://rassrochka.pro/")) {
      shell.openExternal(url)
      return { action: "deny" }
    }
    return { action: "allow" }
  })

  win.on("closed", () => { win = null })

  // Открываем сразу приложение, а не «/»: по корню отдаётся рекламный лендинг, и человек,
  // запустивший настольную программу, каждый раз видел страницу с предложением её скачать,
  // а до учёта добирался через кнопку «Войти».
  win.loadURL(APP_URL)
}

// Меню Mac — по-русски и с тем, без чего на Mac не работает клавиатура
function macMenu() {
  return Menu.buildFromTemplate([
    {
      label: "FinUchet",
      submenu: [
        { role: "about", label: "О программе FinUchet" },
        { type: "separator" },
        { role: "hide", label: "Скрыть FinUchet" },
        { role: "hideOthers", label: "Скрыть остальные" },
        { role: "unhide", label: "Показать все" },
        { type: "separator" },
        { role: "quit", label: "Завершить FinUchet" },
      ],
    },
    {
      label: "Правка",
      submenu: [
        { role: "undo", label: "Отменить" },
        { role: "redo", label: "Повторить" },
        { type: "separator" },
        { role: "cut", label: "Вырезать" },
        { role: "copy", label: "Копировать" },
        { role: "paste", label: "Вставить" },
        { role: "selectAll", label: "Выбрать всё" },
      ],
    },
    {
      label: "Вид",
      submenu: [
        { role: "reload", label: "Обновить" },
        { type: "separator" },
        { role: "resetZoom", label: "Фактический размер" },
        { role: "zoomIn", label: "Увеличить" },
        { role: "zoomOut", label: "Уменьшить" },
        { type: "separator" },
        { role: "togglefullscreen", label: "Во весь экран" },
      ],
    },
    {
      label: "Окно",
      submenu: [
        { role: "minimize", label: "Свернуть" },
        { role: "zoom", label: "Изменить масштаб окна" },
        { role: "close", label: "Закрыть окно" },
      ],
    },
  ])
}

app.whenReady().then(() => {
  if (isMac) Menu.setApplicationMenu(macMenu())
  createWindow()
  // Mac: клик по иконке в Dock после закрытия окна открывает его снова
  app.on("activate", () => { if (!win) createWindow() })
})

// На Mac закрытие окна не завершает программу — так принято; выход через Cmd+Q
app.on("window-all-closed", () => { if (!isMac) app.quit() })
