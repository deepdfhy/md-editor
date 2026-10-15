// 搜索滚动算法单测（对应 BUG4 真实根因，已用 Playwright 真机 DOM 钉死）：
//  1) Toast UI 会在同 DOM 里渲染「md 模式」与「ww 模式」两套容器，各有一个 .ProseMirror；
//     隐藏的那套装 display:none 但 DOM 靠前，querySelector('.ProseMirror') 会先抓到**隐藏**的
//     → 高亮/滚动作用在看不见的节点上（这就是“能搜到但不滚动”的真根因）。
//  2) 真实滚动容器 = 可见的 .ProseMirror 自身（computed overflow:auto，scrollHeight 远超 clientHeight）。
// 本测试验证「选可见 PM」的核心逻辑 + 滚动目标计算。纯 Node，不依赖真实 DOM。
//
// 跑法：node scripts/t-scroll.cjs
'use strict'

let pass = 0
let fail = 0
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg) }
  else { fail++; console.error('  ✗ ' + msg) }
}

function makeEl(className, opt = {}) {
  return {
    className: className || '', tagName: 'DIV', parentElement: null,
    _style: { overflowY: opt.overflowY || 'visible', overflowX: opt.overflowX || 'visible' },
    scrollHeight: opt.scrollHeight != null ? opt.scrollHeight : 100,
    clientHeight: opt.clientHeight != null ? opt.clientHeight : 100,
    scrollTop: opt.scrollTop != null ? opt.scrollTop : 0,
    _rect: opt.rect || null,
    getBoundingClientRect() { return this._rect || { top: 0, height: this.clientHeight, width: 100 } }
  }
}

// 造一个「可见 PM + 隐藏 PM」共存的场景
function buildCtx() {
  // 隐藏的 md 容器（display:none）：PM 高宽 0
  const mdHiddenPm = makeEl('ProseMirror', { overflowY: 'auto', scrollHeight: 0, clientHeight: 0, rect: { top: 0, height: 0, width: 0 } })
  // 可见的 ww 容器：PM 自身 overflow:auto，内容溢出 18817>712
  const visiblePm = makeEl('ProseMirror toastui-editor-contents ProseMirror', {
    overflowY: 'auto', scrollHeight: 18817, clientHeight: 712, scrollTop: 0, rect: { top: 0, height: 712, width: 642 }
  })
  const hit = makeEl('') // 命中元素（某个 <p>）
  hit.parentElement = visiblePm
  visiblePm.parentElement = makeEl('toastui-editor-ww-container', { overflowY: 'hidden', rect: { top: 0, height: 712 } })
  return { mdHiddenPm, visiblePm, hit }
}

// ---- 复刻 EditorPane.vue 的 wwRoot()：从所有 .ProseMirror 里选「可见」的那个 ----
function wwRootFrom(allPms, editorEl) {
  if (!editorEl) return null
  for (const pm of allPms) {
    const r = pm.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) return pm
  }
  return allPms[0] || null
}

// ---- 复刻 scrollElCenter 的核心：优先用可见 PM 作滚动容器，算中心 target ----
function computeScrollTarget(el, container) {
  const er = el.getBoundingClientRect()
  const cr = container.getBoundingClientRect()
  return container.scrollTop + (er.top + er.height / 2) - (cr.top + cr.height / 2)
}

console.log('## wwRoot：必须选中「可见」的 .ProseMirror（而非 DOM 里第一个）')
{
  const ctx = buildCtx()
  // 模拟 editorEl.querySelectorAll('.ProseMirror') — 隐藏的那套 DOM 靠前
  const all = [ctx.mdHiddenPm, ctx.visiblePm]
  // 旧逻辑：querySelector('.ProseMirror') === all[0]（隐藏的）→ 这就是“看不到/不滚动”的根因
  const oldPick = all[0]
  ok(oldPick === ctx.mdHiddenPm, '旧逻辑拿到的是隐藏 PM（width=0）→ 高亮画在看不见的地方')
  ok(ctx.mdHiddenPm.getBoundingClientRect().width === 0, '隐藏 PM 宽为 0，确认不可见')
  const picked = wwRootFrom(all, {})
  ok(picked === ctx.visiblePm, '新逻辑从两个 PM 里选中可见的那个')
  ok(picked.getBoundingClientRect().width > 0, '可见 PM 宽 642 > 0')
}
console.log('')

console.log('## 可见 PM 自身就是滚动容器（overflow:auto, sh18817>ch712）')
{
  const ctx = buildCtx()
  const pm = ctx.visiblePm
  const cs = pm._style
  const isScrollable = /^(auto|scroll|overlay)$/.test(cs.overflowY) && pm.scrollHeight > pm.clientHeight + 1
  ok(isScrollable, '可见 PM overflow:auto 且溢出 → 它自己就是滚动容器')
  // 命中元素在下方：top=18000（接近底部），height=40
  ctx.hit._rect = { top: 18000, height: 40 }
  const t = computeScrollTarget(ctx.hit, pm)
  // target = scrollTop(0) + (18000+20) - (0+356) = 17664
  ok(t === 17664, '向下滚 target=17664（命中项居中），实测 ' + t)
  ok(t <= pm.scrollHeight - pm.clientHeight + 0.5, 'target 未超过最大滚动范围(overflow 会截断)')
}
console.log('')

console.log('## 滚动目标计算：命中项已在可视区中央 → target 不变')
{
  const ctx = buildCtx()
  const pm = ctx.visiblePm
  ctx.hit._rect = { top: 336, height: 40 } // 中心 356 = 可视高 712 的中心
  const t = computeScrollTarget(ctx.hit, pm)
  ok(t === 0, '目标 0（无需滚动），实测 ' + t)
}
console.log('')

console.log('## 滚动目标计算：命中项在上方 → target 变小（向上滚）')
{
  const ctx = buildCtx()
  const pm = ctx.visiblePm
  pm.scrollTop = 15000
  ctx.hit._rect = { top: 200, height: 40 }
  const t = computeScrollTarget(ctx.hit, pm)
  // target = 15000 + (200+20) - 356 = 14864
  ok(t === 14864, '向上滚 target=14864（<15000），实测 ' + t)
}
console.log('')

console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败')
if (fail > 0) process.exit(1)
