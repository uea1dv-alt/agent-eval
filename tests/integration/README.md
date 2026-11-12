# 集成测试（手动跑）

这些脚本会**真调模型、真写数据库、真花钱**，所以不在 `npm test` 里。

`npm test` 只跑纯函数单测 —— 不连数据库、不需要 API key，几百毫秒跑完，随时可以跑。

## 跑之前

1. 起开发服务器（3000 被占用时 Next 会自动换到 3001，以日志里的地址为准）
2. 把实际地址作为第一个参数传进去

| 脚本 | 测什么 | 开销 |
|---|---|---|
| `eval-pipeline.mjs` | 数据集 → 两个 prompt 版本 → 逐条评测 → 幂等 → 评测状态 | 6 次作答 + 6 次判分 |
| `eval-failure.mjs` | 失败也留记录：`score` 是 `null` 不是 `0` | 很小（模型名不存在，被测调用不会发生） |
| `parallel-tools.mjs` | 一轮里并行调多个工具时，工具耗时量得准 | 一次多步 agent 运行 |

```bash
node tests/integration/eval-pipeline.mjs http://localhost:3000
node tests/integration/eval-failure.mjs http://localhost:3000

# 这一个要 import src 里的 .ts（复用真正的 SSE 解码器），用 tsx 跑
npx tsx tests/integration/parallel-tools.mjs http://localhost:3000
```

## 安全阀

默认只允许 `localhost` / `127.0.0.1`。要打远端必须显式打开：

```bash
ALLOW_REMOTE=1 node tests/integration/eval-pipeline.mjs https://你的域名
```

**打开之后仍然会写生产库。** 测试数据不是玩具，想清楚再跑。

## 清理测试数据

前两个脚本创建的数据都带前缀和随机后缀。先预览，确认无误后再删：

```bash
# 预览
node --env-file=.env tests/integration/cleanup-test-data.mjs

# 真删
CLEANUP_APPLY=1 node --env-file=.env tests/integration/cleanup-test-data.mjs
```

清理只按**显式 id** 一条条删，不用 `deleteMany({})` —— 一个写错的条件就能清空整张表。
它删的是数据集 / prompt 版本 / 评测；`Span` 表一行不碰（`parallel-tools.mjs` 产生的那次运行会留着）。
