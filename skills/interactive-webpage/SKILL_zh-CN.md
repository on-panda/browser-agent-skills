---
name: interactive-webpage
description: "当你需要创建网页和交互式交付物，或修改当前 UI 时使用。包含资源、指引和规范。"
---


# Browser JS 环境：可扩展的 Agent UI 和网页应用构建

## 背景
当前网页是一个基于 Vite + Vue3 的 LLM Agent UI，用户通过这个界面与你沟通。因此，不要替换整个 `document.body`。

这个网页承载了你的全部信息和上下文。如果网页刷新或切换，你的会话会中断，所有上下文都会丢失，就像网页中的变量一样。

你可以通过 JavaScript 读取和修改界面。

界面上展示的不只是内容，你的所有上下文也会直观呈现，包括系统提示词（system prompt）、工具 schema（tool schema）、工具调用（tool calls）、工具消息（tool message）和 reasoning。

UI 在你最新回复的下方提供了一个交互区域（interaction area）。

## 即时交互和异步交互
- 除了让用户直接在 chat 界面上和你沟通，你还可以选择通过新增 HTML 组件和用户进行即时交互或异步交互
- 即时交互是指你写一个组件，并在运行 JavaScript 的过程中一直 `await`，直到用户完成反馈，再通过 `console.log()` 拿到用户的交互结果。系统会在 JavaScript 返回后把结果作为工具消息（tool message）返还给你
    - 即时交互时，若用户太久没有操作，会导致工具调用（tool call）超时，系统会通过工具消息告诉你超时了
    - 超时后，你写的交互组件仍然存在，但 `console.log` 已无法再返回给你，记得关闭交互窗口
    - 超时之后你可以再来一次，或者选择使用异步交互
- 异步交互是指你的工具调用（tool calls）和 agentic loop 可能已经结束，然后用户交互后再自动给你发消息
    - 异步交互时，用户交互产生的 `console.log` 可能无法再通过工具消息返回给你
    - 请使用这个函数 `browserAgent.send({ text })` 来让你自己获得交互结果
        - `browserAgent` 变量只存在于你的 JavaScript 本地作用域（local scope）中，代表你自己；`browserAgent.send` 即给自己发送文本消息
- 还有另一种交互叫并行交互
    - 原理：你先搭建好交互组件，然后继续自己的 agentic loop；用户可以并行地和你的组件交互，而不打扰你
    - 此时的弹窗尽量不要遮挡主界面，用户的操作信息可以异步记录在 `browserAgent.local` 上
    - 等你需要交互结果的时候，再去看看用户的操作记录和结果，并做相应的方案
- 你可以把交付组件放入交互区域，也可以选择更加醒目的全局弹窗，请根据需求做出恰当选择
- 如果需要记录的数据量很大，可以记录在 `browserAgent.local` 这个对象里，供后续筛选查找
    - 你的多轮工具调用之间，共享一个独属于你的 `browserAgent.local`

## 交互区域（Interaction Area）
- 交互区域位于最新回复下方，是一个带 id 的 div
    - 用 `browserAgent.shared.uiRootElement.querySelector('#browser-agent-interaction-area')` 获取对应元素
- 交互区域初始状态是高度为 0，用户不可见的空 div，除非你添加了内容
- 交互区域可以容纳多个组件，推荐追加子 div，而不是覆盖 `innerHTML`
- 用户没有交互区域的概念，你可以说 “显示在了我的答复下方” 来指引用户


## iframe
- 如果需求是完整网页或独立应用，可以向交互区域追加 iframe 组件
- iframe 组件上方放一排控制按钮（根据需求可选全屏/新窗口、关闭、下载 等等）
    - 控制按钮行保持低调，和 iframe 网页风格一致，方便融入背景
```js
// 全屏方案：
iframe.requestFullscreen()

// 新窗口方案
openNewTabBtn.onclick = () => {
  const blob = new Blob([html], {type: 'text/html'});
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener,noreferrer');
};
```

## 大型项目

用 CDN 的 UMD 版 React / ReactDOM 创建大型项目。
JSX 用 Babel Standalone 在浏览器里转成 JavaScript。
把 React、ReactDOM、编译后的业务代码和 CSS 全部内联进一个 HTML，再挂载到 iframe 上。

如果需要构建大量文件，可以用 OPFS（Origin Private File System）路径在 `browserAgent/workspace` 下新建项目文件夹，再构建你的项目。


## 提示
- 如果你创作时需要用 `console.log` 获得反馈，确保所有 `console.log` 都会在主函数中被 `await`，并在主函数结束前执行；不要放在未 `await` 的 `.then()` 里
- 如果你是支持查看图片的多模态模型，可以把图片转换为 Blob，通过 `console.log(Blob)` 获得视觉反馈
- 创建悬浮的小组件时，推荐提供关闭方式，避免对当前 UI 的彻底遮挡
    - 如果用户有关闭后重新打开的需求，你还可以在交互区域内部保留一个打开按钮
- 当用户需要的是网页、独立应用等交互式交付物时，最后要提醒用户，你可以把对应交付物打包并自动下载到用户电脑
