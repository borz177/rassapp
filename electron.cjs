const { app, BrowserWindow, Menu, shell, protocol, net, session } = require("electron")
const path = require("path")
const fs = require("fs")
const { pathToFileURL } = require("url")

// FINUCHET_URL — для проверки оболочки против локальной сборки (npm run dev)
const APP_URL = process.env.FINUCHET_URL || "https://rassrochka.pro/app"
const isMac = process.platform === "darwin"

// ── Интерфейс внутри приложения (как в iOS-сборке) ─────────────────────────────
// Страницы, стили и скрипты берутся из сборки (dist/ внутри приложения), а не
// скачиваются с сайта: приложение открывается без интернета, а его вид не
// зависит от того, что сейчас выложено на сервере. Адрес при этом остаётся
// https://rassrochka.pro — меняется только то, откуда приходят файлы. Поэтому
// запросы к серверу (/api, /uploads) идут как раньше, без CORS, а вход и данные
// в памяти устройства у тех, кто уже пользовался приложением, сохраняются.
// FINUCHET_URL (проверка против npm run dev) этот режим выключает.
const DIST = path.join(__dirname, "dist")
const BUNDLED = !process.env.FINUCHET_URL && fs.existsSync(path.join(DIST, "index.html"))
const SERVER_HOST = "rassrochka.pro"
// Это отдаёт сервер, а не сборка
const SERVER_PATHS = /^\/(api|uploads|downloads)(\/|$)/

const isFile = (p) => { try { return fs.statSync(p).isFile() } catch { return false } }

function serveBundle() {
  protocol.handle("https", (request) => {
    const url = new URL(request.url)
    const local = url.hostname === SERVER_HOST
      && (request.method === "GET" || request.method === "HEAD")
      && !SERVER_PATHS.test(url.pathname)
    if (!local) return net.fetch(request, { bypassCustomProtocolHandlers: true })

    const file = path.join(DIST, decodeURIComponent(url.pathname))
    if (!file.startsWith(DIST)) return new Response("Not found", { status: 404 })
    // Файла нет — это адрес внутри приложения (/app, /calc…): отдаём index.html
    const target = isFile(file) ? file : path.join(DIST, "index.html")
    return net.fetch(pathToFileURL(target).toString())
  })
}

let win = null

function createWindow() {
  win = new BrowserWindow({
  width: 1300,
  height: 900,
  title: "FinUchet",
  autoHideMenuBar: true,
  // На Mac иконка берётся из сборки (.icns), а не из окна
  icon: isMac ? undefined : path.join(__dirname, "build", "icon.ico"),

  // Mac: окно без заголовка и полупрозрачное — боковая панель и содержимое висят
  // над размытым рабочим столом отдельными карточками. Кнопки окна встают внутрь
  // боковой панели. Уже 960 px окно не делаем: там сайт переходит на телефонную
  // раскладку с нижней навигацией, а она для этого оформления не рассчитана.
  ...(isMac ? {
    minWidth: 960,
    minHeight: 600,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 28, y: 30 },
    vibrancy: "under-window",
    visualEffectState: "active",
    backgroundColor: "#00000000",
  } : { minWidth: 380 }),

  webPreferences: {
    preload: path.join(__dirname, "preload.js"),
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

app.whenReady().then(async () => {
  if (isMac) Menu.setApplicationMenu(macMenu())
  if (BUNDLED) {
    serveBundle()
    // Service worker прежней версии (когда приложение открывало сайт) отдавал бы
    // из своего кэша старые файлы вместо сборки. Данные (вход, IndexedDB) не трогаем.
    await session.defaultSession.clearStorageData({ storages: ["serviceworkers", "cachestorage"] }).catch(() => {})
  }
  createWindow()
  // Mac: клик по иконке в Dock после закрытия окна открывает его снова
  app.on("activate", () => { if (!win) createWindow() })
})

// На Mac закрытие окна не завершает программу — так принято; выход через Cmd+Q
app.on("window-all-closed", () => { if (!isMac) app.quit() })
