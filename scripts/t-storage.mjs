// 临时测试：验证 toStorageMarkdown 对「编码过的 file://」与「原始中文 file://」的处理
const safeDecode = (s) => {
  try {
    return decodeURIComponent(s)
  } catch (_) {
    return s
  }
}

function fileUrlToRelative(fileUrl, docDir) {
  let p = safeDecode(fileUrl.replace(/^file:\/\//, ''))
  p = p.replace(/^\/+/, '')
  const norm = (x) => x.replace(/\\/g, '/').replace(/\/+$/, '')
  const dp = norm(docDir)
  const pp = norm(p)
  if (pp === dp) return ''
  if (pp.startsWith(dp + '/')) return pp.slice(dp.length + 1)
  return null
}

function toStorageMarkdown(text, docDir) {
  let out = text || ''
  out = out.replace(/(!\[[^\]]*\]\()file:\/\/([^)\s]+)(\))/g, (m, pre, src, post) => {
    const rel = fileUrlToRelative('file://' + src, docDir)
    return rel === null ? m : pre + rel + post
  })
  return out
}

const d = 'E:\\__diag_fake__'
console.log('A encoded:', toStorageMarkdown('![t](file:///E:/__diag_fake__/image/%E6%B5%8B%E8%AF%95%E5%9B%BE%E7%89%87.jpg)', d))
console.log('B raw    :', toStorageMarkdown('![t](file:///E:/__diag_fake__/image/测试图片.jpg)', d))
