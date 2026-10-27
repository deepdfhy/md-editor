// 主进程真实链路测试：拦截 require('electron') 换成假的壳，
// 直接加载真实的 electron/main.js，然后调用它注册的 IPC handler。
// 这样能验证「配置读写 → 忽略规则 → 目录树/文件列表」整条真实代码路径，
// 又不需要真的开窗口（app.whenReady 返回一个永不 resolve 的 Promise）。
// 用法：node scripts/t-main.cjs
'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const Module = require('module')

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

const BASE = path.join(os.tmpdir(), 'md-editor-main-' + Date.now())
const NOTES = path.join(BASE, 'notes')
const USERDATA = path.join(BASE, 'userData')

// ---------- 夹具 ----------
fs.mkdirSync(NOTES, { recursive: true })
for (const d of ['sub', '.git', 'node_modules', 'dist', '.recycle']) {
  fs.mkdirSync(path.join(NOTES, d), { recursive: true })
}
for (const f of [
  'a.md',
  '.secret.md',
  'sub/b.md',
  '.git/x.md',
  'node_modules/y.md',
  'dist/z.md',
  '.recycle/old.md'
]) {
  fs.writeFileSync(path.join(NOTES, f), '# t\n', 'utf-8')
}
fs.mkdirSync(USERDATA, { recursive: true })
// 故意写一份「老版本」配置：没有 ignore 字段，验证能自动落到默认规则
fs.writeFileSync(
  path.join(USERDATA, 'config.json'),
  JSON.stringify(
    { recentDirs: [NOTES], lastDir: NOTES, lastActiveDir: NOTES },
    null,
    2
  ),
  'utf-8'
)

// ---------- 假 electron ----------
const handlers = {}
let openedExternal = ''
const fakeElectron = {
  app: {
    getPath: () => USERDATA,
    getVersion: () => '0.0.0-test',
    // 永不 resolve：保证不创建窗口、不建菜单
    whenReady: () => new Promise(() => {}),
    on: () => {}
  },
  ipcMain: {
    handle: (ch, fn) => {
      handlers[ch] = fn
    },
    on: () => {}
  },
  BrowserWindow: class {
    constructor() {
      throw new Error('测试中不应创建窗口')
    }
  },
  dialog: {},
  clipboard: { writeText: () => {} },
  shell: {
    openExternal: (u) => {
      openedExternal = String(u)
      return Promise.resolve()
    }
  },
  Menu: { buildFromTemplate: () => ({}), setApplicationMenu: () => {} }
}
const origLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return fakeElectron
  return origLoad.apply(this, arguments)
}

require('../electron/main.js')

const call = (ch, ...args) => handlers[ch]({ sender: { send() {} } }, ...args)
const names = (tree) => tree.children.map((c) => c.name).sort()

;(async () => {
  console.log('\n[1] IPC handler 是否都注册了')
  const need = [
    'openFolder',
    'readTree',
    'listFiles',
    'readFile',
    'writeFile',
    'createDir',
    'createDoc',
    'getConfig',
    'setConfig',
    'getDefaults',
    'copyText',
    'exportPdf',
    'readImage',
    'archiveNote',
    'deleteNote',
    'listRecycle',
    'restoreNote',
    'purgeNote',
    'emptyRecycle',
    'saveAttachment',
    'getAppInfo',
    'checkUpdate',
    'openExternal'
  ]
  const missing = need.filter((c) => typeof handlers[c] !== 'function')
  eq(missing, [], '全部 IPC 通道已注册')

  console.log('\n[1b] 新版本检测：仓库解析 / 外链白名单')
  const info = await call('getAppInfo')
  eq(typeof info.version, 'string', 'getAppInfo 返回版本号')
  eq(info.repo, '', '测试环境没配仓库 → repo 为空串')
  // openExternal 只放行 https 的 github.com，其它一律拒绝
  eq(await call('openExternal', 'https://github.com/a/b/releases'), true, 'github https 链接放行')
  eq(openedExternal, 'https://github.com/a/b/releases', '确实交给了 shell.openExternal')
  eq(await call('openExternal', 'file:///C:/windows/system32/calc.exe'), false, 'file: 协议被拒')
  eq(await call('openExternal', 'http://github.com/a/b'), false, 'http（非 https）被拒')
  eq(await call('openExternal', 'https://evil.com/x'), false, '非 github 域名被拒')
  eq(openedExternal, 'https://github.com/a/b/releases', '被拒的链接没有传给 shell')
  const upd = await call('checkUpdate')
  eq(upd.ok, false, '没配仓库 → checkUpdate 明确失败而不是抛异常')
  eq(typeof upd.error, 'string', '失败时带 error 文案')

  console.log('\n[2] getConfig：老配置没有 ignore 字段 → 自动落默认规则')
  const cfg = await call('getConfig')
  eq(cfg.ignore.ignoreDot, true, 'ignoreDot 默认开启')
  eq(cfg.ignore.ignoreDirs, ['node_modules', 'dist'], 'ignoreDirs 默认 node_modules/dist')
  eq(cfg.ignore.ignoreFiles, [], 'ignoreFiles 默认为空')
  eq(cfg.lastDir, NOTES, 'lastDir 正确读出')

  console.log('\n[3] readTree / listFiles：默认规则实际生效')
  const tree = await call('readTree', NOTES)
  eq(tree.root, true, '返回根节点标记')
  eq(names(tree), ['sub'], '目录树只剩 sub（.git/node_modules/dist/.recycle 全被过滤）')
  const files = await call('listFiles', NOTES)
  eq(files.map((f) => f.name), ['a.md'], 'md 列表只剩 a.md（.secret.md 被过滤）')

  console.log('\n[3b] listFilesDeep：递归列出当前目录 + 所有子目录的文件，带 relPath')
  const deep = await call('listFilesDeep', NOTES)
  eq(
    deep.map((f) => f.relPath).sort(),
    ['a.md', 'sub/b.md'],
    '递归列表含当前目录 + 子目录，且 .secret.md / .git / node_modules / dist / .recycle 都被过滤'
  )
  eq(!!deep.find((f) => f.relPath === 'sub/b.md'), true, '子目录文档带相对路径 relPath')

  console.log('\n[4] setConfig 改忽略规则 → 立即生效')
  await call('setConfig', {
    recentDirs: [NOTES],
    lastDir: NOTES,
    lastActiveDir: NOTES,
    ignore: { ignoreDot: false, ignoreDirs: [], ignoreFiles: [] }
  })
  const tree2 = await call('readTree', NOTES)
  eq(names(tree2), ['.git', 'dist', 'node_modules', 'sub'], '关闭全部忽略后目录都出现了')
  const files2 = await call('listFiles', NOTES)
  eq(files2.map((f) => f.name), ['.secret.md', 'a.md'], '.secret.md 也出现了')
  eq(!!(await call('readTree', NOTES)).children.find((c) => c.name === '.recycle'), false, '.recycle 始终不外露')

  console.log('\n[5] 配置是否真的落盘（重读文件）')
  const onDisk = JSON.parse(fs.readFileSync(path.join(USERDATA, 'config.json'), 'utf-8'))
  eq(onDisk.ignore.ignoreDot, false, 'ignore 已写入 config.json')
  eq(onDisk.ignore.ignoreDirs, [], 'ignoreDirs 已写入')

  console.log('\n[6] getDefaults 与「恢复默认」链路')
  const def = await call('getDefaults')
  eq(def.ignore, { ignoreDot: true, ignoreDirs: ['node_modules', 'dist'], ignoreFiles: [] }, '默认值结构正确')
  await call('setConfig', {
    recentDirs: [],
    lastDir: NOTES,
    lastActiveDir: '',
    ignore: def.ignore
  })
  eq(names(await call('readTree', NOTES)), ['sub'], '恢复默认后过滤恢复')

  console.log('\n[7] 读文件 / 不存在目录的容错')
  eq(await call('readFile', path.join(NOTES, 'a.md')), '# t\n', 'readFile 正常')
  eq((await call('readTree', path.join(BASE, '__nope__'))).children, [], '不存在目录 → 空树')

  try {
    fs.rmSync(BASE, { recursive: true, force: true })
  } catch (_) {
    console.log('\n（临时目录清理失败，可忽略：' + BASE + '）')
  }

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败\n')
  process.exit(fail ? 1 : 0)
})().catch((e) => {
  console.error('\n测试异常：', e)
  process.exit(1)
})
