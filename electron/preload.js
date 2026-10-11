const { contextBridge, ipcRenderer } = require('electron')

// 渲染进程只通过这一层安全 API 访问文件系统，不直接 require node
contextBridge.exposeInMainWorld('md', {
  openFolder: () => ipcRenderer.invoke('openFolder'),
  readTree: (dir) => ipcRenderer.invoke('readTree', dir),
  listFiles: (dir) => ipcRenderer.invoke('listFiles', dir),
  scanNotes: (dir, selfPath) => ipcRenderer.invoke('scanNotes', dir, selfPath),
  readFile: (p) => ipcRenderer.invoke('readFile', p),
  writeFile: (p, content) => ipcRenderer.invoke('writeFile', p, content),
  createDir: (dir, name) => ipcRenderer.invoke('createDir', dir, name),
  createDoc: (dir, name) => ipcRenderer.invoke('createDoc', dir, name),
  createNavDoc: (dir, name) => ipcRenderer.invoke('createNavDoc', dir, name),
  saveAttachment: (arg) => ipcRenderer.invoke('saveAttachment', arg),
  archiveNote: (filePath, root) => ipcRenderer.invoke('archiveNote', filePath, root),
  deleteNote: (filePath, root) => ipcRenderer.invoke('deleteNote', filePath, root),
  listRecycle: (root) => ipcRenderer.invoke('listRecycle', root),
  restoreNote: (root, id) => ipcRenderer.invoke('restoreNote', root, id),
  purgeNote: (root, id) => ipcRenderer.invoke('purgeNote', root, id),
  emptyRecycle: (root) => ipcRenderer.invoke('emptyRecycle', root),
  copyText: (text) => ipcRenderer.invoke('copyText', text),
  exportPdf: (arg) => ipcRenderer.invoke('exportPdf', arg),
  readImage: (p) => ipcRenderer.invoke('readImage', p),
  getConfig: () => ipcRenderer.invoke('getConfig'),
  getDefaults: () => ipcRenderer.invoke('getDefaults'),
  setConfig: (cfg) => ipcRenderer.invoke('setConfig', cfg),
  flushConfig: (cfg) => ipcRenderer.send('flushConfig', cfg),
  logDebug: (msg) => ipcRenderer.send('logDebug', msg),
  // 新版本检测 / 打开发布页
  getAppInfo: () => ipcRenderer.invoke('getAppInfo'),
  checkUpdate: () => ipcRenderer.invoke('checkUpdate'),
  openExternal: (url) => ipcRenderer.invoke('openExternal', url),
  watchDir: (dir) => ipcRenderer.send('watchDir', dir),
  unwatchDir: () => ipcRenderer.send('unwatchDir'),
  onDirChanged: (cb) => ipcRenderer.on('dir-changed', (_e, dir) => cb(dir)),
  // 应用菜单点击 → 通知渲染进程执行对应动作（open-folder / save）
  onMenu: (cb) => ipcRenderer.on('menu', (_e, action) => cb(action))
})
