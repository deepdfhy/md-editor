// 忽略规则单元测试（不依赖 Electron，直接 node 跑）
// 用法：node scripts/t-ignore.cjs
'use strict'
const { DEFAULT_IGNORE, normalizeIgnore, createIgnoreMatcher } = require('../electron/ignore.js')

let pass = 0
let fail = 0
function eq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) {
    pass++
    console.log('  ✓ ' + label)
  } else {
    fail++
    console.log('  ✗ ' + label + '  期望=' + JSON.stringify(expected) + ' 实际=' + JSON.stringify(actual))
  }
}

console.log('\n[1] normalizeIgnore 容错')
eq(normalizeIgnore(null).ignoreDot, true, 'undefined → ignoreDot 默认开启')
eq(normalizeIgnore(undefined).ignoreDirs, ['node_modules', 'dist'], '未配置过 → 落到默认目录规则')
eq(normalizeIgnore({}).ignoreFiles, [], '已配置过（空对象）→ 不再套默认值')
eq(normalizeIgnore({ ignoreDot: false }).ignoreDot, false, '显式 false 保留')
eq(normalizeIgnore({ ignoreDirs: 'a\nb, c;d' }).ignoreDirs, ['a', 'b', 'c', 'd'], '文本按换行/逗号/分号拆分')
eq(normalizeIgnore({ ignoreDirs: [' a ', '', 'b'] }).ignoreDirs, ['a', 'b'], '数组去空白与空项')
eq(normalizeIgnore({}).ignoreFiles, [], '缺省 ignoreFiles 为空数组')

console.log('\n[2] 默认规则')
const m1 = createIgnoreMatcher()
m1.setConfig(undefined) // 模拟首次启动：没有任何配置
eq(m1.isIgnored('.git', 'dir'), true, '.git 目录被忽略')
eq(m1.isIgnored('.obsidian', 'dir'), true, '.obsidian 目录被忽略')
eq(m1.isIgnored('.DS_Store', 'file'), true, '.DS_Store 文件被忽略')
eq(m1.isIgnored('.hidden.md', 'file'), true, '. 开头的 md 文件被忽略')
eq(m1.isIgnored('node_modules', 'dir'), true, 'node_modules 默认忽略')
eq(m1.isIgnored('dist', 'dir'), true, 'dist 默认忽略')
eq(m1.isIgnored('src', 'dir'), false, 'src 正常显示')
eq(m1.isIgnored('README.md', 'file'), false, 'README.md 正常显示')
// 默认规则里 node_modules 只写在 ignoreDirs，所以同名「文件」不应被忽略
eq(m1.isIgnored('node_modules', 'file'), false, 'ignoreDirs 不影响同名文件')

console.log('\n[3] 通配符')
const m2 = createIgnoreMatcher()
m2.setConfig(
  normalizeIgnore({
    ignoreDot: false,
    ignoreDirs: ['临时*', 'v?ndor'],
    ignoreFiles: ['*.tmp', '*.bak', '副本*.md']
  })
)
eq(m2.isIgnored('.git', 'dir'), false, '关闭 ignoreDot 后 .git 显示')
eq(m2.isIgnored('临时目录', 'dir'), true, '目录通配 临时* 命中')
eq(m2.isIgnored('vendor', 'dir'), true, '目录通配 v?ndor 命中')
eq(m2.isIgnored('vxxndor', 'dir'), false, '? 只匹配单个字符（不匹配多字符）')
eq(m2.isIgnored('a.tmp', 'file'), true, '文件通配 *.tmp 命中')
eq(m2.isIgnored('a.tmp.md', 'file'), false, '*.tmp 是全名匹配，不会误伤 a.tmp.md')
eq(m2.isIgnored('a.txt', 'file'), false, '*.tmp 不误伤 a.txt')
eq(m2.isIgnored('副本1.md', 'file'), true, '文件通配 副本*.md 命中')
eq(m2.isIgnored('笔记.md', 'file'), false, '普通 md 不被忽略')

console.log('\n[4] 精确匹配不应误伤')
const m3 = createIgnoreMatcher()
m3.setConfig(normalizeIgnore({ ignoreDirs: ['dist'], ignoreFiles: ['notes.md'] }))
eq(m3.isIgnored('dist', 'dir'), true, 'dist 命中')
eq(m3.isIgnored('dist2', 'dir'), false, 'dist2 不被 dist 误伤（全名匹配）')
eq(m3.isIgnored('notes.md', 'file'), true, 'notes.md 命中')
eq(m3.isIgnored('mynotes.md', 'file'), false, 'mynotes.md 不被误伤')
eq(m3.isIgnored('NOTES.MD', 'file'), true, '大小写不敏感')

console.log('\n[5] 规则热更新后缓存生效')
const m4 = createIgnoreMatcher()
m4.setConfig(normalizeIgnore({ ignoreDirs: ['aaa'] }))
eq(m4.isIgnored('aaa', 'dir'), true, '更新前 aaa 被忽略')
m4.setConfig(normalizeIgnore({ ignoreDirs: ['bbb'] }))
eq(m4.isIgnored('aaa', 'dir'), false, '更新后 aaa 恢复显示')
eq(m4.isIgnored('bbb', 'dir'), true, '更新后 bbb 被忽略')

console.log('\n[6] getConfig 返回副本，外部改动不污染内部状态')
const m5 = createIgnoreMatcher()
m5.setConfig(normalizeIgnore({ ignoreDirs: ['x'] }))
const snap = m5.getConfig()
snap.ignoreDirs.push('y')
eq(m5.isIgnored('y', 'dir'), false, '外部 push 不影响匹配器')

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败\n')
process.exit(fail ? 1 : 0)
