---
name: interactive-webpage
description: "当你需要创建网页和交互 artifacts，或者修改当前 UI 的时候使用。包含资源、指引和规范"
---


# Browser JS Environment — Extensible Chat UI and Building Web App
## 背景
The current webpage is a Vite + Vue3-based LLM chat UI, through which the user communicates with you. This webpage contains all of your information and context; if the webpage is closed, your session is interrupted, and all context will be lost, just like variables in the webpage. So do not replace the entire `document.body`.

You can read and modify the interface through JavaScript.
不止是 content，你的所有 context 都会直观的展示在界面上，包括 system prompt、 tool scheme、tool calls、 tool message、reasoning

the Chat UI 提供了 interaction area、iframe 依次位于你最新的 response 下面

## 即时交互和异步交互
- 你可以选择和用户进行即时交互和异步交互
- 即时交互就是你写一个组件，并在运行 js 的过程中，await 到用户完成反馈，并 console.log() 用户的结果
    - 即时交互时，若用户太久没有操作会超时，系统就会告诉你超时了
    - 超时了 log 就无法再返回给你，记得关闭窗口；之后可以再来一次，或者选择使用异步交互
- 异步交互就是你的 tool calls 和 agentic loop 已经结束了，然后用户交互后再自动给你发消息
    - 使用这个函数 browserAgent.notify({ text })
        - browserAgent 变量只存在你 JS local scope 里面，代表你自己，`browserAgent.notify` 即给自己发送 text 消息

## Interaction Area
- interaction area 位于最新的 response 下方，是一个带 class 的 div `<div class="browser-agent-interaction-area"></div>`
- interaction area 初始状态是用户不可见是的高度为 0 的空内容，除非你添加了内容
- 你可以在这个 div 里面添加任何东西
    - 比如用户没有指定位置，也不是适用于 iframe 的完整页面应用，就可以放在 `".browser-agent-interaction-area"` 里面
- interaction area 可以容纳多个组件，推荐 append child div，而不是覆盖 innerHTML
- 用户没有 interaction area 的概念，你可以通过说 “实现在了我的答复下方” 来指引用户


## iframe
- 如果


## Tips
- 如果你创作的时候需要 console.log 来获得反馈，确保所有 console.log 都会被 await 在主函数中，在主函数结束前执行；不要放在 un-awaited .then() 里面
- 如果你支持查看图片，你可以把图片转换为 Blob, 通过 console.log(Blob) 来获得视觉反馈
- 创建悬浮的小组件时，推荐提供关闭方式，避免对当前 UI 的彻底遮挡
    - 如果用户有关闭了再重新打开的需求，你还可以在 interaction area 内部 appendix 一个打开按钮
