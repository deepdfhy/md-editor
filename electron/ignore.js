// 忽略规则（设置中心）
// 单独抽成模块，好处：
//   1) 主进程的目录树 / 文件列表共用同一套判断，不会两边逻辑不一致；
//   2) 不依赖 Electron，可以直接用 node 跑单元测试（scripts/t-ignore.cjs）。
'use strict'

// 默认规则：忽略以 . 开头的目录/文件（.git / .obsidian / .DS_Store…）
// 以及常见的体积型目录。老配置里没有 ignore 字段时按此默认值生效。
const DEFAULT_IGNORE = {
  ignoreDot: true,
  ignoreDirs: ['node_modules', 'dist'],
  ignoreFiles: []
}

// 支持数组，也支持用户在设置里直接粘「每行一个」的文本
function toPatternList(v) {
  if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean)
  return String(v == null ? '' : v)
    .split(/[\n,;]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function cloneDefault() {
  return {
    ignoreDot: DEFAULT_IGNORE.ignoreDot,
    ignoreDirs: DEFAULT_IGNORE.ignoreDirs.slice(),
    ignoreFiles: DEFAULT_IGNORE.ignoreFiles.slice()
  }
}

function normalizeIgnore(raw) {
  // 完全没有配置过（老版本 config.json、首次启动）→ 用默认规则。
  // 只要用户存过一次设置，就完全按他填的来（哪怕把目录列表清空）。
  if (!raw || typeof raw !== 'object') return cloneDefault()
  const src = raw
  return {
    // 单个开关缺省时按「开启」处理，只有显式 false 才关闭
    ignoreDot: src.ignoreDot !== false,
    ignoreDirs: toPatternList(src.ignoreDirs),
    ignoreFiles: toPatternList(src.ignoreFiles)
  }
}

function escapeRe(s) {
  return String(s).replace(/[.+^${}()|[\]\\]/g, '\\$&')
}

function createIgnoreMatcher() {
  let cfg = normalizeIgnore(null)
  const cache = new Map()

  function toRegex(pat) {
    let re = cache.get(pat)
    if (re) return re
    re = new RegExp('^' + escapeRe(pat).replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i')
    cache.set(pat, re)
    return re
  }

  function matchAny(name, patterns) {
    for (const p of patterns || []) {
      if (p && toRegex(p).test(name)) return true
    }
    return false
  }

  return {
    setConfig(raw) {
      cfg = normalizeIgnore(raw)
      cache.clear()
    },
    getConfig() {
      return {
        ignoreDot: cfg.ignoreDot,
        ignoreDirs: cfg.ignoreDirs.slice(),
        ignoreFiles: cfg.ignoreFiles.slice()
      }
    },
    /**
     * @param {string} name 文件/目录的名称（不含路径）
     * @param {'dir'|'file'} kind
     */
    isIgnored(name, kind) {
      if (!name) return false
      if (cfg.ignoreDot && name.startsWith('.')) return true
      return kind === 'dir'
        ? matchAny(name, cfg.ignoreDirs)
        : matchAny(name, cfg.ignoreFiles)
    }
  }
}

module.exports = { DEFAULT_IGNORE, normalizeIgnore, createIgnoreMatcher }
