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
  - 配置存储在 localStorage.getItem('onPandaApiConfigsJson5')

注意：

- 在执行任何 API 管理操作前，必须先阅读 `editLocalStorageApiConfigsInstructions`。
- 处理 `api_key` 时，尽量将其保留在运行时内存或 `localStorage` 中。不要让它以明文出现在你的上下文里（例如打印出来，或读入工具响应）。
  - 做好脱敏处理。如必须展示，只显示开头和结尾，例如：`"api_key": "ak-onP********Key"`。
- 处理配置时务必谨慎。写入前先读取现有配置，避免覆盖原有配置。如果指令不清晰或你不确定某个操作，请向用户询问明确指引。
- 每次修改 API 配置后，都要告知用户点击控制参数中的“刷新模型列表”按钮，或刷新网页，以使新配置生效。
