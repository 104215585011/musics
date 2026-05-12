# Claudio FM — 会话交接摘要

> 每轮会话结束时更新此文件。下一轮 agent 先读这里，再读 claude-progress.md。

---

## 当前已验证（可信赖的基础）

- `npm test` 三个测试文件全部通过
- 后端 `npm start` 正常启动，WebSocket 可连接
- `npm run desktop` 可启动 Electron 桌面端
- 播放器核心、波形可视化、歌词同步、聊天、NetEase 登录均在正常工作状态

---

## 本轮改动

### 新增文件
- `CLAUDE.md` — 项目工作规范（开工/收尾流程、验证要求）
- `init.sh` — 初始化脚本（安装依赖、运行测试、打印启动命令）
- `claude-progress.md` — 进度日志（当前状态 + 会话记录）
- `feature_list.json` — 功能清单（13 个功能，含状态和验证步骤）
- `session-handoff.md` — 本文件
- `clean-state-checklist.md` — 收尾检查清单
- `evaluator-rubric.md` — 会话评审评分表
- `quality-document.md` — 代码库质量快照
- `ui-mockup.html` — Electron UI 改进方案视觉稿

### 代码改动
- 本轮无 `styles.css` / `script.js` 等核心文件改动

---

## 仍损坏或未验证

- `electron-ui-redesign`（priority 1）：mockup 已完成，尚未落实到 `styles.css`
- `upnp-speaker`：需局域网环境测试，无法在 CI 中验证
- `android-pwa`：需真机测试，网络方案（局域网 vs 云端）未决定
- `profile-view`：UI 结构存在，后端数据接口未完整验证

---

## 下一步最佳动作

**立即可做：** 将 `ui-mockup.html` 中的改动落实到 `styles.css`

具体步骤：
1. 打开 `ui-mockup.html` 和 `styles.css` 并排对比
2. 在 `styles.css` 的 `body.is-electron` 块中按以下改动更新：
   - 状态栏：改为 pill 标签样式（见 mockup `.status-pill.err`）
   - 播放键：改为实心白圆（见 mockup `.play-btn`）
   - 进度条：hover 变高 + 圆点（见 mockup `.progress:hover`）
   - 聊天区：去掉左右两列，改为底部固定 strip（见 mockup `.chat`）
   - 歌曲信息：三行层级，增加 padding（见 mockup `.sheet-head`）
3. `npm run desktop` 验证 Electron 端
4. `http://localhost:3000` 验证 PWA 端无回归

**不要动的东西：**
- `server/` 目录下任何文件（本轮无后端改动需求）
- `tests/` 目录（测试当前全部通过）
- `ui-mockup.html`（仅作参考，不是生产文件）

---

## 命令速查

```bash
# 启动后端
npm start

# 启动 Electron（需先启动后端）
npm run desktop

# 运行所有测试
npm test

# 初始化（新环境）
bash init.sh
```

---

*上次更新：会话 001*
