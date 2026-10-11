// 目录扫描 + 忽略规则的真实文件系统测试（不依赖 Electron）
// 用法：node scripts/t-scan.cjs
'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const { normalizeIgnore, createIgnoreMatcher } = require('../electron/ignore.js')
const { createScanner } = require('../electron/fsscan.js')

let pass = 0
let fail = 0
function eq(actual, expected, label) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a === b) {
    pass++
    console.log('  ✓ ' + label)
  } else {
    fail++
    console.log('  ✗ ' + label + '\n      期望=' + b + '\n      实际=' + a)
  }
}

const ROOT = path.join(os.tmpdir(), 'md-editor-scan-' + Date.now())

function makeFixture() {
  const dirs = [
    'sub',
    'sub/deep',
    'images',
    'node_modules',
    'node_modules/pkg',
    'dist',
    '.git',
    '.git/objects',
    '.obsidian',
    '.recycle'
  ]
  for (const d of dirs) fs.mkdirSync(path.join(ROOT, d), { recursive: true })
  const files = [
    'a.md',
    'z-最后.md',
    '.hidden.md',
    'notes.txt',
    'sub/b.md',
    'sub/deep/c.markdown',
    'images/pic.png',
    'node_modules/pkg/readme.md',
    'dist/out.md',
    '.git/objects/x.md',
    '.obsidian/workspace.md',
    '.recycle/old.md'
  ]
  for (const f of files) fs.writeFileSync(path.join(ROOT, f), '# x\n', 'utf-8')
}

function mkScanner(ignoreRaw) {
  const m = createIgnoreMatcher()
  m.setConfig(normalizeIgnore(ignoreRaw))
  return createScanner(m)
}

function namesOf(nodes) {
  return nodes.map((n) => n.name)
}
function findNode(nodes, name) {
  for (const n of nodes) {
    if (n.name === name) return n
    const r = findNode(n.children || [], name)
    if (r) return r
  }
  return null
}

;(async () => {
  makeFixture()
  console.log('\n测试根目录：' + ROOT)

  console.log('\n[1] 默认规则（忽略 . 开头 + node_modules/dist）')
  {
    const sc = mkScanner(undefined)
    const tree = await sc.getTree(ROOT)
    eq(namesOf(tree.children), ['images', 'sub'], '目录树只保留 images / sub')
    eq(!!findNode(tree.children, '.git'), false, '.git 不出现在树里')
    eq(!!findNode(tree.children, '.recycle'), false, '.recycle 始终不出现')
    eq(!!findNode(tree.children, 'node_modules'), false, 'node_modules 被忽略')
    const sub = findNode(tree.children, 'sub')
    eq(namesOf(sub.children), ['deep'], '子层级递归也过滤（sub/deep 保留）')
    const files = await sc.listFiles(ROOT)
    eq(files.map((f) => f.name), ['a.md', 'z-最后.md', 'notes.txt'], '根目录：笔记优先，其后是其它文本文件')
    const subFiles = await sc.listFiles(path.join(ROOT, 'sub'))
    eq(subFiles.map((f) => f.name), ['b.md'], 'sub 目录列出 b.md')
    eq(subFiles[0].mtime > 0, true, '文件带 mtime')
    eq(
      (await sc.listFiles(path.join(ROOT, 'sub', 'deep'))).map((f) => f.name),
      ['c.markdown'],
      '.markdown 扩展名也识别'
    )
    eq(
      (await sc.listFiles(path.join(ROOT, 'node_modules', 'pkg'))).map((f) => f.name),
      ['readme.md'],
      '忽略规则只影响"遍历显示"，不影响直接列举指定目录'
    )
  }

  console.log('\n[2] 关闭 ignoreDot 后 . 开头的目录/文件恢复显示')
  {
    const sc = mkScanner({ ignoreDot: false, ignoreDirs: ['node_modules', 'dist'], ignoreFiles: [] })
    const tree = await sc.getTree(ROOT)
    const names = namesOf(tree.children)
    eq(names.includes('.git'), true, '.git 恢复显示')
    eq(names.includes('.obsidian'), true, '.obsidian 恢复显示')
    eq(names.includes('.recycle'), false, '.recycle 依然被强制隐藏')
    eq(names.includes('node_modules'), false, 'node_modules 仍按 ignoreDirs 忽略')
    const files = await sc.listFiles(ROOT)
    eq(files.map((f) => f.name), ['.hidden.md', 'a.md', 'z-最后.md', 'notes.txt'], '.hidden.md 恢复显示')
  }

  console.log('\n[3] 自定义通配规则')
  {
    const sc = mkScanner({
      ignoreDot: true,
      ignoreDirs: ['images', 's?b'],
      ignoreFiles: ['a*.md', '*.markdown']
    })
    const tree = await sc.getTree(ROOT)
    const names = namesOf(tree.children)
    eq(names.includes('images'), false, 'images 被自定义规则忽略')
    eq(names.includes('sub'), false, 's?b 通配命中 sub')
    const files = await sc.listFiles(ROOT)
    eq(files.map((f) => f.name), ['z-最后.md', 'notes.txt'], 'a*.md 命中 a.md')
    eq(
      (await sc.listFiles(path.join(ROOT, 'sub', 'deep'))).map((f) => f.name),
      [],
      '*.markdown 命中 c.markdown'
    )
  }

  console.log('\n[4] 规则热更新后立即生效（同一 scanner 实例）')
  {
    const m = createIgnoreMatcher()
    m.setConfig(normalizeIgnore({ ignoreDot: true, ignoreDirs: ['sub'], ignoreFiles: [] }))
    const sc = createScanner(m)
    eq(namesOf((await sc.getTree(ROOT)).children).includes('sub'), false, '先忽略 sub')
    m.setConfig(normalizeIgnore({ ignoreDot: true, ignoreDirs: [], ignoreFiles: [] }))
    eq(namesOf((await sc.getTree(ROOT)).children).includes('sub'), true, '改规则后 sub 立刻恢复')
  }

  console.log('\n[5] 异常容错')
  {
    const sc = mkScanner(undefined)
    const t = await sc.getTree(path.join(ROOT, '__不存在的目录__'))
    eq(t.children, [], '不存在的目录 → 空树，不抛异常')
    eq(t.name, '__不存在的目录__', '仍返回 name/path')
    eq(await sc.listFiles(path.join(ROOT, '__不存在的目录__')), [], '不存在的目录 → 空列表')
  }

  try {
    fs.rmSync(ROOT, { recursive: true, force: true })
  } catch (_) {
    console.log('\n（临时目录清理失败，可忽略：' + ROOT + '）')
  }

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败\n')
  process.exit(fail ? 1 : 0)
})()
