---
name: user-local-files
description: "Use when the user shares local files, indicated by `<|user_local_files` in the context. Includes local filesystem read/write guidelines and common tools."
---

# User Local File Handling Guidelines

## Core Principles
Browser agents cannot directly access arbitrary paths on the user's computer. The user must first share files or folders through the interface.

Use `browserAgent.shared.userLocalFiles[key]` to get the file object (Handle or Entry).

The `user_local_files` list is formatted as `- ${key}: ${object.constructor.name}`.

Values in `userLocalFiles` can only be one of these 4 types:
- FileSystemDirectoryHandle
- FileSystemFileHandle
- FileSystemDirectoryEntry
- FileSystemFileEntry

Parse and operate on each object according to its type.

For folders, do not start with a recursive read:
- First inspect only one or two directory levels to understand the structure
- When reading recursively, exclude directories such as `.git` and `node_modules` that contain large amounts of task-irrelevant content

Tips:
- You may load JavaScript libraries from CDNs to help process different file types
- If you are a multimodal model that can inspect images, you can `console.log(Blob)` to get visual feedback
- Compatibility: Safari's Entry interface does not show hidden files (`.xxx`)

## Write Operations
- User-shared `user_local_files` are read-only by default
- Only the Handle interface supports requesting `readwrite` permission. The Entry interface does not provide write access; generate the modified file as a Blob, trigger a download, and ask the user to overwrite the original manually
  - If many files are changed, package only the changed files into a zip using their relative paths, then ask the user to extract and merge them manually
- Before writing a file, confirm the target file and intended change. Show a simple dialog that explains the action and lets the user click to request `readwrite` permission
- Write permission can usually be reused within the same page; still call `queryPermission` or `requestPermission` before writing
- If write permission is definitely needed and the task is substantial, you can use parallel interaction to request permission early
  - When you are ready to write, check whether permission exists, whether the user has acted, and whether they agreed, then choose the appropriate path
- For interaction patterns, read the `interactive-webpage` skill before implementing them

## Git Repositories

When you need to inspect local git repository status, diffs, commit history, branches, or remotes, you can load the `BrowserGit` tool.

```js
if (!globalThis.BrowserGit) {
  (0, eval)(await fetch('https://raw.githubusercontent.com/on-panda/browser-agent-skills/main/skills/user-local-files/browser-git.js').then(r => r.text()))
}
const repo = browserAgent.shared.userLocalFiles['repo-dir']
const git = BrowserGit({ gitDir: repo })
browserAgent.local.git = git
await git.ready
console.log(await git.status())
```

`BrowserGit` only reads the working tree and `.git`. It is not the original git implementation, does not execute shell commands, does not access the network, and does not perform write operations such as commit, checkout, reset, or pull.

Supported read-only commands:

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

If additional git features are needed, you can implement them by referring to `browser-git.js`.

Safari may not support viewing hidden `.git` directories.
- If the user needs git-related functionality, explain the reason and recommend switching to desktop Chrome.
