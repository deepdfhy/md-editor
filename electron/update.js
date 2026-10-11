// 新版本检测：拉 GitHub Releases 的最新 tag，和应用自身版本比大小。
//
// 设计要点：
// - 只做「发现新版本 → 打开发布页」，不做静默下载安装（绿色版单文件，让用户自己下最省事）。
// - 网络层用可注入的 fetchLike，方便单测（scripts/t-update.cjs 用假 net 跑通全链路）。
// - 任何异常都不抛给界面，统一返回 { ok:false, error }，界面只做轻提示。
const DEFAULT_TIMEOUT = 8000

// 'owner/repo' / 'https://github.com/owner/repo' / 'git@github.com:owner/repo.git' 都能认
function parseRepo(input) {
  const s = String(input || '').trim()
  if (!s) return ''
  let m = s.match(/^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/)
  if (m) return m[1] + '/' + m[2]
  m = s.match(/github\.com[:/]+([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[#/?].*)?$/)
  if (m) return m[1] + '/' + m[2]
  return ''
}

// 'v0.1.10' / '0.1.10' / '0.1.10-beta.1' → [0,1,10]，预发布号单独取
function parseVersion(v) {
  const s = String(v || '').trim().replace(/^v/i, '')
  const m = s.match(/^(\d+)\.(\d+)\.(\d+)(?:-([\w.]+))?/)
  if (!m) return null
  return { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] || '' }
}

// 1 = a 新，-1 = b 新，0 = 相同。只有「更新」才算更新（降级不提示）
function compareVersion(a, b) {
  const x = parseVersion(a)
  const y = parseVersion(b)
  if (!x || !y) return 0
  for (let i = 0; i < 3; i++) {
    if (x.nums[i] !== y.nums[i]) return x.nums[i] > y.nums[i] ? 1 : -1
  }
  // 主版本相同：正式版 > 预发布版（0.2.0 > 0.2.0-beta.1）
  if (x.pre === y.pre) return 0
  if (!x.pre) return 1
  if (!y.pre) return -1
  return x.pre > y.pre ? 1 : -1
}

// 默认网络实现：走 Electron 的 net（自动带系统代理，不受页面 CORS 限制）
function defaultFetch(url, timeout) {
  return new Promise((resolve, reject) => {
    let done = false
    const finish = (fn, arg) => {
      if (done) return
      done = true
      fn(arg)
    }
    try {
      const { net } = require('electron')
      const req = net.request({ url, method: 'GET' })
      req.setHeader('Accept', 'application/vnd.github+json')
      req.setHeader('User-Agent', 'md-editor-updater')
      req.on('response', (res) => {
        let body = ''
        res.on('data', (chunk) => (body += chunk.toString('utf8')))
        res.on('end', () => finish(resolve, { status: res.statusCode, body }))
        res.on('error', (e) => finish(reject, e))
      })
      req.on('error', (e) => finish(reject, e))
      req.setTimeout(timeout || DEFAULT_TIMEOUT, () => {
        try {
          req.abort()
        } catch (_) {}
        finish(reject, new Error('请求超时'))
      })
      req.end()
    } catch (e) {
      finish(reject, e)
    }
  })
}

// 拉最新 release；deps 可注入，便于测试
async function fetchLatest(repo, deps = {}) {
  const fetchLike = deps.fetchLike || defaultFetch
  const timeout = deps.timeout || DEFAULT_TIMEOUT
  const rel = parseRepo(repo)
  if (!rel) return { ok: false, error: '未配置 GitHub 仓库（设置里填 owner/repo）' }
  let res
  try {
    res = await fetchLike('https://api.github.com/repos/' + rel + '/releases/latest', timeout)
  } catch (e) {
    return { ok: false, error: (e && e.message) || '网络请求失败' }
  }
  if (!res || res.status !== 200) {
    // 404 一般是「还没发布过 release」或仓库名写错
    const tip = res && res.status === 404 ? '仓库不存在或还没有发布 Release' : 'GitHub 返回 ' + ((res && res.status) || '?')
    return { ok: false, error: tip }
  }
  let data
  try {
    data = JSON.parse(res.body)
  } catch (_) {
    return { ok: false, error: '返回内容不是合法 JSON' }
  }
  const tag = (data.tag_name || data.name || '').trim()
  const page = data.html_url || 'https://github.com/' + rel + '/releases'
  return {
    ok: true,
    repo: rel,
    tag,
    version: String(tag).replace(/^v/i, ''),
    name: data.name || tag,
    url: page,
    publishedAt: data.published_at || '',
    body: String(data.body || '').slice(0, 2000)
  }
}

async function checkUpdate(currentVersion, repo, deps = {}) {
  const r = await fetchLatest(repo, deps)
  if (!r.ok) return r
  const hasUpdate = compareVersion(r.version, currentVersion) > 0
  return Object.assign({}, r, { ok: true, current: currentVersion, hasUpdate })
}

module.exports = { parseRepo, parseVersion, compareVersion, fetchLatest, checkUpdate, defaultFetch }
