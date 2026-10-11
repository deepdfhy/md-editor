import MiniSearch from 'minisearch'

// 中文友好的分词：拉丁字母/数字单词整体成词，CJK 单字各自成词。
// 这样“字段”“DIY”这类子串都能被检索到（MiniSearch 默认分词器会把中文整段当成一个 token）。
function tokenize(text) {
  const t = String(text == null ? '' : text).toLowerCase()
  const tokens = []
  const re = /[a-z0-9_]+|[\u4e00-\u9fff]/gi
  let m
  while ((m = re.exec(t)) !== null) tokens.push(m[0])
  return tokens
}

// 基于 MiniSearch 的标题+全文搜索。文档结构：{ id: path, name, title, body }
export function createSearch() {
  const ms = new MiniSearch({
    idField: 'id',
    fields: ['title', 'body', 'name'],
    storeFields: ['title', 'name', 'path'],
    tokenize,
    processTerm: (term) => term.toLowerCase(),
    searchOptions: {
      boost: { title: 3, name: 2 },
      prefix: true,
      fuzzy: 0.1,
      combineWith: 'AND'
    }
  })

  return {
    // docs: [{ id, name, title, body }]
    setDocs(docs) {
      ms.removeAll()
      if (docs && docs.length) {
        try {
          ms.addAll(docs)
        } catch (_) {
          /* 单条异常不应中断整体 */
        }
      }
    },
    // 返回 [{ path, name, title }] 或 null（空查询表示不筛选）
    search(query) {
      const q = (query || '').trim()
      if (!q) return null
      try {
        const res = ms.search(q)
        return res.map((r) => ({ path: r.path, name: r.name, title: r.title }))
      } catch (_) {
        return null
      }
    }
  }
}
