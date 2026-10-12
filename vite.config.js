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
    // 必须清空：否则历次构建的旧 js/css 会一直堆在 dist/assets 里被一起打进 app.asar
    // （实测会让安装包从 83MB 胖到 102MB）
    emptyOutDir: true
  }
})
