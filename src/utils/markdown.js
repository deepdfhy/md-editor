import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js'
import DOMPurify from 'dompurify'
import 'highlight.js/styles/atom-one-dark.css'

// Markdown 解析实例：代码块用 highlight.js 高亮，UTF-8 不乱码
export const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: false,
  breaks: false,
  highlight(str, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return (
          '<pre class="hljs"><code>' +
          hljs.highlight(str, { language: lang, ignoreIllegals: true }).value +
          '</code></pre>'
        )
      } catch (_) {}
    }
    return '<pre class="hljs"><code>' + md.utils.escapeHtml(str) + '</code></pre>'
  }
})

// markdown-it 默认的 validateLink 会拦掉 file:/data: 协议。
// 笔记里图片在「展示态」是 file:// 绝对路径（见 toDisplayMarkdown），
// 若不放行，预览里图片会被替换成空 src 而显示不出来。
md.validateLink = (url) => {
  const u = (url || '').trim().toLowerCase()
  if (u.startsWith('javascript:') || u.startsWith('vbscript:') || u.startsWith('data:text/html')) {
    return false
  }
  return true
}

// 自定义 HTML 净化器：与 Toast UI 自带的（DOMPurify 默认配置）保持一致，
// 仅把 file: 协议加入 URI 白名单，让代码模式的内置预览也能显示本地图片。
const FILE_URI_REGEXP = /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|cid|xmpp|file):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i
export function customHtmlSanitizer(html, options) {
  try {
    return DOMPurify.sanitize(
      html,
      Object.assign({}, options || {}, { ALLOWED_URI_REGEXP: FILE_URI_REGEXP })
    )
  } catch (_) {
    return html
  }
}
// 提取大纲：返回有序标题数组（含层级、文本、行号），点击按 index 定位
export function extractToc(text) {
  const lines = (text || '').split('\n')
  const toc = []
  let inFence = false
  lines.forEach((line, i) => {
    const fence = line.trim().match(/^```+/)
    if (fence) {
      inFence = !inFence
      return
    }
    if (inFence) return
    const m = line.match(/^(#{1,6})\s+(.*)$/)
    if (m) {
      const level = m[1].length
      const text = m[2].replace(/\s+#+$/, '').trim()
      toc.push({ level, text, line: i })
    }
  })
  return toc
}

// 取首个 H1 作为文档标题（搜索/列表用）
export function getFirstHeading(text) {
  const lines = (text || '').split('\n')
  for (const line of lines) {
    const m = line.match(/^#\s+(.*)$/)
    if (m) return m[1].trim()
  }
  return ''
}

// 浏览器内可用的相对路径拼接（替代 Node path，避免引入额外依赖）
export function joinPath(base, rel) {
  if (/^[a-zA-Z]:[\\/]/.test(rel) || rel.startsWith('/')) return rel
  const parts = (base + '/' + rel).split(/[\\/]+/)
  const stack = []
  for (const p of parts) {
    if (p === '' || p === '.') continue
    if (p === '..') stack.pop()
    else stack.push(p)
  }
  return stack.join('/')
}

// 安全解码：路径里含非法 % 序列时不抛异常（会导致整段预览渲染中断）
function safeDecode(s) {
  try {
    return decodeURIComponent(s)
  } catch (_) {
    return s
  }
}

// file:// 绝对路径 → 本地文件路径（Windows：file:///E:/a/b.png → E:/a/b.png）
export function fileUrlToPath(url) {
  let p = safeDecode((url || '').replace(/^file:\/\//i, ''))
  if (/^\/[a-zA-Z]:[\\/]/.test(p)) p = p.slice(1) // 去掉盘符前多余的 /
  else p = p.replace(/^\/+/, '')
  return p
}

// 渲染预览 HTML，并把图片（相对路径 / file:// 绝对路径）改写成 data URL（保证正确显示）
export async function renderPreview(text, docDir) {
  const html = md.render(text || '')
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const imgs = doc.querySelectorAll('img')
    for (const img of imgs) {
      const src = img.getAttribute('src') || ''
      if (!src || /^(https?:|data:|blob:)/i.test(src) || src.startsWith('#')) continue
      let abs = ''
      if (/^file:/i.test(src)) abs = fileUrlToPath(src)
      else if (docDir) abs = joinPath(docDir, safeDecode(src))
      if (!abs) continue
      try {
        const dataUrl = await window.md.readImage(abs)
        if (dataUrl) img.setAttribute('src', dataUrl)
      } catch (_) {}
    }
    return doc.body.innerHTML
  } catch (_) {
    return html
  }
}

// 把 Windows 绝对路径转成可在 file:// 页面中直接显示的 file URL。
// 只对会破坏 Markdown/URL 语法的字符（空格、括号、#、?、%）做百分号转义，
// 中文等非 ASCII 字符保留原样 —— 否则代码模式下中文路径会显示成一长串
// %E5%B7%A5%E4%BD%9C… 的「乱码」。Chromium 解析 file:// 时会自行处理非 ASCII。
export function toFileUrl(p) {
  const norm = (p || '').replace(/\\/g, '/').replace(/^\/+/, '')
  const enc = norm.replace(/[%#?()\s]/g, (c) =>
    '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')
  )
  return 'file:///' + enc
}

// 把 markdown 里相对图片路径转成 file:// 绝对路径，供编辑器（WYSIWYG/代码/预览）直接显示
export function toDisplayMarkdown(text, docDir) {
  if (!docDir) return text || ''
  let out = text || ''
  out = out.replace(/(!\[[^\]]*\]\()([^)\s]+)(\))/g, (m, pre, src, post) => {
    if (/^(https?:|data:|blob:|file:|#)/i.test(src)) return m
    const abs = joinPath(docDir, safeDecode(src))
    return pre + toFileUrl(abs) + post
  })
  out = out.replace(/(<img\b[^>]*\bsrc=")([^"]+)(")/gi, (m, pre, src, post) => {
    if (/^(https?:|data:|blob:|file:|#)/i.test(src)) return m
    const abs = joinPath(docDir, safeDecode(src))
    return pre + toFileUrl(abs) + post
  })
  return out
}

// 把 file:// 绝对路径还原为相对路径（基于文档目录），用于写回磁盘
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

// 把编辑器里的 file:// 绝对路径还原为相对路径，写回磁盘时保持标准相对引用
export function toStorageMarkdown(text, docDir) {
  if (!docDir) return text || ''
  let out = text || ''
  out = out.replace(/(!\[[^\]]*\]\()file:\/\/([^)\s]+)(\))/g, (m, pre, src, post) => {
    const rel = fileUrlToRelative('file://' + src, docDir)
    return rel === null ? m : pre + rel + post
  })
  out = out.replace(/(<img\b[^>]*\bsrc=")file:\/\/([^"]+)(")/gi, (m, pre, src, post) => {
    const rel = fileUrlToRelative('file://' + src, docDir)
    return rel === null ? m : pre + rel + post
  })
  return out
}
