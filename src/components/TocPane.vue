<script setup>
const props = defineProps({
  toc: { type: Array, default: () => [] }
})
const emit = defineEmits(['navigate'])
</script>

<template>
  <div class="toc">
    <div class="toc-title">文档大纲</div>
    <div
      v-for="(h, i) in toc"
      :key="i"
      class="toc-item"
      :class="'lv' + h.level"
      :style="{ paddingLeft: (h.level - 1) * 14 + 10 + 'px' }"
      :title="h.text"
      @click="emit('navigate', i)"
    >
      {{ h.text }}
    </div>
    <div v-if="!toc.length" class="toc-empty">暂无标题</div>
  </div>
</template>
