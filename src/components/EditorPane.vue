<script setup>
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import Editor from '@toast-ui/editor'
import '@toast-ui/editor/dist/toastui-editor.css'
import '@toast-ui/editor/dist/theme/toastui-editor-dark.css'
// 代码语法高亮（行业通用做法）：Toast UI 官方插件 + Prism
import codeSyntaxHighlight from '@toast-ui/editor-plugin-code-syntax-highlight'
import '@toast-ui/editor-plugin-code-syntax-highlight/dist/toastui-editor-plugin-code-syntax-highlight.css'
import Prism from '../utils/prism.js' // 统一语言注册 + 语言名兼容层（查看器共用同一份）
import { renderPreview, toDisplayMarkdown, toStorageMarkdown, toFileUrl, joinPath, customHtmlSanitizer } from '../utils/markdown.js'

const props = defineProps({
  file: { type: String, default: '' },
  content: { type: String, default: '' },
  docDir: { type: String, default: '' },
  // 'dark' | 'light'：Toast UI 的深色皮肤是靠容器上的 .toastui-editor-dark 类生效的，
  // 所以切主题不用重建编辑器，只切类名即可（重建会丢撤销历史与光标位置）。
  theme: { type: String, default: 'dark' },
  isDirty: { type: Boolean, default: false },
  savedFlash: { type: Boolean, default: false }
})
const emit = defineEmits(['change', 'save', 'loaded'])

const editorEl = ref(null)
const previewEl = ref(null)
const sourceEl = ref(null)
const bodyEl = ref(null)
const previewHtml = ref('')
const mode = ref('wysiwyg')
let editor = null

// 代码块上的「复制」按钮：每个代码块一枚、常显。
// 不往 ProseMirror 的 DOM 里插节点（会被它重渲染清掉），而是用绝对定位的浮层跟随代码块。
const wwBtns = ref([]) // [{ key, top, left }]
const copiedKey = ref(-1)
let copiedTimer = null
let wwRaf = 0
let wwObserver = null

// ---------- 代码模式：自己渲染的纯文本源码视图 ----------
// 为什么不用 Toast UI 自带的 markdown 模式（CodeMirror）？
// 因为它的 Markdown 序列化会把图片 URL 重新编码成 %E6%B5%8B%E8%AF%95… ，
// 中文路径就看不懂了。改成用一个 textarea 直接显示磁盘原文，
// Toast UI 始终保持 wysiwyg 模式、只在需要时同步内容。
const sourceText = ref('')
let srcTimer = null
// 最近一次的「存储形态」文本（相对路径、中文可读），保存 / 脏标记都以此为准
let lastStorage = ''

function getSaveDir() {
  return props.docDir || ''
}

// ---------- 所见即所得下的 Markdown 快捷输入 ----------
// Toast UI 的 WYSIWYG 不会把行首的 # / - / > 等识别成格式（会当普通文本并转义成 \#），
// 这里在按键后检测行内标记，立即删掉标记并应用对应格式。
const MD_SHORTCUTS = [
  {
    key: ' ',
    re: /^(#{1,6}) $/,
    cut: (m) => m[1].length + 1,
    run: (ed, m) => ed.exec('heading', { level: m[1].length })
  },
  { key: ' ', re: /^> $/, cut: () => 2, run: (ed) => ed.exec('blockQuote') },
  { key: ' ', re: /^[-+*] $/, cut: () => 2, run: (ed) => ed.exec('bulletList') },
  { key: ' ', re: /^(\d+)\. $/, cut: (m) => m[1].length + 2, run: (ed) => ed.exec('orderedList') }
]

// 取光标所在「顶层块」（ProseMirror 直接子节点）的文本
function currentBlockText() {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return ''
  let el = sel.anchorNode
  if (!el) return ''
  el = el.nodeType === 3 ? el.parentElement : el
  while (el && !(el.parentElement && el.parentElement.classList.contains('ProseMirror'))) {
    el = el.parentElement
  }
  return el ? el.textContent || '' : ''
}

function onEditorKeyup(type, ev) {
  if (!editor || type !== 'wysiwyg') return
  const blockText = currentBlockText()
  if (!blockText) return
  let rule = null
  let matched = null
  for (const s of MD_SHORTCUTS) {
    if (s.key !== ev.key) continue
    const r = s.re.exec(blockText)
    if (r) {
      rule = s
      matched = r
      break
    }
  }
  if (!rule) return
  const sel = editor.getSelection()
  if (!Array.isArray(sel) || typeof sel[0] !== 'number') return
  const from = sel[0]
  const n = rule.cut(matched)
  try {
    editor.deleteSelection(from - n, from)
    rule.run(editor, matched)
  } catch (_) {}
}

// Toast UI 的深色皮肤 = 容器上的 .toastui-editor-dark 类（构造时的 theme 选项只加这一个类）。
// 所以切换主题时把类名换掉就行，不必 destroy/重建编辑器。
function syncEditorTheme() {
  const root = editorEl.value
  if (!root) return
  const dark = props.theme !== 'light'
  const nodes = [root, ...root.querySelectorAll('.toastui-editor-defaultUI')]
  nodes.forEach((n) => n.classList.toggle('toastui-editor-dark', dark))
  // 代码块底色/文字的深浅由 CSS 变量负责，这里只需要让复制按钮重新量一次位置
  scheduleLayoutWw()
}
watch(() => props.theme, () => nextTick(syncEditorTheme))

onMounted(() => {
  editor = new Editor({
    el: editorEl.value,
    height: '100%',
    initialEditType: 'wysiwyg',
    previewStyle: 'vertical',
    usageStatistics: false,
    theme: props.theme === 'light' ? 'light' : 'dark',
    // 放行 file: 协议，否则代码模式的内置预览会清掉本地图片的 src
    customHTMLSanitizer: customHtmlSanitizer,
    // 按语言高亮代码块（所见即所得 + 内置预览）
    plugins: [[codeSyntaxHighlight, { highlighter: Prism }]],
    hooks: {
      addImageBlobHook: async (blob, callback) => {
        try {
          const buf = await blob.arrayBuffer()
          const name = blob.name || 'image-' + Date.now() + '.png'
          const dir = getSaveDir()
        const rel = await window.md.saveAttachment({ dir, filename: name, data: buf })
        callback(dir ? toFileUrl(joinPath(dir, rel)) : rel, name)
        } catch (e) {
          callback('', '')
        }
      }
    }
  })
  editor.on('change', () => {
    // 代码模式下内容由 textarea 持有，编辑器的 change 只是回灌结果，不需要再上报
    if (mode.value === 'code') return
    lastStorage = toStorageMarkdown(editor.getMarkdown(), getSaveDir())
    emit('change', lastStorage)
    // 所见即所得编辑后，ProseMirror 可能重渲导致高亮 range 失效，重新画一遍
    if (searchOpen.value && searchQuery.value && mode.value === 'wysiwyg') {
      if (wwRehlTimer) clearTimeout(wwRehlTimer)
      wwRehlTimer = setTimeout(() => {
        if (searchOpen.value && searchQuery.value && mode.value === 'wysiwyg') {
          highlightWw(searchQuery.value)
        }
      }, 250)
    }
  })
  editor.on('keyup', onEditorKeyup)
  if (props.file) {
    lastStorage = toStorageMarkdown(props.content || '', getSaveDir())
    editor.setMarkdown(toDisplayMarkdown(props.content || '', getSaveDir()), false)
    sourceText.value = lastStorage
  }
  syncEditorTheme()
  applyMode()
  emit('loaded', lastStorage)

  // 滚动（捕获阶段能拿到内部滚动容器的事件）、尺寸变化、内容重绘都要重新定位复制按钮
  const body = bodyEl.value
  if (body) {
    body.addEventListener('scroll', scheduleLayoutWw, true)
    window.addEventListener('resize', scheduleLayoutWw)
  }
  const pm = editorEl.value && editorEl.value.querySelector('.ProseMirror')
  if (pm && window.MutationObserver) {
    wwObserver = new MutationObserver(scheduleLayoutWw)
    wwObserver.observe(pm, { childList: true, subtree: true, characterData: true })
  }
  // 搜索：Ctrl+F 兜底拦截（主路径由菜单 accelerator 走 IPC）、Esc 关闭搜索
  window.addEventListener('keydown', onSearchKeydown, true)
})

watch(
  () => props.file,
  async () => {
    if (!editor || !props.file) return
    // 切文件前：清掉旧文件残留的搜索高亮/计数（CSS ::highlight 是全局的，
    // 若不清，旧 .ProseMirror 上的黄/红块会在切走后残留，且 wwRanges 会指向旧内容失效）。
    clearSearch()
    lastStorage = toStorageMarkdown(props.content || '', getSaveDir())
    editor.setMarkdown(toDisplayMarkdown(props.content || '', getSaveDir()), false)
    sourceText.value = lastStorage
    if (mode.value === 'preview') await renderPreviewHtml()
    await nextTick()
    scheduleLayoutWw()
    setTimeout(scheduleLayoutWw, 120)
    // 若切文件后搜索条仍开着，用新文件内容重新检索
    if (searchOpen.value && searchQuery.value) {
      setTimeout(runSearch, 60)
    }
    emit('loaded', lastStorage)
  }
)

async function renderPreviewHtml() {
  previewHtml.value = await renderPreview(editor.getMarkdown(), getSaveDir())
  await nextTick()
  addCopyButtons(previewEl.value)
}

// 把 textarea 里的源码灌回编辑器（所见即所得 / 预览都从这里取内容）
function pushSourceToEditor() {
  if (!editor) return
  try {
    editor.setMarkdown(toDisplayMarkdown(sourceText.value, getSaveDir()), false)
  } catch (_) {}
}

// 从编辑器取回存储形态文本，填进 textarea
function syncSourceFromEditor() {
  if (!editor) return
  sourceText.value = toStorageMarkdown(editor.getMarkdown(), getSaveDir())
}

// 离开代码模式前必须调用：把还没落到的输入立刻同步，避免丢字
function flushSource() {
  if (srcTimer) {
    clearTimeout(srcTimer)
    srcTimer = null
    pushSourceToEditor()
  }
}

function onSourceInput(e) {
  // 直接从事件目标取值，不依赖 v-model 与我们这个 @input 的触发先后顺序
  const val = e && e.target && typeof e.target.value === 'string' ? e.target.value : sourceText.value
  sourceText.value = val
  lastStorage = val
  emit('change', lastStorage)
  if (srcTimer) clearTimeout(srcTimer)
  srcTimer = setTimeout(() => {
    srcTimer = null
    pushSourceToEditor()
  }, 150)
}

async function setMode(m) {
  if (m === mode.value) {
    await applyMode()
    if (searchOpen.value && searchQuery.value) {
      await nextTick()
      setTimeout(runSearch, 60)
    }
    return
  }
  // 从代码模式切走：先把编辑框里的改动灌回编辑器
  if (mode.value === 'code') {
    flushSource()
    lastStorage = sourceText.value
  }
  mode.value = m
  if (m === 'code') syncSourceFromEditor()
  await applyMode()
  // 切换模式后若搜索还开着，用新模式的搜索引擎重新检索
  if (searchOpen.value && searchQuery.value) {
    await nextTick()
    setTimeout(runSearch, 60)
  }
}

async function applyMode() {
  if (!editor || !editorEl.value || !previewEl.value || !sourceEl.value) return
  const show = (el, on) => (el.style.display = on ? 'block' : 'none')
  if (mode.value === 'preview') {
    await renderPreviewHtml()
    show(editorEl.value, false)
    show(sourceEl.value, false)
    show(previewEl.value, true)
    wwBtns.value = []
  } else if (mode.value === 'code') {
    show(previewEl.value, false)
    show(editorEl.value, false)
    show(sourceEl.value, true)
    wwBtns.value = []
  } else {
    show(previewEl.value, false)
    show(sourceEl.value, false)
    show(editorEl.value, true)
    // 容器刚由 display:none 恢复，等一帧再量尺寸
    scheduleLayoutWw()
    setTimeout(scheduleLayoutWw, 80)
  }
}

// 复制文本到剪贴板：优先走主进程 clipboard（file:// 下 navigator.clipboard 不可靠）
function copyText(text, btn) {
  const done = () => {
    if (!btn) return
    const old = btn.dataset.label || btn.textContent
    btn.dataset.label = old
    btn.textContent = '已复制'
    setTimeout(() => (btn.textContent = old), 1200)
  }
  try {
    if (window.md && window.md.copyText) window.md.copyText(text).then(done).catch(() => {})
    else navigator.clipboard.writeText(text).then(done).catch(() => {})
  } catch (_) {
    try {
      navigator.clipboard.writeText(text).then(done)
    } catch (__) {}
  }
}

// 给预览模式的代码块加「复制」按钮
function addCopyButtons(container) {
  if (!container) return
  const pres = container.querySelectorAll('pre')
  pres.forEach((pre) => {
    if (pre.querySelector('.copy-btn')) return
    const btn = document.createElement('button')
    btn.className = 'copy-btn'
    btn.type = 'button'
    btn.textContent = '复制'
    btn.addEventListener('click', () => {
      const code = pre.querySelector('code')?.innerText || pre.innerText
      copyText(code, btn)
    })
    pre.style.position = 'relative'
    pre.appendChild(btn)
  })
}

// ---------- 所见即所得：代码块「复制」按钮定位 ----------
// 代码块右上角那个语言徽标（PHP ✎）是 .toastui-editor-ww-code-block-highlighting
// 的 ::after 伪元素，宽度随语言名长度变化（PHP 很窄、javascript 很宽），
// 所以不能用固定值给它让位 —— 这里按它真实的字体/内边距用 canvas 量出宽度，
// 再把「复制」按钮排到它左边同一行，形成 [复制] [语言] 一排。
const WW_BTN_W = 46
const WW_BTN_H = 22
const WW_BTN_GAP = 8
let langMeasureCtx = null

function badgeBox(host) {
  const fallback = { w: 96, h: 24, right: 10, top: 10 }
  if (!host) return fallback
  if (!langMeasureCtx) {
    try {
      langMeasureCtx = document.createElement('canvas').getContext('2d')
    } catch (_) {
      return fallback
    }
  }
  let cs = null
  try {
    cs = window.getComputedStyle(host, '::after')
  } catch (_) {}
  if (!cs || !langMeasureCtx) return fallback
  const text = host.getAttribute('data-language') || ''
  langMeasureCtx.font = `${cs.fontWeight || '700'} ${cs.fontSize || '13px'} ${cs.fontFamily || 'sans-serif'}`
  const tw = langMeasureCtx.measureText(text || 'text').width
  const pl = parseFloat(cs.paddingLeft) || 0
  const pr = parseFloat(cs.paddingRight) || 0
  return {
    w: Math.ceil(tw + pl + pr),
    h: parseFloat(cs.height) || 24,
    right: parseFloat(cs.right) || 10,
    top: parseFloat(cs.top) || 10
  }
}

// 光标停在代码块里时，Toast UI 还会额外浮出一个「可编辑语言名」的控件。
// 它出现的时机不确定，所以这里做一次防御性避让：真的撞上了再往左挪。
function avoidLangWidget(body, rr, top, left) {
  const lw = body.querySelector('.toastui-editor-code-block-language')
  if (!lw) return left
  const lr = lw.getBoundingClientRect()
  if (lr.width <= 0) return left
  const lwLeft = lr.left - rr.left
  const lwTop = lr.top - rr.top
  const lwBottom = lr.bottom - rr.top
  if (top < lwBottom && top + WW_BTN_H > lwTop && left + WW_BTN_W > lwLeft - 6) {
    return Math.max(8, Math.round(lwLeft - 6 - WW_BTN_W))
  }
  return left
}

function wwBlockList() {
  const body = bodyEl.value
  if (!body) return []
  return Array.from(body.querySelectorAll('.toastui-editor-ww-code-block-highlighting'))
}

function layoutWwButtons() {
  const body = bodyEl.value
  if (!body) return
  const blocks = wwBlockList()
  if (mode.value !== 'wysiwyg' || !blocks.length) {
    if (wwBtns.value.length) wwBtns.value = []
    return
  }
  const rr = body.getBoundingClientRect()
  const next = []
  blocks.forEach((host, idx) => {
    const br = host.getBoundingClientRect()
    // 只给可视区域附近的代码块生成按钮（按钮是绝对定位，全量生成会撑出滚动条）
    if (br.bottom < rr.top - 24 || br.top > rr.bottom + 24) return
    const badge = badgeBox(host)
    const top = Math.round(br.top - rr.top + badge.top + 1)
    let left = Math.round(br.right - rr.left - badge.right - badge.w - WW_BTN_GAP - WW_BTN_W)
    // 代码块太窄时不把按钮顶到块外面去
    const minLeft = Math.round(br.left - rr.left + 8)
    if (left < minLeft) left = minLeft
    left = avoidLangWidget(body, rr, top, left)
    next.push({ key: idx, top, left })
  })
  // 位置没变就不赋值，避免每次滚动都触发 Vue 重渲染
  const same =
    next.length === wwBtns.value.length &&
    next.every((b, k) => {
      const o = wwBtns.value[k]
      return o && o.key === b.key && o.top === b.top && o.left === b.left
    })
  if (!same) wwBtns.value = next
}

function scheduleLayoutWw() {
  if (wwRaf) return
  wwRaf = window.requestAnimationFrame(() => {
    wwRaf = 0
    layoutWwButtons()
  })
}

function copyWwCode(item) {
  const host = wwBlockList()[item && item.key]
  const pre = host ? host.querySelector('pre') : null
  if (!pre) return
  copyText(pre.innerText, null)
  copiedKey.value = item.key
  clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => (copiedKey.value = -1), 1200)
}

// TOC 跳转：index 用于预览/所见即所得定位第 N 个标题；line 用于代码模式定位行号
async function scrollToHeading({ index = 0, line = 0 } = {}) {
  if (!editor) return
  if (mode.value === 'code') {
    const ta = sourceEl.value
    if (ta) {
      const lines = sourceText.value.split('\n')
      let pos = 0
      for (let i = 0; i < line && i < lines.length; i++) pos += lines[i].length + 1
      ta.focus()
      try {
        ta.setSelectionRange(pos, pos)
      } catch (_) {}
      const lh = parseFloat(window.getComputedStyle(ta).lineHeight) || 20
      ta.scrollTop = Math.max(0, (line - 4) * lh)
      return
    }
  }
  await nextTick()
  const heads = getHeadings()
  // 容错：index 越界时取最后一个
  const target = heads[index] || heads[heads.length - 1]
  if (target) {
    try {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } catch (_) {}
  }
}

// 收集当前可视区域内的标题元素：
// - 预览模式：渲染在 previewEl 中
// - 所见即所得：Toast UI 把内容渲染在内嵌 iframe 里，需到 iframe 文档中查找
function getHeadings() {
  if (!editorEl.value) return []
  let heads = editorEl.value.querySelectorAll('h1,h2,h3,h4,h5,h6')
  if (heads.length) return heads
  const iframes = editorEl.value.querySelectorAll('iframe')
  for (const f of iframes) {
    try {
      const d = f.contentDocument || (f.contentWindow && f.contentWindow.document)
      if (d) {
        const h = d.querySelectorAll('h1,h2,h3,h4,h5,h6')
        if (h.length) return h
      }
    } catch (_) {
      /* 跨域 iframe 等异常忽略 */
    }
  }
  return heads
}

// ---------- 笔记内搜索（搜索按钮 / Ctrl+F） ----------
// 三种模式分别处理：
// - 所见即所得：Toast UI 用 ProseMirror 直接渲染在主文档里（不是 iframe），用 CSS Custom Highlight API 在 .ProseMirror 内画高亮（不改动 DOM、不抢焦点、可精确滚动）
// - 预览：内容渲染在主文档的 previewEl 里，自己遍历文本节点包 <mark>（只命中正文，不和工具栏/标题冲突）
// - 代码：textarea，自己算匹配位置并用 setSelectionRange 跳转（无内联高亮，但选中可见）
const searchOpen = ref(false)
const searchQuery = ref('')
const matchCase = ref(false)
const matchIdx = ref(0)
const matchTotal = ref(0)
const searchFailed = ref(false)
const searchInput = ref(null)

// 代码模式：预计算的所有匹配 [start, end]
let codeMatches = []
let codeIdx = -1
// 预览模式：所有高亮 <mark>
let previewMarks = []
let previewIdx = -1

// 返回所见即所得的内容根节点（真正的滚动/高亮作用对象）。
// 关键坑（已实测钉死）：Toast UI 在同一 DOM 里会同时渲染「markdown 模式」与「wysiwyg 模式」
// 两套容器，隐藏的那套（display:none）里也有一个 .ProseMirror，且因 DOM 顺序靠前、
// `querySelector('.ProseMirror')` 会先抓到**隐藏**的那个 → 高亮画上去用户看不见、滚动也是空滚。
// 所以这里必须从所有 .ProseMirror 里挑出**可见**的那个（即 ww-mode 里、getBoundingClientRect 非 0 的）。
// 另外：真正的滚动容器就是这个可见 .ProseMirror 本身（其 computed overflow 是 auto，
// scrollHeight 远超 clientHeight，Toast UI 把 .toastui-editor-contents 也挂在它上面）。
function wwRoot() {
  if (mode.value !== 'wysiwyg' || !editorEl.value) return null
  const all = editorEl.value.querySelectorAll('.ProseMirror')
  for (const pm of all) {
    const r = pm.getBoundingClientRect()
    // 选可见的那个：宽高都非 0 才说明正显示在视口里（隐藏容器宽高为 0）
    if (r.width > 0 && r.height > 0) return pm
  }
  return (
    all[0] ||
    editorEl.value.querySelector('.toastui-editor-ww-container') ||
    null
  )
}

// 所见即所得：用 CSS Custom Highlight API 在主文档里画高亮（不改动 DOM、不抢焦点、可精确滚动）。
let wwRanges = [] // [{ range, el }]，range/el 都属于主文档
let wwIdx = -1
let wwRehlTimer = null

function wwCanHighlight() {
  return !!(window.CSS && window.CSS.highlights && window.Highlight)
}

function clearWwHighlight() {
  if (wwCanHighlight()) {
    window.CSS.highlights.delete('ep-search')
    window.CSS.highlights.delete('ep-search-active')
  }
  wwRanges = []
  wwIdx = -1
}

function highlightWw(text) {
  clearWwHighlight()
  const root = wwRoot()
  if (!text || !root) return
  if (!wwCanHighlight()) return // 兜底走原生 find（见 runSearch/searchStep）
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT
      let p = node.parentNode
      while (p && p !== root) {
        const tag = p.tagName
        if (tag === 'SCRIPT' || tag === 'STYLE') return NodeFilter.FILTER_REJECT
        p = p.parentNode
      }
      return NodeFilter.FILTER_ACCEPT
    }
  })
  const q = matchCase.value ? text : text.toLowerCase()
  const targets = []
  let n
  while ((n = walker.nextNode())) targets.push(n)
  targets.forEach((node) => {
    const val = node.nodeValue
    const h = matchCase.value ? val : val.toLowerCase()
    let from = 0
    let idx
    while ((idx = h.indexOf(q, from)) !== -1) {
      const range = document.createRange()
      range.setStart(node, idx)
      range.setEnd(node, idx + text.length)
      wwRanges.push({ range, el: node.parentElement })
      from = idx + text.length
    }
  })
  // 按文档位置排序，保证上/下翻页顺序正确
  wwRanges.sort((a, b) => a.range.compareBoundaryPoints(Range.START_TO_START, b.range))
  applyWwHighlight()
}

function applyWwHighlight() {
  if (!wwCanHighlight()) return
  const all = new Highlight(...wwRanges.map((r) => r.range))
  window.CSS.highlights.set('ep-search', all)
  if (wwIdx >= 0 && wwRanges[wwIdx]) {
    window.CSS.highlights.set('ep-search-active', new Highlight(wwRanges[wwIdx].range))
  } else {
    window.CSS.highlights.delete('ep-search-active')
  }
}

// 沿 DOM 向上收集「所有可滚动祖先」，从里到外；外层是 Toast UI / app 的滚动容器。
// 关键点：Toast UI wysiwyg 的真实滚动容器并不唯一——外层 .toastui-editor-ww-container
// 是 overflow:hidden（不可滚动），但它的父级 .toastui-editor-main / .toastui-editor-defaultUI /
// .ep-editor / .ep-body 中「实际可滚动」的那一级可能因布局不同而变（height:100% 链裁剪后，
// 最外层可滚动节点才是真滚动者）。所以这里**不止找第一个**，而是把所有满足
// `overflow:(auto|scroll|overlay) 且内容溢出` 的祖先都收进来，逐个设 scrollTop，
// 无论哪一级在滚都能滚到命中项。
function getScrollAncestors(el) {
  const list = []
  let node = el.parentElement
  while (node && node !== document.body && node !== document.documentElement) {
    const cs = getComputedStyle(node)
    const scrollable =
      /^(auto|scroll|overlay)$/.test(cs.overflowY) ||
      /^(auto|scroll|overlay)$/.test(cs.overflowX)
    if (scrollable && (node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1)) {
      list.push(node)
    }
    node = node.parentElement
  }
  return list
}

// 把命中元素滚动到可视区中央。用 getBoundingClientRect 计算差值，然后**直接赋值 scrollTop**
// （不用 scrollTo({behavior:'smooth'})，避免个别元素/引擎对 smooth 不生效导致“点了没动”）。
// 关键：wysiwyg 的真实滚动容器就是可见的 .ProseMirror 自身（computed overflow:auto，且
// Toast UI 把 .toastui-editor-contents 也挂在它上面），所以**优先用 wwRoot() 当滚动容器**，
// 命中元素相对它居中。只有当可见 PM 不可滚时，才退回通用 getScrollAncestors 找它的真滚动祖先。
function scrollElCenter(el) {
  if (!el) return
  let container = null
  const root = wwRoot()
  if (root && root !== el && root.scrollHeight > root.clientHeight + 1) {
    const rcs = getComputedStyle(root)
    if (/^(auto|scroll|overlay)$/.test(rcs.overflowY)) container = root
  }
  if (!container) {
    const ancestors = getScrollAncestors(el)
    // getScrollAncestors 是从里到外 push 的，ancestors[0] 是离命中元素最近（最内层）的滚动容器；
    // 只滚它一个，避免多容器互相干扰
    container = ancestors[0] || null
  }
  if (!container) {
    // 实在找不到，退回原生 scrollIntoView（至少浏览器自己会滚）
    try {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    } catch (_) {
      el.scrollIntoView(true)
    }
    return
  }
  const er = el.getBoundingClientRect()
  const cr = container.getBoundingClientRect()
  const target = container.scrollTop + (er.top + er.height / 2) - (cr.top + cr.height / 2)
  container.scrollTop = Math.max(0, target)
}

function wwGoto(idx) {
  if (!wwRanges.length) return
  wwIdx = idx
  applyWwHighlight()
  const rec = wwRanges[idx]
  const el = rec && rec.el
  scrollElCenter(el)
}

// 返回要搜索的 window：所见即所得是 iframe，其它是主窗口（预览不走 window.find，自己包 mark）
function getSearchWindow() {
  if (mode.value === 'wysiwyg' && editorEl.value) {
    const iframes = editorEl.value.querySelectorAll('iframe')
    for (const f of iframes) {
      try {
        if (f.contentWindow) return f.contentWindow
      } catch (_) {
        /* 跨域等异常忽略 */
      }
    }
  }
  return window
}

function sameRange(a, b) {
  return (
    a &&
    b &&
    a.startContainer === b.startContainer &&
    a.startOffset === b.startOffset &&
    a.endOffset === b.endOffset
  )
}

// 用原生 find 统计一个 window 内的匹配总数（带 wrapAround 循环计数，回到起点就停）
function nativeCount(text, win) {
  try {
    win.getSelection().removeAllRanges()
  } catch (_) {}
  let total = 0
  let first = null
  let guard = 0
  while (guard++ < 100000) {
    const ok = win.find(text, matchCase.value, false, true)
    if (!ok) break
    const sel = win.getSelection()
    const r = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null
    if (total === 0) {
      first = r
      total = 1
      continue
    }
    if (r && sameRange(r, first)) break
    total++
  }
  return total
}

// 落回第一个匹配（高亮）
function nativeFirst(text, win) {
  try {
    win.getSelection().removeAllRanges()
  } catch (_) {}
  win.find(text, matchCase.value, false, true)
}

function nativeStep(text, win, backward) {
  return win.find(text, matchCase.value, backward, true)
}

// ---------- 代码模式：在 textarea 文本中找全部匹配 ----------
function codeSearchAll(text) {
  codeMatches = []
  if (!text) return
  const hay = sourceText.value
  const q = matchCase.value ? text : text.toLowerCase()
  const h = matchCase.value ? hay : hay.toLowerCase()
  let i = h.indexOf(q)
  while (i !== -1) {
    codeMatches.push([i, i + text.length])
    i = h.indexOf(q, i + text.length)
  }
}

function codeGoto(idx) {
  const pair = codeMatches[idx]
  if (!pair) return
  const [s, e] = pair
  const ta = sourceEl.value
  if (!ta) return
  ta.focus()
  try {
    ta.setSelectionRange(s, e)
  } catch (_) {}
  const line = sourceText.value.slice(0, s).split('\n').length
  const lh = parseFloat(window.getComputedStyle(ta).lineHeight) || 20
  ta.scrollTop = Math.max(0, (line - 4) * lh)
}

// ---------- 预览模式：遍历文本节点包 <mark> ----------
function clearPreviewMarks() {
  if (!previewEl.value) return
  previewEl.value.querySelectorAll('mark.ep-search-hit').forEach((m) => {
    const parent = m.parentNode
    if (!parent) return
    parent.replaceChild(document.createTextNode(m.textContent), m)
    parent.normalize()
  })
  previewMarks = []
  previewIdx = -1
}

function highlightPreview(text) {
  clearPreviewMarks()
  if (!text || !previewEl.value) return
  const root = previewEl.value
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT
      let p = node.parentNode
      while (p && p !== root) {
        const tag = p.tagName
        if (
          tag === 'SCRIPT' ||
          tag === 'STYLE' ||
          (tag === 'MARK' && p.classList.contains('ep-search-hit'))
        ) {
          return NodeFilter.FILTER_REJECT
        }
        p = p.parentNode
      }
      return NodeFilter.FILTER_ACCEPT
    }
  })
  const q = matchCase.value ? text : text.toLowerCase()
  const targets = []
  let n
  while ((n = walker.nextNode())) targets.push(n)
  targets.forEach((node) => {
    const val = node.nodeValue
    const h = matchCase.value ? val : val.toLowerCase()
    const ranges = []
    let from = 0
    let idx
    while ((idx = h.indexOf(q, from)) !== -1) {
      ranges.push([idx, idx + text.length])
      from = idx + text.length
    }
    if (!ranges.length) return
    const frag = document.createDocumentFragment()
    let last = 0
    ranges.forEach(([s, e]) => {
      if (s > last) frag.appendChild(document.createTextNode(val.slice(last, s)))
      const mark = document.createElement('mark')
      mark.className = 'ep-search-hit'
      mark.textContent = val.slice(s, e)
      frag.appendChild(mark)
      last = e
    })
    if (last < val.length) frag.appendChild(document.createTextNode(val.slice(last)))
    node.parentNode.replaceChild(frag, node)
  })
  previewMarks = Array.from(root.querySelectorAll('mark.ep-search-hit'))
}

function previewGoto(idx) {
  if (!previewMarks.length) return
  previewMarks.forEach((m, i) => m.classList.toggle('active', i === idx))
  const m = previewMarks[idx]
  if (m) m.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

// ---------- 统一入口 ----------
function runSearch() {
  const q = searchQuery.value
  if (!q) {
    clearSearch()
    return
  }
  if (mode.value === 'code') {
    codeSearchAll(q)
    matchTotal.value = codeMatches.length
    if (codeMatches.length) {
      codeIdx = 0
      codeGoto(0)
      matchIdx.value = 1
      searchFailed.value = false
    } else {
      codeIdx = -1
      matchIdx.value = 0
      searchFailed.value = true
    }
    return
  }
  if (mode.value === 'preview') {
    highlightPreview(q)
    matchTotal.value = previewMarks.length
    if (previewMarks.length) {
      previewIdx = 0
      previewGoto(0)
      matchIdx.value = 1
      searchFailed.value = false
    } else {
      previewIdx = -1
      matchIdx.value = 0
      searchFailed.value = true
    }
    return
  }
  // 所见即所得（ProseMirror 在主文档里）：CSS 高亮，不抢焦点、可精确滚动
  if (!wwRoot()) {
    matchTotal.value = 0
    matchIdx.value = 0
    searchFailed.value = true
    return
  }
  if (wwCanHighlight()) {
    highlightWw(q)
    matchTotal.value = wwRanges.length
    if (wwRanges.length) {
      wwGoto(0)
      matchIdx.value = 1
      searchFailed.value = false
    } else {
      wwIdx = -1
      matchIdx.value = 0
      searchFailed.value = true
    }
  } else {
    // 兜底：原生 find（极少数不支持 CSS 高亮的环境）
    const win = getSearchWindow()
    const total = nativeCount(q, win)
    matchTotal.value = total
    if (total > 0) {
      nativeFirst(q, win)
      matchIdx.value = 1
      searchFailed.value = false
    } else {
      matchIdx.value = 0
      searchFailed.value = true
      try {
        win.getSelection().removeAllRanges()
      } catch (_) {}
    }
  }
}

function searchStep(backward) {
  const q = searchQuery.value
  if (!q) return
  if (mode.value === 'code') {
    if (!codeMatches.length) return
    codeIdx = backward
      ? codeIdx - 1 < 0
        ? codeMatches.length - 1
        : codeIdx - 1
      : (codeIdx + 1) % codeMatches.length
    codeGoto(codeIdx)
    matchIdx.value = codeIdx + 1
    return
  }
  if (mode.value === 'preview') {
    if (!previewMarks.length) return
    previewIdx = backward
      ? previewIdx - 1 < 0
        ? previewMarks.length - 1
        : previewIdx - 1
      : (previewIdx + 1) % previewMarks.length
    previewGoto(previewIdx)
    matchIdx.value = previewIdx + 1
    return
  }
  if (!wwRoot()) return
  if (wwCanHighlight()) {
    if (!wwRanges.length) return
    wwIdx = backward
      ? wwIdx - 1 < 0
        ? wwRanges.length - 1
        : wwIdx - 1
      : (wwIdx + 1) % wwRanges.length
    wwGoto(wwIdx)
    matchIdx.value = wwIdx + 1
    return
  }
  // 兜底：原生 find
  const win = getSearchWindow()
  const ok = nativeStep(q, win, backward)
  if (!ok) return
  matchIdx.value = backward
    ? matchIdx.value - 1 <= 0
      ? matchTotal.value
      : matchIdx.value - 1
    : (matchIdx.value % matchTotal.value) + 1
}

function clearSearch() {
  matchIdx.value = 0
  matchTotal.value = 0
  searchFailed.value = false
  if (wwRehlTimer) {
    clearTimeout(wwRehlTimer)
    wwRehlTimer = null
  }
  clearPreviewMarks()
  clearWwHighlight()
}

function openSearch() {
  searchOpen.value = true
  nextTick(() => {
    const el = searchInput.value
    if (el) {
      el.focus()
      try {
        el.select()
      } catch (_) {}
    }
  })
  if (searchQuery.value) runSearch()
}

function closeSearch() {
  searchOpen.value = false
  clearSearch()
}

function onSearchInputKeydown(e) {
  if (e.key === 'Enter') {
    e.preventDefault()
    searchStep(e.shiftKey)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    closeSearch()
  }
}

// Ctrl+F：菜单 accelerator 会优先拦截并走 IPC；这里是兜底（也顺手处理 Esc 关闭搜索）
function onSearchKeydown(e) {
  if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
    e.preventDefault()
    e.stopPropagation()
    openSearch()
    return
  }
  if (e.key === 'Escape' && searchOpen.value) {
    e.preventDefault()
    e.stopPropagation()
    closeSearch()
  }
}

defineExpose({ scrollToHeading, setMode, openSearch })

onBeforeUnmount(() => {
  clearTimeout(copiedTimer)
  if (wwRehlTimer) clearTimeout(wwRehlTimer)
  if (wwRaf) window.cancelAnimationFrame(wwRaf)
  if (wwObserver) {
    wwObserver.disconnect()
    wwObserver = null
  }
  const body = bodyEl.value
  if (body) body.removeEventListener('scroll', scheduleLayoutWw, true)
  window.removeEventListener('resize', scheduleLayoutWw)
  window.removeEventListener('keydown', onSearchKeydown, true)
  if (editor) editor.destroy()
})
</script>

<template>
  <div class="editor-pane">
    <div class="ep-toolbar">
      <span class="ep-title">
        <span v-if="isDirty" class="ep-dot" title="有未保存的修改"></span>
        <span class="ep-file" :title="file">{{ file.split(/[\\/]/).pop() }}</span>
      </span>
      <span v-if="savedFlash" class="ep-saved">✓ 已保存</span>
      <div class="ep-actions">
        <button type="button" class="ep-find" @click="openSearch" title="在当前笔记中查找 (Ctrl+F)">查找</button>
        <button type="button" class="ep-save" @click="emit('save')" title="保存 (Ctrl+S)">保存</button>
        <div class="ep-modes">
          <button :class="{ active: mode === 'wysiwyg' }" @click="setMode('wysiwyg')">所见即所得</button>
          <button :class="{ active: mode === 'code' }" @click="setMode('code')">代码</button>
          <button :class="{ active: mode === 'preview' }" @click="setMode('preview')">预览</button>
        </div>
      </div>
    </div>
    <div class="ep-body" ref="bodyEl">
      <div ref="editorEl" class="ep-editor"></div>
      <textarea
        ref="sourceEl"
        class="ep-source"
        spellcheck="false"
        v-model="sourceText"
        @input="onSourceInput"
        style="display: none"
      ></textarea>
      <div ref="previewEl" class="ep-preview markdown-body" v-html="previewHtml" style="display: none"></div>
      <button
        v-for="b in wwBtns"
        :key="b.key"
        type="button"
        class="copy-btn ww-copy-float"
        :style="{ top: b.top + 'px', left: b.left + 'px' }"
        @mousedown.prevent
        @click="copyWwCode(b)"
      >{{ copiedKey === b.key ? '已复制' : '复制' }}</button>
      <div v-if="searchOpen" class="ep-search">
        <input
          ref="searchInput"
          class="ep-search-input"
          type="text"
          v-model="searchQuery"
          @input="runSearch"
          @keydown="onSearchInputKeydown"
          placeholder="在当前笔记中查找…"
        />
        <label class="ep-search-case">
          <input type="checkbox" v-model="matchCase" @change="runSearch" /> 区分大小写
        </label>
        <span class="ep-search-count" :class="{ none: searchFailed }">
          {{ matchTotal ? (matchIdx + ' / ' + matchTotal) : (searchQuery ? '无匹配' : '') }}
        </span>
        <button type="button" class="ep-search-btn" @click="searchStep(true)" title="上一个 (Shift+Enter)">↑</button>
        <button type="button" class="ep-search-btn" @click="searchStep(false)" title="下一个 (Enter)">↓</button>
        <button type="button" class="ep-search-close" @click="closeSearch" title="关闭 (Esc)">✕</button>
      </div>
    </div>
  </div>
</template>
