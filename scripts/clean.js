// 打包前清理：删除 electron-builder 的 unpacked 缓存目录
// 否则 electron-builder 会复用旧的 win-unpacked/app.asar，导致「代码改了但 exe 没更新」
const fs = require('fs')
const path = require('path')

const targets = [
  path.join(__dirname, '..', 'release', 'win-unpacked'),
  path.join(__dirname, '..', 'release', 'win-ia32-unpacked'),
  path.join(__dirname, '..', 'release', 'win-arm64-unpacked'),
  path.join(__dirname, '..', 'release', '.cache')
]

for (const d of targets) {
  try {
    if (fs.existsSync(d)) {
      fs.rmSync(d, { recursive: true, force: true })
      console.log('cleaned:', d)
    }
  } catch (e) {
    console.warn('clean failed (ignore if sandbox):', d, e.message)
  }
}
