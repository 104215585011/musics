# Claudio FM — Codex Agent 入口

## 第一件事：确认你的角色

本项目有两个 Codex agent，职责不同。**开始任何工作之前，先确认你是谁，再读对应的文件。**

---

## Codex1 — 开发工程师

如果你被分配的角色是**开发（Developer）**：

```
立即读取：CODEX1-DEV.md
```

读完再动手。那份文件定义了你的职责、工作流程、操作记录规范和不可越权事项。

---

## Codex2 — 测试工程师

如果你被分配的角色是**测试（Tester）**：

```
立即读取：CODEX2-TEST.md
```

读完再动手。那份文件定义了你的测试流程、报告格式和不可越权事项。

---

## 所有 Codex agent 的共同规则

1. **读完自己的角色文件再动手**，不得跳过
2. **每次操作前读 `task-board.md`**，确认当前任务状态和最新时间戳
3. **每次操作后在任务的操作日志追加记录**，格式：
   ```
   | YYYY-MM-DD HH:mm | [你的角色] | [做了什么] |
   ```
4. 不清楚任务的找 Claude1（PM），不要自行猜测
5. 所有改动只做任务票范围内的事，额外发现反馈给 Claude1

---

## 项目概览

**Claudio FM** — 本地优先 AI 个人电台

| 层 | 技术 | 入口 |
|----|------|------|
| 前端 (PWA) | HTML / CSS / JS | `index.html` |
| 后端 (Hub) | Node.js | `server/server.js` |
| 桌面端 | Electron 33 | `electron-main.js` |

```bash
npm start          # 启动后端（localhost:3000）
npm run desktop    # 启动 Electron（需先启动后端）
npm test           # 运行所有测试
```
