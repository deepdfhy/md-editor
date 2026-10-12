# MD 编辑器

一款面向**代码笔记**的 Windows 桌面 Markdown 编辑器。4 列布局：目录树 / 文件列表 / 编辑器 / 大纲，笔记直接以 `.md` 文件存在你自己的文件夹里，不搞私有格式、不锁定数据。

> 下载：[最新版本](../../releases/latest) → 下载 `MD 编辑器 Setup x.y.z.exe`，双击安装即可。
>
> - 首次安装可以自己选择安装目录
> - 以后升级会自动识别上次的安装目录并原地覆盖，不会装出多个副本
> - 升级时如果程序还在运行，安装器会提示「强制关闭并继续安装」

## 功能

**编辑**
- 所见即所得 / 代码 / 预览 三种模式随时切换；代码模式直接显示磁盘原文（中文路径不会被转成 `%E6%B5%8B` 那种乱码）
- 代码块语法高亮（Prism，One Dark / One Light 两套配色）、每块一个「复制」按钮、语言徽标与复制按钮排成一行
- 图片粘贴即存到笔记同级目录，磁盘里始终写相对路径
- 大纲导航、Ctrl+S 保存、1200ms 防抖自动保存、切标签前兜底落盘

**多文件类型**
- 第 2 列列出目录下的**全部文件**：笔记（可编辑）、图片（带缩放预览）、代码 / 文本（只读高亮 + 行号 + 复制）
- 全文检索只索引笔记正文，附件按文件名一起搜

**标签页**
- 单击文件 = 临时标签（再点别的会替换），双击 = 固定标签；切标签自动把当前项滚进可视区

**聚合页（卡片式笔记汇总）**
- 任意目录右键「新建聚合页」得到一个 `xxx.nav.md`，打开就是卡片墙：自动汇总本目录 + 各直接子目录的笔记，自动取首个 H1 当标题、第一张图当封面
- 按分类 Tab 切换、卡片大小可滑动调节、单击卡片弹窗预览（可全屏 / 在新标签页打开）

**其它**
- 归档 / 回收站（可恢复、可彻底删除）
- 导出 PDF、右键复制路径、置顶常用笔记
- 忽略规则（`.git`、`node_modules` 这类目录不进树、不进搜索）
- 浅色 / 深色主题（Ctrl+Shift+L），设置与打开过的目录都记在 `%APPDATA%/md-editor/config.json`
- 启动时静默检查新版本，有更新就在顶部提示并跳转 GitHub 发布页

## 开发

```bash
git clone https://github.com/deepdfhy/md-editor.git
cd md-editor
npm install
npm run dev:all     # vite + electron 一起起来，改代码热更新
```

## 打包

只出**安装包（NSIS）**，不再出绿色版。自定义安装逻辑在 `build/installer.nsh`：
- 全新安装 → 显示目录选择页，可自定义安装目录
- 已安装过 → 读注册表 `InstallLocation` 复用原目录，跳过安装模式页与目录页，原地覆盖
- 覆盖安装检测到程序在运行 → 弹窗可选「强制关闭并继续安装」（先 WM_CLOSE，不退再强杀）

```bash
npm run build                                        # 先构建前端
npx electron-builder --win nsis                      # 安装包 → release/
```

**发新版**：改 `package.json` 的 `version` → `git commit` → `git tag v0.1.13` → `git push --tags`，
GitHub Actions（`.github/workflows/release.yml`）会自动构建并作为 Release 附件上传。

## 自检脚本

| 脚本 | 覆盖 |
|---|---|
| `scripts/t-ignore.cjs` | 忽略规则解析 / 通配 / 大小写 / 不误伤 |
| `scripts/t-scan.cjs` | 真实临时目录的目录树与多类型文件列举 |
| `scripts/t-main.cjs` | 打桩 electron 后加载真实 `electron/main.js`，直接测它注册的 IPC |
| `scripts/t-files.cjs` | 文件类型判定、聚合页扫描、标题与封面提取 |
| `scripts/t-update.cjs` | 版本号比较、GitHub Release 解析与各种异常分支 |
| `scripts/diag.js` | 无头 Electron 加载真实构建产物跑完整界面流程，输出 JSON + 截图 |

## 技术栈

Electron + Vue 3 + Vite + Toast UI Editor + markdown-it + highlight.js + Prism + MiniSearch + DOMPurify

## 许可

MIT
