# agent-eval

Agent 运行追踪与评测平台 —— 给 LLM Agent 做 trace + eval 的基础设施。

## 当前进度：Stage 1 ✅ 已上线

**https://agent-eval-six.vercel.app**

- **Stage 0**：单次 LLM 调用的记录本 —— token / 耗时 / 成本落库并在页面上可查
- **Stage 1**：多步 Agent + trace 树 —— 模型可以查库、算数，来回好几步；一次运行产生的所有 span 在页面上渲染成**可展开的树**，并且**边跑边长**（SSE 流式）

## 快速开始

```bash
# 1. 装依赖
npm install

# 2. 配环境变量（.env 是 gitignore 的，不会提交）
cp .env.example .env
# 然后编辑 .env，填入 DEEPSEEK_API_KEY 和两个 Neon 连接串
# （两个连接串为什么是两个，见 .env.example 里的注释）

# 3. 建数据库表
npm run db:migrate

# 4. 起服务
npm run dev
```

打开 http://localhost:3000

> **改完 `.env` 一定要重启 dev server。** 环境变量是进程启动时读进内存的，
> 热更新不会重新读。改了密码却还在用旧的连库，报出来的是「连不上数据库」——
> 看起来像网络问题，其实是进程里揣着过期凭据。这个坑踩过一次。

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 开发服务器 |
| `npm run db:migrate` | 应用 schema 变更，生成迁移文件 |
| `npm run db:studio` | 可视化查看数据库（`prisma studio`） |
| `npm run build` | 生产构建 |

## 项目结构

```
src/
├── app/
│   ├── page.tsx                    主页：读数条 + 表单 + 历史运行列表
│   └── api/runs/
│       ├── route.ts                POST 跑一次调用并落库；GET 列历史
│       └── stream/route.ts         ★ 多步 agent：SSE 流式 + 边跑边落库
├── components/
│   ├── RunForm.tsx                 表单（客户端）：单次 / Agent 两种模式
│   ├── AgentRun.tsx                正在跑的这次运行：状态 + 流式正文 + 实时树
│   ├── TraceTree.tsx               ★ 递归渲染 trace 树，可展开
│   ├── RunList.tsx                 历史运行列表，展开看那次的树
│   └── DetailBlock.tsx             展开后的详情块（列表和树共用）
└── lib/
    ├── db.ts                       Prisma 单例
    ├── errors.ts                   把 unknown 异常转成一句人话
    ├── pricing.ts                  价格表 → 成本估算
    ├── runs.ts                     平铺 span → 按 runId 分组的「运行」
    ├── spans.ts                    span 的序列化与 JSON 字段解析
    ├── use-agent-stream.ts         客户端：消费 SSE，边收边更新界面
    ├── agent/
    │   ├── events.ts               SSE 线路上传的事件类型
    │   ├── prompt.ts               agent 的系统提示词
    │   ├── sse.ts                  SSE 编解码
    │   └── tree.ts                 平铺数组 → 树
    ├── tools/
    │   ├── index.ts                工具注册表
    │   ├── query-spans.ts          查平台自己的历史记录
    │   └── calculate.ts            精确计算（不用 eval）
    └── providers/                  ★ provider adapter 层
        ├── types.ts                LLMProvider 接口（契约）
        ├── deepseek.ts             DeepSeek 实现（chat + runAgent）
        └── index.ts                注册表
```

### provider adapter 层

这一层解决的问题：把「用哪个模型厂商」从业务代码里赶出去。

页面和 API 路由只认 `LLMProvider` 接口，不认 DeepSeek。**加新 provider 只需要两步**：新建一个实现文件 + 在 `index.ts` 注册。别处一行都不用改。

模型能力（是否支持思考模式、是否支持图片）由 provider 自己声明，前端据此渲染表单 —— 加新模型时 UI 自动跟上，不用改前端。

**AI SDK 的类型不外泄。** `deepseek.ts` 把 SDK 的流翻译成我们自己的 `AgentEvent`，上层只认这套事件。这样换厂商时上层不用动，也意味着 SDK 升级踩坑的范围被限制在一个文件里。

### agent 是怎么跑起来的

```
用户提问
  │
  ├─ 第 1 步  llm_call ──→ tool_call (query_spans)   模型决定：先查数据
  ├─ 第 2 步  llm_call ──→ tool_call (calculate)     拿到数据后：交给工具算
  └─ 第 3 步  llm_call                               看到结果：给最终答案
```

**工具集只有两个：一个取数、一个算数。**

- `query_spans` —— 查平台自己记录的历史调用。所以这个评测平台能被 agent 用来查自己的 trace，数据不是造的
- `calculate` —— 精确计算。**为什么需要它**：LLM 是在「猜下一个 token」，不是在做算术，三位数加减都可能错，而且错得很自信。正确做法不是让它算准点，而是**别让它算**。这个工具刻意不用 `eval` —— 那等于把服务器交给模型生成的字符串

**为什么整个过程要流式（SSE）**：agent 跑三步可能要十几秒。普通响应要等全部跑完才返回，用户盯着白屏，也看不出卡在哪一步。SSE 让每一步、每个字立刻推出去，**树是边跑边长的**。

## 数据模型

只有一张 `Span` 表。Stage 0 建表时就把 `parentId` 自关联留好了，所以 Stage 1 **没有改表结构** —— 这正是「Stage 0 重点是数据模型建对」的回报。

```
id | runId | parentId | type | name | input | output
   | model | inputTokens | outputTokens | latencyMs | createdAt
```

- `type`：`agent_run` | `llm_call` | `tool_call`
- `parentId`：自关联成 trace 树，`null` 表示这次运行的根节点
- `input` / `output`：JSON 字符串，**形状按 type 分三种**（见 `src/lib/spans.ts` 的注释）

树形状：

```
agent_run            一次运行一个根节点，parentId = null
├─ llm_call          第 1 步：模型决定调工具
│  └─ tool_call      工具执行，挂在发起它的那次调用下
└─ llm_call          第 2 步：看到工具结果后作答
```

**为什么 `tool_call` 要挂在 `llm_call` 下面而不是平铺**：这样一眼能看出「哪个工具是被哪一步决策调起来的」。平铺的话，因果就丢了。

### 落库时机：树为什么能「边跑边长」

| agent 事件 | 数据库动作 |
|---|---|
| 运行开始 | INSERT `agent_run` |
| `step_start` | INSERT `llm_call`（先建空壳） |
| `tool_call` | INSERT `tool_call` |
| `tool_result` | UPDATE 那条 `tool_call`（补结果和耗时） |
| `step_end` | UPDATE 那条 `llm_call`（补正文、token、耗时） |
| 运行结束 | UPDATE `agent_run`（补最终答案、汇总 token、总耗时） |

每次写库都往 SSE 推一条 `{ type: 'span', span }`，客户端 upsert 进 Map 再重建树。

**span id 由我们自己用 `crypto.randomUUID()` 生成**，不等数据库返回 —— 这样父 span 的行还没写，子 span 就能引用它的 id。

## 三级台阶

| 阶段 | 交付物 | 状态 |
|---|---|---|
| **Stage 0** | 单次 LLM 调用的记录本 | ✅ 已上线 |
| **Stage 1** | 多步 Agent + trace 树 | ✅ 已上线 |
| **Stage 2** | 评测与对比（数据集 + LLM-as-judge + prompt 版本对比） | ⬜ |

## 技术栈

Next.js 16 (App Router) · React 19 · TypeScript · Prisma 6 + Postgres (Neon) · Vercel AI SDK 7 + `@ai-sdk/deepseek`

## 已知事项

- **数据库是 Neon Postgres**（US East / `iad1`，跟 Vercel 函数同区）。连接串由 Vercel 的 Neon 集成自动注入。
  两个连接串用途不同：应用侧走 `POSTGRES_PRISMA_URL`（**连接池**），迁移走 `POSTGRES_URL_NON_POOLING`（**直连**）。
  原因是 Vercel 是 serverless —— 每个请求可能落在新进程里，直连会把连接数用光；而连接池（pgbouncer）不支持迁移要用的部分 SQL 语句。
  本地开发也连同一个库（没有本地 Postgres），所以「本地好的线上坏」这类问题不会出现。
- **成本为上限估算**：按高峰价、输入未命中缓存计算，实际账单通常更低。
- **`/api/runs/stream` 设了 `maxDuration = 60`**：Vercel 函数默认 10 秒就掐。多步 agent 很容易超过，而且被掐断时**不报错**，流就那么停了，看起来像「模型没反应」。
- 踩坑记录见 `notes/`。
