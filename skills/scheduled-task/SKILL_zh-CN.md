---
name: scheduled-task
description: 当 browser agent 需要自主启动或定时任务时使用。包含工具、页面保活策略。
---

# 自主启动与定时任务

当用户为 browser agent 设置自主启动、定时任务、周期任务、到点执行、长时间等待后继续执行时，agent 需要启用保活流程。

## 立即告知用户

启用定时任务后，agent 必须告诉用户：

```txt
此任务依赖当前浏览器页面运行。请尽量保持 Agent 标签页在前台，不要关闭页面、切换到其他标签页、最小化窗口、锁屏、合盖或让电脑睡眠，否则任务可能暂停或延迟。
```

如果运行在 Chrome 中，可以补充：

```txt
建议固定此标签页，并将本站加入 Chrome 的 “Always keep these sites active”。
```

## 防止误关页面

定时任务存在时，agent 必须启用 `beforeunload`。

```js
let keepAliveMode = false;

function beforeUnloadHandler(event) {
  if (!keepAliveMode) return;
  event.preventDefault();
  event.returnValue = "";
}

function enableKeepAliveMode() {
  keepAliveMode = true;
  window.addEventListener("beforeunload", beforeUnloadHandler);
}

function disableKeepAliveMode() {
  keepAliveMode = false;
  window.removeEventListener("beforeunload", beforeUnloadHandler);
}
```

任务结束后必须调用 `disableKeepAliveMode()`。

## 检测页面离开前台

agent 使用 `visibilitychange` 判断页面是否进入后台。

```js
let hiddenWarningTimer = null;

document.addEventListener("visibilitychange", () => {
  if (!keepAliveMode) return;

  if (document.visibilityState === "hidden") {
    persistAgentState("hidden");

    hiddenWarningTimer = setTimeout(() => {
      if (keepAliveMode && document.visibilityState === "hidden") {
        notifyUserToReturn();
      }
    }, 8000);
  }

  if (document.visibilityState === "visible") {
    clearTimeout(hiddenWarningTimer);
    hiddenWarningTimer = null;

    persistAgentState("visible");
    resumeScheduledTasks();
  }
});
```

agent 不要猜测 hidden 的具体原因。切换标签页、最小化、锁屏、合盖都可能表现为 hidden。

## 提醒用户切回页面

页面 hidden 一段时间后，agent 可以通过浏览器通知提醒用户。

```js
async function notifyUserToReturn() {
  if (!("Notification" in window)) return;

  if (Notification.permission === "default") {
    await Notification.requestPermission();
  }

  if (Notification.permission !== "granted") return;

  const notification = new Notification("Agent 任务可能暂停", {
    body: "请切回 Agent 标签页，保持定时任务继续运行。",
    requireInteraction: true,
  });

  notification.onclick = () => {
    window.focus();
  };
}
```

通知文案只说页面不在前台，不要声称知道用户做了什么：

```txt
Agent 页面已不在前台，任务可能暂停。请切回 Agent 标签页。
```

## 页面恢复后继续任务

页面重新 visible 时，agent 必须恢复任务，并根据真实时间补跑已经到期的任务。

```js
function resumeScheduledTasks() {
  reconcileDueTasks();
}

function reconcileDueTasks() {
  const now = Date.now();
  const dueTasks = loadTasksDueBefore(now);

  for (const task of dueTasks) {
    runTask(task);
  }
}
```

不要假设 `setTimeout` 或 `setInterval` 一直准时运行。

## 检测长时间暂停

agent 可以用 heartbeat 判断运行时是否暂停过。

```js
let lastTickAt = Date.now();

setInterval(() => {
  const now = Date.now();
  const gap = now - lastTickAt;

  if (gap > 60_000) {
    persistAgentState("runtime-paused");
    reconcileDueTasks();
  }

  lastTickAt = now;
}, 10_000);
```

## 最小流程

当 browser agent 启用定时任务时：

```js
enableKeepAliveMode();
persistAgentState("scheduled-task-enabled");
notifyUserAboutKeepAliveRequirement();
```

之后 agent 必须持续处理：

```txt
hidden  -> 保存状态，延迟提醒用户切回
visible -> 取消提醒，恢复并补跑任务
unload  -> 提醒用户不要误关
paused  -> 恢复后按真实时间补跑
```

browser agent 不能保证网页永远运行。它只能尽量保活、提醒用户，并在恢复后继续任务。

```
