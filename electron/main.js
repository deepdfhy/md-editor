const { app, BrowserWindow, ipcMain, dialog, clipboard, Menu, shell } = require('electron')
const fs = require('fs')
const path = require('path')
const { DEFAULT_IGNORE, normalizeIgnore, createIgnoreMatcher } = require('./ignore.js')
const { createScanner, RECYCLE_DIR } = require('./fsscan.js')
const { checkUpdate, parseRepo } = require('./update.js')

// 归档目录名（位于打开的根目录下；回收站目录名见 fsscan.js）
const ARCHIVE_DIR = '归档'

// ---------- 忽略规则（设置中心） ----------
// 过滤放在主进程做：目录树与文件列表共用同一套规则，渲染进程不用各自实现，
// 搜索索引也就自然不含被忽略的文件。规则实现见 electron/ignore.js，
// 实际扫描/过滤见 electron/fsscan.js。
const ignore = createIgnoreMatcher()
const scanner = createScanner(ignore)
const getTree = (root) => scanner.getTree(root)
const listFiles = (dir) => scanner.listFiles(dir)

// ---------- 附件落盘（相对路径，保存到 <dir>/attachments/） ----------
async function saveAttachment({ dir, filename, data }) {
  const attDir = path.join(dir, 'attachments')
  await fs.promises.mkdir(attDir, { recursive: true })
  const safe = path.basename(filename).replace(/[\\/:*?"<>|]/g, '_')
  const dest = path.join(attDir, safe)
  await fs.promises.writeFile(dest, Buffer.from(data))
  // 返回相对当前文档目录的路径，保证换工具也能显示
  return 'attachments/' + safe
}

// ---------- 目录监听（外部变动时通知渲染进程刷新） ----------
let currentWatcher = null
function watchDir(event, dir) {
  if (currentWatcher) {
    currentWatcher.close()
    currentWatcher = null
  }
  if (!dir) return
  const sender = event.sender
  currentWatcher = fs.watch(dir, (eventType, filename) => {
    if (filename) sender.send('dir-changed', dir)
  })
}
function unwatchDir() {
  if (currentWatcher) {
    currentWatcher.close()
    currentWatcher = null
  }
}

// ---------- IPC 注册 ----------
ipcMain.handle('openFolder', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openDirectory'] })
  if (r.canceled || !r.filePaths[0]) return null
  const root = r.filePaths[0]
  return await getTree(root)
})

// 仅重新读取某个目录的子树（用于右键新建目录后局部刷新，避免整棵树折叠）
ipcMain.handle('readTree', async (_e, dir) => getTree(dir))

// 列出目录下的所有文件（笔记 + 图片/css/js 等附件），带 kind 供前端路由
ipcMain.handle('listFiles', async (_e, dir) => listFiles(dir))
// 聚合页用：扫出本目录笔记 + 各直接子目录的笔记（含标题与封面图路径）
ipcMain.handle('scanNotes', async (_e, dir, selfPath) => scanner.scanNotes(dir, { selfPath }))
ipcMain.handle('readFile', async (_e, p) => fs.promises.readFile(p, 'utf-8'))
ipcMain.handle('writeFile', async (_e, p, content) =>
  fs.promises.writeFile(p, content, 'utf-8')
)
ipcMain.handle('createDir', async (_e, dir, name) => {
  await fs.promises.mkdir(path.join(dir, name), { recursive: false })
  return path.join(dir, name)
})
ipcMain.handle('createDoc', async (_e, dir, name) => {
  const fn = /\.(md|markdown|mdx)$/i.test(name) ? name : name + '.md'
  const p = path.join(dir, fn)
  await fs.promises.writeFile(p, '# ' + fn.replace(/\.[^.]+$/, '') + '\n\n', 'utf-8')
  return p
})

// 新建聚合页：文件名固定 <名字>.nav.md，打开后是「目录内笔记卡片汇总」视图
ipcMain.handle('createNavDoc', async (_e, dir, name) => {
  const base = String(name || '')
    .trim()
    .replace(/\.nav\.md$/i, '')
    .replace(/\.(md|markdown|mdx)$/i, '')
  const safe = (base || '聚合页').replace(/[\\/:*?"<>|]/g, '_')
  const fn = safe + '.nav.md'
  const p = path.join(dir, fn)
  if (fs.existsSync(p)) throw new Error('该目录下已存在：' + fn)
  const content =
    `# ${safe}\n\n` +
    '> 这是**聚合页**：打开后会自动把本目录下的笔记汇总成卡片展示，\n' +
    '> 卡片封面取每篇笔记里的第一张图片；子目录会按分类归入各自的标签页。\n' +
    '> 上面这段说明文字可以直接改，改完保存即可。\n'
  await fs.promises.writeFile(p, content, 'utf-8')
  return p
})
ipcMain.handle('saveAttachment', async (_e, arg) => saveAttachment(arg))

// ---------- 归档 / 回收站 ----------
// 同名时自动追加 (1)(2)… 避免覆盖已有文件
async function uniquePath(dir, name) {
  const ext = path.extname(name)
  const base = path.basename(name, ext)
  let target = path.join(dir, name)
  let i = 1
  while (fs.existsSync(target)) {
    target = path.join(dir, `${base}(${i})${ext}`)
    i++
  }
  return target
}

function recycleDirOf(root) {
  return path.join(root, RECYCLE_DIR)
}
function manifestOf(root) {
  return path.join(recycleDirOf(root), 'manifest.json')
}
async function readManifest(root) {
  try {
    const raw = await fs.promises.readFile(manifestOf(root), 'utf-8')
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch (_) {
    return []
  }
}
async function writeManifest(root, list) {
  await fs.promises.mkdir(recycleDirOf(root), { recursive: true })
  await fs.promises.writeFile(manifestOf(root), JSON.stringify(list, null, 2), 'utf-8')
}

// 归档：移动到 <root>/归档/
ipcMain.handle('archiveNote', async (_e, filePath, root) => {
  const arcDir = path.join(root, ARCHIVE_DIR)
  await fs.promises.mkdir(arcDir, { recursive: true })
  const target = await uniquePath(arcDir, path.basename(filePath))
  await fs.promises.rename(filePath, target)
  return target
})

// 删除：移入回收站并记录清单（可恢复）
ipcMain.handle('deleteNote', async (_e, filePath, root) => {
  const dir = recycleDirOf(root)
  await fs.promises.mkdir(dir, { recursive: true })
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const stored = id + '__' + path.basename(filePath)
  await fs.promises.rename(filePath, path.join(dir, stored))
  const list = await readManifest(root)
  list.unshift({
    id,
    stored,
    name: path.basename(filePath),
    origPath: filePath,
    deletedAt: Date.now()
  })
  await writeManifest(root, list)
  return id
})

// 列出回收站（顺带剔除文件已不存在的残留记录）
ipcMain.handle('listRecycle', async (_e, root) => {
  const list = await readManifest(root)
  const out = []
  for (const it of list) {
    try {
      await fs.promises.access(path.join(recycleDirOf(root), it.stored))
      out.push(it)
    } catch (_) {}
  }
  if (out.length !== list.length) await writeManifest(root, out)
  return out
})

// 恢复到原路径（原位置若已有同名文件则自动改名）
ipcMain.handle('restoreNote', async (_e, root, id) => {
  const list = await readManifest(root)
  const it = list.find((x) => x.id === id)
  if (!it) return null
  const destDir = path.dirname(it.origPath)
  await fs.promises.mkdir(destDir, { recursive: true })
  const target = await uniquePath(destDir, it.name)
  await fs.promises.rename(path.join(recycleDirOf(root), it.stored), target)
  await writeManifest(root, list.filter((x) => x.id !== id))
  return target
})

// 彻底删除单条
ipcMain.handle('purgeNote', async (_e, root, id) => {
  const list = await readManifest(root)
  const it = list.find((x) => x.id === id)
  if (it) {
    try {
      await fs.promises.unlink(path.join(recycleDirOf(root), it.stored))
    } catch (_) {}
  }
  await writeManifest(root, list.filter((x) => x.id !== id))
  return true
})

// 清空回收站
ipcMain.handle('emptyRecycle', async (_e, root) => {
  const list = await readManifest(root)
  for (const it of list) {
    try {
      await fs.promises.unlink(path.join(recycleDirOf(root), it.stored))
    } catch (_) {}
  }
  await writeManifest(root, [])
  return true
})

// ---------- 剪贴板（右键复制路径用，比 navigator.clipboard 在 file:// 下更可靠） ----------
ipcMain.handle('copyText', (_e, text) => {
  clipboard.writeText(String(text == null ? '' : text))
  return true
})

// ---------- 导出 PDF ----------
// 渲染进程把「已渲染 + 内联样式（含代码高亮）」的完整 HTML 传进来，
// 这里用隐藏窗口加载后 printToPDF，保持样式与代码高亮。
ipcMain.handle('exportPdf', async (_e, { html, defaultName }) => {
  const r = await dialog.showSaveDialog({
    defaultPath: defaultName || 'note.pdf',
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  })
  if (r.canceled || !r.filePath) return null
  const tmp = path.join(app.getPath('temp'), 'md-export-' + Date.now() + '.html')
  await fs.promises.writeFile(tmp, html || '', 'utf-8')
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: false }
  })
  try {
    await win.loadFile(tmp)
    // 等图片（data URL）与字体就绪
    await new Promise((res) => setTimeout(res, 500))
    const data = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { top: 0.55, bottom: 0.55, left: 0.5, right: 0.5 }
    })
    await fs.promises.writeFile(r.filePath, data)
    return r.filePath
  } finally {
    try {
      win.destroy()
    } catch (_) {}
    try {
      await fs.promises.unlink(tmp)
    } catch (_) {}
  }
})

// 预览时把相对路径的图片读成 data URL，保证在 app 内任何位置都能正确显示
const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
  ico: 'image/x-icon', avif: 'image/avif', jfif: 'image/jpeg', tif: 'image/tiff', tiff: 'image/tiff'
}
ipcMain.handle('readImage', async (_e, p) => {
  const b = await fs.promises.readFile(p)
  const ext = path.extname(p).slice(1).toLowerCase()
  const mime = MIME[ext] || 'application/octet-stream'
  return 'data:' + mime + ';base64,' + b.toString('base64')
})

// ---------- 软件配置（记住打开过的目录，存于 userData） ----------
function configPath() {
  return path.join(app.getPath('userData'), 'config.json')
}
function logDebug(msg) {
  try {
    const p = path.join(app.getPath('userData'), 'md-editor-debug.log')
    fs.appendFileSync(p, `[${new Date().toISOString()}] ${msg}\n`)
  } catch (_) {}
}
function loadConfig() {
  try {
    const raw = fs.readFileSync(configPath(), 'utf-8')
    const cfg = JSON.parse(raw)
    if (typeof cfg === 'object' && cfg) {
      cfg.ignore = normalizeIgnore(cfg.ignore)
      ignore.setConfig(cfg.ignore)
      logDebug('loadConfig OK, lastDir=' + cfg.lastDir)
      return cfg
    }
  } catch (e) {
    logDebug('loadConfig failed: ' + (e && e.message))
  }
  const fallback = {
    recentDirs: [],
    lastDir: '',
    lastActiveDir: '',
    ignore: normalizeIgnore(null)
  }
  ignore.setConfig(fallback.ignore)
  return fallback
}
function saveConfig(cfg) {
  try {
    const next = Object.assign({}, cfg)
    next.ignore = normalizeIgnore(next.ignore)
    ignore.setConfig(next.ignore) // 规则变了，匹配器内部会重建正则缓存
    const p = configPath()
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, JSON.stringify(next, null, 2), 'utf-8')
    logDebug('saveConfig OK, lastDir=' + next.lastDir)
  } catch (e) {
    logDebug('saveConfig FAILED: ' + (e && e.message))
  }
}
ipcMain.handle('getConfig', () => loadConfig())
// 设置中心「恢复默认」用：默认忽略规则由主进程统一提供，避免两边各写一份
ipcMain.handle('getDefaults', () => ({
  ignore: normalizeIgnore(DEFAULT_IGNORE)
}))
ipcMain.handle('setConfig', (_e, cfg) => {
  saveConfig(cfg)
  return true
})
// 关闭窗口前由渲染进程最后一次兜底写入（send，不依赖 invoke 返回）
ipcMain.on('flushConfig', (_e, cfg) => saveConfig(cfg))
// 渲染进程把诊断信息写入调试日志
ipcMain.on('logDebug', (_e, msg) => logDebug(msg))

ipcMain.on('watchDir', watchDir)
ipcMain.on('unwatchDir', unwatchDir)

// ---------- 新版本检测（GitHub Releases） ----------
// 仓库来源优先级：用户在设置里填的 > package.json 的 repository 字段。
// 只做「发现新版本 → 打开发布页」，不做自动下载安装（安装包让用户自己下最省事）。
function defaultRepo() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf-8'))
    const r = pkg.repository
    const url = typeof r === 'string' ? r : (r && r.url) || ''
    return parseRepo(url) || parseRepo(pkg.homepage || '')
  } catch (_) {
    return ''
  }
}
function currentRepo() {
  try {
    const cfg = loadConfig()
    const r = parseRepo(cfg.updateRepo) || defaultRepo()
    // 占位仓库（YOUR_NAME/md-editor）等同「还没配」，免得打包版每次启动都去打个必然 404 的请求
    return /^YOUR_/i.test(r) ? '' : r
  } catch (_) {
    return defaultRepo()
  }
}
ipcMain.handle('getAppInfo', () => ({
  version: app.getVersion(),
  repo: currentRepo(),
  packaged: app.isPackaged
}))
ipcMain.handle('checkUpdate', async () => {
  const repo = currentRepo()
  const r = await checkUpdate(app.getVersion(), repo)
  logDebug('checkUpdate repo=' + repo + ' -> ' + JSON.stringify({ ok: r.ok, hasUpdate: r.hasUpdate, tag: r.tag, error: r.error }))
  return r
})
// 只放行 https 的 github.com 链接，别让渲染进程拿它当任意协议跳板
ipcMain.handle('openExternal', (_e, url) => {
  const u = String(url || '')
  if (!/^https:\/\/([\w.-]+\.)?github\.com\//i.test(u)) return false
  shell.openExternal(u)
  return true
})

// ---------- 中文应用菜单 ----------
function showAbout() {
  dialog.showMessageBox({
    type: 'info',
    title: '关于 MD 编辑器',
    message: 'MD 编辑器',
    detail:
      `版本：${app.getVersion()}\n\n` +
      '一款面向代码笔记的桌面 Markdown 编辑器\n' +
      '4 列布局：目录树 / 文件列表 / 编辑器 / 大纲\n\n' +
      '技术栈：Electron + Vue3 + Toast UI Editor\n' +
      '作者：俊哥 / 虾技派\n' +
      '开源许可：MIT',
    buttons: ['确定'],
    noLink: true
  })
}

function buildMenu() {
  const version = app.getVersion()
  const template = [
    {
      label: '文件',
      submenu: [
        {
          label: '打开文件夹…',
          accelerator: 'CmdOrCtrl+O',
          click: (_item, w) => w && w.webContents.send('menu', 'open-folder')
        },
        {
          label: '保存',
          accelerator: 'CmdOrCtrl+S',
          click: (_item, w) => w && w.webContents.send('menu', 'save')
        },
        { type: 'separator' },
        {
          label: '设置…',
          accelerator: 'CmdOrCtrl+,',
          click: (_item, w) => w && w.webContents.send('menu', 'settings')
        },
        { type: 'separator' },
        { label: '退出', role: 'quit' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', role: 'undo' },
        { label: '重做', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', role: 'cut' },
        { label: '复制', role: 'copy' },
        { label: '粘贴', role: 'paste' },
        { label: '全选', role: 'selectAll' },
        { type: 'separator' },
        {
          label: '查找',
          accelerator: 'CmdOrCtrl+F',
          click: (_item, w) => w && w.webContents.send('menu', 'find')
        }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '重新加载', role: 'reload' },
        { label: '强制重新加载', role: 'forceReload' },
        { label: '开发者工具', role: 'toggleDevTools' },
        { type: 'separator' },
        { label: '实际大小', role: 'resetZoom' },
        { label: '放大', role: 'zoomIn' },
        { label: '缩小', role: 'zoomOut' },
        { type: 'separator' },
        {
          label: '切换浅色 / 深色主题',
          accelerator: 'CmdOrCtrl+Shift+L',
          click: (_item, w) => w && w.webContents.send('menu', 'toggle-theme')
        },
        { type: 'separator' },
        { label: '全屏', role: 'togglefullscreen' }
      ]
    },
    {
      label: '窗口',
      submenu: [
        { label: '最小化', role: 'minimize' },
        { label: '关闭', role: 'close' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        { label: '检查更新…', click: (_item, w) => w && w.webContents.send('menu', 'check-update') },
        { type: 'separator' },
        { label: '关于 MD 编辑器', click: showAbout },
        { type: 'separator' },
        { label: `版本 ${version}`, enabled: false }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ---------- 窗口 ----------
function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'MD 编辑器',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env.DEV === '1') {
    win.loadURL('http://localhost:5173')
    win.webContents.openDevTools()
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(() => {
  loadConfig() // 先把忽略规则读进内存，保证首次构建目录树就生效
  buildMenu()
  createWindow()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
