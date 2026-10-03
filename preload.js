const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
})

// По этому флагу сайт включает оформление «парящих» панелей: окно на Mac
// полупрозрачное (vibrancy), и боковая панель с содержимым висят над размытым
// рабочим столом отдельными карточками. См. .shell-floating в src/index.css.
//
// blur — окно умеет размывать то, что за ним: Mac (vibrancy) и Windows 11 22H2+
// (Acrylic, сборка 22621 — то же условие, что winAcrylic в electron.cjs). Только
// тогда панели висят отдельными карточками над рабочим столом. На Windows 10
// размытия нет, и вокруг карточек был бы сплошной фон окна — там панели встают
// от края до края (.shell-flat).
const winBuild = process.platform === 'win32'
  ? Number(String(process.getSystemVersion?.() || '').split('.')[2] || 0)
  : 0
contextBridge.exposeInMainWorld('finuchetShell', {
  platform: process.platform,
  floating: process.platform === 'darwin' || process.platform === 'win32',
  blur: process.platform === 'darwin' || winBuild >= 22621,
})
