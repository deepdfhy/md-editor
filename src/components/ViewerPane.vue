<script setup>
// 只读查看器：图片 / 代码 / 文本
// 程序员的笔记目录里常常直接放着 css/js/图片等附件，这类文件不需要编辑，
// 只需要能「点开就看」——图片直接渲染，代码按 Prism 上色并带行号，纯文本按等宽展示。
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { highlightCode, escapeHtml } from '../utils/prism.js'
import { langForFile, formatSize, formatTime, KIND_LABEL } from '../utils/fileTypes.js'
import { toFileUrl } from '../utils/markdown.js'
import { useFs } from '../composables/useFs.js'

const props = defineProps({
  file: { type: String, default: '' },
  name: { type: String, default: '' },
  ext: { type: String, default: '' },
  kind: { type: String, default: 'text' },
  content: { type: String, default: '' },
  size: { type: Number, default: 0 },
  mtime: { type: Number, default: 0 }
})
const emit = defineEmits(['copy'])

const fs = useFs()

// 超过这个体积就不做语法高亮（Prism 在大文件上会明显卡住）
const MAX_HIGHLIGHT = 400 * 1024

const lang = computed(() => langForFile(props.name, props.ext))
const tooBig = computed(() => props.content.length > MAX_HIGHLIGHT)

const highlighted = computed(() => {
  if (props.kind === 'image') return ''
  if (tooBig.value) return null
  return highlightCode(props.content, lang.value)
})

const plainHtml = computed(() => escapeHtml(props.content || ''))
const bodyHtml = computed(() => (highlighted.value == null ? plainHtml.value : highlighted.value))
const lineCount = computed(() => {
  const c = props.content || ''
  return c === '' ? 0 : c.split('\n').length
})
const lineNumbers = computed(() => {
  const n = lineCount.value
  const arr = new Array(n)
  for (let i = 0; i < n; i++) arr[i] = i + 1
  return arr
})

const showLineNo = ref(props.kind !== 'text')
const copied = ref(false)
let copyTimer = null
function doCopy() {
  emit('copy', props.content)
  copied.value = true
  clearTimeout(copyTimer)
  copyTimer = setTimeout(() => (copied.value = false), 1600)
}
onBeforeUnmount(() => clearTimeout(copyTimer))

// ---------- 图片 ----------
const imgSrc = ref('')
const imgErr = ref('')
const imgLoading = ref(false)
const zoom = ref(1)
const fitMode = ref(true) // true=适应窗口 false=按 zoom 缩放

async function loadImage() {
  imgSrc.value = ''
  imgErr.value = ''
  zoom.value = 1
  fitMode.value = true
  if (props.kind !== 'image' || !props.file) return
  imgLoading.value = true
  try {
    // 先走 IPC 读成 data URL（最稳，不受 file:// 加载策略影响）
    imgSrc.value = await fs.readImage(props.file)
  } catch (e) {
    imgSrc.value = toFileUrl(props.file)
  }
  imgLoading.value = false
}
function onImgError() {
  imgErr.value = '图片加载失败（可能格式不受支持或文件已损坏）'
}
function zoomIn() {
  fitMode.value = false
  zoom.value = Math.min(8, +(zoom.value + 0.25).toFixed(2))
}
function zoomOut() {
  fitMode.value = false
  zoom.value = Math.max(0.1, +(zoom.value - 0.25).toFixed(2))
}
function zoomFit() {
  fitMode.value = true
  zoom.value = 1
}
function zoomReset() {
  fitMode.value = false
  zoom.value = 1
}
const imgStyle = computed(() => {
  if (fitMode.value) return { maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto' }
  return { width: zoom.value * 100 + '%', maxWidth: 'none', maxHeight: 'none' }
})

watch(
  () => [props.file, props.kind],
  () => loadImage()
)
watch(
  () => props.content,
  () => {
    showLineNo.value = props.kind !== 'text'
  }
)
loadImage()
</script>

<template>
  <div class="viewer">
    <div class="vp-head">
      <span class="vp-name" :title="file">{{ name }}</span>
      <span class="vp-badge">{{ KIND_LABEL[kind] || '文件' }}</span>
      <span v-if="kind !== 'image'" class="vp-lang">{{ lang }}</span>
      <span v-if="size" class="vp-meta">{{ formatSize(size) }}</span>
      <span v-if="mtime" class="vp-meta">{{ formatTime(mtime) }}</span>
      <span class="vp-spacer"></span>
      <template v-if="kind !== 'image'">
        <button class="vp-btn" type="button" @click="showLineNo = !showLineNo">
          {{ showLineNo ? '隐藏行号' : '显示行号' }}
        </button>
        <button class="vp-btn" type="button" @click="doCopy">{{ copied ? '✓ 已复制' : '复制内容' }}</button>
      </template>
      <template v-else>
        <button class="vp-btn" type="button" @click="zoomOut">－</button>
        <span class="vp-zoom">{{ fitMode ? '适应' : Math.round(zoom * 100) + '%' }}</span>
        <button class="vp-btn" type="button" @click="zoomIn">＋</button>
        <button class="vp-btn" type="button" @click="zoomFit">适应</button>
        <button class="vp-btn" type="button" @click="zoomReset">1:1</button>
      </template>
    </div>

    <!-- 图片 -->
    <div v-if="kind === 'image'" class="vp-image-wrap">
      <div v-if="imgLoading" class="vp-tip">加载中…</div>
      <div v-else-if="imgErr" class="vp-tip err">{{ imgErr }}</div>
      <img
        v-else-if="imgSrc"
        class="vp-image"
        :src="imgSrc"
        :alt="name"
        :style="imgStyle"
        @error="onImgError"
      />
      <div v-else class="vp-tip">无预览</div>
    </div>

    <!-- 代码 / 文本 -->
    <div v-else class="vp-code-scroll">
      <div v-if="tooBig" class="vp-big-tip">
        文件较大（{{ formatSize(size) }}），已跳过语法高亮，按纯文本显示以保证流畅。
      </div>
      <div class="vp-code" :class="{ 'no-ln': !showLineNo }">
        <div v-if="showLineNo" class="vp-gutter">
          <div v-for="n in lineNumbers" :key="n" class="vp-ln">{{ n }}</div>
        </div>
        <pre class="vp-pre"><code :class="'language-' + lang" v-html="bodyHtml"></code></pre>
      </div>
    </div>
  </div>
</template>
