<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'
import DirectoryTree from './components/DirectoryTree.vue'
import FileList from './components/FileList.vue'
import EditorPane from './components/EditorPane.vue'
import ViewerPane from './components/ViewerPane.vue'
import NavPane from './components/NavPane.vue'
import TocPane from './components/TocPane.vue'
import { useFs } from './composables/useFs.js'
import { createSearch } from './composables/useSearch.js'
import { extractToc, getFirstHeading } from './utils/markdown.js'
import { buildPdfHtml } from './utils/pdf.js'
import { formatSize } from './utils/fileTypes.js'

const fs = useFs()
const search = createSearch()

const tree = ref(null)
const rootDir = ref('')
const selectedDir = ref('')
const files = ref([])
const searchQuery = ref('')
const col1W = ref(240)
const col2W = ref(240) // 第2列默认宽度（约为之前弹性宽度的 2/3），可拖拽调节
const col4W = ref(260)
const editorRef = ref(null)

// ---------- 主题（浅色 / 深色） ----------
// 真实配置存 config.json 的 theme；localStorage 只为了让首帧不闪（见 index.html）
const theme = ref('dark')
function applyTheme(t) {
  const v = t === 'light' ? 'light' : 'dark'
  theme.value = v
  document.documentElement.setAttribute('data-theme', v)
  try {
    localStorage.setItem('md-theme', v)
  } catch (_) {}
}
function toggleTheme() {
  applyTheme(theme.value === 'light' ? 'dark' : 'light')
  saveConfig()
  showToast(theme.value === 'light' ? '已切换到浅色模式' : '已切换到深色模式')
}

// ---------- 新版本检测 ----------
const appVersion = ref('')
const updateInfo = ref(null) // { version, url, name }
const updateChecking = ref(false)
let updateChecked = false

async function checkUpdate(manual = false) {
  if (updateChecking.value) return
  updateChecking.value = true
  if (manual) showToast('正在检查更新…')
  try {
    const r = await fs.checkUpdate()
    if (!r || !r.ok) {
      if (manual) window.alert('检查更新失败：' + ((r && r.error) || '未知错误'))
      return
    }
    if (r.hasUpdate) {
      updateInfo.value = { version: r.version, url: r.url, name: r.name }
      showToast('发现新版本 ' + r.version)
    } else if (manual) {
      window.alert('已是最新版本（' + r.current + '）')
    }
  } catch (e) {
    if (manual) window.alert('检查更新失败：' + ((e && e.message) || e))
  } finally {
    updateChecking.value = false
  }
}
async function openUpdatePage() {
  const u = updateInfo.value && updateInfo.value.url
  if (!u) return
  try {
    await fs.openExternal(u)
  } catch (e) {
    window.alert('打开浏览器失败：' + ((e && e.message) || e))
  }
}
function dismissUpdate() {
  updateInfo.value = null
}

// ---------- 打开的标签页（tabs） ----------
// 单击文件 = 临时标签（再开别的文件会被替换）；双击文件/标签 = 正式标签（固定，不被替换）
const tabs = ref([]) // [{ path, name, pinned }]
const activePath = ref('')
const contents = reactive({}) // path -> 编辑器中当前内容（相对路径引用，未保存也可）
const savedMap = reactive({}) // path -> 最近一次落盘/加载时的内容（脏标记基准）

const activeTab = computed(() => tabs.value.find((t) => t.path === activePath.value) || null)
// 第 3 列渲染哪种面板：聚合页 → 卡片墙；笔记 → 编辑器；图片/代码/文本 → 只读查看器
const activeKind = computed(() => (activeTab.value && activeTab.value.kind) || 'note')
const activeIsNav = computed(() => !!(activeTab.value && activeTab.value.isNav))
// 聚合页默认显示卡片墙；切成「源文件」才能编辑它自身的 markdown 内容
const navEdit = ref(false)
// 聚合页「卡片大小」（px），存在 config.json 里跨会话保留
const navCardSize = ref(180)
const activeContent = computed(() => contents[activePath.value] || '')
const isDirty = computed(() => {
  const p = activePath.value
  return !!p && contents[p] !== savedMap[p]
})
const openPaths = computed(() => tabs.value.map((t) => t.path))

function isTabDirty(t) {
  return contents[t.path] !== savedMap[t.path]
}

// 目录切换下拉
const recentDirs = ref([])
const switchMenu = ref(false)

// ---------- 设置中心：忽略规则 ----------
// 默认规则的真实来源在主进程 electron/ignore.js，这里只做一份兜底副本
// （加载 getDefaults 后会覆盖），避免两边各写一套默认值后慢慢跑偏。
const FALLBACK_IGNORE = { ignoreDot: true, ignoreDirs: ['node_modules', 'dist'], ignoreFiles: [] }
const defaultIgnore = ref(JSON.parse(JSON.stringify(FALLBACK_IGNORE)))
const ignoreCfg = ref(JSON.parse(JSON.stringify(FALLBACK_IGNORE)))
const settingsOpen = ref(false)
const settingsForm = reactive({ ignoreDot: true, ignoreDirsText: '', ignoreFilesText: '', updateRepo: '' })

// GitHub 仓库（owner/repo）：留空则用 package.json 的 repository 字段
const updateRepo = ref('')

// 轻提示
const toast = ref('')
let toastTimer = null
function showToast(msg) {
  toast.value = msg
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 2200)
}

// 保存状态
const justSaved = ref(false)
const rememberFlash = ref(false)
let rememberFlashTimer = null
let saveTimer = null
let pendingPath = ''
let savedFlashTimer = null

const toc = computed(() => extractToc(activeContent.value))

// 大于 2MB 的笔记不进全文检索索引（与主进程 fsscan 的 BIG_FILE 保持一致）
const INDEX_MAX = 2 * 1024 * 1024

// 置顶的聚合页：列表里排在最前面。存在 config.json 里，跨会话保留。
const pins = ref([])

const orderedFiles = computed(() => {
  if (!pins.value.length) return files.value
  const pinSet = new Set(pins.value)
  return [
    ...files.value.filter((f) => pinSet.has(f.path)),
    ...files.value.filter((f) => !pinSet.has(f.path))
  ]
})

const displayItems = computed(() => {
  const q = searchQuery.value.trim()
  if (!q) return orderedFiles.value
  const map = new Map(orderedFiles.value.map((f) => [f.path, f]))
  const out = []
  const seen = new Set()
  const res = search.search(q)
  if (res) {
    for (const r of res) {
      if (map.has(r.path) && !seen.has(r.path)) {
        out.push(map.get(r.path))
        seen.add(r.path)
      }
    }
  }
  // 全文检索只索引了笔记正文，图片/css/js 这类附件按文件名补一次匹配
  const lq = q.toLowerCase()
  for (const f of orderedFiles.value) {
    if (!seen.has(f.path) && f.name.toLowerCase().includes(lq)) {
      out.push(f)
      seen.add(f.path)
    }
  }
  return out
})

function dirOf(p) {
  if (!p) return ''
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i >= 0 ? p.slice(0, i) : ''
}

const fileDir = computed(() => dirOf(activePath.value) || selectedDir.value)

// ---------- 配置读写（记住打开过的目录） ----------
async function loadConfig() {
  // 默认忽略规则以主进程为准
  try {
    const d = await fs.getDefaults()
    if (d && d.ignore) defaultIgnore.value = d.ignore
  } catch (_) {}
  try {
    const cfg = await fs.getConfig()
    recentDirs.value = cfg.recentDirs || []
    pins.value = cfg.pins || []
    if (Number(cfg.navCardSize) > 0) navCardSize.value = Number(cfg.navCardSize)
    if (cfg.theme) applyTheme(cfg.theme)
    if (cfg.updateRepo) updateRepo.value = cfg.updateRepo
    if (cfg.ignore) ignoreCfg.value = cfg.ignore
    if (cfg.lastDir) {
      try {
        const t = await fs.readTree(cfg.lastDir)
        tree.value = t
        rootDir.value = t.path
        const node = cfg.lastActiveDir ? findNode(t, cfg.lastActiveDir) : t
        await selectDir(node || t, false)
        fs.logDebug('restore OK, lastDir=' + cfg.lastDir)
      } catch (e) {
        fs.logDebug('restore FAILED, lastDir=' + cfg.lastDir + ' : ' + (e && e.message))
        // 目录已不存在，忽略
      }
    } else {
      fs.logDebug('loadConfig: no lastDir in config')
    }
  } catch (e) {
    fs.logDebug('loadConfig getConfig failed: ' + (e && e.message))
  }
}

function currentConfig() {
  // 注意：Vue ref 的 .value 是响应式 Proxy，不能直接传给 IPC（结构化克隆会失败）。
  // 这里用 JSON 深拷贝成纯普通对象，确保可被 clone。
  return {
    recentDirs: JSON.parse(JSON.stringify(recentDirs.value || [])),
    pins: JSON.parse(JSON.stringify(pins.value || [])),
    navCardSize: Number(navCardSize.value) || 180,
    theme: theme.value,
    updateRepo: updateRepo.value || '',
    lastDir: rootDir.value || '',
    lastActiveDir: selectedDir.value || '',
    ignore: JSON.parse(JSON.stringify(ignoreCfg.value || FALLBACK_IGNORE))
  }
}
async function saveConfig() {
  const cfg = currentConfig()
  try {
    await fs.setConfig(cfg)
    fs.logDebug('render: saveConfig OK, lastDir=' + cfg.lastDir)
    rememberFlash.value = true
    clearTimeout(rememberFlashTimer)
    rememberFlashTimer = setTimeout(() => (rememberFlash.value = false), 1500)
  } catch (e) {
    fs.logDebug('render: saveConfig FAILED: ' + (e && e.message))
    window.alert('目录记忆保存失败：' + (e && e.message))
  }
  // 兜底：用 send 再发一次，避免关闭竞态导致丢失
  try {
    fs.flushConfig(cfg)
  } catch (_) {}
}

function pushRecent(dir) {
  recentDirs.value = [dir, ...recentDirs.value.filter((d) => d !== dir)].slice(0, 12)
  saveConfig()
}

function shortName(p) {
  if (!p) return ''
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts.slice(-2).join(' / ')
}

function toggleSwitchMenu() {
  switchMenu.value = !switchMenu.value
}

// 从历史列表里移除（只清理记录，不动磁盘上的目录）
function removeRecent(dir) {
  recentDirs.value = recentDirs.value.filter((d) => d !== dir)
  saveConfig()
  showToast('已从历史目录中移除')
}

// ---------- 设置中心 ----------
function openSettings() {
  switchMenu.value = false
  const ig = ignoreCfg.value || DEFAULT_IGNORE
  settingsForm.ignoreDot = ig.ignoreDot !== false
  settingsForm.ignoreDirsText = (ig.ignoreDirs || []).join('\n')
  settingsForm.ignoreFilesText = (ig.ignoreFiles || []).join('\n')
  settingsForm.updateRepo = updateRepo.value || ''
  settingsOpen.value = true
}
function closeSettings() {
  settingsOpen.value = false
}
function resetSettings() {
  const d = defaultIgnore.value
  settingsForm.ignoreDot = d.ignoreDot !== false
  settingsForm.ignoreDirsText = (d.ignoreDirs || []).join('\n')
  settingsForm.ignoreFilesText = (d.ignoreFiles || []).join('\n')
}
function splitPatterns(text) {
  return String(text || '')
    .split(/[\n,;]/)
    .map((s) => s.trim())
    .filter(Boolean)
}
async function saveSettings() {
  ignoreCfg.value = {
    ignoreDot: settingsForm.ignoreDot,
    ignoreDirs: splitPatterns(settingsForm.ignoreDirsText),
    ignoreFiles: splitPatterns(settingsForm.ignoreFilesText)
  }
  updateRepo.value = String(settingsForm.updateRepo || '').trim()
  await saveConfig()
  settingsOpen.value = false
  await refreshAfterOps()
  showToast('设置已保存')
}

async function openRecent(dir) {
  switchMenu.value = false
  try {
    const t = await fs.readTree(dir)
    if (!t) return
    tree.value = t
    rootDir.value = t.path
    await selectDir(t, false)
    pushRecent(dir)
  } catch (e) {
    recentDirs.value = recentDirs.value.filter((d) => d !== dir)
    saveConfig()
    window.alert('无法打开该目录，可能已被移动或删除：\n' + dir)
  }
}

// ---------- 打开文件夹 ----------
async function openFolder() {
  switchMenu.value = false
  const t = await fs.openFolder()
  if (!t) return
  tree.value = t
  rootDir.value = t.path
  await selectDir(t, true)
  pushRecent(t.path)
}

async function selectDir(node, remember = true) {
  if (!node || !node.path) return
  selectedDir.value = node.path
  fs.watchDir(node.path)
  await loadFiles(node.path)
  if (remember) await saveConfig()
}

// 列出目录下「全部文件」（笔记 + 图片 + 代码 + 文本），但只给笔记建全文索引
async function loadFiles(dir) {
  if (!dir) return
  const list = await fs.listFiles(dir)
  files.value = list
  const docs = []
  for (const f of list) {
    if (f.kind !== 'note' || f.isNav) continue // 聚合页本身不进检索
    if (f.size > INDEX_MAX) continue
    try {
      const c = await fs.readFile(f.path)
      docs.push({ id: f.path, name: f.name, title: getFirstHeading(c) || f.name, body: c })
    } catch (_) {}
  }
  search.setDocs(docs)
}

function handleSelectDir(node) {
  selectDir(node)
}

// ---------- 标签页：打开 / 激活 / 固定 / 关闭 ----------
function baseName(p) {
  const i = Math.max(String(p).lastIndexOf('/'), String(p).lastIndexOf('\\'))
  return i >= 0 ? p.slice(i + 1) : p
}

async function openFile(f, { pinned = false } = {}) {
  const p = f.path
  const existing = tabs.value.find((t) => t.path === p)
  if (existing) {
    if (pinned) existing.pinned = true
    await activateTab(p)
    return
  }
  const kind = f.kind || 'note'
  // 超大文本文件先问一下：一次性读进内存 + 渲染在高亮上会很慢
  const MAX_OPEN = 8 * 1024 * 1024
  if (kind !== 'image' && f.size > MAX_OPEN) {
    const ok = window.confirm(
      '文件较大（' + formatSize(f.size) + '），打开可能需要几秒钟且会占用较多内存。\n确定继续打开吗？'
    )
    if (!ok) return
  }
  // 先读内容，保证激活时 EditorPane / 查看器能拿到正确内容（图片走 data URL，不读文本）
  let c = ''
  if (kind !== 'image') {
    try {
      c = await fs.readFile(p)
    } catch (e) {
      window.alert('打开失败：' + (e && e.message))
      return
    }
    contents[p] = c
    savedMap[p] = c
  }
  const tab = {
    path: p,
    name: f.name || baseName(p),
    pinned,
    kind,
    ext: f.ext || '',
    isNav: !!f.isNav,
    size: f.size || 0,
    mtime: f.mtime || 0
  }
  if (pinned) {
    tabs.value.push(tab)
  } else {
    // 临时标签：替换已有的临时标签（若其有未保存改动则先固定保留，避免丢失）
    const idx = tabs.value.findIndex((t) => !t.pinned)
    if (idx >= 0) {
      const old = tabs.value[idx]
      if (isTabDirty(old)) {
        old.pinned = true
        tabs.value.push(tab)
      } else {
        delete contents[old.path]
        delete savedMap[old.path]
        tabs.value.splice(idx, 1, tab)
      }
    } else {
      tabs.value.push(tab)
    }
  }
  await activateTab(p)
}

async function activateTab(p) {
  const t = tabs.value.find((x) => x.path === p)
  if (!t) return
  const prev = activePath.value
  if (prev && prev !== p) await flushSave(prev)
  clearTimeout(saveTimer)
  if (contents[p] === undefined) {
    const t2 = tabs.value.find((x) => x.path === p)
    if (t2 && t2.kind === 'image') {
      contents[p] = ''
      savedMap[p] = ''
    } else {
      try {
        const c = await fs.readFile(p)
        contents[p] = c
        savedMap[p] = c
      } catch (e) {
        window.alert('打开失败：' + (e && e.message))
        return
      }
    }
  }
  activePath.value = p
  navEdit.value = false
}

function pinTab(p) {
  const t = tabs.value.find((x) => x.path === p)
  if (t) t.pinned = true
}

function closeTab(p) {
  const i = tabs.value.findIndex((t) => t.path === p)
  if (i < 0) return
  tabs.value.splice(i, 1)
  delete contents[p]
  delete savedMap[p]
  if (activePath.value === p) {
    const next = tabs.value[i] || tabs.value[i - 1] || null
    activePath.value = next ? next.path : ''
  }
}

// 切换标签前把未保存内容先落盘
async function flushSave(p) {
  if (!p) return
  const c = contents[p]
  if (c === undefined || c === savedMap[p]) return
  try {
    await fs.writeFile(p, c)
    savedMap[p] = c
  } catch (_) {}
}

function removeTabsByPath(p) {
  if (tabs.value.some((t) => t.path === p)) closeTab(p)
}

// ---------- 编辑内容变更 / 保存 ----------
function onContentChange(text) {
  const p = activePath.value
  if (!p) return
  contents[p] = text
  pendingPath = p
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => savePath(p), 1200) // 防抖自动保存
}

// 编辑器完成加载/切换文档后，以它当前产出的规范化内容作为基准
function onLoaded(text) {
  const p = activePath.value
  if (!p) return
  contents[p] = text
  savedMap[p] = text
  clearTimeout(saveTimer)
}

async function savePath(p) {
  if (!p) return
  const c = contents[p]
  if (c === undefined || c === savedMap[p]) return
  try {
    await fs.writeFile(p, c)
  } catch (e) {
    window.alert('保存失败：' + (e?.message || e))
    return
  }
  savedMap[p] = c
}

async function doSave() {
  const p = activePath.value
  if (!p) return
  await savePath(p)
  pendingPath = ''
  justSaved.value = true
  clearTimeout(savedFlashTimer)
  savedFlashTimer = setTimeout(() => (justSaved.value = false), 1500)
}

async function createDir({ dir, name }) {
  if (!name) return
  await fs.createDir(dir, name)
  const node = findNode(tree.value, dir)
  if (node) {
    const fresh = await fs.readTree(node.path)
    node.children = fresh.children
  }
  await loadFiles(selectedDir.value)
}
// 在「当前第 2 列列表」里找刚创建的文件；找不到说明建在了别的目录，
// 这时也用路径直接打开（列表里没有不代表文件不存在）
async function openCreated(p, kind, isNav) {
  const f = files.value.find((x) => x.path === p)
  if (f) {
    await openFile(f, { pinned: true })
    return
  }
  await openFile(
    {
      path: p,
      name: baseName(p),
      kind,
      isNav,
      ext: (p.match(/\.([^.\\/]+)$/) || [])[1] || ''
    },
    { pinned: true }
  )
}
async function createDoc({ dir, name }) {
  if (!name) return
  const p = await fs.createDoc(dir, name)
  await loadFiles(selectedDir.value)
  await openCreated(p, 'note', false)
}
async function createNav({ dir, name }) {
  if (!name) return
  try {
    const p = await fs.createNavDoc(dir, name)
    await loadFiles(selectedDir.value)
    await openCreated(p, 'note', true)
    showToast('聚合页已创建，自动汇总本目录下的笔记')
  } catch (e) {
    window.alert('创建聚合页失败：' + (e && e.message))
  }
}

// 聚合页置顶 / 取消置顶（记在配置里，下次打开仍然生效）
async function handleTogglePin(item) {
  const i = pins.value.indexOf(item.path)
  if (i >= 0) {
    pins.value.splice(i, 1)
    showToast('已取消置顶')
  } else {
    pins.value.push(item.path)
    showToast('已置顶到列表最前')
  }
  await saveConfig()
}

// 从聚合页卡片点进某篇笔记（可能在子目录里，当前文件列表中不一定有）
async function openNoteByPath(p) {
  const known = files.value.find((x) => x.path === p)
  if (known) {
    await openFile(known, { pinned: true })
    return
  }
  await openFile({ path: p, name: baseName(p), kind: 'note', ext: 'md' }, { pinned: true })
}

// 聚合页卡片大小：拖动过程中不写盘，停手 500ms 后再存（避免每拖一格都写一次配置）
let cardSizeTimer = null
function onNavCardSize(v) {
  const n = Number(v)
  if (!isFinite(n) || n <= 0) return
  navCardSize.value = n
  clearTimeout(cardSizeTimer)
  cardSizeTimer = setTimeout(() => saveConfig(), 500)
}

// ---------- 归档 / 回收站 ----------
const recycleOpen = ref(false)
const recycleItems = ref([])

// 归档/删除/恢复后统一刷新：文件列表 + 目录树（仅替换数据，保留展开状态）
async function refreshAfterOps() {
  if (rootDir.value) {
    const fresh = await fs.readTree(rootDir.value)
    tree.value = fresh
    rootDir.value = fresh.path
    // 当前选中的目录可能被新的忽略规则隐藏了，回退到根目录
    if (
      selectedDir.value &&
      selectedDir.value !== fresh.path &&
      !findNode(fresh, selectedDir.value)
    ) {
      await selectDir(fresh, false)
      return
    }
  }
  await loadFiles(selectedDir.value)
}

async function handleArchive(item) {
  if (!rootDir.value) return
  const ok = window.confirm('确定归档「' + item.name + '」？\n将移动到根目录下的「归档」文件夹。')
  if (!ok) return
  try {
    await fs.archiveNote(item.path, rootDir.value)
  } catch (e) {
    window.alert('归档失败：' + (e && e.message))
    return
  }
  removeTabsByPath(item.path)
  await refreshAfterOps()
}

async function handleRemove(item) {
  if (!rootDir.value) return
  const ok = window.confirm('确定删除「' + item.name + '」？\n将移入回收站，可随时恢复。')
  if (!ok) return
  try {
    await fs.deleteNote(item.path, rootDir.value)
  } catch (e) {
    window.alert('删除失败：' + (e && e.message))
    return
  }
  removeTabsByPath(item.path)
  await refreshAfterOps()
}

async function openRecycle() {
  if (!rootDir.value) {
    window.alert('请先打开一个文件夹')
    return
  }
  recycleOpen.value = true
  await loadRecycle()
}

async function loadRecycle() {
  try {
    recycleItems.value = await fs.listRecycle(rootDir.value)
  } catch (e) {
    recycleItems.value = []
  }
}

async function restoreFromRecycle(id) {
  try {
    await fs.restoreNote(rootDir.value, id)
  } catch (e) {
    window.alert('恢复失败：' + (e && e.message))
    return
  }
  await loadRecycle()
  await refreshAfterOps()
}

async function purgeFromRecycle(id) {
  const ok = window.confirm('确定彻底删除该笔记？此操作不可恢复！')
  if (!ok) return
  try {
    await fs.purgeNote(rootDir.value, id)
  } catch (e) {
    window.alert('删除失败：' + (e && e.message))
    return
  }
  await loadRecycle()
}

async function emptyRecycleBin() {
  if (!recycleItems.value.length) return
  const ok = window.confirm('确定清空回收站？所有笔记将被永久删除，不可恢复！')
  if (!ok) return
  try {
    await fs.emptyRecycle(rootDir.value)
  } catch (e) {
    window.alert('清空失败：' + (e && e.message))
    return
  }
  await loadRecycle()
  await refreshAfterOps()
}

function fmtTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const p = (n) => (n < 10 ? '0' + n : '' + n)
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function closeRecycle() {
  recycleOpen.value = false
}

// ---------- 复制路径 / 导出 PDF ----------
async function handleCopyPath(item) {
  try {
    await fs.copyText(item.path)
    showToast('已复制笔记路径')
  } catch (e) {
    window.alert('复制失败：' + (e && e.message))
  }
}
async function handleCopyDir(item) {
  try {
    await fs.copyText(dirOf(item.path))
    showToast('已复制所在目录路径')
  } catch (e) {
    window.alert('复制失败：' + (e && e.message))
  }
}
async function handleCopyViewerText(text) {
  try {
    await fs.copyText(text)
    showToast('已复制文件内容')
  } catch (e) {
    window.alert('复制失败：' + (e && e.message))
  }
}
async function handleExportPdf(item) {
  // 优先用已打开标签里的最新内容，否则读磁盘
  let content = contents[item.path]
  if (content === undefined) {
    try {
      content = await fs.readFile(item.path)
    } catch (e) {
      window.alert('读取失败：' + (e && e.message))
      return
    }
  }
  try {
    const html = await buildPdfHtml(content, dirOf(item.path))
    const name = item.name.replace(/\.(md|markdown|mdx)$/i, '') + '.pdf'
    const saved = await fs.exportPdf({ html, defaultName: name })
    if (saved) showToast('已导出 PDF')
  } catch (e) {
    window.alert('导出失败：' + (e && e.message))
  }
}

function findNode(node, path) {
  if (!node) return null
  if (node.path === path) return node
  if (node.children) {
    for (const c of node.children) {
      const r = findNode(c, path)
      if (r) return r
    }
  }
  return null
}

function navigate(i) {
  const item = toc.value[i]
  editorRef.value?.scrollToHeading({ index: i, line: item ? item.line : 0 })
}

// 目录外部变动（如新建文件）时刷新列表
let reloadTimer = null
// 自增值：通知正在打开的聚合页重新扫描卡片墙
const navRefresh = ref(0)
function onKeydown(e) {
  if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
    e.preventDefault()
    doSave()
    return
  }
  // Esc：依次关掉最上层的浮层
  if (e.key === 'Escape') {
    if (settingsOpen.value) closeSettings()
    else if (recycleOpen.value) closeRecycle()
    else if (switchMenu.value) switchMenu.value = false
  }
}
onMounted(() => {
  fs.onDirChanged(() => {
    clearTimeout(reloadTimer)
    reloadTimer = setTimeout(() => {
      if (selectedDir.value) loadFiles(selectedDir.value)
      if (activeIsNav.value) navRefresh.value++
    }, 400)
  })
  // 应用菜单（文件→打开文件夹 / 保存）
  fs.onMenu((action) => {
    if (action === 'open-folder') openFolder()
    else if (action === 'save') doSave()
    else if (action === 'settings') openSettings()
    else if (action === 'toggle-theme') toggleTheme()
    else if (action === 'check-update') checkUpdate(true)
  })
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('click', closeSwitchMenu)
  window.addEventListener('pagehide', flushNow)
  window.addEventListener('beforeunload', flushNow)
  // 版本号 + 启动后静默查一次新版本（只有打包版才查，开发时不打扰）
  fs.getAppInfo()
    .then((info) => {
      if (!info) return
      appVersion.value = info.version || ''
      if (info.packaged && !updateChecked) {
        updateChecked = true
        setTimeout(() => checkUpdate(false), 4000)
      }
    })
    .catch(() => {})
  loadConfig()
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('click', closeSwitchMenu)
  window.removeEventListener('pagehide', flushNow)
  window.removeEventListener('beforeunload', flushNow)
})
function closeSwitchMenu() {
  switchMenu.value = false
}

// 窗口关闭前兜底：保存未落盘内容 + 写入配置
function flushNow() {
  const p = pendingPath || activePath.value
  try {
    if (p && contents[p] !== undefined && contents[p] !== savedMap[p]) {
      fs.writeFile(p, contents[p])
    }
  } catch (_) {}
  try {
    fs.flushConfig(currentConfig())
  } catch (_) {}
}

// 列宽拖拽
let resizing = null
function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v))
}
function startResize(side, e) {
  resizing = side
  const startX = e.clientX
  const startW = side === 'left' ? col1W.value : side === 'mid' ? col2W.value : col4W.value
  const move = (ev) => {
    if (!resizing) return
    const dx = ev.clientX - startX
    if (side === 'left') col1W.value = clamp(startW + dx, 160, 480)
    else if (side === 'mid') col2W.value = clamp(startW + dx, 160, 520)
    else col4W.value = clamp(startW - dx, 160, 480)
  }
  const up = () => {
    resizing = null
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', up)
  }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
}
</script>

<template>
  <div class="app">
    <header class="topbar">
      <button class="btn primary" @click="openFolder">打开文件夹</button>
      <span class="crumbs">{{ selectedDir || '未打开文件夹' }}</span>
      <span v-if="rememberFlash" style="color:#3fb950;font-size:12px;margin-left:12px;">✓ 已记住目录</span>
      <span class="topbar-spacer"></span>
      <button
        class="theme-toggle"
        type="button"
        :title="theme === 'light' ? '切换到深色模式 (Ctrl+Shift+L)' : '切换到浅色模式 (Ctrl+Shift+L)'"
        @click="toggleTheme"
      >
        <svg v-if="theme === 'light'" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
          <circle cx="8" cy="8" r="3.1" fill="none" stroke="currentColor" stroke-width="1.3" />
          <path
            d="M8 1v1.8M8 13.2V15M1 8h1.8M13.2 8H15M3.1 3.1l1.3 1.3M11.6 11.6l1.3 1.3M12.9 3.1l-1.3 1.3M4.4 11.6l-1.3 1.3"
            stroke="currentColor" stroke-width="1.3" stroke-linecap="round"
          />
        </svg>
        <svg v-else viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
          <path
            d="M10.8 1.6a6.4 6.4 0 1 0 3.6 10.1A7.2 7.2 0 0 1 10.8 1.6z"
            fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"
          />
        </svg>
        {{ theme === 'light' ? '浅色' : '深色' }}
      </button>
      <button class="btn" title="设置 (Ctrl+,)" @click="openSettings">⚙ 设置</button>
      <span v-if="toast" class="toast">{{ toast }}</span>
    </header>

    <!-- 发现新版本（手动/自动检查都会用这条提示） -->
    <div v-if="updateInfo" class="update-bar">
      <span class="update-ic" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="13" height="13">
          <path d="M8 2v8M4.8 6.8 8 10l3.2-3.2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
          <path d="M2.5 12.5h11" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
        </svg>
      </span>
      <span class="update-text">
        发现新版本 <b>{{ updateInfo.version }}</b>，当前 {{ appVersion || '—' }}。
      </span>
      <button class="update-btn" type="button" @click="openUpdatePage">前往 GitHub 下载</button>
      <button class="update-close" type="button" title="不再提示" @click="dismissUpdate">✕</button>
    </div>

    <div class="cols">
      <div class="col col1" :style="{ width: col1W + 'px' }">
        <div class="col1-header">
          <span class="col1-title">目录</span>
          <button class="col1-switch" @click.stop="toggleSwitchMenu">切换目录 ▾</button>
          <div v-if="switchMenu" class="switch-menu" @click.stop>
            <div
              v-for="d in recentDirs"
              :key="d"
              class="switch-item"
              :class="{ active: d === rootDir }"
              :title="d"
              @click="openRecent(d)"
            >
              <span class="switch-name">{{ shortName(d) }}</span>
              <span
                class="switch-del"
                title="从历史列表中移除（不会删除磁盘目录）"
                @click.stop="removeRecent(d)"
              >✕</span>
            </div>
            <div v-if="!recentDirs.length" class="switch-empty">暂无历史目录</div>
            <div class="switch-item add" @click="openFolder">+ 浏览其他文件夹…</div>
          </div>
        </div>

        <DirectoryTree
          v-if="tree"
          :tree="tree"
          :selected-dir="selectedDir"
          @select="handleSelectDir"
          @create-dir="createDir"
          @create-doc="createDoc"
          @create-nav="createNav"
        />
        <div v-else class="placeholder">点击「打开文件夹」开始</div>
      </div>

      <div class="resizer" @mousedown="startResize('left', $event)"></div>

      <div class="col col2" :style="{ width: col2W + 'px' }">
        <FileList
          :items="displayItems"
          :query="searchQuery"
          :active-file="activePath"
          :is-dirty="isDirty"
          :open-paths="openPaths"
          :pins="pins"
          @update:query="(v) => (searchQuery = v)"
          @open="(f) => openFile(f)"
          @open-pinned="(f) => openFile(f, { pinned: true })"
          @archive="handleArchive"
          @remove="handleRemove"
          @open-recycle="openRecycle"
          @copy-path="handleCopyPath"
          @copy-dir="handleCopyDir"
          @export-pdf="handleExportPdf"
          @toggle-pin="handleTogglePin"
        />
      </div>

      <div class="resizer" @mousedown="startResize('mid', $event)"></div>

      <div class="col col3">
        <div v-if="tabs.length" class="tabbar">
          <div
            v-for="t in tabs"
            :key="t.path"
            class="tab"
            :class="{ active: t.path === activePath, pinned: t.pinned }"
            :title="t.path + (t.pinned ? '（已固定）' : '')"
            @click="activateTab(t.path)"
            @dblclick="pinTab(t.path)"
          >
            <span class="tab-dot" :class="{ dirty: isTabDirty(t) }"></span>
            <span v-if="t.isNav" class="tab-ic" title="聚合页">▦</span>
            <span class="tab-name">{{ t.name }}</span>
            <span class="tab-close" @click.stop="closeTab(t.path)">✕</span>
          </div>
          <span class="tabbar-spacer"></span>
          <div v-if="activeIsNav" class="nav-view-switch">
            <button
              type="button"
              :class="{ active: !navEdit }"
              @click="navEdit = false"
            >卡片视图</button>
            <button type="button" :class="{ active: navEdit }" @click="navEdit = true">源文件</button>
          </div>
        </div>

        <!-- 聚合页：卡片式笔记汇总封面墙 -->
        <NavPane
          v-if="activePath && activeIsNav && !navEdit"
          :file="activePath"
          :name="activeTab.name"
          :dir="fileDir"
          :pinned="pins.includes(activePath)"
          :refresh-key="navRefresh"
          :card-size="navCardSize"
          @open-note="openNoteByPath"
          @update:card-size="onNavCardSize"
        />
        <!-- 图片 / 代码 / 文本：只读查看器 -->
        <ViewerPane
          v-else-if="activePath && activeKind !== 'note'"
          :file="activePath"
          :name="activeTab.name"
          :ext="activeTab.ext"
          :kind="activeKind"
          :content="activeContent"
          :size="activeTab.size"
          :mtime="activeTab.mtime"
          @copy="handleCopyViewerText"
        />
        <!-- 笔记：编辑器 -->
        <EditorPane
          v-else-if="activePath"
          ref="editorRef"
          :file="activePath"
          :content="activeContent"
          :doc-dir="fileDir"
          :theme="theme"
          :is-dirty="isDirty"
          :saved-flash="justSaved"
          @change="onContentChange"
          @save="doSave"
          @loaded="onLoaded"
        />
        <div v-else class="placeholder">从左侧选择一篇文档开始编辑</div>
      </div>

      <div class="resizer" @mousedown="startResize('right', $event)"></div>

      <div class="col col4" :style="{ width: col4W + 'px' }">
        <TocPane v-if="activePath && activeKind === 'note' && !activeIsNav" :toc="toc" @navigate="navigate" />
        <div v-else class="placeholder">
          {{ activeIsNav ? '聚合页没有大纲' : activePath ? '只读文件没有大纲' : '暂无内容' }}
        </div>
      </div>
    </div>

    <!-- 回收站面板 -->
    <div v-if="recycleOpen" class="recycle-mask" @click.self="closeRecycle">
      <div class="recycle">
        <div class="recycle-head">
          <span class="recycle-title">回收站</span>
          <button
            class="recycle-empty"
            type="button"
            :disabled="!recycleItems.length"
            @click="emptyRecycleBin"
          >清空回收站</button>
          <button class="recycle-close" type="button" @click="closeRecycle">✕</button>
        </div>
        <div class="recycle-list">
          <div v-if="!recycleItems.length" class="recycle-empty-tip">回收站为空</div>
          <div v-for="it in recycleItems" :key="it.id" class="recycle-item">
            <div class="recycle-info">
              <div class="recycle-name" :title="it.name">{{ it.name }}</div>
              <div class="recycle-meta">删除于 {{ fmtTime(it.deletedAt) }}</div>
              <div class="recycle-meta dim" :title="it.origPath">原路径：{{ it.origPath }}</div>
            </div>
            <div class="recycle-ops">
              <button class="recycle-btn" type="button" @click="restoreFromRecycle(it.id)">恢复</button>
              <button class="recycle-btn danger" type="button" @click="purgeFromRecycle(it.id)">彻底删除</button>
            </div>
          </div>
        </div>
        <div class="recycle-foot">回收站内笔记不会真正删除，可随时恢复；「彻底删除」或「清空回收站」后不可恢复。</div>
      </div>
    </div>

    <!-- 设置中心 -->
    <div v-if="settingsOpen" class="recycle-mask" @click.self="closeSettings">
      <div class="recycle settings">
        <div class="recycle-head">
          <span class="recycle-title">设置</span>
          <button class="recycle-close" type="button" @click="closeSettings">✕</button>
        </div>

        <div class="settings-body">
          <div class="set-group-title">外观</div>
          <div class="set-row">
            <span class="set-row-label">主题</span>
            <div class="seg">
              <button type="button" :class="{ active: theme === 'light' }" @click="applyTheme('light')">浅色</button>
              <button type="button" :class="{ active: theme === 'dark' }" @click="applyTheme('dark')">深色</button>
            </div>
            <span class="set-row-hint">也可以按 Ctrl+Shift+L 快速切换</span>
          </div>

          <div class="set-group-title">新版本检测</div>
          <div class="set-field">
            <div class="set-label">GitHub 仓库（owner/repo）</div>
            <input
              class="set-input"
              type="text"
              spellcheck="false"
              v-model="settingsForm.updateRepo"
              placeholder="例如 junge/md-editor（留空则读取 package.json 的 repository）"
            />
          </div>
          <div class="set-row">
            <button class="recycle-btn" type="button" :disabled="updateChecking" @click="checkUpdate(true)">
              {{ updateChecking ? '检查中…' : '立即检查更新' }}
            </button>
            <span class="set-row-hint">当前版本 {{ appVersion || '—' }}，有新版本会在顶部提示并跳转 GitHub 发布页</span>
          </div>

          <div class="set-group-title">忽略规则</div>
          <label class="set-check">
            <input type="checkbox" v-model="settingsForm.ignoreDot" />
            <span>忽略以「.」开头的目录和文件</span>
          </label>
          <div class="set-tip">用于隐藏 <code>.git</code>、<code>.obsidian</code>、<code>.DS_Store</code> 这类文件。</div>

          <div class="set-field">
            <div class="set-label">忽略的目录名（每行一个，支持 * 和 ? 通配）</div>
            <textarea
              class="set-textarea"
              spellcheck="false"
              v-model="settingsForm.ignoreDirsText"
              placeholder="node_modules&#10;dist&#10;临时"
            ></textarea>
          </div>

          <div class="set-field">
            <div class="set-label">忽略的文件名（每行一个，支持 * 和 ? 通配）</div>
            <textarea
              class="set-textarea"
              spellcheck="false"
              v-model="settingsForm.ignoreFilesText"
              placeholder="*.tmp&#10;*.bak&#10;Thumbs.db"
            ></textarea>
          </div>

          <div class="set-tip">
            被忽略的目录/文件不会出现在左侧目录树和文件列表中，也不会进入搜索索引。
            保存后立即生效。目录名按「名称」匹配（任意层级都生效），不需要写完整路径。
          </div>
        </div>

        <div class="recycle-foot settings-foot">
          <button class="recycle-btn" type="button" @click="resetSettings">恢复默认</button>
          <span class="settings-foot-spacer"></span>
          <button class="recycle-btn" type="button" @click="closeSettings">取消</button>
          <button class="recycle-btn primary" type="button" @click="saveSettings">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>
