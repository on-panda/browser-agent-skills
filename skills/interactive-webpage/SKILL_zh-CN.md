---
name: interactive-webpage
description: "当你需要创建网页和交互 artifacts，或者修改当前 UI 的时候使用，包含资源、指引和规范"
---


# Browser JS Environment — Extensible Agent UI and Building Web App
## 背景
The current webpage is a Vite + Vue3-based LLM Agent UI, through which the user communicates with you. So do not replace the entire `document.body`.

This webpage contains all of your information and context; if the webpage is refreshed or switched, your session is interrupted, and all context will be lost, just like variables in the webpage.

You can read and modify the interface through JavaScript.
不止是 content，你的所有 context 都会直观的展示在界面上，包括 system prompt、 tool scheme、tool calls、 tool message、reasoning

the UI 提供了 interaction area 位于你最新的 response 下面

## 即时交互和异步交互
- 除了让用户直接在 chat 界面上和你沟通，你还可以选择通过新增 HTML 组件和用户进行即时交互或异步交互
- 即时交互就是你写一个组件，并在运行 js 的过程中，一直 await 到用户完成反馈，并通过 console.log() 拿到用户的交互结果，系统会在 js return 后作为 tool message 返还给你
    - 即时交互时，若用户太久没有操作，会导致 tool call 超时，系统会通过 tool message 告诉你超时了
    - 超时后，你写的交互组件仍然存在，但 console.log 已无法再返回给你，记得关闭交互窗口
    - 超时之后你可以再来一次，或者选择使用异步交互
- 异步交互就是你的 tool calls 和 agentic loop 可能已经结束了，然后用户交互后再自动给你发消息
    - 异步交互时，用户交互产生的 console.log 可能无法再通过 tool message 返回给你
    - 请使用这个函数 `browserAgent.send({ text })` 来让你自己获得交互结果
        - browserAgent 变量只存在你 JS local scope 里面，代表你自己，`browserAgent.send` 即给自己发送 text 消息
- 还有另一种交互叫并行交互
    - 原理：你早早的搭建好了交互组件，然后继续自己的 agentic loop，用户可以并行的和你的组件交互，而不打扰你
    - 此时的弹窗尽量不要遮挡主界面，用户的操作信息可以异步记录在 `browserAgent.local` 上
    - 等你需要交互结果的时候，再去看看用户的操作记录和结果，并做相应的方案
- 你可以把交付组件放入 interaction area，也可以选择更加醒目的全局弹窗，根据需求做出恰当选择即可
- 如果需要记录的数据量很大，你可以记录在 `browserAgent.local` 这个 Object 里面，供后续筛选查找
    - 你的多轮 tool call 间，共享一个独属于你的 `browserAgent.local`

## Interaction Area
- interaction area 位于最新的 response 下方，是一个带 id 的 div
    - 用 `browserAgent.shared.uiRootElement.querySelector('#browser-agent-interaction-area')` 来获取对应的 element
- interaction area 初始状态是高度为 0，用户不可见的空 div，除非你添加了内容
- interaction area 可以容纳多个组件，推荐 append child div，而不是覆盖 innerHTML
- 用户没有 interaction area 的概念，你可以说 “显示在了我的答复下方” 来指引用户


## iframe
- 如果需求是完整的网页/独立的 App，可以在 Interaction Area append iframe 组件
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

用 CDN 的 UMD 版 React / ReactDOM 来创建大型项目
JSX 用 Babel Standalone 在浏览器里转成 JS
把 React、ReactDOM、编译后的业务代码、CSS 全部内联进一个 HTML，挂靠在 iframe 上

如果需要构建超多文件，可以用 OPFS (Origin Private File System) 路径在 'browserAgent/workspace' 下新建你的项目文件夹，再构建你的项目


## Tips
- 如果你创作的时候需要 console.log 来获得反馈，确保所有 console.log 都会被 await 在主函数中，在主函数结束前执行；不要放在 un-awaited .then() 里面
- 如果你是支持查看图片的多模态模型，你可以把图片转换为 Blob, 通过 console.log(Blob) 来获得视觉反馈
- 创建悬浮的小组件时，推荐提供关闭方式，避免对当前 UI 的彻底遮挡
    - 如果用户有关闭了再重新打开的需求，你还可以在 interaction area 内部 appendix 一个打开按钮
- 用户需要的是网页/独立的 App 等交互物的时候，最后要提醒用户，你可以把对应交付物打包并自动下载到用户电脑
