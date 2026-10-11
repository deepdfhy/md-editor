// 导出 PDF 用的 HTML 构建：把 Markdown 渲染成「浅色 + 代码高亮」的独立文档。
// 代码高亮样式复用 highlight.js 的 atom-one-light 主题（以字符串内联，不污染应用暗色主题）。
import hljsLightCss from 'highlight.js/styles/atom-one-light.css?inline'
import { renderPreview } from './markdown.js'

// 打印用正文样式（浅色，接近 GitHub 排版），带分页保护
const PRINT_CSS = `
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: system-ui, 'Microsoft YaHei', -apple-system, 'Segoe UI', sans-serif;
  color: #24292f;
  line-height: 1.75;
  font-size: 14px;
}
@page { margin: 16mm 14mm; }
h1, h2, h3, h4, h5, h6 { color: #111; line-height: 1.3; margin: 18px 0 10px; page-break-after: avoid; }
h1 { font-size: 25px; border-bottom: 1px solid #e1e4e8; padding-bottom: 6px; }
h2 { font-size: 20px; border-bottom: 1px solid #eaecef; padding-bottom: 4px; }
h3 { font-size: 17px; }
h4 { font-size: 15px; }
p { margin: 9px 0; }
a { color: #0969da; text-decoration: none; }
code {
  font-family: 'Cascadia Code', Consolas, 'Courier New', monospace;
  background: #f0f1f3; padding: 1px 5px; border-radius: 3px;
  font-size: 12.5px; color: #b31d28;
}
pre {
  background: #f6f8fa; border: 1px solid #e1e4e8; border-radius: 6px;
  padding: 12px 14px; overflow: auto; margin: 10px 0; page-break-inside: avoid;
}
pre code { background: none; padding: 0; color: inherit; font-size: 12.5px; }
blockquote {
  border-left: 3px solid #d0d7de; padding: 4px 14px; color: #57606a;
  background: #f6f8fa; margin: 10px 0;
}
table { border-collapse: collapse; margin: 10px 0; width: 100%; }
th, td { border: 1px solid #d0d7de; padding: 6px 10px; }
th { background: #f6f8fa; }
img { max-width: 100%; page-break-inside: avoid; }
ul, ol { padding-left: 24px; margin: 9px 0; }
hr { border: none; border-top: 1px solid #e1e4e8; margin: 16px 0; }
`

// 生成完整的 PDF 源 HTML（图片会被 renderPreview 转成 data URL，保证 PDF 内可见）
export async function buildPdfHtml(markdown, docDir) {
  const body = await renderPreview(markdown || '', docDir)
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>MD 编辑器导出</title>
<style>${hljsLightCss}</style>
<style>${PRINT_CSS}</style>
</head>
<body>${body}</body>
</html>`
}
