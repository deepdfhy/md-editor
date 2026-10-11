import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 基路径用相对路径，保证打包后 file:// 直接打开也能加载资源
export default defineConfig({
  base: './',
  plugins: [vue()],
  server: {
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: 'dist',
    emptyOutDir: false
  }
})
