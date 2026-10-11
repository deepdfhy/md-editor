// npm run set-repo -- owner/repo
// 把仓库地址一次性写进 package.json（repository / homepage / bugs）和 README 的 clone 行，
// 免得哥几个文件挨个手动改。
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const arg = process.argv.slice(2).join(' ').trim()
const m = arg.match(/([\w.-]+)\/([\w.-]+?)(?:\.git)?$/)
if (!m) {
  console.log('用法：npm run set-repo -- <用户名>/<仓库名>')
  console.log('例如：npm run set-repo -- junge/md-editor')
  process.exit(1)
}
const slug = m[1] + '/' + m[2]
const url = 'https://github.com/' + slug

// ---------- package.json ----------
const pkgPath = path.join(root, 'package.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
pkg.repository = { type: 'git', url: url + '.git' }
pkg.homepage = url + '#readme'
pkg.bugs = { url: url + '/issues' }
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8')
console.log('✓ package.json → ' + url)

// ---------- README ----------
const readmePath = path.join(root, 'README.md')
let readme = fs.readFileSync(readmePath, 'utf-8')
const before = readme
readme = readme.replace(/git clone https:\/\/github\.com\/[\w.-]+\/[\w.-]+\.git/, 'git clone ' + url + '.git')
if (readme !== before) {
  fs.writeFileSync(readmePath, readme, 'utf-8')
  console.log('✓ README.md → ' + url + '.git')
}

console.log('\n顺手记一下接下来两条命令：')
console.log('  git init && git add -A && git commit -m "first commit"')
console.log('  git branch -M main && git remote add origin ' + url + '.git && git push -u origin main')
