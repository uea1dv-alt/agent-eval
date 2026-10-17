---
name: eval-progress
description: 对照 agent-eval 的三级台阶检查项目实际进度，给出下一步唯一要做的事。Use when the user asks 我现在到哪了、进度怎么样、下一步做什么、卡住了怎么办、复盘一下。
---

# 项目进度检查

对照 `CLAUDE.md` 里的三级台阶，**基于实际文件**报告进度 —— 不要凭记忆猜，每次都去读。

## 步骤

1. 列文件树，排除干扰目录：

   ```bash
   find . -path ./node_modules -prune -o -path ./.next -prune -o -path ./.git -prune -o -type f -print | head -50
   ```

2. 按下表逐项验证。**每一项都要有证据**（文件路径或代码片段），不能凭印象打勾。
3. 输出报告，最后只给**一件事**作为下一步。

## 检查清单

### Stage 0 —— 单次调用记录本

- [ ] `package.json` 存在且依赖已安装（`node_modules` 在）
- [ ] 有调用 LLM 的代码（搜 `generateText` / `streamText` / `messages.create`）
- [ ] 有 provider adapter（搜是否只有一个地方读 API key）
- [ ] Prisma schema 里有 span 表（`prisma/schema.prisma`）
- [ ] 有写入记录的代码路径
- [ ] 有页面列出历史记录（`app/` 下找）
- [ ] **有公网链接**（问用户，或看 README）

### Stage 1 —— Agent + trace 树

- [ ] 定义了工具（搜 `tools:` 或 `tool(`）
- [ ] 存在 agent 循环
- [ ] span 表有 `parent_id` 且真的在写值
- [ ] 前端把 span 渲染成树（搜递归组件）
- [ ] SSE / 流式（搜 `ReadableStream` 或 `streamText`）

### Stage 2 —— 评测与对比

- [ ] 数据集定义（搜 `dataset` / `evalset`）
- [ ] 打分逻辑（搜 `judge` / `score`）
- [ ] prompt 版本对比视图

## 输出格式

```markdown
## 当前：Stage N

| 检查项 | 状态 | 证据 |
|---|---|---|
| ... | ✅ / ❌ | 文件:行 或 "未找到" |

### 下一步（只做这一件）
<一件事，具体到可以立刻动手>
```

## 注意

- 项目还是空的时候，**不要罗列整套计划**。直接说「Stage 0 未开始」，给第一条命令就停。
- 发现了但不在当前阶段的事，**记到「以后再说」里，不要现在就做**。
- 如果用户是在纠结选哪条路，指出这一点并帮他收敛，别顺着往下铺开。
