# agent-eval

Agent 运行追踪与评测平台 —— 给 LLM Agent 做 trace + eval 的基础设施。

## 使用者背景

- 软件工程大三学生，**刚入门**（起点：写过静态 HTML，`jersey-designer` 只有一个 index.html）
- **需要解释「为什么」**，不要只给代码。遇到新概念先一句话说清它解决什么问题
- 目标：2027 年春季的暑期实习（AI Agent 主线 / AI 测开暗线 / 后端保底）
- 学习计划节奏见 `notes/`

## 技术栈（已定，不要中途换）

- **全程 TypeScript** —— 不引入 Java，不引入 Python
- Next.js (App Router) + React
- Prisma + SQLite（本地）→ Postgres（上线后）
- Vercel AI SDK（`vercel/ai`）
- 部署：Vercel

**为什么只用 TS**：AI Agent（Vercel AI SDK）、AI 测试（Playwright）、后端（NestJS）三条线都能被 TS 覆盖。学一门到扎实 > 学三门到会写语法。

## LLM Provider

- 起步用 **DeepSeek**（国内直连、便宜、OpenAI 兼容）
- 环境里已有可用的 key 和 base URL（在 `~/.claude/settings.json` 的 `env` 段）
- **必须写 provider adapter 层**：一个 interface + 多个实现。切换 provider 只改一个文件。
  这层本身就是简历加分项。

## 数据模型（核心，后续只加字段，不推翻）

Stage 0 就要建 span 表：

```
id | run_id | parent_id | type | name | input | output
   | model | input_tokens | output_tokens | latency_ms | created_at
```

- `type`: `llm_call` | `tool_call`
- `parent_id` 自关联成 trace 树 —— **Stage 0 先留空字段**，Stage 1 才用
- 字段命名参考 OpenTelemetry 的 LLM span 语义约定（`traceloop/openllmetry`）

## 三级台阶

| 阶段 | 交付物 | 验收标准 |
|---|---|---|
| **Stage 0** | 单次 LLM 调用的记录本 | 有公网链接；能看到每次调用的 token / 耗时 |
| **Stage 1** | 多步 Agent + trace 树 | 一次运行产生多个 span，前端渲染成可展开的树 + SSE 流式 |
| **Stage 2** | 评测与对比 | 数据集批量跑 + LLM-as-judge 打分 + 两个 prompt 版本对比 |

## 本项目已装 skill

**只有一个，且只在本目录启动时加载**（常驻 ~59 token）：

| skill | 来源 | 用途 |
|---|---|---|
| `eval-progress` | 自建 | 查项目实际进度，给下一步 |

**通用的 skill 不放这里，放个人层。** 现有两个在 `~/.claude/skills/`，任何目录都能用：
`frontend-design`（UI 别写成模板默认样）、`mcp-builder`（写 MCP server，官方推荐 TS）。

判断标准：**只有这个项目才讲得通**的（比如 `eval-progress` 查的是本项目三级台阶）→ 项目层；
**任何 web 项目都用得上**的 → 个人层。

**`mcp-builder` 有个坑**：它的 `scripts/`（`connections.py` / `evaluation.py`）是 Python，你跑不了。
但核心指导语言无关，TS 部分看它的 `reference/node_mcp_server.md`。

**故意没收的**：官方 `webapp-testing` —— 它 100% 是 Python（`with_server.py` + 全 `.py` 示例），
和你「只用 TS」直接冲突。Codex 那边官方 `playwright` skill 是纯 JS 的，已经装到 Codex 了。

## 约定

- **项目 skill 一律加 `eval-` 前缀**，第三方 skill 也照办（改目录名 + frontmatter 的 `name` 字段）。原因：skill 优先级是 企业 > 个人 > 项目，项目 skill 盖不住同名的个人/全局 skill，加前缀可以彻底避免撞名。
- 学习复盘写在 `notes/`，一周一个文件
- 注释和 commit message 用中文
- 环境变量放 `.env`，**绝不提交**。`.gitignore` 第一行就要有 `.env`
