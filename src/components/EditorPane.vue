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
})

watch(
  () => props.file,
  async () => {
    if (!editor || !props.file) return
    lastStorage = toStorageMarkdown(props.content || '', getSaveDir())
    editor.setMarkdown(toDisplayMarkdown(props.content || '', getSaveDir()), false)
    sourceText.value = lastStorage
    if (mode.value === 'preview') await renderPreviewHtml()
    await nextTick()
    scheduleLayoutWw()
    setTimeout(scheduleLayoutWw, 120)
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

defineExpose({ scrollToHeading, setMode })

onBeforeUnmount(() => {
  clearTimeout(copiedTimer)
  if (wwRaf) window.cancelAnimationFrame(wwRaf)
  if (wwObserver) {
    wwObserver.disconnect()
    wwObserver = null
  }
  const body = bodyEl.value
  if (body) body.removeEventListener('scroll', scheduleLayoutWw, true)
  window.removeEventListener('resize', scheduleLayoutWw)
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
    </div>
  </div>
</template>
