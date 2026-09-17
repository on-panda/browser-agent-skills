---
name: onpanda-docs
description: "Use when the user asks about onPanda or asks you to manage API configuration. This skill contains information about onPanda, its source code, and related resources."
---

# onPanda Documentation Skill

## Resources

- Source code: https://github.com/on-panda/on-panda
  - The README.md in the source repository provides more useful documentation.
- Development documentation that is not suitable for README.md: https://github.com/on-panda/on-panda-docs/blob/main/content/en/README.md

## API Management

- The i18n files contain user-facing instructions for configuring APIs. The relevant key is `editLocalStorageApiConfigsInstructions`.
  - https://github.com/on-panda/on-panda/blob/main/src/i18n/locales/en-US.js
- Source code for API control parameters: https://github.com/on-panda/on-panda/blob/main/src/stores/controlParameterState.js
  - Stored in `localStorage` under `onPandaApiConfigsJson5`; access it with `localStorage.getItem('onPandaApiConfigsJson5')`.

Note:

- When handling `api_key`, keep it in memory or `localStorage` whenever possible. Do not expose it in your context in plain text (for example, by printing it or reading it into a tool response).
  - Redact it properly. If it must be displayed, show only the beginning and end, for example: `"api_key": "ak-onP********Key"`.
- Handle `config` and `api_key` with great care. If the instruction is unclear or you are uncertain about an action, ask the user for clear guidance.
