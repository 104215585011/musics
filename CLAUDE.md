# Claudio FM — Claude Agent 入口

## 第一件事：确认你的角色

本项目有两个 Claude agent，职责不同。**开始任何工作之前，先确认你是谁，再读对应的文件。**

### Claude1 — 产品经理（PM）
```
立即读取：CLAUDE1-PM.md
```

### Claude2 — UI 总监
```
立即读取：CLAUDE2-UI.md
```

读完再动手。角色文件定义了你的职责、工作流程、操作记录规范和不可越权事项。

---

## 项目概览

**Claudio FM** 是一个本地优先的 AI 个人电台，由三层构成：

| 层 | 技术 | 入口 |
|----|------|------|
| 前端 (PWA) | 原生 HTML / CSS / JS | `index.html` |
| 后端 (Hub) | Node.js HTTP + WebSocket | `server/server.js` |
| 桌面壳 (Electron) | Electron 33 | `electron-main.js` |

核心服务位于 `server/services/`，音乐提供商位于 `server/providers/`。

---

## 开工流程

每次新会话，按顺序执行：

1. 读 `claude-progress.md` — 了解当前已验证状态和未完成功能
2. 读 `feature_list.json` — 确认下一个 `in_progress` 功能
3. 读 `session-handoff.md` — 了解上一轮遗留的风险和注意事项
4. 运行 `npm test` — 确认基础测试通过，再动代码

如果测试失败，先修测试，不在坏的基础上叠新功能。

---

## 标准命令

```bash
# 安装依赖
npm install

# 启动后端服务（默认 http://localhost:3000）
npm start          # 或 npm run dev

# 启动 Electron 桌面端（需先启动后端）
npm run desktop

# 运行所有测试
npm test
# 等价于：
node tests/script.test.js && node tests/server.test.js && node tests/api.test.js
```

---

## 关键路径速查

| 关注点 | 路径 |
|--------|------|
| 主样式（含 Electron 专属块） | `styles.css` |
| 客户端逻辑 | `script.js`, `app.js`, `api.js` |
| Electron 主进程 | `electron-main.js` |
| Electron 预加载 | `preload.js` |
| 后端路由 | `server/routes/claudio.js` |
| AI 聊天路由 | `server/services/chat-router.js` |
| 流媒体服务 | `server/services/stream.js` |
| NetEase 音乐提供商 | `server/providers/music/ncma.js` |
| AI brain (AICODEE) | `server/providers/brain/aicodee.js` |
| 用户个性化文件 | `user/` 目录 |
| Electron 专属 CSS | `styles.css` 中 `body.is-electron` 块 |

---

## 工作规则

### 范围纪律
- **同一时间只做一个功能**，`feature_list.json` 里只能有一个 `in_progress`
- 发现旁路问题，记录到 `claude-progress.md` 的"已知风险"，不要临时展开修
- 不改测试文件来让测试通过——修真正的实现

### Electron vs PWA 双端注意
- Electron 专属样式写在 `body.is-electron` 选择器下，不影响 PWA
- Electron 窗口无圆角（`border-radius: 0`）、全窗口布局、sheet 为深色
- PWA 保持居中卡片样式、sheet 为浅色

### 代码质量
- 样式改动先在 `ui-mockup.html` 里验证视觉效果，再同步到 `styles.css`
- 不留调试用的 `console.log`（已有的除外）
- 服务端改动需确保 WebSocket 连接不中断

---

## 验证规范（完成的定义）

功能标记为 `passing` 前，**必须**完成以下步骤，缺一不可：

1. `npm test` 全部通过
2. `npm start` 启动后端无报错
3. 打开浏览器访问 `http://localhost:3000`，点击受影响的 UI 控件
4. 确认可见行为与目标描述一致
5. 在 `feature_list.json` 的 `evidence` 字段记录：点了什么、看到了什么

**UI 改动额外要求**：
- Electron 端：`npm run desktop` 启动，在 Electron 窗口内验证
- 响应式：同时验证 PWA（浏览器）和 Electron 两端

如果无法完成浏览器或 Electron 验证，明确说明原因，不得标记为 `passing`。

---

## 收尾流程

会话结束前：
1. 对照 `clean-state-checklist.md` 逐项检查
2. 更新 `claude-progress.md` 的会话记录
3. 更新 `feature_list.json` 中涉及功能的状态和证据
4. 写 `session-handoff.md`，说明遗留风险和下一步动作
