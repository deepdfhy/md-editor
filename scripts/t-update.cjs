// 新版本检测的单元测试：不联网，靠注入假的 fetchLike 跑通全链路。
// 跑法：node scripts/t-update.cjs
const assert = require('assert')
const path = require('path')
const Module = require('module')
const { parseRepo, parseVersion, compareVersion, fetchLatest, checkUpdate, defaultFetch } = require(
  path.join(__dirname, '..', 'electron', 'update.js')
)

let pass = 0
let fail = 0
function ok(name, fn) {
  try {
    fn()
    pass++
    console.log('  ✓ ' + name)
  } catch (e) {
    fail++
    console.log('  ✗ ' + name + ' → ' + (e && e.message))
  }
}

console.log('\n[parseRepo] 各种仓库写法都要能认出来')
ok("'junge/md-editor'", () => assert.strictEqual(parseRepo('junge/md-editor'), 'junge/md-editor'))
ok("'https://github.com/junge/md-editor'", () =>
  assert.strictEqual(parseRepo('https://github.com/junge/md-editor'), 'junge/md-editor'))
ok("'https://github.com/junge/md-editor.git'", () =>
  assert.strictEqual(parseRepo('https://github.com/junge/md-editor.git'), 'junge/md-editor'))
ok("'git@github.com:junge/md-editor.git'", () =>
  assert.strictEqual(parseRepo('git@github.com:junge/md-editor.git'), 'junge/md-editor'))
ok("'https://github.com/junge/md-editor/releases'", () =>
  assert.strictEqual(parseRepo('https://github.com/junge/md-editor/releases'), 'junge/md-editor'))
ok('带 .git 的简写', () => assert.strictEqual(parseRepo('junge/md-editor.git'), 'junge/md-editor'))
ok('空值 → 空串', () => {
  assert.strictEqual(parseRepo(''), '')
  assert.strictEqual(parseRepo(null), '')
  assert.strictEqual(parseRepo(undefined), '')
})
ok('别的域名不认', () => assert.strictEqual(parseRepo('https://gitee.com/junge/md-editor'), ''))
ok('只有仓库名不算', () => assert.strictEqual(parseRepo('md-editor'), ''))
ok('前后空格容错', () => assert.strictEqual(parseRepo('  junge/md-editor  '), 'junge/md-editor'))

console.log('\n[parseVersion]')
ok("'0.1.10'", () => assert.deepStrictEqual(parseVersion('0.1.10').nums, [0, 1, 10]))
ok("'v0.1.10' 去掉 v", () => assert.deepStrictEqual(parseVersion('v0.1.10').nums, [0, 1, 10]))
ok('预发布号', () => assert.strictEqual(parseVersion('1.2.3-beta.1').pre, 'beta.1'))
ok('非法版本 → null', () => assert.strictEqual(parseVersion('abc'), null))

console.log('\n[compareVersion] 1=左边新 -1=右边新 0=相同')
ok('0.1.10 > 0.1.9（字符串比大小会踩的坑）', () =>
  assert.strictEqual(compareVersion('0.1.10', '0.1.9'), 1))
ok('0.2.0 > 0.1.10', () => assert.strictEqual(compareVersion('0.2.0', '0.1.10'), 1))
ok('v 前缀不影响', () => assert.strictEqual(compareVersion('v0.2.0', '0.1.10'), 1))
ok('相同 → 0', () => assert.strictEqual(compareVersion('0.1.10', '0.1.10'), 0))
ok('旧版本 → -1', () => assert.strictEqual(compareVersion('0.1.9', '0.1.10'), -1))
ok('1.0.0 > 0.99.99', () => assert.strictEqual(compareVersion('1.0.0', '0.99.99'), 1))
ok('正式版 > 预发布版', () => assert.strictEqual(compareVersion('0.2.0', '0.2.0-beta.1'), 1))
ok('预发布版 < 正式版', () => assert.strictEqual(compareVersion('0.2.0-beta.1', '0.2.0'), -1))
ok('非法版本按「无更新」处理', () => assert.strictEqual(compareVersion('garbage', '0.1.10'), 0))

// 假网络：返回固定响应
function fakeFetch(status, body) {
  const calls = []
  const fn = (url) => {
    calls.push(url)
    return Promise.resolve({ status, body })
  }
  fn.calls = calls
  return fn
}

console.log('\n[fetchLatest]')
;(async () => {
  const release = {
    tag_name: 'v0.2.0',
    name: 'MD 编辑器 0.2.0',
    html_url: 'https://github.com/junge/md-editor/releases/tag/v0.2.0',
    published_at: '2026-10-11T10:00:00Z',
    body: '更新内容'
  }
  let f = fakeFetch(200, JSON.stringify(release))
  let r = await fetchLatest('junge/md-editor', { fetchLike: f })
  ok('200 → 解析出 tag / url', () => {
    assert.strictEqual(r.ok, true)
    assert.strictEqual(r.tag, 'v0.2.0')
    assert.strictEqual(r.version, '0.2.0')
    assert.strictEqual(r.url, release.html_url)
    assert.strictEqual(r.repo, 'junge/md-editor')
  })
  ok('请求的是官方 api 地址', () =>
    assert.strictEqual(f.calls[0], 'https://api.github.com/repos/junge/md-editor/releases/latest'))

  ok('404 → 提示仓库不存在或没发过 Release', () => {})
  f = fakeFetch(404, '')
  r = await fetchLatest('junge/md-editor', { fetchLike: f })
  ok('404 分支', () => {
    assert.strictEqual(r.ok, false)
    assert.ok(/没有发布|不存在/.test(r.error), r.error)
  })

  r = await fetchLatest('junge/md-editor', { fetchLike: fakeFetch(500, 'boom') })
  ok('500 → 带上状态码', () => {
    assert.strictEqual(r.ok, false)
    assert.ok(/500/.test(r.error), r.error)
  })

  r = await fetchLatest('junge/md-editor', { fetchLike: fakeFetch(200, 'not-json') })
  ok('返回不是 JSON → 不抛异常', () => {
    assert.strictEqual(r.ok, false)
    assert.ok(/JSON/.test(r.error), r.error)
  })

  r = await fetchLatest(
    'junge/md-editor',
    { fetchLike: () => Promise.reject(new Error('请求超时')) }
  )
  ok('网络异常 → 返回 error 而不是抛出', () => {
    assert.strictEqual(r.ok, false)
    assert.strictEqual(r.error, '请求超时')
  })

  r = await fetchLatest('', { fetchLike: fakeFetch(200, '{}') })
  ok('没配仓库 → 明确提示', () => {
    assert.strictEqual(r.ok, false)
    assert.ok(/GitHub 仓库/.test(r.error), r.error)
  })

  console.log('\n[checkUpdate]')
  r = await checkUpdate('0.1.10', 'junge/md-editor', { fetchLike: fakeFetch(200, JSON.stringify(release)) })
  ok('线上更新 → hasUpdate true', () => {
    assert.strictEqual(r.ok, true)
    assert.strictEqual(r.hasUpdate, true)
    assert.strictEqual(r.current, '0.1.10')
    assert.strictEqual(r.version, '0.2.0')
  })

  const same = Object.assign({}, release, { tag_name: 'v0.1.10' })
  r = await checkUpdate('0.1.10', 'junge/md-editor', { fetchLike: fakeFetch(200, JSON.stringify(same)) })
  ok('版本相同 → hasUpdate false', () => assert.strictEqual(r.hasUpdate, false))

  const older = Object.assign({}, release, { tag_name: 'v0.1.9' })
  r = await checkUpdate('0.1.10', 'junge/md-editor', { fetchLike: fakeFetch(200, JSON.stringify(older)) })
  ok('线上更旧（本地是开发版）→ 不提示降级', () => assert.strictEqual(r.hasUpdate, false))

  r = await checkUpdate('0.1.10', 'junge/md-editor', { fetchLike: fakeFetch(404, '') })
  ok('查不到也不算「有更新」', () => {
    assert.strictEqual(r.ok, false)
    assert.strictEqual(r.hasUpdate, undefined)
  })

  // ---------------------------------------------------------------------
  // defaultFetch：真正走网络的那一层。
  // 之前只测了注入假 fetchLike 的链路，漏了这一层 —— 结果 0.1.11/0.1.12 真机上
  // 一按「检查更新」就报 req.setTimeout is not a function（Electron 的
  // ClientRequest 没有这个方法，那是 Node http 的 API）。
  // 所以这里把 require('electron') 打桩成假 net，把这一层钉死。
  // ---------------------------------------------------------------------
  console.log('\n[defaultFetch] Electron net 这一层（ClientRequest 没有 setTimeout）')
  const origLoad = Module._load
  let stub = {}
  let lastReq = null
  const makeReq = () => ({
    headers: {},
    handlers: {},
    ended: false,
    aborted: false,
    setHeader(k, v) {
      this.headers[k] = v
    },
    on(ev, fn) {
      this.handlers[ev] = fn
    },
    end() {
      this.ended = true
    },
    abort() {
      this.aborted = true
    }
  })
  const makeRes = (status) => {
    const h = {}
    return {
      statusCode: status,
      on(ev, fn) {
        h[ev] = fn
      },
      emit(ev, arg) {
        if (h[ev]) h[ev](arg)
      }
    }
  }
  const useNetStub = () => {
    stub = { net: { request: () => (lastReq = makeReq()) } }
  }
  Module._load = function (request) {
    if (request === 'electron') return stub
    return origLoad.apply(this, arguments)
  }

  // 1) 正常 200
  useNetStub()
  {
    const p = defaultFetch('https://api.github.com/repos/a/b/releases/latest', 5000)
    ok('请求已发出（end 被调用）', () => assert.strictEqual(lastReq.ended, true))
    ok('带了 User-Agent（GitHub API 必须）', () =>
      assert.strictEqual(lastReq.headers['User-Agent'], 'md-editor-updater'))
    const res = makeRes(200)
    lastReq.handlers.response(res)
    res.emit('data', Buffer.from('{"tag_name":"v9.9.9"}'))
    res.emit('end')
    const out = await p
    ok('拿到 status 与 body', () => {
      assert.strictEqual(out.status, 200)
      assert.strictEqual(out.body, '{"tag_name":"v9.9.9"}')
    })
  }

  // 2) 超时：一直不响应 → 自己开的定时器 abort + reject
  useNetStub()
  {
    const p = defaultFetch('https://api.github.com/x', 40)
    let err = null
    try {
      await p
    } catch (e) {
      err = e
    }
    ok('超时会 abort 并报「请求超时」', () => {
      assert.ok(err && /请求超时/.test(err.message), 'err=' + (err && err.message))
      assert.strictEqual(lastReq.aborted, true)
    })
  }

  // 3) 请求本身出错
  useNetStub()
  {
    const p = defaultFetch('https://api.github.com/x', 5000)
    lastReq.handlers.error(new Error('boom'))
    let err = null
    try {
      await p
    } catch (e) {
      err = e
    }
    ok('请求出错 → reject 原始错误', () => assert.strictEqual(err.message, 'boom'))
  }

  // 4) 拿不到 electron.net 时不能把异常抛到界面上
  stub = {}
  {
    let err = null
    try {
      await defaultFetch('https://api.github.com/x', 5000)
    } catch (e) {
      err = e
    }
    ok('没有 net 时只 reject，不崩', () => assert.ok(err instanceof Error))
  }

  // 5) 打桩到 net 层，整条 checkUpdate 跑通（和真机同一条代码路径）
  useNetStub()
  {
    const p = checkUpdate('0.1.12', 'deepdfhy/md-editor')
    const res = makeRes(200)
    lastReq.handlers.response(res)
    res.emit(
      'data',
      Buffer.from(
        JSON.stringify({
          tag_name: 'v0.2.0',
          html_url: 'https://github.com/deepdfhy/md-editor/releases/tag/v0.2.0'
        })
      )
    )
    res.emit('end')
    const r = await p
    ok('走真实网络层跑通 checkUpdate', () => {
      assert.strictEqual(r.ok, true)
      assert.strictEqual(r.hasUpdate, true)
      assert.strictEqual(r.current, '0.1.12')
      assert.strictEqual(r.version, '0.2.0')
      assert.strictEqual(
        r.url,
        'https://github.com/deepdfhy/md-editor/releases/tag/v0.2.0'
      )
    })
  }

  Module._load = origLoad

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败\n')
  process.exit(fail ? 1 : 0)
})()
