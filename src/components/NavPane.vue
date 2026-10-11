<script setup>
// 聚合页（.nav.md）：把「当前目录 + 各直接子目录」里的笔记自动汇总成卡片封面墙。
// 分类：未分类（本目录直属笔记）+ 每个子目录一个分类；顶部 Tab 可切换只看某一类。
// 交互：单击卡片 = 就地弹窗预览（弹窗里可「全屏」「在新标签页打开」）；中键 = 直接开标签。
import { ref, reactive, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useFs } from '../composables/useFs.js'
import { toFileUrl, renderPreview } from '../utils/markdown.js'
import { formatSize, formatRelative, placeholderColor } from '../utils/fileTypes.js'

const props = defineProps({
  file: { type: String, default: '' },
  name: { type: String, default: '' },
  dir: { type: String, default: '' },
  pinned: { type: Boolean, default: false },
  // App 在目录有外部变动时会自增这个值，用来触发卡片墙自动刷新
  refreshKey: { type: Number, default: 0 },
  // 卡片尺寸（px），由 App 持久化到 config.json
  cardSize: { type: Number, default: 180 }
})
const emit = defineEmits(['open-note', 'update:card-size'])

const fs = useFs()

// 卡片尺寸范围：拖到最小是「一屏能扫多一点」，最大是「封面看得清」。
// 下限故意放到 110：网格是 minmax(尺寸, 1fr)，若下限太接近默认值，
// 滑块左半段算出来的列数不变、拖了没反应，手感会像坏了。
const CARD_MIN = 110
const CARD_MAX = 340
const CARD_DEF = 180

const loading = ref(false)
const err = ref('')
// 标签页：'__all__' | '__uncat__' | 子目录路径
const tab = ref('__all__')
const data = ref({ dir: '', uncategorized: [], categories: [] })
// 封面加载失败的笔记：退回渐变占位块（图片被删/路径失效时不显示破图）
// ⚠️ 必须在 load() 之前声明：load 里会重置它，而 load() 在 setup 末尾就会立刻执行
const coverFail = reactive({})

const total = computed(
  () => data.value.uncategorized.length + data.value.categories.reduce((s, c) => s + c.notes.length, 0)
)

const tabs = computed(() => {
  const out = [{ key: '__all__', label: '全部', count: total.value }]
  out.push({ key: '__uncat__', label: '未分类', count: data.value.uncategorized.length })
  for (const c of data.value.categories) {
    out.push({ key: c.path, label: c.name, count: c.notes.length })
  }
  return out
})

// 当前 Tab 下要渲染的分组：[{ key, title, path, notes }]
const groups = computed(() => {
  const d = data.value
  if (tab.value === '__all__') {
    const out = []
    if (d.uncategorized.length) out.push({ key: '__uncat__', title: '未分类', path: d.dir, notes: d.uncategorized })
    for (const c of d.categories) {
      if (c.notes.length) out.push({ key: c.path, title: c.name, path: c.path, notes: c.notes })
    }
    return out
  }
  if (tab.value === '__uncat__') {
    return d.uncategorized.length ? [{ key: '__uncat__', title: '未分类', path: d.dir, notes: d.uncategorized }] : []
  }
  const c = d.categories.find((x) => x.path === tab.value)
  return c && c.notes.length ? [{ key: c.path, title: c.name, path: c.path, notes: c.notes }] : []
})

async function load() {
  if (!props.dir) return
  loading.value = true
  err.value = ''
  for (const k of Object.keys(coverFail)) delete coverFail[k]
  try {
    const r = await fs.scanNotes(props.dir, props.file)
    data.value = r || { dir: props.dir, uncategorized: [], categories: [] }
    // 当前 Tab 指向的分类可能已被删掉，回落到「全部」
    if (tab.value !== '__all__' && tab.value !== '__uncat__') {
      if (!data.value.categories.some((c) => c.path === tab.value)) tab.value = '__all__'
    }
  } catch (e) {
    err.value = '扫描失败：' + ((e && e.message) || e)
  }
  loading.value = false
  await nextTick()
  syncTabScroll()
}

watch(() => [props.file, props.dir], load)
watch(() => props.refreshKey, load)
load()

// ---------- 分类 Tab 条：桌面软件观感 ----------
// 不用浏览器默认横向滚动条（又宽又丑、带箭头、悬停才出现），改成：
// 隐藏滚动条 + 滚轮横向滚动 + 两端渐隐遮罩（本身就是左右箭头，可点）。
const tabsEl = ref(null)
const tabOverflow = ref(false)
const tabCanLeft = ref(false)
const tabCanRight = ref(false)

function syncTabScroll() {
  const el = tabsEl.value
  if (!el) return
  const max = el.scrollWidth - el.clientWidth
  tabOverflow.value = max > 1
  tabCanLeft.value = el.scrollLeft > 1
  tabCanRight.value = el.scrollLeft < max - 1
}

// 滚轮：纵向滚轮转成横向滚动。到头了就放行（让外层容器继续滚）
function onTabsWheel(e) {
  const el = tabsEl.value
  if (!el) return
  const max = el.scrollWidth - el.clientWidth
  if (max <= 1) return
  const d = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX
  if (!d) return
  const next = el.scrollLeft + d
  if ((d < 0 && el.scrollLeft <= 0) || (d > 0 && el.scrollLeft >= max)) return
  e.preventDefault()
  el.scrollLeft = Math.max(0, Math.min(max, next))
}

function scrollTabs(dir) {
  const el = tabsEl.value
  if (!el) return
  el.scrollBy({ left: dir * Math.max(140, Math.round(el.clientWidth * 0.6)), behavior: 'smooth' })
}

// 切 Tab 后把它带进可视区（居中对齐，不触发整页滚动）
function revealActiveTab() {
  const el = tabsEl.value
  if (!el) return
  const btn = el.querySelector('.np-tab.active')
  if (!btn) return
  const target = btn.offsetLeft - (el.clientWidth - btn.offsetWidth) / 2
  el.scrollTo({ left: Math.max(0, target), behavior: 'smooth' })
}

let tabRO = null
onMounted(() => {
  syncTabScroll()
  // 容器宽度变化（拖列宽/改窗口）时重算箭头可用状态
  if (typeof ResizeObserver !== 'undefined' && tabsEl.value) {
    tabRO = new ResizeObserver(syncTabScroll)
    tabRO.observe(tabsEl.value)
  }
  window.addEventListener('resize', syncTabScroll)
})
onBeforeUnmount(() => {
  if (tabRO) tabRO.disconnect()
  window.removeEventListener('resize', syncTabScroll)
  window.removeEventListener('keydown', onPreviewKey)
})

watch(tab, () => nextTick(revealActiveTab))
// Tab 数量/文案变化后重新量一次（新分类出现时箭头要跟着出来）
watch(
  () => tabs.value.map((t) => t.key + ':' + t.count).join('|'),
  () => nextTick(() => {
    syncTabScroll()
    setTimeout(syncTabScroll, 260) // 等平滑滚动/字体回流结束后再校正一次
  })
)

// ---------- 卡片尺寸 ----------
const cardPx = computed(() => {
  const v = Number(props.cardSize)
  if (!isFinite(v) || v <= 0) return CARD_DEF
  return Math.min(CARD_MAX, Math.max(CARD_MIN, Math.round(v)))
})
// 卡片大小：只控制网格的列宽下限（封面高度由 CSS 的 aspect-ratio 跟着宽度走）
const gridStyle = computed(() => ({ '--np-card': cardPx.value + 'px' }))
function onSizeInput(e) {
  emit('update:card-size', Number(e.target.value) || CARD_DEF)
}

// ---------- 封面 ----------
function coverSrc(n) {
  if (n.coverAbs) return toFileUrl(n.coverAbs)
  if (n.cover && /^(https?:|data:|blob:)/i.test(n.cover)) return n.cover
  return ''
}
function placeholderStyle(n) {
  const [a, b] = placeholderColor(n.title || n.name)
  return { background: `linear-gradient(135deg, ${a}, ${b})` }
}
function initial(n) {
  const t = (n.title || n.name || '?').trim()
  return t.slice(0, 1).toUpperCase()
}

// ---------- 单击弹窗预览 / 中键（或按钮）开标签 ----------
const pv = reactive({
  open: false,
  full: false,
  loading: false,
  err: '',
  title: '',
  path: '',
  meta: '',
  html: ''
})

function dirOf(p) {
  const i = Math.max(String(p).lastIndexOf('/'), String(p).lastIndexOf('\\'))
  return i >= 0 ? String(p).slice(0, i) : ''
}

async function openPreview(n) {
  pv.open = true
  pv.full = false
  pv.loading = true
  pv.err = ''
  pv.html = ''
  pv.title = n.title || n.name
  pv.path = n.path
  pv.meta = formatRelative(n.mtime) + ' · ' + formatSize(n.size)
  window.addEventListener('keydown', onPreviewKey)
  try {
    const raw = await fs.readFile(n.path)
    // 弹窗里是只读预览：跟「预览」模式同一套渲染（本地图片转 data URL，能正常显示）
    pv.html = await renderPreview(raw, dirOf(n.path))
  } catch (e) {
    pv.err = '打开失败：' + ((e && e.message) || e)
  }
  pv.loading = false
}

function closePreview() {
  pv.open = false
  pv.full = false
  pv.html = ''
  window.removeEventListener('keydown', onPreviewKey)
}

function toggleFull() {
  pv.full = !pv.full
}

// 弹窗里「在新标签页打开」：交给 App 建一个固定标签，并关掉弹窗
function openInTab() {
  const p = pv.path
  closePreview()
  if (p) emit('open-note', p)
}

// 中键 = 直接在新标签页打开（桌面软件习惯）。
// 注意：Chromium 里中键不触发 click（只触发 auxclick），所以不能用 @click.middle。
function onCardAux(n, e) {
  if (e.button !== 1) return
  e.preventDefault()
  emit('open-note', n.path)
}
// 中键按下时阻止默认行为，否则会弹出「自动滚动」的十字光标
function onCardMouseDown(e) {
  if (e.button === 1) e.preventDefault()
}

// Esc：全屏时先退出全屏（符合桌面软件习惯），再按一次才关弹窗
function onPreviewKey(e) {
  if (e.key !== 'Escape' || !pv.open) return
  e.stopPropagation()
  if (pv.full) pv.full = false
  else closePreview()
}
</script>

<template>
  <div class="navpage">
    <div class="np-head">
      <span class="np-icon" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="14" height="14">
          <rect x="1.5" y="2.5" width="5" height="5" rx="1" fill="currentColor" />
          <rect x="9.5" y="2.5" width="5" height="5" rx="1" fill="currentColor" />
          <rect x="1.5" y="9.5" width="5" height="4" rx="1" fill="currentColor" />
          <rect x="9.5" y="9.5" width="5" height="4" rx="1" fill="currentColor" />
        </svg>
      </span>
      <span class="np-title">{{ name.replace(/\.nav\.md$/i, '') }}</span>
      <span v-if="pinned" class="np-pin">已置顶</span>
      <span class="np-meta">共 {{ total }} 篇</span>
      <span class="np-spacer"></span>

      <!-- 卡片大小：滑动调节，记进配置 -->
      <div class="np-size" title="拖动调节卡片大小（双击恢复默认）">
        <span class="np-size-ico" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="13" height="13">
            <rect x="1" y="1" width="4" height="4" rx="0.8" fill="currentColor" />
            <rect x="6" y="1" width="4" height="4" rx="0.8" fill="currentColor" />
            <rect x="11" y="1" width="4" height="4" rx="0.8" fill="currentColor" />
            <rect x="1" y="6" width="4" height="4" rx="0.8" fill="currentColor" />
            <rect x="6" y="6" width="4" height="4" rx="0.8" fill="currentColor" />
            <rect x="11" y="6" width="4" height="4" rx="0.8" fill="currentColor" />
            <rect x="1" y="11" width="4" height="4" rx="0.8" fill="currentColor" />
            <rect x="6" y="11" width="4" height="4" rx="0.8" fill="currentColor" />
            <rect x="11" y="11" width="4" height="4" rx="0.8" fill="currentColor" />
          </svg>
        </span>
        <input
          class="np-range"
          type="range"
          :min="CARD_MIN"
          :max="CARD_MAX"
          step="10"
          :value="cardPx"
          aria-label="卡片大小"
          @input="onSizeInput"
          @dblclick="emit('update:card-size', CARD_DEF)"
        />
        <span class="np-size-ico" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="13" height="13">
            <rect x="1" y="1" width="6.4" height="6.4" rx="1" fill="currentColor" />
            <rect x="8.6" y="1" width="6.4" height="6.4" rx="1" fill="currentColor" />
            <rect x="1" y="8.6" width="6.4" height="6.4" rx="1" fill="currentColor" />
            <rect x="8.6" y="8.6" width="6.4" height="6.4" rx="1" fill="currentColor" />
          </svg>
        </span>
        <span class="np-size-val">{{ cardPx }}</span>
      </div>

      <button class="np-btn" type="button" @click="load">刷新</button>
    </div>

    <div class="np-tabs-wrap">
      <button
        v-if="tabOverflow"
        class="np-tabs-arrow l"
        type="button"
        title="向左滚动"
        :disabled="!tabCanLeft"
        @click="scrollTabs(-1)"
      >‹</button>
      <div ref="tabsEl" class="np-tabs" @scroll="syncTabScroll" @wheel="onTabsWheel">
        <button
          v-for="t in tabs"
          :key="t.key"
          class="np-tab"
          :class="{ active: t.key === tab }"
          type="button"
          :title="t.label"
          @click="tab = t.key"
        >
          <span class="np-tab-label">{{ t.label }}</span>
          <span class="np-tab-n">{{ t.count }}</span>
        </button>
      </div>
      <button
        v-if="tabOverflow"
        class="np-tabs-arrow r"
        type="button"
        title="向右滚动"
        :disabled="!tabCanRight"
        @click="scrollTabs(1)"
      >›</button>
    </div>

    <div class="np-body" :style="gridStyle">
      <div v-if="loading" class="np-tip">扫描中…</div>
      <div v-else-if="err" class="np-tip err">{{ err }}</div>
      <div v-else-if="!groups.length" class="np-tip">
        这个目录下还没有笔记。在左侧目录里新建文档，或切换到其他分类看看。
      </div>

      <section v-for="g in groups" :key="g.key" class="np-group">
        <div class="np-group-head">
          <span class="np-group-title">{{ g.title }}</span>
          <span class="np-group-n">{{ g.notes.length }} 篇</span>
        </div>
        <div class="np-grid">
          <article
            v-for="n in g.notes"
            :key="n.path"
            class="np-card"
            :title="n.path + '\n单击：弹窗预览 · 中键：在新标签页打开'"
            @click="openPreview(n)"
            @auxclick="onCardAux(n, $event)"
            @mousedown="onCardMouseDown"
          >
            <div class="np-cover">
              <img
                v-if="coverSrc(n) && !coverFail[n.path]"
                :src="coverSrc(n)"
                :alt="n.title"
                loading="lazy"
                @error="coverFail[n.path] = true"
              />
              <div v-else class="np-cover-ph" :style="placeholderStyle(n)">{{ initial(n) }}</div>
            </div>
            <div class="np-card-body">
              <div class="np-card-title">{{ n.title }}</div>
              <div class="np-card-meta">
                <span>{{ formatRelative(n.mtime) }}</span>
                <span class="np-dot">·</span>
                <span>{{ formatSize(n.size) }}</span>
              </div>
            </div>
          </article>
        </div>
      </section>
    </div>

    <!-- 笔记预览弹窗：单击卡片打开；可全屏 / 在新标签页打开 -->
    <Teleport to="body">
      <div
        v-if="pv.open"
        class="npv-mask"
        :class="{ full: pv.full }"
        @click.self="closePreview"
      >
        <div class="npv" :class="{ full: pv.full }">
          <div class="npv-head">
            <span class="npv-ic" aria-hidden="true">
              <svg viewBox="0 0 16 16" width="13" height="13">
                <path d="M3 1.5h6.5L13 5v9.5H3z" fill="none" stroke="currentColor" stroke-width="1.2" />
                <path d="M9.3 1.6V5H12.9" fill="none" stroke="currentColor" stroke-width="1.2" />
              </svg>
            </span>
            <span class="npv-title" :title="pv.path">{{ pv.title }}</span>
            <span class="npv-meta">{{ pv.meta }}</span>
            <span class="npv-spacer"></span>
            <span class="npv-path" :title="pv.path">{{ pv.path }}</span>
            <button class="npv-btn" type="button" title="在新标签页打开（可继续编辑）" @click="openInTab">
              <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                <path d="M9 2h5v5" fill="none" stroke="currentColor" stroke-width="1.3" />
                <path d="M14 2 7.5 8.5" fill="none" stroke="currentColor" stroke-width="1.3" />
                <path d="M12 9.6V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3.4" fill="none" stroke="currentColor" stroke-width="1.3" />
              </svg>
              新窗打开
            </button>
            <button
              class="npv-btn"
              type="button"
              :title="pv.full ? '退出全屏（Esc）' : '全屏查看（Esc 退出）'"
              @click="toggleFull"
            >
              <svg v-if="!pv.full" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                <path d="M6 2H2v4M10 2h4v4M10 14h4v-4M6 14H2v-4" fill="none" stroke="currentColor" stroke-width="1.3" />
              </svg>
              <svg v-else viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                <path d="M2 6h4V2M14 6h-4V2M14 10h-4v4M2 10h4v4" fill="none" stroke="currentColor" stroke-width="1.3" />
              </svg>
              {{ pv.full ? '退出全屏' : '全屏' }}
            </button>
            <button class="npv-btn icon" type="button" title="关闭（Esc）" @click="closePreview">✕</button>
          </div>
          <div class="npv-body">
            <div v-if="pv.loading" class="npv-tip">加载中…</div>
            <div v-else-if="pv.err" class="npv-tip err">{{ pv.err }}</div>
            <div v-else class="npv-doc markdown-body" v-html="pv.html"></div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
