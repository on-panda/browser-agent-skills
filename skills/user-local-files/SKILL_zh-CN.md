---
name: user-local-files
description: "当用户分享本地文件，即上下文中存在 `<|user_local_files` 时使用。本 skill 包含本地文件系统读写规范和常用工具。"
---

# 用户本地文件处理规范

## 基本原则
browser agent 不能直接访问用户电脑上的任意路径。只有用户通过界面上传文件或文件夹后，才能分享给你。

使用 `browserAgent.shared.userLocalFiles[key]` 获取文件对象（Handle 或 Entry）。

`user_local_files` 列表格式为 `- ${key}: ${object.constructor.name}`。

`userLocalFiles` 的值只可能是以下 4 种类型：
- FileSystemDirectoryHandle
- FileSystemFileHandle
- FileSystemDirectoryEntry
- FileSystemFileEntry

请根据对应的对象类型进行解析和操作。

对于文件夹，不要一上来就递归读取
- 请先只查看一两层目录，看看情况
- 递归读取时，记得排除 `.git`、`node_modules` 等包含大量任务无关内容的目录


提示：
- 可以加载 CDN 上的各色 JavaScript 库来协助处理各种类型的文件
- 如果你是支持查看图片的多模态模型，你可以通过 `console.log(Blob)` 来获得视觉反馈
- 兼容性：Safari 的 Entry 接口不会显示隐藏文件（`.xxx`）

## 写操作
- 用户上传的 `user_local_files` 默认只有读权限
- Handle 接口才支持请求 `readwrite` 权限。Entry 接口不提供写权限，需要把改好的文件生成 Blob，触发下载，并让用户去手动覆盖
  - 如果更改文件比较多，可以按相对路径打包一个仅包含更改文件的 zip 文件下载给用户，让用户解压并手动合并
- 写入文件前必须确认目标文件和修改意图，并写一个简易的弹窗告知用户信息，让用户点击，以请求 `readwrite` 权限。
- 写权限同一页面内通常可复用；写入前仍应通过 `queryPermission`/`requestPermission` 检查
- 如果确定要写权限且任务比较重，可以使用并行交互，在最开始就把写权限先申请上
  - 等你需要写的时候，再去看看有没有权限、用户有没有操作/是否同意，并做相应的方案
- 交互方案可以阅读 `interactive-webpage` skill 后实现

## Git 仓库

当你需要查看本地 Git 仓库状态、diff、提交记录、分支或远端信息时，可以加载 `BrowserGit` 工具。

```js
if (!globalThis.BrowserGit) {
  const src = await fetch('https://raw.githubusercontent.com/on-panda/browser-agent-skills/main/skills/user-local-files/browser-git.js').then(r => r.text())
  (0, eval)(src)
}
const repo = browserAgent.shared.userLocalFiles['repo-dir']
const git = BrowserGit({ gitDir: repo })
browserAgent.local.git = git
await git.ready
console.log(await git.status())
```

`BrowserGit` 只读取工作区和 `.git`，不是原版 Git，不执行 shell、不联网、不做 commit/checkout/reset/pull 等写操作。

支持的只读命令：

```js
await git.status()
await git.status('--short')
await git.diff()
await git.diff('--cached')
await git.diff('--stat')
await git.log('--oneline -n 10')
await git.show('HEAD --stat')
await git.show('HEAD:path/to/file')
await git.branch('-a')
await git.remote('-v')
```

如果有额外的 Git 功能需求，可以参考 `browser-git.js` 的代码自行实现。

Safari 可能不支持查看隐藏的 `.git` 目录。
- 如果用户有 Git 相关需求，告知用户原因并推荐用户切换桌面版 Chrome。
