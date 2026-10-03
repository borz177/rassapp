const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
})

// По этому флагу сайт включает оформление «парящих» панелей: окно на Mac
// полупрозрачное (vibrancy), и боковая панель с содержимым висят над размытым
// рабочим столом отдельными карточками. См. .shell-floating в src/index.css.
contextBridge.exposeInMainWorld('finuchetShell', {
  platform: process.platform,
  floating: process.platform === 'darwin' || process.platform === 'win32',
})
