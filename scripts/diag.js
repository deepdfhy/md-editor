// 诊断脚本：用隐藏窗口加载 dist/index.html（真实 preload + 占位 IPC），
// 自动走一遍「选目录 → 打开文档 → 编辑器挂载（含 Prism 高亮插件）→ 切模式」，
// 捕获渲染进程异常，用于定位「打开空白」等问题。
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')

// 无 GPU 环境下避免渲染进程崩溃
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-software-rasterizer')
app.commandLine.appendSwitch('in-process-gpu')

const COVER_FILE = path.join(__dirname, '__diag_cover.png')
// 造一张 40x24 的真实 png，供聚合页封面用
;(function makeCover() {
  const b = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAACgAAAAYCAIAAAAH5iiXAAAAUUlEQVR4nGOUz3/NMBCAaUBsZWBgYIFQ5u7X6WblyZ2aA+ljplGL6QWY6GYTGhi1mG6AiX5WoYJRi+kGmOhnFSoYtZhugIl+Vo10ixlHXCsTAKmrBiOVmvkaAAAAAElFTkSuQmCC',
    'base64'
  )
  try {
    require('fs').writeFileSync(COVER_FILE, b)
  } catch (_) {}
})()

const ROOT = 'E:\\__diag_fake__'
const ROOT_BS = 'E:\\__diag_fake__'
const DEMO = ROOT + '\\demo.md'
const DEMO_MD = [
  '# 标题一',
  '',
  '正文段落，测试渲染，含行内代码 `const x = 1`。',
  '',
  '```js',
  '// 这是一个注释',
  "const a = 1;",
  "const s = 'hello 世界';",
  'function hi(x) { return x + a }',
  '```',
  '',
  '```python',
  'def add(a, b):',
  '    return a + b',
  '```',
  '',
  // 故意用大写语言名：Toast UI 插件是直接 prism.languages['PHP'] 取语言，
  // 大小写不兼容的话这个代码块就一点颜色都没有
  '```PHP',
  '<?php',
  "$name = '俊哥';",
  'echo "Hello $name";',
  '```',
  '',
  // 故意用一个 Prism 没有组件的语言名，看别名兜底（vue → markup）
  '```vue',
  '<template><div>{{ msg }}</div></template>',
  '```',
  '',
  '| 列1 | 列2 |',
  '| --- | --- |',
  '| a | b |',
  '',
  '![测试图](image/测试图片.jpg)',
  ''
].join('\n')

// 占位 IPC：返回假数据，让应用能完整跑通流程
ipcMain.handle('getConfig', () => ({
  recentDirs: [ROOT_BS, 'E:\\__diag_fake2__'],
  lastDir: ROOT_BS,
  lastActiveDir: ROOT_BS,
  ignore: { ignoreDot: true, ignoreDirs: ['node_modules', 'dist'], ignoreFiles: [] }
}))
ipcMain.handle('getDefaults', () => ({
  ignore: { ignoreDot: true, ignoreDirs: ['node_modules', 'dist'], ignoreFiles: [] }
}))
let lastCfg = null
ipcMain.handle('setConfig', (_e, cfg) => {
  lastCfg = cfg
  return true
})
ipcMain.handle('readTree', () => ({
  name: '__diag_fake__',
  path: ROOT_BS,
  root: true,
  children: [{ name: 'sub', path: ROOT_BS + '\\sub', children: [] }]
}))
const CSS_SRC = [
  '.app { color: #fff; }',
  '/* 注释 comment */',
  '.card > .title { font-weight: 700; }',
  '@media (max-width: 600px) { .app { padding: 0 } }',
  ''
].join('\n')
const NAV_MD = '# 我的导航\n\n聚合页说明。\n'
// 多类型：笔记 + 代码(css) + 图片 + 聚合页，验证第 2 列图标与第 3 列查看器/聚合页
ipcMain.handle('listFiles', () => [
  { name: 'demo.md', path: DEMO, mtime: Date.now(), size: DEMO_MD.length, ext: 'md', kind: 'note', isNav: false },
  {
    name: 'app.css',
    path: ROOT + '\\app.css',
    mtime: Date.now(),
    size: CSS_SRC.length,
    ext: 'css',
    kind: 'code',
    isNav: false
  },
  { name: 'pic.png', path: ROOT + '\\pic.png', mtime: Date.now(), size: 70, ext: 'png', kind: 'image', isNav: false },
  {
    name: '导航.nav.md',
    path: ROOT + '\\导航.nav.md',
    mtime: Date.now(),
    size: NAV_MD.length,
    ext: 'md',
    kind: 'note',
    isNav: true
  }
])
// 造足够多的分类，让顶部 Tab 条真的溢出（用于验证「隐藏滚动条 + 滚轮横扫 + 两端箭头」）
const MANY_CATS = []
for (let i = 1; i <= 11; i++) {
  const nm = '分类' + String(i).padStart(2, '0')
  MANY_CATS.push({
    name: nm,
    path: ROOT + '\\' + nm,
    notes: [
      {
        name: nm + '.md',
        path: ROOT + '\\' + nm + '\\' + nm + '.md',
        title: nm + '笔记',
        cover: '',
        coverAbs: '',
        mtime: Date.now(),
        size: 80,
        isNav: false
      }
    ]
  })
}
// 递归列表桩：在当前目录文件基础上加一个「子目录里的文档」，验证搜索能展示子目录命中
ipcMain.handle('listFilesDeep', () => [
  { name: 'demo.md', path: DEMO, relPath: 'demo.md', mtime: Date.now(), size: DEMO_MD.length, ext: 'md', kind: 'note', isNav: false },
  { name: 'sub-note.md', path: ROOT + '\\子目录\\sub-note.md', relPath: '子目录/sub-note.md', mtime: Date.now(), size: 120, ext: 'md', kind: 'note', isNav: false },
  { name: 'app.css', path: ROOT + '\\app.css', relPath: 'app.css', mtime: Date.now(), size: CSS_SRC.length, ext: 'css', kind: 'code', isNav: false }
])
ipcMain.handle('scanNotes', () => ({
  dir: ROOT,
  uncategorized: [
    {
      name: 'demo.md',
      path: DEMO,
      title: '标题一',
      cover: 'image/测试图片.jpg',
      // 指向真实存在的图片文件，验证「封面图」链路（左边这张应加载出来）
      coverAbs: COVER_FILE,
      mtime: Date.now(),
      size: 100,
      isNav: false
    }
  ],
  categories: [
    {
      name: 'sub',
      path: ROOT + '\\sub',
      notes: [
        { name: 'a.md', path: ROOT + '\\sub\\a.md', title: '子目录A', cover: '', coverAbs: '', mtime: Date.now(), size: 60, isNav: false },
        { name: 'b.md', path: ROOT + '\\sub\\b.md', title: '子目录B', cover: '', coverAbs: '', mtime: Date.now(), size: 60, isNav: false }
      ]
    },
    ...MANY_CATS
  ]
}))
ipcMain.handle('createNavDoc', (_e, dir, name) => path.join(dir, String(name) + '.nav.md'))
ipcMain.handle('readFile', (e, p) => {
  const s = String(p)
  if (s.includes('导航.nav.md')) return NAV_MD
  if (s.endsWith('.css')) return CSS_SRC
  // 其它笔记（含子目录里的）都返回同一份带 H1/代码块/图片的正文，供弹窗预览验证
  if (/\.md$/i.test(s)) return DEMO_MD
  return ''
})
ipcMain.handle('writeFile', () => true)
// 返回 1x1 透明 PNG 的 data URL，验证预览/PDF 的图片内联链路
ipcMain.handle('readImage', () => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=')
const copyState = { calls: 0, last: '' }
ipcMain.handle('copyText', (_e, t) => {
  copyState.calls++
  copyState.last = String(t == null ? '' : t)
  return true
})
ipcMain.handle('exportPdf', () => null)
ipcMain.handle('openFolder', () => null)
// 版本检测：假装线上有 0.2.0（比当前新），用来验证提示条与跳转链路
let openedExternal = ''
ipcMain.handle('getAppInfo', () => ({
  version: '0.1.10',
  repo: 'demo/md-editor',
  packaged: false
}))
ipcMain.handle('checkUpdate', () => ({
  ok: true,
  repo: 'demo/md-editor',
  tag: 'v0.2.0',
  version: '0.2.0',
  name: 'v0.2.0',
  url: 'https://github.com/demo/md-editor/releases/tag/v0.2.0',
  publishedAt: '',
  body: '',
  current: '0.1.10',
  hasUpdate: true
}))
ipcMain.handle('openExternal', (_e, url) => {
  openedExternal = String(url || '')
  return true
})
ipcMain.on('watchDir', () => {})
ipcMain.on('unwatchDir', () => {})
ipcMain.on('flushConfig', (_e, cfg) => {
  if (cfg) lastCfg = cfg
})
ipcMain.on('logDebug', () => {})

const errors = []

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, '..', 'electron', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.webContents.on('console-message', (_e, level, message) => {
    // level: 0=verbose 1=info 2=warning 3=error
    if (level >= 3) {
      errors.push(message)
      console.log('[ERROR]', message)
    } else {
      console.log('[log:' + level + ']', String(message).split('\n')[0].slice(0, 160))
    }
  })
  win.webContents.on('render-process-gone', (_e, d) => console.log('[render-process-gone]', JSON.stringify(d)))
  win.webContents.on('did-fail-load', (_e, code, desc, url) => console.log('[did-fail-load]', code, desc, url))

  try {
    await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  } catch (e) {
    console.log('[loadFile-error]', e && e.message)
  }

  const res = await win.webContents.executeJavaScript(`(async () => {
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const out = { steps: [] };
    const q = (s) => document.querySelector(s);

    for (let i = 0; i < 50 && !q('.tree .node'); i++) await wait(100);
    out.treeNodes = document.querySelectorAll('.tree .node').length;
    const node = q('.tree .node');
    if (node) node.click();
    await wait(800);

    for (let i = 0; i < 50 && !q('.fl-item'); i++) await wait(100);
    out.fileItems = document.querySelectorAll('.fl-item').length;
    const item = q('.fl-item');
    if (item) item.click();
    await wait(2500);

    out.tabs = document.querySelectorAll('.tab').length;
    out.proseMirror = !!q('.ProseMirror');
    out.epEditor = !!q('.ep-editor');
    out.editorChars = (q('.toastui-editor-contents') ? q('.toastui-editor-contents').textContent.length : -1);
    out.codeHighlighted = !!q('.toastui-editor-contents .token');
    out.wwCodeBlock = document.querySelectorAll('.toastui-editor-ww-code-block').length;
    out.wwCopyBtn = document.querySelectorAll('.ww-copy').length;
    // dump 所见即所得容器里的代码块真实 DOM 结构，确认包装类名
    const anc = (el, n) => {
      const a = [];
      let e = el;
      while (e && e !== document.body && a.length < n) {
        a.push(e.tagName + '.' + (e.className || ''));
        e = e.parentElement;
      }
      return a;
    };
    out.wwContainers = document.querySelectorAll('.toastui-editor-ww-container').length;
    out.wwProseMirror = !!q('.toastui-editor-ww-container .ProseMirror');
    const wwPre = q('.toastui-editor-ww-container .ProseMirror pre') || q('.ProseMirror pre');
    out.wwPreHtml = wwPre ? wwPre.outerHTML.slice(0, 260) : null;
    out.wwPreParents = wwPre ? anc(wwPre, 5) : null;
    out.wwPreParentChildren = wwPre && wwPre.parentElement
      ? Array.from(wwPre.parentElement.children).map((c) => c.tagName + '.' + (c.className || ''))
      : null;
    out.wwAllClasses = (() => {
      const set = new Set();
      document.querySelectorAll('.toastui-editor-ww-container *').forEach((el) => {
        (el.className || '').toString().split(/\\s+/).forEach((c) => { if (c && /code|pre|lang/i.test(c)) set.add(c); });
      });
      return Array.from(set);
    })();

    out.wwImgSrc = (() => { const i = q('.toastui-editor-ww-container img'); return i ? i.getAttribute('src') : null; })();

    // ---- 代码高亮是否「真的有色」：光有 .token 节点不够，还要看计算出来的颜色 ----
    const cs = (el) => (el ? getComputedStyle(el).color : null);
    const tokenSel = '.toastui-editor-ww-code-block-highlighting ';
    const kw = q(tokenSel + '.token.keyword');
    out.tokenKeywordText = kw ? kw.textContent : null;
    out.tokenKeywordColor = cs(kw);
    const str = q(tokenSel + '.token.string');
    out.tokenStringColor = cs(str);
    const cmt = q(tokenSel + '.token.comment');
    out.tokenCommentColor = cs(cmt);
    out.tokenTotal = document.querySelectorAll(tokenSel + '.token').length;
    const preEl = q('.toastui-editor-ww-code-block-highlighting pre');
    out.wwCodeBg = preEl ? getComputedStyle(preEl).backgroundColor : null;
    // 逐个代码块统计：语言名 + token 数（验证大写语言名 / 别名兜底是否也高亮）
    out.perBlock = Array.from(document.querySelectorAll('.toastui-editor-ww-container pre')).map((p) => ({
      lang: p.getAttribute('class') || '',
      dataLang: (p.querySelector('code') || {}).getAttribute
        ? p.querySelector('code').getAttribute('data-language')
        : null,
      tokens: p.querySelectorAll('.token').length,
      sample: (p.textContent || '').replace(/\\s+/g, ' ').slice(0, 46)
    }));
    // 代码块内部的 <code> 不该自带背景/内边距，否则会盖住 pre 的底色（行内代码才需要）
    const innerCode = preEl ? preEl.querySelector('code') : null;
    out.wwInnerCodeBg = innerCode ? getComputedStyle(innerCode).backgroundColor : null;
    out.wwInnerCodePad = innerCode ? getComputedStyle(innerCode).paddingLeft : null;
    const inlineCode = q('.toastui-editor-contents p code');
    out.inlineCodeBg = inlineCode ? getComputedStyle(inlineCode).backgroundColor : null;

    // ---- 代码块复制按钮：应每个代码块一枚且可见 ----
    const fbs = Array.from(document.querySelectorAll('.copy-btn.ww-copy-float'));
    out.wwPreCount = document.querySelectorAll('.toastui-editor-ww-container pre').length;
    out.wwFloatCount = fbs.length;
    out.wwFloatTexts = fbs.map((b) => b.textContent.trim());
    out.wwFloatVisible = fbs.map((b) => getComputedStyle(b).display !== 'none');
    out.wwFloatOpacity = fbs.map((b) => getComputedStyle(b).opacity);
    out.wwFloatRects = fbs.map((b) => {
      const r = b.getBoundingClientRect();
      return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
    });
    // 命中测试：按钮所在坐标上最顶层的元素是不是按钮自己（防止被编辑器盖住）
    out.wwFloatHit = fbs.map((b) => {
      const r = b.getBoundingClientRect();
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return el ? el.tagName + '.' + (el.className || '') : null;
    });
    // 真的点一下第一个「复制」，看是否走到了剪贴板 IPC、文案是否变成「已复制」
    if (fbs[0]) {
      fbs[0].click();
      await wait(300);
      out.wwFloatTextAfterClick = fbs[0].textContent.trim();
      await wait(1300);
      out.wwFloatTextAfterReset = fbs[0].textContent.trim();
    }

    // ---- 所见即所得下「编辑代码块」后高亮会不会丢 ----
    const firstPre = q('.toastui-editor-ww-container pre');
    out.editTokenBefore = firstPre ? firstPre.querySelectorAll('.token').length : -1;
    if (firstPre) {
      const target = firstPre.querySelector('code') || firstPre;
      const range = document.createRange();
      range.selectNodeContents(target);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('insertText', false, ' ');
      await wait(600);
      out.editTokenDuring = firstPre.querySelectorAll('.token').length;
      out.editPreDuring = firstPre.outerHTML.slice(0, 120);
      // 光标在代码块里时，Toast UI 会额外浮出一个「可编辑语言名」的控件
      const lw = q('.toastui-editor-code-block-language');
      if (lw) {
        const lr = lw.getBoundingClientRect();
        out.langWidgetWhileFocused = [Math.round(lr.left), Math.round(lr.top), Math.round(lr.right), Math.round(lr.bottom)];
        out.langWidgetWhileFocusedCss = {
          position: getComputedStyle(lw).position,
          right: getComputedStyle(lw).right,
          left: getComputedStyle(lw).left,
          inlineLeft: lw.style.left,
          inlineTop: lw.style.top
        };
        out.langWidgetWhileFocusedHtml = lw.outerHTML.slice(0, 220);
      } else {
        out.langWidgetWhileFocused = null;
      }
      // 点走焦点，看插件会不会重新高亮
      const outside = q('.toastui-editor-ww-container p') || q('.topbar');
      if (outside) outside.click();
      await wait(900);
      const again = q('.toastui-editor-ww-container pre');
      out.editTokenAfterBlur = again ? again.querySelectorAll('.token').length : -1;
      out.editPreAfterBlur = again ? again.outerHTML.slice(0, 160) : null;
    }

    // ---- 量一下 Toast UI 语言控件/徽标的真实几何，用来给复制按钮让位 ----
    const rectOf = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)];
    };
    const langEl = q('.toastui-editor-code-block-language');
    out.langWidgetRect = rectOf(langEl);
    out.langWidgetCss = langEl
      ? {
          position: getComputedStyle(langEl).position,
          right: getComputedStyle(langEl).right,
          left: getComputedStyle(langEl).left,
          width: getComputedStyle(langEl).width
        }
      : null;
    out.langWidgetHtml = langEl ? langEl.outerHTML.slice(0, 200) : null;
    out.firstPreRect = rectOf(q('.toastui-editor-ww-container pre'));
    out.wwContainerRect = rectOf(q('.toastui-editor-ww-container'));
    out.badgeAfterStyle = (() => {
      const p = q('.toastui-editor-ww-code-block-highlighting');
      if (!p) return null;
      const s = getComputedStyle(p, '::after');
      return { content: s.content, right: s.right, top: s.top, padding: s.padding, height: s.height, fontSize: s.fontSize, fontWeight: s.fontWeight };
    })();

    // ---- 切换目录下拉：历史项 + 删除按钮 ----
    const swBtn = q('.col1-switch');
    out.switchBtnExists = !!swBtn;
    if (swBtn) {
      swBtn.click();
      await wait(250);
      out.switchItems = document.querySelectorAll('.switch-menu .switch-item:not(.add)').length;
      out.switchDelBtns = document.querySelectorAll('.switch-menu .switch-del').length;
      // 点第一项的删除按钮，数量应变少
      const del = q('.switch-menu .switch-del');
      if (del) {
        del.click();
        await wait(250);
        out.switchItemsAfterDel = document.querySelectorAll('.switch-menu .switch-item:not(.add)').length;
      }
      swBtn.click();
      await wait(150);
      out.switchMenuClosed = !q('.switch-menu');
    }

    // ---- 设置中心 ----
    const setBtn = Array.from(document.querySelectorAll('.topbar .btn')).find((b) =>
      b.textContent.includes('设置')
    );
    out.settingsBtnExists = !!setBtn;
    if (setBtn) {
      setBtn.click();
      await wait(300);
      out.settingsOpen = !!q('.settings');
      const dot = q('.settings .set-check input');
      out.settingsDotChecked = dot ? dot.checked : null;
      const tas = document.querySelectorAll('.settings .set-textarea');
      out.settingsTextareaCount = tas.length;
      out.settingsDirsValue = tas[0] ? tas[0].value.replace(/\\s+/g, '|') : null;
      out.settingsFilesValue = tas[1] ? tas[1].value : null;
      // 改一下开关再保存，验证写回链路不报错
      if (dot) {
        dot.checked = false;
        dot.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const saveBtn = Array.from(document.querySelectorAll('.settings-foot .recycle-btn')).find(
        (b) => b.textContent.trim() === '保存'
      );
      out.settingsSaveBtnExists = !!saveBtn;
      if (saveBtn) {
        saveBtn.click();
        await wait(600);
      }
      out.settingsClosedAfterSave = !q('.settings');
    }

    const btns = Array.from(document.querySelectorAll('.ep-modes button'));
    const byText = (t) => btns.find(b => b.textContent.trim() === t);
    if (byText('代码')) {
      byText('代码').click();
      await wait(1500);
      out.codeModeOk = true;
      // 代码模式里应显示「可读的中文路径」，而不是 %E6%B5%8B 这种百分号编码。
      // 0.1.7 起代码模式改用自绘 textarea（.ep-source），不再走 CodeMirror。
      const ta = q('.ep-source');
      out.sourceElFound = !!ta;
      out.sourceVisible = ta ? getComputedStyle(ta).display !== 'none' : false;
      out.editorHiddenInCode = q('.ep-editor') ? getComputedStyle(q('.ep-editor')).display === 'none' : null;
      const cmText = ta ? ta.value : '';
      out.cmTextLen = cmText.length;
      out.cmHasChinese = /测试图片/.test(cmText);
      out.cmHasPercentEscape = /%E[0-9A-Fa-f]{2}/.test(cmText);
      const m = cmText.match(/!\\[[^\\]]*\\]\\(([^)]+)\\)/);
      out.cmImgRef = m ? m[1] : null;
      out.cmTextSample = cmText.replace(/\\s+/g, ' ').slice(0, 260);
      // 在代码模式里改一个字，验证改动能同步回所见即所得
      if (ta) {
        ta.value = cmText + '\\n\\n源码模式改动验证。';
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(500);
      }
      out.sourceEdited = ta ? ta.value.length : 0;
    }
    if (byText('预览')) {
      byText('预览').click();
      await wait(1500);
      out.previewPre = document.querySelectorAll('.ep-preview pre').length;
      out.previewCopyBtn = document.querySelectorAll('.ep-preview .copy-btn').length;
      const pi = q('.ep-preview img');
      out.previewImgSrcHead = pi ? String(pi.getAttribute('src')).slice(0, 24) : null;
      // 预览模式（highlight.js）也必须有颜色
      const pk = q('.ep-preview .hljs-keyword') || q('.ep-preview .hljs-title') || q('.ep-preview code span');
      out.previewTokenColor = pk ? getComputedStyle(pk).color : null;
      out.previewTokenClass = pk ? pk.className : null;
      const pp = q('.ep-preview pre');
      out.previewCodeBg = pp ? getComputedStyle(pp).backgroundColor : null;
    }
    if (byText('所见即所得')) {
      byText('所见即所得').click();
      await wait(1500);
      out.backWwOk = true;
      // 代码模式里加的那句话，切回所见即所得后应该还在
      out.backWwHasEdit = (q('.toastui-editor-contents') || { textContent: '' })
        .textContent.includes('源码模式改动验证');
      // 模拟鼠标移到 WYSIWYG 代码块上，验证悬浮「复制」按钮出现
      const wwPre = q('.toastui-editor-ww-container .ProseMirror pre');
      out.wwPreFound = !!wwPre;
      if (wwPre) {
        const r = wwPre.getBoundingClientRect();
        wwPre.dispatchEvent(new MouseEvent('mousemove', {
          bubbles: true, clientX: r.left + 5, clientY: r.top + 5
        }));
        await wait(300);
        const fb = q('.copy-btn.ww-copy-float');
        out.wwFloatBtnExists = !!fb;
        out.wwFloatBtnVisible = fb ? getComputedStyle(fb).display !== 'none' : false;
        out.wwFloatBtnText = fb ? fb.textContent : null;
      }
    }

    out.topbar = !!q('.topbar');

    // ---- 浅色 / 深色主题切换 ----
    const bgOf = (s) => {
      const el = q(s);
      return el ? getComputedStyle(el).backgroundColor : null;
    };
    const tkOf = (s) => {
      const el = q(s);
      return el ? getComputedStyle(el).color : null;
    };
    const themeSnap = () => ({
      attr: document.documentElement.getAttribute('data-theme'),
      localStorage: (() => {
        try { return localStorage.getItem('md-theme'); } catch (e) { return 'ERR'; }
      })(),
      bodyBg: bgOf('body'),
      topbarBg: bgOf('.topbar'),
      editorBg: bgOf('.toastui-editor-defaultUI'),
      wwCodeBg: bgOf('.toastui-editor-ww-code-block-highlighting pre'),
      tokenKeywordColor: tkOf('.toastui-editor-ww-code-block-highlighting .token.keyword'),
      tokenStringColor: tkOf('.toastui-editor-ww-code-block-highlighting .token.string'),
      // Toast UI 的深色皮肤靠这个类生效，浅色下必须没有
      darkClass: !!q('.toastui-editor-dark'),
      proseMirror: !!q('.ProseMirror'),
      textLen: (q('.toastui-editor-contents') || { textContent: '' }).textContent.length
    });
    out.themeDark = themeSnap();
    const themeBtn = q('.theme-toggle');
    out.themeBtnExists = !!themeBtn;
    if (themeBtn) {
      themeBtn.click();
      await wait(700);
      out.themeLight = themeSnap();
      // 切回深色，后面的截图仍以深色为主
      themeBtn.click();
      await wait(700);
      out.themeBackToDark = themeSnap();
    }

    // ---- 新版本检测（主进程 IPC 被打桩成「有一个新版本」） ----
    out.updateBarBefore = !!q('.update-bar');
    out.updateBarShown = false;
    {
      const setBtn2 = Array.from(document.querySelectorAll('.topbar .btn')).find((b) =>
        b.textContent.includes('设置')
      );
      if (setBtn2) {
        setBtn2.click();
        await wait(400);
        out.settingsThemeSeg = Array.from(document.querySelectorAll('.settings .seg button')).map((b) =>
          b.textContent.trim()
        );
        const repoInput = q('.settings .set-input');
        out.settingsRepoInput = repoInput ? repoInput.value : null;
        const chk = Array.from(document.querySelectorAll('.settings .recycle-btn')).find((b) =>
          b.textContent.includes('检查更新')
        );
        out.settingsCheckBtn = !!chk;
        if (chk) { chk.click(); await wait(800); }
        // 关掉设置面板再看顶部的更新提示条
        const closeBtn = q('.settings .recycle-close');
        if (closeBtn) { closeBtn.click(); await wait(400); }
      }
      out.updateBarShown = !!q('.update-bar');
      out.updateBarText = q('.update-text') ? q('.update-text').textContent.replace(/\\s+/g, ' ').trim() : null;
      const goBtn = q('.update-bar .update-btn');
      out.updateGoBtnText = goBtn ? goBtn.textContent.trim() : null;
      if (goBtn) { goBtn.click(); await wait(400); }
    }

    // ---- 第 2 列：按类型的图标是否渲染出来了 ----
    const items = Array.from(document.querySelectorAll('.fl-item'));
    out.flNames = items.map((i) => i.querySelector('.fl-name').textContent.trim());
    out.flIcons = items.map((i) => {
      const s = i.querySelector('svg[class*="fl-ic-"]');
      return s ? s.getAttribute('class') : null;
    });
    out.flPinMarks = document.querySelectorAll('.fl-item .fl-pin').length;

    // ---- 只读查看器：打开 css（应有 Prism 高亮 + 行号） ----
    const byName = (n) => items.find((i) => i.querySelector('.fl-name').textContent.trim() === n);
    const cssItem = byName('app.css');
    if (cssItem) {
      cssItem.click();
      await wait(900);
      out.viewerShown = !!q('.viewer');
      out.vpName = q('.vp-name') ? q('.vp-name').textContent.trim() : null;
      out.vpBadge = q('.vp-badge') ? q('.vp-badge').textContent.trim() : null;
      out.vpLang = q('.vp-lang') ? q('.vp-lang').textContent.trim() : null;
      out.vpTokenCount = document.querySelectorAll('.vp-pre .token').length;
      out.vpLineCount = document.querySelectorAll('.vp-gutter .vp-ln').length;
      const kw = q('.vp-pre .token.selector') || q('.vp-pre .token.tag');
      out.vpTokenColor = kw ? getComputedStyle(kw).color : null;
      out.vpPreBg = q('.vp-pre') ? getComputedStyle(q('.vp-pre')).backgroundColor : null;
      // 点一下「复制内容」，验证走通剪贴板
      const cp = Array.from(document.querySelectorAll('.vp-btn')).find((b) => b.textContent.includes('复制内容'));
      out.vpCopyBtnExists = !!cp;
      if (cp) { cp.click(); await wait(250); }
      out.vpCopyBtnTextAfter = cp ? cp.textContent.trim() : null;
    }

    // ---- 只读查看器：打开图片（应渲染 <img>） ----
    const pngItem = byName('pic.png');
    if (pngItem) {
      pngItem.click();
      await wait(900);
      out.imgViewerShown = !!q('.vp-image-wrap');
      const im = q('.vp-image');
      out.imgSrcHead = im ? String(im.getAttribute('src')).slice(0, 24) : null;
      out.imgNaturalW = im ? im.naturalWidth : -1;
    }

    // ---- 聚合页：打开 .nav.md 应渲染卡片墙 + 分类 Tab ----
    const navItem = byName('导航.nav.md');
    if (navItem) {
      navItem.click();
      await wait(1200);
      out.navShown = !!q('.navpage');
      out.navTitle = q('.np-title') ? q('.np-title').textContent.trim() : null;
      out.navTabs = Array.from(document.querySelectorAll('.np-tab')).map((b) => b.textContent.trim());
      out.navCardCount = document.querySelectorAll('.np-card').length;
      out.navCardTitles = Array.from(document.querySelectorAll('.np-card-title')).map((e) => e.textContent.trim());
      out.navGroupTitles = Array.from(document.querySelectorAll('.np-group-title')).map((e) => e.textContent.trim());
      out.navCoverImgs = document.querySelectorAll('.np-cover img').length;
      out.navPlaceholders = document.querySelectorAll('.np-cover-ph').length;
      out.navTabIcon = !!q('.tab-ic');
      // 聚合页可以在「卡片视图 / 源文件」之间切换
      out.navSwitchBtns = Array.from(document.querySelectorAll('.nav-view-switch button')).map((b) =>
        b.textContent.trim()
      );
      const srcBtn = Array.from(document.querySelectorAll('.nav-view-switch button')).find(
        (b) => b.textContent.trim() === '源文件'
      );
      if (srcBtn) { srcBtn.click(); await wait(1400); }
      out.navEditMode = {
        editor: !!q('.ep-editor'),
        navGone: !q('.navpage'),
        text: (q('.toastui-editor-contents') || { textContent: '' }).textContent.replace(/\\s+/g, ' ').slice(0, 16)
      };
      const cardBtn = Array.from(document.querySelectorAll('.nav-view-switch button')).find(
        (b) => b.textContent.trim() === '卡片视图'
      );
      if (cardBtn) { cardBtn.click(); await wait(700); }
      out.navBackToCards = !!q('.navpage');

      // ---- Tab 条：不应有浏览器默认滚动条（占 0 高度），要有滚轮横扫 + 两端箭头 ----
      const tabsStrip = q('.np-tabs');
      out.navTabsGeometry = tabsStrip
        ? {
            clientW: tabsStrip.clientWidth,
            scrollW: tabsStrip.scrollWidth,
            overflows: tabsStrip.scrollWidth > tabsStrip.clientWidth + 1,
            // 隐藏滚动条时不会有额外高度；默认横向滚动条会占 ~15px
            scrollbarHeight: tabsStrip.offsetHeight - tabsStrip.clientHeight
          }
        : null;
      out.navTabsArrows = {
        left: !!q('.np-tabs-arrow.l'),
        right: !!q('.np-tabs-arrow.r'),
        leftDisabled: q('.np-tabs-arrow.l') ? q('.np-tabs-arrow.l').disabled : null,
        rightDisabled: q('.np-tabs-arrow.r') ? q('.np-tabs-arrow.r').disabled : null
      };
      if (tabsStrip) {
        const before = tabsStrip.scrollLeft;
        // cancelable 事件 + defaultPrevented：验证滚轮监听不是 passive（否则 preventDefault 无效，
        // 在 Tab 条上滚轮会穿透去滚整个卡片区）
        const wev = new WheelEvent('wheel', { deltaY: 200, bubbles: true, cancelable: true });
        tabsStrip.dispatchEvent(wev);
        await wait(300);
        out.navWheelScroll = { before, after: tabsStrip.scrollLeft, prevented: wev.defaultPrevented };
        const arrowR = q('.np-tabs-arrow.r');
        if (arrowR) {
          arrowR.click();
          // 平滑滚动由动画帧驱动，隐藏窗口里可能被节流，多采样几次
          await wait(600);
          const s1 = tabsStrip.scrollLeft;
          await wait(1500);
          const s2 = tabsStrip.scrollLeft;
          await wait(2000);
          out.navArrowScroll = { at600: s1, at2100: s2, at4100: tabsStrip.scrollLeft, rightDisabledNow: arrowR.disabled };
        }
        // 滚回开头，方便截图时看到第一组 Tab
        tabsStrip.scrollLeft = 0;
        await wait(400);
      }

      // ---- 卡片大小滑块 ----
      const range = q('.np-range');
      out.navRangeExists = !!range;
      out.navRangeRange = range ? [range.min, range.max, range.value] : null;
      const cardW = () => {
        const c = q('.np-card');
        if (!c) return null;
        const r = c.getBoundingClientRect();
        const cover = c.querySelector('.np-cover');
        return {
          w: Math.round(r.width),
          h: Math.round(r.height),
          coverH: cover ? Math.round(cover.getBoundingClientRect().height) : null,
          cols: (getComputedStyle(q('.np-grid')).gridTemplateColumns || '').split(' ').length
        };
      };
      out.navCardDefault = cardW();
      if (range) {
        range.value = String(Number(range.max));
        range.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(500);
        out.navCardMax = cardW();
        range.value = String(Number(range.min));
        range.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(500);
        out.navCardMin = cardW();
        // 双击滑块恢复默认
        range.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        await wait(500);
        out.navCardAfterDblclick = cardW();
        range.value = '240';
        range.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(900); // 等防抖写盘（500ms）
      }

      // 切到「sub」分类，卡片数应变为 2
      const tabSub = Array.from(document.querySelectorAll('.np-tab')).find((b) => b.textContent.includes('sub'));
      if (tabSub) { tabSub.click(); await wait(600); }
      out.navCardsAfterTab = document.querySelectorAll('.np-card').length;
      out.navGroupsAfterTab = document.querySelectorAll('.np-group').length;

      // ---- 单击卡片 → 弹窗预览（不再是直接开标签） ----
      const tabsBefore = document.querySelectorAll('.tab').length;
      const card = q('.np-card');
      if (card) { card.click(); await wait(1800); }
      out.npvShown = !!q('.npv');
      out.npvTitle = q('.npv-title') ? q('.npv-title').textContent.trim() : null;
      out.npvMeta = q('.npv-meta') ? q('.npv-meta').textContent.trim() : null;
      out.npvBtns = Array.from(document.querySelectorAll('.npv-btn')).map((b) => b.textContent.trim());
      out.npvBodyHtml = !!q('.npv-doc');
      out.npvH1 = q('.npv-doc h1') ? q('.npv-doc h1').textContent.trim() : null;
      out.npvImgSrc = (() => {
        const i = q('.npv-doc img');
        return i ? String(i.getAttribute('src')).slice(0, 22) : null;
      })();
      out.npvMaskNotFull = !q('.npv.full');
      out.npvTabsUnchanged = document.querySelectorAll('.tab').length === tabsBefore;

      // 全屏按钮
      const fullBtn = Array.from(document.querySelectorAll('.npv-btn')).find((b) => b.textContent.includes('全屏'));
      if (fullBtn) { fullBtn.click(); await wait(400); }
      out.npvFull = {
        cls: !!q('.npv.full'),
        maskPadding: getComputedStyle(q('.npv-mask')).padding,
        btnText: Array.from(document.querySelectorAll('.npv-btn')).map((b) => b.textContent.trim()).find((t) => t.includes('全屏'))
      };
      // Esc：全屏状态下按一次只退出全屏，弹窗还在
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await wait(300);
      out.npvAfterEsc1 = { open: !!q('.npv'), full: !!q('.npv.full') };
      // 再按一次 Esc：这次应关掉弹窗
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await wait(300);
      out.npvAfterEsc2 = { open: !!q('.npv') };

      // ---- 弹窗里「新窗打开」→ 应以正式标签打开该笔记 ----
      if (q('.np-card')) { q('.np-card').click(); await wait(1500); }
      const openTabBtn = Array.from(document.querySelectorAll('.npv-btn')).find((b) =>
        b.textContent.includes('新窗打开')
      );
      out.npvOpenBtnExists = !!openTabBtn;
      if (openTabBtn) { openTabBtn.click(); await wait(1800); }
      out.navAfterOpenTab = {
        modalGone: !q('.npv'),
        editor: !!q('.ep-editor'),
        tabs: document.querySelectorAll('.tab').length,
        tabsBefore,
        activeTabName: q('.tab.active .tab-name') ? q('.tab.active .tab-name').textContent.trim() : null
      };
    }

    return out;
  })()`)

  console.log('[result]', JSON.stringify(res, null, 1))
  console.log('[copyText] calls=' + copyState.calls + ' len=' + copyState.last.length)
  console.log('[copyText.head]', JSON.stringify(copyState.last.replace(/\s+/g, ' ').slice(0, 80)))
  console.log('[setConfig] navCardSize=' + (lastCfg ? lastCfg.navCardSize : 'null') + ' theme=' + (lastCfg ? lastCfg.theme : 'null'))
  console.log('[openExternal] ' + openedExternal)
  console.log('[errorCount]', errors.length)

  // 截图存证：肉眼确认代码高亮 / 复制按钮的实际观感
  const shot = async (name) => {
    try {
      const img = await win.webContents.capturePage()
      const buf = img.toPNG()
      require('fs').writeFileSync(path.join(__dirname, name), buf)
      console.log('[shot] scripts/' + name, buf.length, 'bytes')
    } catch (e) {
      console.log('[shot] ' + name + ' failed:', e && e.message)
    }
  }
  const drive = (js) => win.webContents.executeJavaScript(js).catch(() => {})

  // 先回到 demo.md（前面点过聚合页卡片，当前可能停在别的笔记上），
  // 再显式切到「所见即所得」并多等一会：无头窗口的首帧可能滞后
  await drive(`(async()=>{
    const it=Array.from(document.querySelectorAll('.fl-item')).find(i=>i.querySelector('.fl-name').textContent.trim()==='demo.md');
    if(it){ it.click(); await new Promise(r=>setTimeout(r,1600)); }
    const b=Array.from(document.querySelectorAll('.ep-modes button')).find(x=>x.textContent.trim()==='所见即所得');
    if(b) b.click();
    await new Promise(r=>setTimeout(r,1500));
    return 1;
  })()`)
  await shot('_shot.png')

  // 再补一张「预览」模式（同样有高亮 + 复制按钮）
  await drive(`(async()=>{
    const b=Array.from(document.querySelectorAll('.ep-modes button')).find(x=>x.textContent.trim()==='预览');
    if(b) b.click();
    await new Promise(r=>setTimeout(r,1500));
    return 1;
  })()`)
  await shot('_shot-preview.png')

  // 回到所见即所得，免得影响后面的截图
  await drive(`(async()=>{
    const b=Array.from(document.querySelectorAll('.ep-modes button')).find(x=>x.textContent.trim()==='所见即所得');
    if(b) b.click();
    await new Promise(r=>setTimeout(r,1200));
    return 1;
  })()`)

  // 切换目录下拉（含删除按钮）
  await drive(`(async()=>{
    const b=document.querySelector('.col1-switch'); if(!b) return 0;
    b.click(); await new Promise(r=>setTimeout(r,400)); return 1;
  })()`)
  await shot('_shot-switch.png')

  // 设置中心
  await drive(`(async()=>{
    document.body.click();
    await new Promise(r=>setTimeout(r,200));
    const b=Array.from(document.querySelectorAll('.topbar .btn')).find(x=>x.textContent.includes('设置'));
    if(!b) return 0;
    b.click(); await new Promise(r=>setTimeout(r,500)); return 1;
  })()`)
  await shot('_shot-settings.png')

  // 关闭设置后：打开 css 查看器（只读 + 高亮）
  await drive(`(async()=>{
    const mask = document.querySelector('.recycle-mask');
    if (mask) mask.click();
    await new Promise(r=>setTimeout(r,300));
    const it = Array.from(document.querySelectorAll('.fl-item')).find(i=>i.querySelector('.fl-name').textContent.trim()==='app.css');
    if(!it) return 0;
    it.click(); await new Promise(r=>setTimeout(r,900)); return 1;
  })()`)
  await shot('_shot-viewer-css.png')

  // 打开图片查看器
  await drive(`(async()=>{
    const it = Array.from(document.querySelectorAll('.fl-item')).find(i=>i.querySelector('.fl-name').textContent.trim()==='pic.png');
    if(!it) return 0;
    it.click(); await new Promise(r=>setTimeout(r,900)); return 1;
  })()`)
  await shot('_shot-viewer-image.png')

  // 打开聚合页（卡片墙）
  await drive(`(async()=>{
    const it = Array.from(document.querySelectorAll('.fl-item')).find(i=>i.querySelector('.fl-name').textContent.trim()==='导航.nav.md');
    if(!it) return 0;
    it.click(); await new Promise(r=>setTimeout(r,1200)); return 1;
  })()`)
  await shot('_shot-nav.png')

  // 卡片大小拉到最大：验证滑动调节真的改变卡片尺寸
  await drive(`(async()=>{
    const r = document.querySelector('.np-range');
    if(!r) return 0;
    r.value = r.max;
    r.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(x=>setTimeout(x,700));
    return 1;
  })()`)
  await shot('_shot-nav-big.png')

  // 卡片大小拉到最小：一屏能看到更多卡片
  await drive(`(async()=>{
    const r = document.querySelector('.np-range');
    if(!r) return 0;
    r.value = r.min;
    r.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(x=>setTimeout(x,700));
    return 1;
  })()`)
  await shot('_shot-nav-small.png')

  // 取消分类 Tab（回到「全部」）+ 滑回默认大小，再单击卡片打开预览弹窗
  await drive(`(async()=>{
    const r = document.querySelector('.np-range');
    if (r) { r.value='180'; r.dispatchEvent(new Event('input',{bubbles:true})); }
    const t = document.querySelector('.np-tab');
    if (t) t.click();
    await new Promise(x=>setTimeout(x,700));
    const c = document.querySelector('.np-card');
    if(!c) return 0;
    c.click(); await new Promise(x=>setTimeout(x,1800)); return 1;
  })()`)
  await shot('_shot-nav-modal.png')

  // 弹窗全屏
  await drive(`(async()=>{
    const b = Array.from(document.querySelectorAll('.npv-btn')).find(x=>x.textContent.includes('全屏'));
    if(!b) return 0;
    b.click(); await new Promise(x=>setTimeout(x,600)); return 1;
  })()`)
  await shot('_shot-nav-modal-full.png')

  // 关掉弹窗，切到浅色主题，补几张浅色截图
  await drive(`(async()=>{
    const c = document.querySelector('.npv-mask');
    if (c) { c.click(); await new Promise(x=>setTimeout(x,400)); }
    const t = document.querySelector('.theme-toggle');
    if (!t) return 0;
    if (document.documentElement.getAttribute('data-theme') !== 'light') t.click();
    await new Promise(x=>setTimeout(x,900));
    return document.documentElement.getAttribute('data-theme');
  })()`)
  await shot('_shot-light-nav.png')

  // 浅色下的编辑器（带代码高亮 + 复制按钮）
  await drive(`(async()=>{
    const it = Array.from(document.querySelectorAll('.fl-item')).find(i=>i.querySelector('.fl-name').textContent.trim()==='demo.md');
    if(it){ it.click(); await new Promise(r=>setTimeout(r,1600)); }
    const b=Array.from(document.querySelectorAll('.ep-modes button')).find(x=>x.textContent.trim()==='所见即所得');
    if(b) b.click();
    await new Promise(r=>setTimeout(r,1400));
    return 1;
  })()`)
  await shot('_shot-light.png')

  // 浅色下的聚合页卡片墙
  await drive(`(async()=>{
    const it = Array.from(document.querySelectorAll('.fl-item')).find(i=>i.querySelector('.fl-name').textContent.trim()==='导航.nav.md');
    if(!it) return 0;
    it.click(); await new Promise(r=>setTimeout(r,1400)); return 1;
  })()`)
  await shot('_shot-light-nav-cards.png')

  app.quit()
})
