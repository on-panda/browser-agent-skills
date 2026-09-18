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

Important:

- Before performing any API management operation, read `editLocalStorageApiConfigsInstructions`.
- When handling `api_key`, keep it in runtime memory or `localStorage` whenever possible. Do not expose it as plain text in your context (for example, by printing it or including it in a tool response).
  - Redact it properly. If it must be displayed, show only its beginning and end, for example: `"api_key": "ak-onP********Key"`.
- Handle configuration with great care. Before writing, read the existing configuration to avoid overwriting it. If the instruction is unclear or you are unsure about an action, ask the user for clear guidance.
- After modifying the API configuration, always tell the user to click the “Refresh model list” button in the Control Parameters section or refresh the webpage so the new configuration takes effect.
