# Claudio FM — Task Board

> 所有 agent 的任务协调中心。PM 开票，各角色按流程更新状态和记录。
> **任何人动这个文件前，先检查最后一条 Log 时间戳，确认没有并发冲突。**

---

## 任务状态说明

| 状态 | 含义 | 当前负责人 |
|------|------|-----------|
| `draft` | PM 已创建，待分配 | Claude1 |
| `ui-review` | 等待 UI 总监评审 | Claude2 |
| `ui-rejected` | UI 总监驳回，返回 PM | Claude1 |
| `ui-approved` | UI 总监通过，待开发 | Codex1 |
| `in-dev` | 开发中 | Codex1 |
| `dev-done` | 开发完成，待测试 | Codex2 |
| `in-test` | 测试中 | Codex2 |
| `test-failed` | 测试不通过，返回开发 | Codex1 |
| `test-passed` | 测试通过（非 UI 任务直接 → done） | Claude2 或 done |
| `ui-acceptance` | 等待 UI 总监验收 | Claude2 |
| `acceptance-failed` | UI 验收不通过，返回开发 | Codex1 |
| `done` | 完全完成 | — |
| `blocked` | 有阻断问题，需 PM 介入 | Claude1 |

---

## 工作流快速参考

```
【无 UI 任务】
Claude1(开票) → Codex1(开发) → Codex2(测试) → done

【有 UI 任务】
Claude1(开票) → Claude2(评审)
    ↓ 不通过 → Claude1(修改需求) → Claude2(重新评审)
    ↓ 通过
Codex1(开发) → Codex2(测试)
    ↓ 不通过 → Codex1(修复) → Codex2(重新测试)
    ↓ 通过
Claude2(UI 验收)
    ↓ 不通过 → Codex1(修复) → Codex2(重新测试) → Claude2(重新验收)
    ↓ 通过 → done
```

---

## 活跃任务

<!-- PM 在此区域新增任务 -->

---

## 已完成任务归档

<!-- 状态变为 done 后移动到此处 -->

---

## 任务模板

复制以下模板创建新任务：

```markdown
## TASK-XXX: [任务标题]

- **Priority**: P1 / P2 / P3
- **Type**: UI相关 / 非UI
- **Status**: draft
- **Assigned to**: —
- **Created by**: Claude1 | **Created at**: YYYY-MM-DD HH:mm
- **feature_list.json ref**: [对应的 feature id，如 electron-ui-redesign]

### 需求描述
[用户可见的目标行为是什么]

### 验收标准
- [ ] 条件一
- [ ] 条件二

### UI 规范（UI 任务填写）
> 由 Claude2 在评审通过后补充

### 开发记录（Codex1 填写）
> 改动了哪些文件、做了什么

### 测试报告（Codex2 填写）
> 跑了什么测试、结果如何、证据

### UI 验收报告（Claude2 填写）
> 验收结论和说明

### 操作日志
| 时间 | Agent | 操作 |
|------|-------|------|
| YYYY-MM-DD HH:mm | Claude1 | 创建任务 |
```
