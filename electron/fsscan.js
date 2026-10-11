// 目录扫描：目录树构建 + 文件列举 + 笔记元信息提取
// 抽出来是为了：①与 Electron 解耦，可以用 node 直接跑真实文件系统测试；
// ②忽略规则的过滤集中在这一层，目录树和文件列表不可能出现"一套规则两种结果"。
'use strict'
const fs = require('fs')
const path = require('path')

// 回收站目录：始终不出现在目录树里（通过「回收站」面板访问）
const RECYCLE_DIR = '.recycle'

const NOTE_RE = /\.(md|markdown|mdx)$/i
// 聚合页：文件名以 .nav.md 结尾（如「我的导航.nav.md」），打开后是卡片汇总视图
const NAV_RE = /\.nav\.md$/i

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif'])
const CODE_EXT = new Set([
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'vue', 'svelte',
  'css', 'scss', 'sass', 'less', 'styl', 'stylus',
  'html', 'htm', 'xml', 'svgz', 'xhtml',
  'json', 'json5', 'jsonc', 'yaml', 'yml', 'toml', 'ini', 'conf', 'cfg', 'env', 'properties',
  'php', 'py', 'rb', 'java', 'kt', 'kts', 'scala', 'groovy', 'go', 'rs', 'c', 'h', 'cpp', 'cc', 'cxx', 'hpp',
  'cs', 'swift', 'dart', 'lua', 'pl', 'pm', 'r', 'm', 'mm', 'sql',
  'sh', 'bash', 'zsh', 'fish', 'bat', 'cmd', 'ps1', 'psm1',
  'dockerfile', 'makefile', 'cmake', 'gradle', 'diff', 'patch', 'graphql', 'proto', 'nginx', 'vim', 'tex'
])
const TEXT_EXT = new Set([
  'txt', 'text', 'log', 'csv', 'tsv', 'rst', 'adoc',
  'gitignore', 'npmignore', 'editorconfig', 'license', 'lock', 'sum'
])

// 大文件（>2MB）不做语法高亮、也不进全文检索，避免卡死
const BIG_FILE = 2 * 1024 * 1024
// 聚合页里读取笔记用的并发上限
const SCAN_CONCURRENCY = 8

function extOf(name) {
  const i = name.lastIndexOf('.')
  if (i <= 0) return ''
  return name.slice(i + 1).toLowerCase()
}

function kindOf(name) {
  if (NOTE_RE.test(name)) return 'note'
  const ext = extOf(name)
  if (IMAGE_EXT.has(ext)) return 'image'
  if (CODE_EXT.has(ext)) return 'code'
  if (TEXT_EXT.has(ext)) return 'text'
  // 没有扩展名的（Dockerfile / Makefile / LICENSE 之类）按文本处理
  if (!ext) return 'text'
  return 'text'
}

// 并发受限地跑一批任务
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length)
  let cursor = 0
  const workers = new Array(Math.min(limit, items.length || 1)).fill(0).map(async () => {
    for (;;) {
      const i = cursor++
      if (i >= items.length) return
      out[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return out
}

// 从 markdown 文本里取标题与封面图（不引入 markdown 解析器，正则够用且快）
function extractMeta(text, fileName) {
  const src = String(text || '')
  // 标题：跳过代码围栏，取第一个 H1
  let title = ''
  const lines = src.split(/\r?\n/)
  let inFence = false
  for (const line of lines) {
    const t = line.trim()
    if (/^(```|~~~)/.test(t)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const m = t.match(/^#\s+(.+?)\s*#*$/)
    if (m) {
      title = m[1].trim()
      break
    }
  }
  if (!title) title = fileName.replace(NAV_RE, '').replace(NOTE_RE, '') || fileName

  // 封面：第一张图片（markdown 语法或 <img src>）
  let cover = ''
  const fenceStripped = src.replace(/```[\s\S]*?```/g, '').replace(/~~~[\s\S]*?~~~/g, '')
  const md = fenceStripped.match(/!\[[^\]]*\]\(\s*<?([^)\s>]+)>?/)
  if (md) cover = md[1]
  if (!cover) {
    const img = fenceStripped.match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i)
    if (img) cover = img[1]
  }
  return { title, cover }
}

function createScanner(ignore) {
  async function buildTree(dir) {
    let entries
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true })
    } catch (_) {
      return [] // 权限不足/目录消失等，视为空目录而不是让整棵树挂掉
    }
    const children = []
    for (const e of entries) {
      if (!e.isDirectory()) continue
      if (e.name === RECYCLE_DIR) continue
      if (ignore.isIgnored(e.name, 'dir')) continue
      const childPath = path.join(dir, e.name)
      children.push({
        name: e.name,
        path: childPath,
        children: await buildTree(childPath)
      })
    }
    return children
  }

  async function getTree(root) {
    return {
      name: path.basename(root),
      path: root,
      root: true,
      children: await buildTree(root)
    }
  }

  // 列出目录下的所有文件（不只是 md）：程序员笔记目录里常放 css/js/图片等附件，
  // 都需要能在第 2 列看到并点开预览。
  async function listFiles(dir) {
    let entries
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true })
    } catch (_) {
      return []
    }
    const files = []
    for (const e of entries) {
      if (!e.isFile()) continue
      const n = e.name
      if (ignore.isIgnored(n, 'file')) continue
      const p = path.join(dir, n)
      let st = null
      try {
        st = await fs.promises.stat(p)
      } catch (_) {
        continue
      }
      files.push({
        name: n,
        path: p,
        mtime: st.mtimeMs,
        size: st.size,
        ext: extOf(n),
        kind: kindOf(n),
        isNav: NAV_RE.test(n)
      })
    }
    // 笔记排在前面（附件目录里全是图片时也不影响；笔记目录里笔记不会被淹没），组内按名称
    files.sort((a, b) => {
      const an = a.kind === 'note' ? 0 : 1
      const bn = b.kind === 'note' ? 0 : 1
      if (an !== bn) return an - bn
      return a.name.localeCompare(b.name, 'zh')
    })
    return files
  }

  // 聚合页用：扫出「本目录的笔记 + 每个直接子目录的笔记」
  async function scanNotes(dir, options) {
    const selfPath = (options && options.selfPath) || ''
    let entries
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true })
    } catch (_) {
      return { dir, uncategorized: [], categories: [] }
    }

    const subDirs = []
    const ownFiles = []
    for (const e of entries) {
      if (e.isDirectory()) {
        if (e.name === RECYCLE_DIR) continue
        if (ignore.isIgnored(e.name, 'dir')) continue
        subDirs.push(e.name)
      } else if (e.isFile()) {
        if (!NOTE_RE.test(e.name)) continue
        if (ignore.isIgnored(e.name, 'file')) continue
        ownFiles.push(e.name)
      }
    }

    // baseDir 是「这篇笔记自己所在的目录」，封面相对路径要按它解析
    // （子目录里的笔记不能拿外层目录去拼，否则封面全找不到）
    async function readNote(filePath, name, baseDir) {
      try {
        const st = await fs.promises.stat(filePath)
        const raw = st.size > BIG_FILE ? '' : await fs.promises.readFile(filePath, 'utf-8')
        const meta = extractMeta(raw, name)
        // 封面转成绝对路径，交给渲染进程读 data URL；网络图/内联图原样保留
        let coverAbs = ''
        const c = meta.cover || ''
        if (c && !/^(https?:|data:|blob:)/i.test(c)) {
          if (/^file:\/\//i.test(c)) {
            let p = c.replace(/^file:\/\//i, '')
            try {
              p = decodeURIComponent(p)
            } catch (_) {}
            coverAbs = /^\/[a-zA-Z]:/.test(p) ? p.slice(1) : p
          } else if (path.isAbsolute(c)) {
            coverAbs = c
          } else {
            let rel = c
            try {
              rel = decodeURIComponent(c)
            } catch (_) {}
            coverAbs = path.join(baseDir || dir, rel)
          }
        }
        return {
          name,
          path: filePath,
          title: meta.title,
          cover: meta.cover,
          coverAbs,
          mtime: st.mtimeMs,
          size: st.size,
          isNav: NAV_RE.test(name)
        }
      } catch (_) {
        return null
      }
    }

    const uncategorized = (
      await mapLimit(
        ownFiles.filter((n) => path.join(dir, n) !== selfPath),
        SCAN_CONCURRENCY,
        (n) => readNote(path.join(dir, n), n, dir)
      )
    ).filter(Boolean)

    const categories = []
    for (const d of subDirs) {
      const subDir = path.join(dir, d)
      let subEntries
      try {
        subEntries = await fs.promises.readdir(subDir, { withFileTypes: true })
      } catch (_) {
        continue
      }
      const names = subEntries
        .filter(
          (x) =>
            x.isFile() && NOTE_RE.test(x.name) && !ignore.isIgnored(x.name, 'file')
        )
        .map((x) => x.name)
      if (!names.length) continue
      const notes = (
        await mapLimit(names, SCAN_CONCURRENCY, (n) => readNote(path.join(subDir, n), n, subDir))
      ).filter(Boolean)
      categories.push({ name: d, path: subDir, notes })
    }

    return { dir, uncategorized, categories }
  }

  return { buildTree, getTree, listFiles, scanNotes }
}

module.exports = {
  createScanner,
  RECYCLE_DIR,
  NOTE_RE,
  NAV_RE,
  extOf,
  kindOf,
  extractMeta,
  BIG_FILE
}
