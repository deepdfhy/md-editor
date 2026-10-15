// 搜索滚动算法单测：抽出 EditorPane.vue 里 `getScrollParent` / `scrollElCenter` 的**纯逻辑**
//（不依赖真实 DOM，用桩对象模拟 Toast UI 的 DOM 层级），验证 BUG4 修复的核心：
// 在 overflow:hidden 的外壳（.ww-container）下，能否正确定位内部 overflow:auto 的
// 真实滚动容器（.toastui-editor-contents），且居滚动目标计算在「命中项在上/下方」都正确。
//
// 跑法：node scripts/t-scroll.cjs
'use strict'

let pass = 0
let fail = 0
function ok(cond, msg) {
  if (cond) {
    pass++
    console.log('  ✓ ' + msg)
  } else {
    fail++
    console.error('  ✗ ' + msg)
  }
}

// ---- 造一个轻量桩 DOM：带 parentElement / getComputedStyle 所需字段 / 滚动属性 ----
// 层级（对齐 Toast UI wysiwyg 真实结构）：
//   body
//    └ .ep-editor
//       └ .toastui-editor-ww-container   (overflow: hidden —— 不可滚动的外壳)
//          └ .toastui-editor-contents    (overflow: auto  —— 真正滚动的容器)
//             └ .ProseMirror
//                └ p                      ← 命中元素 el 的父
//                   └ [text] hit
function makeEl(className, opt = {}) {
  return {
    className: className || '',
    tagName: 'DIV',
    parentElement: null,
    _style: { overflowY: opt.overflowY || 'visible', overflowX: opt.overflowX || 'visible' },
    scrollHeight: opt.scrollHeight != null ? opt.scrollHeight : 100,
    clientHeight: opt.clientHeight != null ? opt.clientHeight : 100,
    scrollWidth: opt.scrollWidth != null ? opt.scrollWidth : 100,
    clientWidth: opt.clientWidth != null ? opt.clientWidth : 100,
    scrollTop: opt.scrollTop != null ? opt.scrollTop : 0,
    _rect: opt.rect || null,
    // 模拟 getBoundingClientRect
    getBoundingClientRect() {
      return this._rect || { top: 0, left: 0, height: clientHeightHACK(this), width: this.clientWidth }
    }
  }
}
function clientHeightHACK(el) {
  return el.clientHeight
}

// 组装层级
const contents = makeEl('toastui-editor-contents', {
  overflowY: 'auto',
  scrollHeight: 3000,
  clientHeight: 600, // 可视高 600
  scrollTop: 0,
  rect: { top: 0, height: 600 }
})
const wwContainer = makeEl('toastui-editor-ww-container', { overflowY: 'hidden', rect: { top: 0, height: 600 } })
const editorBox = makeEl('ep-editor', { rect: { top: 0, height: 600 } })
const body = makeEl('BODY', { rect: { top: 0, height: 900 } })

const pm = makeEl('ProseMirror')
const p = makeEl('')
const hit = makeEl('', { rect: null }) // 命中元素（文本节点的父，即 <p>）

pm.parentElement = contents
contents.parentElement = wwContainer
wwContainer.parentElement = editorBox
editorBox.parentElement = body
p.parentElement = pm
hit.parentElement = p
// body 的上层设为 null（模拟到顶）
body.parentElement = null

// ---- 复刻 EditorPane.vue 里的 getScrollParent（纯逻辑） ----
function getScrollParent(el) {
  let node = el.parentElement
  while (node && node.tagName !== 'BODY') {
    const cs = node._style
    const scrollable =
      /^(auto|scroll|overlay)$/.test(cs.overflowY) ||
      /^(auto|scroll|overlay)$/.test(cs.overflowX)
    if (scrollable && (node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth)) {
      return node
    }
    node = node.parentElement
  }
  return null
}

// ---- 复刻 scrollElCenter 的目标计算（纯逻辑，去掉真实 scrollTo）----
function computeScrollTarget(el) {
  const container = getScrollParent(el)
  if (!container) return null // 走兜底 scrollIntoView
  const er = el.getBoundingClientRect()
  const cr = container.getBoundingClientRect()
  return container.scrollTop + (er.top + er.height / 2) - (cr.top + cr.height / 2)
}

console.log('## getScrollParent：overflow:hidden 外壳下能否定位到内部滚动容器')
{
  const sp = getScrollParent(hit)
  ok(sp === contents, '应返回 .toastui-editor-contents（overflow:auto），而非 overflow:hidden 的 .ww-container')
  ok(sp && sp.className === 'toastui-editor-contents', '返回值确实是内容滚动容器')
  ok(getScrollParent(contents) === null, '.contents 自身无上层的可滚动祖先 → null（不再向上爬到 .ww-container）')
}
console.log('')

// 命中项居中计算：命中项中心在可视区下方 → target 应为正（向下滚）
console.log('## computeScrollTarget：命中项在可视区下方 → target > 0（向下滚）')
{
  // hit 元素在可视区（相对视口）位于内容下方：top=1800, height=40（scrollTop=0）
  hit._rect = { top: 1800, height: 40 }
  const t = computeScrollTarget(hit)
  // target = scrollTop(0) + (1800 + 20) - (0 + 300) = 1520
  ok(t === 1520, 'target 应为 1520，实测 ' + t + ' → 向下滚动让命中项居中')
}
console.log('')

// 命中项在可视区上方（已滚到很下面）→ target < 当前 scrollTop（向上滚）
console.log('## computeScrollTarget：命中项在可视区上方 → target 变小（向上滚）')
{
  // 现在 contents 已经滚到 scrollTop=2000，命中项 <p> 位于文档前部：p.top = 2100（相对视口），
  // 因为已滚动 2000，p 在文档坐标 2100+... 但这里是相对视口坐标：p.top=2100-? 直接给相对视口
  // 假设 hit 在视口上方：er.top = -1500, height=40
  hit._rect = { top: -1500, height: 40 }
  contents._rect = { top: 0, height: 600 }
  contents.scrollTop = 1200
  const t = computeScrollTarget(hit)
  // target = 1200 + (-1500 + 20) - (0 + 300) = -580
  ok(t === -580, 'target 应为 -580（向上滚），实测 ' + t)
}
console.log('')

// 命中项就在视口中央附近 → target 基本等于当前 scrollTop（几乎不动）
console.log('## computeScrollTarget：命中项已在可视区中央 → target ≈ scrollTop')
{
  contents.scrollTop = 500
  hit._rect = { top: 280, height: 40 } // 中心 300 = 容器中心
  const t = computeScrollTarget(hit)
  ok(t === 500, 'target 应为 500（不滚动），实测 ' + t)
}
console.log('')

console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败')
if (fail > 0) process.exit(1)
