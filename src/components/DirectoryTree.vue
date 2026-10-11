<script setup>
import { ref, reactive, computed, nextTick, onMounted, onBeforeUnmount } from 'vue'

defineOptions({ name: 'DirectoryTree' })

const props = defineProps({
  tree: { type: Object, required: true },
  selectedDir: { type: String, default: '' }
})
const emit = defineEmits(['select', 'create-dir', 'create-doc', 'create-nav'])

// 每个节点实例维护自己的展开状态，默认展开
const open = ref(true)
const menu = reactive({ show: false, x: 0, y: 0, node: null })
// 命名弹窗（替代 window.prompt，打包后的 Electron 中 prompt 不可靠）
const dialog = reactive({ show: false, type: '', dir: '', name: '' })
const inputRef = ref(null)

function toggle() {
  if (props.tree.children && props.tree.children.length) open.value = !open.value
}
function onSelect() {
  emit('select', props.tree)
}
function onContext(e) {
  e.preventDefault()
  menu.show = true
  menu.x = e.clientX
  menu.y = e.clientY
  menu.node = props.tree
}
function closeMenu() {
  menu.show = false
}
function openDialog(type) {
  dialog.type = type
  dialog.dir = menu.node ? menu.node.path : ''
  dialog.name = ''
  dialog.show = true
  menu.show = false
  nextTick(() => inputRef.value && inputRef.value.focus())
}
function confirmDialog() {
  const name = dialog.name.trim()
  if (!name) return
  if (dialog.type === 'dir') emit('create-dir', { dir: dialog.dir, name })
  else if (dialog.type === 'nav') emit('create-nav', { dir: dialog.dir, name })
  else emit('create-doc', { dir: dialog.dir, name })
  dialog.show = false
}
function cancelDialog() {
  dialog.show = false
}

const modalTitle = computed(() => {
  if (dialog.type === 'dir') return '新建子目录'
  if (dialog.type === 'nav') return '新建聚合页'
  return '新建文档'
})
const modalPlaceholder = computed(() => {
  if (dialog.type === 'dir') return '请输入目录名称'
  if (dialog.type === 'nav') return '请输入聚合页名称（如：我的导航）'
  return '请输入文档名称（.md 可省略）'
})

// 点击菜单/弹窗以外的区域关闭右键菜单
function onWinClick(e) {
  if (!menu.show) return
  const t = e.target
  if (!t.closest || (!t.closest('.ctx-menu') && !t.closest('.node'))) closeMenu()
}

onMounted(() => window.addEventListener('click', onWinClick))
onBeforeUnmount(() => window.removeEventListener('click', onWinClick))
</script>

<template>
  <ul class="tree">
    <li class="tree-li">
      <div
        class="node"
        :class="{ active: selectedDir === tree.path }"
        @click="onSelect"
        @contextmenu="onContext"
      >
        <span class="twisty" @click.stop="toggle">
          {{ tree.children && tree.children.length ? (open ? '▾' : '▸') : '' }}
        </span>
        <svg class="ic" viewBox="0 0 16 16" width="14" height="14">
          <path d="M1.5 4h5l2 2h6v6.5H1.5z" fill="#c9a227" />
        </svg>
        <span class="label">{{ tree.name }}</span>
      </div>

      <template v-if="open && tree.children && tree.children.length">
        <DirectoryTree
          v-for="c in tree.children"
          :key="c.path"
          :tree="c"
          :selected-dir="selectedDir"
          @select="emit('select', $event)"
          @create-dir="emit('create-dir', $event)"
          @create-doc="emit('create-doc', $event)"
          @create-nav="emit('create-nav', $event)"
        />
      </template>

      <!-- 右键菜单 -->
      <div
        v-if="menu.show && menu.node === tree"
        class="ctx-menu"
        :style="{ left: menu.x + 'px', top: menu.y + 'px' }"
      >
        <div class="ctx-item" @click.stop="openDialog('dir')">新建子目录</div>
        <div class="ctx-item" @click.stop="openDialog('doc')">新建文档</div>
        <div class="ctx-item" @click.stop="openDialog('nav')">新建聚合页</div>
      </div>
    </li>

    <!-- 命名弹窗（应用内，替代 window.prompt） -->
    <div v-if="dialog.show && dialog.dir === tree.path" class="modal-mask" @click.self="cancelDialog">
      <div class="modal">
        <div class="modal-title">{{ modalTitle }}</div>
        <div class="modal-hint">位置：{{ dialog.dir }}</div>
        <input
          ref="inputRef"
          class="modal-input"
          v-model="dialog.name"
          :placeholder="modalPlaceholder"
          @keyup.enter="confirmDialog"
          @keyup.esc="cancelDialog"
        />
        <div v-if="dialog.type === 'nav'" class="modal-hint dim">
          聚合页会把当前目录及其子目录下的笔记自动汇总成卡片封面墙。
        </div>
        <div class="modal-actions">
          <button class="modal-btn" @click="cancelDialog">取消</button>
          <button class="modal-btn primary" @click="confirmDialog">确定</button>
        </div>
      </div>
    </div>
  </ul>
</template>
