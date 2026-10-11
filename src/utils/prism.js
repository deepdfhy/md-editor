// Prism 统一配置：语言注册 + 语言名兼容层 + 高亮函数
// 编辑器（所见即所得代码块）和只读查看器（css/js/图片之外的文本文件）共用这一份，
// 避免两边各注册一套语言、结果不一致。
import Prism from 'prismjs'

// ⚠️ Prism 语言组件有依赖顺序：extend 的目标语言必须先加载，否则会在
// Prism.languages.extend(缺失语言, {…}) 处抛 "Cannot set properties of undefined"，
// 进而导致整个渲染进程白屏。核心已含 markup / css / clike / javascript，
// 以下严格按依赖拓扑顺序补齐（c 必须在 cpp 前，markup-templating 必须在 php 前）。
import 'prismjs/components/prism-markup-templating' // php / docker 依赖
import 'prismjs/components/prism-c' // cpp / objectivec 依赖
import 'prismjs/components/prism-typescript' // 依赖 javascript
import 'prismjs/components/prism-jsx' // 依赖 markup + javascript
import 'prismjs/components/prism-tsx' // 依赖 jsx + typescript
import 'prismjs/components/prism-json'
import 'prismjs/components/prism-bash'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-java' // scala 依赖 clike/java
import 'prismjs/components/prism-csharp' // 依赖 clike
import 'prismjs/components/prism-cpp' // 依赖 c
import 'prismjs/components/prism-go' // 依赖 clike
import 'prismjs/components/prism-rust'
import 'prismjs/components/prism-php' // 依赖 markup-templating
import 'prismjs/components/prism-sql'
import 'prismjs/components/prism-yaml'
import 'prismjs/components/prism-markdown' // 依赖 markup
import 'prismjs/components/prism-scss' // 依赖 css
// 第二梯队：程序员笔记里常见的语言，不注册的话 ```nginx / ```docker 这类代码块完全没颜色。
import 'prismjs/components/prism-json5' // 依赖 json
import 'prismjs/components/prism-ini'
import 'prismjs/components/prism-editorconfig' // 依赖 ini
import 'prismjs/components/prism-toml'
import 'prismjs/components/prism-diff'
import 'prismjs/components/prism-git'
import 'prismjs/components/prism-ignore'
import 'prismjs/components/prism-log'
import 'prismjs/components/prism-csv'
import 'prismjs/components/prism-regex'
import 'prismjs/components/prism-http'
import 'prismjs/components/prism-graphql'
import 'prismjs/components/prism-protobuf' // 依赖 clike
import 'prismjs/components/prism-less' // 依赖 css
import 'prismjs/components/prism-sass' // 依赖 css
import 'prismjs/components/prism-stylus' // 依赖 css
import 'prismjs/components/prism-kotlin' // 依赖 clike
import 'prismjs/components/prism-scala' // 依赖 java
import 'prismjs/components/prism-groovy' // 依赖 clike
import 'prismjs/components/prism-dart' // 依赖 clike
import 'prismjs/components/prism-swift'
import 'prismjs/components/prism-lua'
import 'prismjs/components/prism-perl'
import 'prismjs/components/prism-r'
import 'prismjs/components/prism-objectivec' // 依赖 c
import 'prismjs/components/prism-vim'
import 'prismjs/components/prism-latex'
import 'prismjs/components/prism-nginx'
import 'prismjs/components/prism-docker' // 依赖 markup-templating
import 'prismjs/components/prism-cmake'
import 'prismjs/components/prism-batch'
import 'prismjs/components/prism-powershell'

// ---------------------------------------------------------------------------
// 语言名兼容层
// Toast UI 的 code-syntax-highlight 插件内部是直接 `prism.languages[lang]`
// 取语言的 —— 大小写敏感、且不解析别名。所以笔记里写 ```PHP / ```Js / ```VUE
// 这类大小写不规范的围栏时取不到语言对象，代码块就完全没有高亮
// （这正是「预览模式有高亮、所见即所得没有」的常见原因：预览走 highlight.js，
//  它自己会做别名与大小写兼容）。
// 这里给 Prism.languages 套一层 Proxy 做兜底：原样取不到 → 全小写再取 → 查别名表。
// 不改第三方源码，只在运行时补一层查找。
// ---------------------------------------------------------------------------
export const LANG_ALIAS = {
  'c#': 'csharp',
  cs: 'csharp',
  dotnet: 'csharp',
  'c++': 'cpp',
  cplusplus: 'cpp',
  'objective-c': 'objectivec',
  objc: 'objectivec',
  dockerfile: 'docker',
  make: 'makefile',
  shell: 'bash',
  zsh: 'bash',
  console: 'bash',
  vue: 'markup', // Prism 1.30 没有 vue 组件，用 markup（HTML）兜底，至少能把标签/属性上色
  svelte: 'markup',
  html: 'markup',
  htm: 'markup',
  xml: 'markup',
  svg: 'markup',
  md: 'markdown',
  py: 'python',
  rb: 'ruby',
  yml: 'yaml',
  ts: 'typescript'
}

const rawLanguages = Prism.languages
const missCache = new Map()

export function resolveLanguage(name) {
  if (typeof name !== 'string' || !name) return undefined
  let v = rawLanguages[name]
  if (v !== undefined) return v
  if (missCache.has(name)) return missCache.get(name)
  const lower = name.toLowerCase()
  v = rawLanguages[lower]
  if (v === undefined) {
    const alias = LANG_ALIAS[lower]
    if (alias) v = rawLanguages[alias]
  }
  missCache.set(name, v)
  return v
}

Prism.languages = new Proxy(rawLanguages, {
  get(target, prop, receiver) {
    const v = Reflect.get(target, prop, receiver)
    if (v !== undefined || typeof prop !== 'string') return v
    return resolveLanguage(prop)
  }
})

// 不需要高亮的语言名
const NO_HL = new Set(['', 'none', 'text', 'plain', 'plaintext', 'txt'])

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * 高亮一段代码，返回 HTML 片段。
 * @returns {string|null} null 表示没有对应语言的语法表（调用方按纯文本处理）
 */
export function highlightCode(code, langName) {
  const name = String(langName || '')
  if (NO_HL.has(name.toLowerCase())) return null
  const grammar = resolveLanguage(name)
  if (!grammar) return null
  try {
    return Prism.highlight(String(code), grammar, name)
  } catch (_) {
    return null
  }
}

export { escapeHtml }
export default Prism
