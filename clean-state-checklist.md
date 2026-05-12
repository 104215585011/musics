# Claudio FM — 收尾检查清单

> 每次会话结束前逐项核对。全部通过才算干净收尾。

---

## 启动验证

- [ ] `npm start` 启动后端，无报错，控制台无异常堆栈
- [ ] `http://localhost:3000` 可正常访问，Player 页面加载完整
- [ ] 如有 Electron 改动：`npm run desktop` 启动正常，窗口显示正确

## 测试验证

- [ ] `npm test` 全部通过（script.test.js + server.test.js + api.test.js）
- [ ] 没有为了让测试通过而绕过逻辑或注释掉测试用例

## 代码状态

- [ ] 没有遗留的调试代码（`console.log('debug...')` 等）
- [ ] 没有注释掉的半成品代码块未做说明
- [ ] 没有未处理的合并冲突标记（`<<<<<<` / `>>>>>>>`）
- [ ] Electron 专属样式只写在 `body.is-electron` 块内，未污染 PWA 样式

## 功能清单同步

- [ ] `feature_list.json` 中本轮涉及的功能状态已更新（`not_started` → `in_progress` → `passing`）
- [ ] 标记为 `passing` 的功能都有对应的 `evidence` 字段记录（不留空）
- [ ] 没有功能被误标记为 `passing`（必须真实通过验证）
- [ ] 同一时间只有一个功能处于 `in_progress`

## 文档同步

- [ ] `claude-progress.md` 已添加本轮会话记录（目标 / 完成 / 验证 / 证据 / 下一步）
- [ ] `session-handoff.md` 已更新：本轮改动 + 已知风险 + 下一步动作
- [ ] 如有新的架构变化，已更新 `quality-document.md`

## 交接就绪

- [ ] 下一轮会话仅凭仓库内文件（无需口头补充）就能继续推进
- [ ] `session-handoff.md` 的"不要动的东西"一栏已填写
- [ ] 所有 blocker 已记录在 `claude-progress.md` 的"当前 Blocker"中

---

## 快速状态确认命令

```bash
# 一键验证
npm test && echo "✅ 测试通过" || echo "❌ 测试失败"

# 确认后端可启动（5 秒后自动退出）
timeout 5 npm start || true

# 检查是否有遗留 debug log（排除 node_modules）
grep -r "console.log" --include="*.js" \
  --exclude-dir=node_modules \
  --exclude-dir=.npm-cache \
  . | grep -v "// " | grep -v "server.js"
```
