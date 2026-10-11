// 文件类型工具：扩展名 → 展示信息 / Prism 语言 / 图标配色
// 主进程 fsscan.js 里已经算好了 kind，这里只负责「渲染层」的表现。

export const KIND_LABEL = {
  note: '笔记',
  image: '图片',
  code: '代码',
  text: '文本'
}

// 扩展名 → Prism 语言名。Prism 语言名在 EditorPane 里做过大小写与别名兜底。
const EXT_LANG = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  jsx: 'jsx', ts: 'typescript', tsx: 'tsx',
  vue: 'markup', svelte: 'markup',
  css: 'css', scss: 'scss', sass: 'sass', less: 'less', styl: 'stylus', stylus: 'stylus',
  html: 'markup', htm: 'markup', xml: 'markup', xhtml: 'markup', svg: 'markup',
  json: 'json', json5: 'json5', jsonc: 'json',
  yaml: 'yaml', yml: 'yaml', toml: 'toml', ini: 'ini', conf: 'ini', cfg: 'ini',
  env: 'bash', properties: 'ini',
  php: 'php', py: 'python', rb: 'ruby', java: 'java', kt: 'kotlin', kts: 'kotlin',
  scala: 'scala', groovy: 'groovy', go: 'go', rs: 'rust',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
  cs: 'csharp', swift: 'swift', dart: 'dart', lua: 'lua', pl: 'perl', pm: 'perl',
  r: 'r', m: 'objectivec', mm: 'objectivec', sql: 'sql',
  sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash', bat: 'batch', cmd: 'batch',
  ps1: 'powershell', psm1: 'powershell',
  dockerfile: 'docker', makefile: 'makefile', cmake: 'cmake',
  gradle: 'groovy', diff: 'diff', patch: 'diff', graphql: 'graphql',
  proto: 'protobuf', nginx: 'nginx', vim: 'vim', tex: 'latex',
  md: 'markdown', markdown: 'markdown', mdx: 'markdown',
  txt: 'none', text: 'none', log: 'log', csv: 'csv', tsv: 'csv',
  gitignore: 'ignore', npmignore: 'ignore', editorconfig: 'editorconfig'
}

// 无扩展名的常见文件名 → 语言
const NAME_LANG = {
  dockerfile: 'docker',
  makefile: 'makefile',
  'cmakelists.txt': 'cmake',
  '.gitignore': 'ignore',
  '.npmignore': 'ignore',
  '.editorconfig': 'editorconfig',
  '.env': 'bash',
  license: 'none',
  readme: 'markdown'
}

export function langForFile(name, ext) {
  const lower = String(name || '').toLowerCase()
  if (NAME_LANG[lower]) return NAME_LANG[lower]
  const e = String(ext || '').toLowerCase()
  return EXT_LANG[e] || 'none'
}

export function isImageKind(kind) {
  return kind === 'image'
}
export function isNoteKind(kind) {
  return kind === 'note'
}
// 可以用「只读查看器」打开的类型
export function isViewableKind(kind) {
  return kind === 'image' || kind === 'code' || kind === 'text'
}

export function formatSize(bytes) {
  const n = Number(bytes) || 0
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  return (n / 1024 / 1024).toFixed(2) + ' MB'
}

export function formatTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const p = (n) => (n < 10 ? '0' + n : '' + n)
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// 相对时间，卡片上显示更直观
export function formatRelative(ts) {
  if (!ts) return ''
  const diff = Date.now() - Number(ts)
  if (diff < 0) return formatTime(ts)
  const m = Math.floor(diff / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return m + ' 分钟前'
  const h = Math.floor(m / 60)
  if (h < 24) return h + ' 小时前'
  const d = Math.floor(h / 24)
  if (d < 30) return d + ' 天前'
  const dt = new Date(Number(ts))
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

// 卡片封面缺失时的占位配色：由标题 hash 稳定取色
const PLACEHOLDER_COLORS = [
  ['#1f6feb', '#0d419d'],
  ['#2ea043', '#116329'],
  ['#bb8009', '#7a5500'],
  ['#a371f7', '#6639ba'],
  ['#db61a2', '#8b2b62'],
  ['#1f9ea8', '#0f5f66']
]
export function placeholderColor(text) {
  const s = String(text || '')
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return PLACEHOLDER_COLORS[h % PLACEHOLDER_COLORS.length]
}
