<script setup>
import { reactive, computed, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps({
  items: { type: Array, default: () => [] },
  query: { type: String, default: '' },
  activeFile: { type: String, default: '' },
  isDirty: { type: Boolean, default: false },
  openPaths: { type: Array, default: () => [] },
  pins: { type: Array, default: () => [] }
})
const emit = defineEmits([
  'update:query',
  'open',
  'open-pinned',
  'archive',
  'remove',
  'open-recycle',
  'copy-path',
  'copy-dir',
  'export-pdf',
  'toggle-pin'
])

const menu = reactive({ show: false, x: 0, y: 0, item: null })

// 右键菜单项按类型显示：只有笔记能导出 PDF，只有聚合页能置顶
const isNote = computed(() => menu.item && menu.item.kind === 'note')
const isNav = computed(() => !!(menu.item && menu.item.isNav))

function onContext(e, f) {
  e.preventDefault()
  menu.show = true
  menu.x = e.clientX
  menu.y = e.clientY
  menu.item = f
}
function closeMenu() {
  menu.show = false
}
function doArchive() {
  if (menu.item) emit('archive', menu.item)
  closeMenu()
}
function doRemove() {
  if (menu.item) emit('remove', menu.item)
  closeMenu()
}
function doCopyPath() {
  if (menu.item) emit('copy-path', menu.item)
  closeMenu()
}
function doCopyDir() {
  if (menu.item) emit('copy-dir', menu.item)
  closeMenu()
}
function doExportPdf() {
  if (menu.item) emit('export-pdf', menu.item)
  closeMenu()
}
function doTogglePin() {
  if (menu.item) emit('toggle-pin', menu.item)
  closeMenu()
}
// 双击 = 正式打开（固定标签，不会被临时标签替换）
function onDblClick(f) {
  emit('open-pinned', f)
}
function onWinClick(e) {
  if (!menu.show) return
  const t = e.target
  if (!t.closest || !t.closest('.fl-ctx')) closeMenu()
}
function isPinned(f) {
  return props.pins.includes(f.path)
}

onMounted(() => window.addEventListener('click', onWinClick))
onBeforeUnmount(() => window.removeEventListener('click', onWinClick))
</script>

<template>
  <div class="filelist">
    <div class="fl-search">
      <svg class="fl-ic" viewBox="0 0 16 16" width="14" height="14">
        <circle cx="7" cy="7" r="5" fill="none" stroke="#888" stroke-width="1.5" />
        <line x1="10.5" y1="10.5" x2="14" y2="14" stroke="#888" stroke-width="1.5" />
      </svg>
      <input
        :value="query"
        @input="emit('update:query', $event.target.value)"
        placeholder="搜索当前目录 标题/全文"
        spellcheck="false"
      />
      <button class="fl-bin" type="button" title="回收站" @click="emit('open-recycle')">
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
          <path
            d="M6 2h4v1h4v1.5H2V3h4V2zM3.2 6h9.6l-.8 7.2a1 1 0 0 1-1 .8H5a1 1 0 0 1-1-.8L3.2 6z"
            fill="currentColor"
          />
        </svg>
      </button>
    </div>
    <div class="fl-list">
      <div
        v-for="f in items"
        :key="f.path"
        class="fl-item"
        :class="{ active: f.path === activeFile, open: openPaths.includes(f.path) }"
        :title="f.path"
        @click="emit('open', f)"
        @dblclick="onDblClick(f)"
        @contextmenu="onContext($event, f)"
      >
        <span class="fl-dot" :class="{ dirty: isDirty && f.path === activeFile }"></span>

        <!-- 聚合页：独立图标（九宫格），一眼区别于普通笔记 -->
        <svg v-if="f.isNav" class="fl-ic fl-ic-nav" viewBox="0 0 16 16" width="13" height="13">
          <rect x="1.5" y="2.5" width="5" height="5" rx="1" fill="currentColor" />
          <rect x="9.5" y="2.5" width="5" height="5" rx="1" fill="currentColor" />
          <rect x="1.5" y="9.5" width="5" height="4" rx="1" fill="currentColor" />
          <rect x="9.5" y="9.5" width="5" height="4" rx="1" fill="currentColor" />
        </svg>
        <!-- 笔记 -->
        <svg v-else-if="f.kind === 'note'" class="fl-ic fl-ic-note" viewBox="0 0 16 16" width="13" height="13">
          <path d="M3.5 1.5h6l3 3v10h-9z" fill="none" stroke="currentColor" stroke-width="1.3" />
          <path d="M9.5 1.5v3h3" fill="none" stroke="currentColor" stroke-width="1.3" />
        </svg>
        <!-- 图片 -->
        <svg v-else-if="f.kind === 'image'" class="fl-ic fl-ic-image" viewBox="0 0 16 16" width="13" height="13">
          <rect x="1.5" y="3" width="13" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3" />
          <circle cx="5.5" cy="6.5" r="1.2" fill="currentColor" />
          <path d="M2.5 11.5l3-3 2.5 2.5 2-2 3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.3" />
        </svg>
        <!-- 代码 -->
        <svg v-else-if="f.kind === 'code'" class="fl-ic fl-ic-code" viewBox="0 0 16 16" width="13" height="13">
          <path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.4" />
        </svg>
        <!-- 其它文本 -->
        <svg v-else class="fl-ic fl-ic-text" viewBox="0 0 16 16" width="13" height="13">
          <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3" />
          <path d="M5 6h6M5 8.5h6M5 11h3.5" stroke="currentColor" stroke-width="1.2" />
        </svg>

        <span class="fl-name">{{ f.name }}</span>
        <span v-if="isPinned(f)" class="fl-pin" title="已置顶">▲</span>
      </div>
      <div v-if="!items.length" class="fl-empty">当前目录没有可显示的文件</div>
    </div>

    <!-- 右键菜单 -->
    <div
      v-if="menu.show"
      class="ctx-menu fl-ctx"
      :style="{ left: menu.x + 'px', top: menu.y + 'px' }"
    >
      <template v-if="isNav">
        <div class="ctx-item" @click.stop="doTogglePin">
          {{ menu.item && pins.includes(menu.item.path) ? '取消置顶' : '置顶显示' }}
        </div>
        <div class="ctx-sep"></div>
      </template>
      <template v-if="isNote">
        <div class="ctx-item" @click.stop="doArchive">归档笔记</div>
        <div class="ctx-item" @click.stop="doRemove">删除笔记</div>
        <div class="ctx-sep"></div>
      </template>
      <template v-else>
        <div class="ctx-item" @click.stop="doRemove">删除文件</div>
        <div class="ctx-sep"></div>
      </template>
      <div class="ctx-item" @click.stop="doCopyPath">复制文件路径</div>
      <div class="ctx-item" @click.stop="doCopyDir">复制所在目录路径</div>
      <template v-if="isNote">
        <div class="ctx-sep"></div>
        <div class="ctx-item" @click.stop="doExportPdf">导出 PDF</div>
      </template>
    </div>
  </div>
</template>
