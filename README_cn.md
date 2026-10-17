# ⚡ browser-harness: your browser is the harness
> 免安装、点开即用、天然沙盒 —— 最轻便、最性感的浏览器原生 Agent 运行环境。

👉 **[立即体验 Live Demo](https://onpanda.diyer22.com/?example=browser-agent)**

---

## 🔥 为什么需要 browser-harness？

测试或使用 Agent 时，你是否厌倦了配环境、`npm install`、手动切换模型和 effort，或者担心 Agent 把本地系统搞乱？

**browser-harness** 将完整的 Agent 运行时直接搬进了你的浏览器。它无需任何后端环境部署，却打破了传统网页的次元壁——集 **本地文件读写、信息搜集、界面实时渲染、多媒体与硬件 I/O、持久记忆** 于一体。

### ✨ 核心亮点 (Why Hackers Love It)

* 🛡️ **Zero-Install & 天然沙盒**：告别环境配置地狱，点开链接即刻运行；基于浏览器原生安全边界，授权可控，大胆放手让 Agent 干活。
* 👁️ **所见即所得的“视觉自省闭环”**：告别手动打开和管理 HTML/SVG 的繁琐。Agent 在浏览器内直接渲染页面或图像、自己截屏观察、自我反思并多轮迭代。
* 📂 **拖拽即打通本地文件与 Git 仓库**：利用现代浏览器能力，只需把本地文件夹或代码仓库拖入窗口，Agent 即可直接查看和整理文件、Review 甚至修改未提交的代码。
* ⚡ **大模型“体感摸底”神器**：功能接口齐全、UI 交互直观、配置随时切换，是测试模型在复杂组合任务中 Agentic 表现的最佳试验场。

---

## 🎮 它能做什么？（7 个硬核 Showcase）

你可以单点调用，也可以自由组合以下能力，压测模型的能力极限：

### 1. 实时渲染与视觉自省 (Render, See & Iterate)
* **生成并迭代视觉作品**：`用 render_svg 绘制“鹈鹕骑自行车”的 SVG 图像，并自己观察画面迭代 3 次。`
* **搜集信息并构建完整网页**：`搜索 StepFun 最新主力模型的信息，然后直接实现一个苹果官网风格的介绍网页。`
* **打破宿主 UI 边界**：`今天天气如何？直接实现一个带动效的天气小卡片，挂载在当前页面右下角。`

### 2. 多模态视觉与硬件直连 (Multimodal & WebAPI)
* **调用摄像头与视觉加工**：`调用摄像头给我拍张照，你边看照片边裁剪让头像居中，再画一个贴合双眼的墨镜，做成大头贴让我下载。`
* **论文视觉审美与排版锐评**：`查看这篇论文第一页的截图，评价图 1 的设计和配色：https://arxiv.org/pdf/2401.00036`

### 3. 本地文件与代码仓库接管 (Local File & Repo Hacking)
> 💡 *仅需将本地文件夹或代码库拖拽至浏览器窗口授权即可，安全可控*
* **直接 Review 并修 Bug**：`Review 我拖进来的这个 repo 中未 commit 的改动，如果有 Bug 请直接帮我修改保存。`
* **本地知识库自动化整理**：`整理这个文件夹内的所有 PDF 文件，按主题归类并移入对应的子文件夹，最后生成一个 index.html 汇总所有文档信息。`

---

## 🛠️ 适用场景

* **极速模型体感测试（Vibe Check）**：无需写胶水代码，快速验证大模型在多步工具调用、视觉反馈和代码生成上的真实水平。
* **零负担临时 Agent 工作台**：随时随地打开浏览器处理文件整理、网页原型生成、文档分析等任务。
* **Agent 技能扩展与实验**：基于轻量化架构，快速验证和组合新的浏览器端 Agent Skills。

---

## 🔗 开源与资源

* 🌐 **在线体验 Demo**：[点击直接运行 browser-harness](https://onpanda.diyer22.com/?example=browser-agent)
* 📦 **核心代码仓库**：[GitHub - Core Repository](https://github.com/on-panda/on-panda)
* 🧩 **Agent 技能库**：[GitHub - browser-agent-skills](https://github.com/on-panda/browser-agent-skills)