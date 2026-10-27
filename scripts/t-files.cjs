// 多文件类型列举 + 聚合页扫描的真实文件系统测试（不依赖 Electron）
// 用法：node scripts/t-files.cjs
'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const { normalizeIgnore, createIgnoreMatcher } = require('../electron/ignore.js')
const { createScanner, extractMeta, kindOf, extOf, NAV_RE } = require('../electron/fsscan.js')

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
function ok(v, label) {
  eq(!!v, true, label)
}

const ROOT = path.join(os.tmpdir(), 'md-editor-files-' + Date.now())
const IMG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

function w(rel, content) {
  const p = path.join(ROOT, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, content)
}

function makeFixture() {
  // 根目录：混合笔记 + 图片 + 代码 + 文本 + 聚合页
  w('readme.md', '# 项目说明\n\n正文\n')
  w('指南.nav.md', '# 我的导航\n')
  w('style.css', 'body { color: red; } /* c */\n')
  w('app.js', 'const a = 1 // hi\n')
  w('config.json', '{ "a": 1 }\n')
  w('notes.txt', '纯文本\n')
  w('Dockerfile', 'FROM node:20\n')
  w('pic.png', IMG)
  w('sub/a.md', '# 子目录笔记A\n\n![封面](images/cover.png)\n')
  w('sub/images/cover.png', IMG)
  w('sub/无标题.md', '没有一级标题的笔记\n')
  w('空目录占位/.keep', '')
  w('.secret.md', '# 不该出现\n')
  w('.git/config', '[core]\n')
}

function mkScanner(ignoreRaw) {
  const m = createIgnoreMatcher()
  m.setConfig(normalizeIgnore(ignoreRaw))
  return createScanner(m)
}

;(async () => {
  makeFixture()
  console.log('\n测试根目录：' + ROOT)

  console.log('\n[1] 纯函数：扩展名与类型判定')
  {
    eq(extOf('a.md'), 'md', 'extOf 取扩展名')
    eq(extOf('Dockerfile'), '', 'extOf 无扩展名 → 空串')
    eq(extOf('.gitignore'), '', 'extOf 点开头且无第二段 → 空串')
    eq(kindOf('a.md'), 'note', 'md → note')
    eq(kindOf('a.markdown'), 'note', 'markdown → note')
    eq(kindOf('a.MDX'), 'note', '扩展名大小写不敏感')
    eq(kindOf('style.css'), 'code', 'css → code')
    eq(kindOf('app.js'), 'code', 'js → code')
    eq(kindOf('index.HTML'), 'code', 'html → code')
    eq(kindOf('pic.PNG'), 'image', '图片大小写不敏感')
    eq(kindOf('notes.txt'), 'text', 'txt → text')
    eq(kindOf('Dockerfile'), 'text', '无扩展名 → text')
    eq(NAV_RE.test('指南.nav.md'), true, '.nav.md 识别为聚合页')
    eq(NAV_RE.test('readme.md'), false, '普通笔记不是聚合页')
  }

  console.log('\n[2] listFiles：多类型一起列出，笔记优先')
  {
    const sc = mkScanner(undefined)
    const files = await sc.listFiles(ROOT)
    const names = files.map((f) => f.name)
    eq(names.includes('.secret.md'), false, '. 开头被忽略')
    eq(names.includes('.git'), false, '.git 目录不出现在文件列表')
    // 笔记在前（含聚合页），其后按名称排序
    const firstTwo = names.slice(0, 2).sort()
    eq(firstTwo, ['readme.md', '指南.nav.md'], '前两项都是笔记')
    ok(names.indexOf('readme.md') < names.indexOf('style.css'), '笔记排在代码文件之前')
    const others = files.filter((f) => f.kind !== 'note').map((f) => f.name)
    const sorted = [...others].sort((a, b) => a.localeCompare(b, 'zh'))
    eq(others, sorted, '非笔记组内按名称排序')

    const by = (n) => files.find((f) => f.name === n)
    eq(by('style.css').kind, 'code', 'style.css 的 kind=code')
    eq(by('app.js').kind, 'code', 'app.js 的 kind=code')
    eq(by('config.json').kind, 'code', 'json 也算代码类')
    eq(by('pic.png').kind, 'image', 'pic.png 的 kind=image')
    eq(by('notes.txt').kind, 'text', 'notes.txt 的 kind=text')
    eq(by('Dockerfile').kind, 'text', 'Dockerfile 的 kind=text')
    eq(by('指南.nav.md').isNav, true, '聚合页 isNav=true')
    eq(by('readme.md').isNav, false, '普通笔记 isNav=false')
    ok(by('pic.png').size > 0, '带 size')
    ok(by('pic.png').mtime > 0, '带 mtime')
    eq(by('style.css').ext, 'css', '带 ext')
  }

  console.log('\n[3] listFiles：忽略规则对附件同样生效')
  {
    const sc = mkScanner({ ignoreDot: true, ignoreDirs: [], ignoreFiles: ['*.css', 'pic.png'] })
    const names = (await sc.listFiles(ROOT)).map((f) => f.name)
    eq(names.includes('style.css'), false, '*.css 被忽略')
    eq(names.includes('pic.png'), false, 'pic.png 被忽略')
    ok(names.includes('app.js'), '未匹配的文件仍在')
  }

  console.log('\n[3b] listFilesDeep：递归列出当前目录 + 所有子目录，带相对路径，遵守忽略')
  {
    const sc = mkScanner(undefined)
    const deep = await sc.listFilesDeep(ROOT)
    const rels = deep.map((f) => f.relPath)
    ok(rels.includes('readme.md'), '含当前目录直属文件')
    ok(rels.includes('sub/a.md'), '含一层子目录文件（相对路径 sub/a.md）')
    ok(rels.includes('sub/images/cover.png'), '含两层子目录文件（相对路径 sub/images/cover.png）')
    ok(!rels.some((r) => r.includes('.secret.md')), '. 开头文件被忽略')
    ok(!rels.some((r) => r.startsWith('.git')), '.git 目录被忽略')
    ok(!rels.some((r) => r.startsWith('空目录占位')), '空目录不出现在文件列表（只列文件）')
    eq(deep.find((f) => f.relPath === 'sub/a.md').kind, 'note', '子目录笔记 kind 正确')
  }

  console.log('\n[4] scanNotes：未分类 + 分类 结构')
  {
    const sc = mkScanner(undefined)
    const r = await sc.scanNotes(ROOT)
    eq(r.dir, ROOT, '返回扫描目录')
    const uncat = r.uncategorized.map((n) => n.name).sort()
    eq(uncat, ['readme.md', '指南.nav.md'], '未分类 = 本目录直属笔记（含聚合页）')
    eq(r.categories.map((c) => c.name), ['sub'], '分类 = 直接子目录')
    eq(r.categories[0].notes.map((n) => n.name).sort(), ['a.md', '无标题.md'], '分类下笔记正确')
    eq(!!r.categories.find((c) => c.name === '空目录占位'), false, '没有笔记的子目录不产生分类')
  }

  console.log('\n[5] scanNotes：selfPath 排除自身')
  {
    const sc = mkScanner(undefined)
    const r = await sc.scanNotes(ROOT, { selfPath: path.join(ROOT, '指南.nav.md') })
    const uncat = r.uncategorized.map((n) => n.name)
    eq(uncat.includes('指南.nav.md'), false, '聚合页不会把自己列进卡片墙')
    ok(uncat.includes('readme.md'), '其它笔记照常列出')
  }

  console.log('\n[6] scanNotes：标题 / 封面提取')
  {
    const sc = mkScanner(undefined)
    const r = await sc.scanNotes(ROOT)
    const a = r.categories[0].notes.find((n) => n.name === 'a.md')
    eq(a.title, '子目录笔记A', '标题取第一个 H1')
    eq(a.cover, 'images/cover.png', '封面取第一张图片（原始相对路径）')
    eq(
      path.normalize(a.coverAbs),
      path.normalize(path.join(ROOT, 'sub', 'images', 'cover.png')),
      '封面相对路径按「笔记所在目录」解析（子目录笔记不能用外层目录拼）'
    )
    const noTitle = r.categories[0].notes.find((n) => n.name === '无标题.md')
    eq(noTitle.title, '无标题', '没有 H1 时回落到文件名（去掉扩展名）')
    eq(noTitle.cover, '', '没有图片 → 封面为空')
  }

  console.log('\n[7] scanNotes：忽略规则生效')
  {
    const sc = mkScanner({ ignoreDot: true, ignoreDirs: ['sub'], ignoreFiles: ['*.nav.md'] })
    const r = await sc.scanNotes(ROOT)
    eq(r.categories.length, 0, '被忽略的子目录不产生分类')
    eq(r.uncategorized.map((n) => n.name), ['readme.md'], '被忽略的聚合页不进入未分类')
  }

  console.log('\n[8] extractMeta：跳过代码围栏取标题')
  {
    const src = '```md\n# 这不是标题\n```\n\n# 真正的标题\n\n![x](a.png)\n'
    const m = extractMeta(src, 'x.md')
    eq(m.title, '真正的标题', '代码块里的 # 不算标题')
    eq(m.cover, 'a.png', '封面正常提取')
    const m2 = extractMeta('', '文件名.md')
    eq(m2.title, '文件名', '空文件 → 用文件名')
    const m3 = extractMeta('# 标题\n![c](http://x.com/a.png)', 'n.nav.md')
    eq(m3.cover, 'http://x.com/a.png', '网络图片原样保留')
  }

  console.log('\n[9] 容错：不存在的目录')
  {
    const sc = mkScanner(undefined)
    const r = await sc.scanNotes(path.join(ROOT, '__none__'))
    eq(r.uncategorized, [], '不存在的目录 → 未分类为空')
    eq(r.categories, [], '不存在的目录 → 分类为空')
  }

  try {
    fs.rmSync(ROOT, { recursive: true, force: true })
  } catch (_) {}

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
  process.exit(fail ? 1 : 0)
})()
