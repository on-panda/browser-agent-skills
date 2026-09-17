---
name: onpanda-docs
description: "当用户询问 onPanda 或要求你管理 API 配置时使用。本 skill 包含 onPanda 的介绍和源代码等内容"
---

# onPanda 文档 skill

## 资源
- 源代码: https://github.com/on-panda/on-panda
  - 源代码里面的 README.md 更具备文档价值
- 不适合放在 README.md 的开发文档: https://github.com/on-panda/on-panda-docs/blob/main/content/en/README.md

## API 管理
- i18n 里面有面向用户讲解如何配置 API 的说明，其 key 是 `editLocalStorageApiConfigsInstructions`
  - https://github.com/on-panda/on-panda/blob/main/src/i18n/locales/en-US.js
- API 控制参数源代码: https://github.com/on-panda/on-panda/blob/main/src/stores/controlParameterState.js
  - localStorage.getItem('onPandaApiConfigsJson5') 存储

注意：
- 在处理 api_key 的时候，尽量让其保留在内存或者 localStorage 中，不要明文出现在你的 context 里面（避免 print 出来、或者读取到你的 tool response 里面）
  - 做好脱敏处理，要展示的话，只展示前后几位 `"api_key": "ak-onP********Key"`
- 处理 config 和 api_key 的时候一定要小心翼翼，三思而行。指令不清晰，或者对自己的行为不确定的情况，请询问用户获得清晰的指引。
