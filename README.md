# agent-eval

Agent 运行追踪与评测平台 —— 给 LLM Agent 做 trace + eval 的基础设施。

## 当前进度：Stage 0 ✅

单次 LLM 调用的记录本。发一个 prompt，把这次调用的 **token 数 / 耗时 / 输入输出 / 成本** 落库，并在页面上看到历史记录。

## 快速开始

```bash
# 1. 装依赖
npm install

# 2. 配环境变量（.env 是 gitignore 的，不会提交）
cp .env.example .env
# 然后编辑 .env，填入 DEEPSEEK_API_KEY

# 3. 建数据库表
npm run db:migrate

# 4. 起服务
npm run dev
```

打开 http://localhost:3000

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
│   ├── page.tsx              主页：读数条 + 表单 + 历史记录
│   └── api/runs/route.ts     POST 跑一次调用并落库；GET 列历史
├── components/
│   ├── RunForm.tsx           调用表单（客户端）
│   └── RunList.tsx           历史记录表，点行展开看完整输入输出
└── lib/
    ├── db.ts                 Prisma 单例
    ├── pricing.ts            价格表 → 成本估算
    ├── spans.ts              span 的序列化与 JSON 字段解析
    └── providers/            ★ provider adapter 层
        ├── types.ts          LLMProvider 接口（契约）
        ├── deepseek.ts       DeepSeek 实现
        └── index.ts          注册表
```

### provider adapter 层

这一层解决的问题：把「用哪个模型厂商」从业务代码里赶出去。

页面和 API 路由只认 `LLMProvider` 接口，不认 DeepSeek。**加新 provider 只需要两步**：新建一个实现文件 + 在 `index.ts` 注册。别处一行都不用改。

模型能力（是否支持思考模式、是否支持图片）由 provider 自己声明，前端据此渲染表单 —— 加新模型时 UI 自动跟上，不用改前端。

## 数据模型

只有一张 `Span` 表，一次调用一行。字段命名参考 OpenTelemetry 的 LLM span 语义约定。

```
id | runId | parentId | type | name | input | output
   | model | inputTokens | outputTokens | latencyMs | createdAt
```

- `type`：`llm_call` | `tool_call`
- `parentId`：自关联成 trace 树。**Stage 0 恒为 null**，Stage 1 才真正串成树
- `input` / `output`：JSON 字符串（用 String 而非 Json 类型，保证以后切 Postgres 不用改列类型）

## 三级台阶

| 阶段 | 交付物 | 状态 |
|---|---|---|
| **Stage 0** | 单次 LLM 调用的记录本 | ✅ 功能完成（部署待做） |
| **Stage 1** | 多步 Agent + trace 树 | ⬜ |
| **Stage 2** | 评测与对比（数据集 + LLM-as-judge + prompt 版本对比） | ⬜ |

## 技术栈

Next.js 16 (App Router) · React 19 · TypeScript · Prisma 6 + SQLite · Vercel AI SDK 7 + `@ai-sdk/deepseek`

## 已知事项

- **部署未做**。Vercel 是 Serverless，本地 SQLite 文件在线上存不住。schema 已做成可移植（无 SQLite 独有类型），切 Postgres 只需改 provider 一行 + 换连接串。
- **成本为上限估算**：按高峰价、输入未命中缓存计算，实际账单通常更低。
- 踩坑记录见 `notes/`。
