import { Suspense } from "react";
import RunForm from "@/components/RunForm";
import RunList, { type RunRow } from "@/components/RunList";
import { prisma } from "@/lib/db";
import { estimateCostUsd, formatCostUsd, formatLatency } from "@/lib/pricing";
import { DEFAULT_PROVIDER_ID, listProviderMeta } from "@/lib/providers";
import { groupByRun } from "@/lib/runs";
import { serializeSpan } from "@/lib/spans";

// 时间固定用东八区显示，保证服务端渲染结果稳定（部署到别的时区的机器上也不会跳）
const TIME_ZONE = "Asia/Shanghai";

/**
 * 一次查多少条 span。
 *
 * 为什么不是「查 N 次运行」：runId 没有单独的索引，而且分页边界很容易把一次运行
 * 从中间截断 —— 截断后子 span 的父节点不在结果里，树就散了。
 * 多查一些、让 groupByRun 自己分组的代价更小（buildTree 对孤儿节点有兜底）。
 * 真到数据量大到需要分页时，应该按 runId 分页（`findMany({ distinct: ['runId'] })`
 * 拿到一批 runId，再按 runId 查全部 span），那是 Stage 2 的事。
 */
const SPAN_SCAN_LIMIT = 300;

const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

export default function Home() {
  return (
    <div className="mx-auto max-w-[1180px] px-6">
      <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-6">
        <h1 className="text-lg font-semibold tracking-tight">agent-eval</h1>
        <p className="text-xs text-faint">
          Stage 1 · 多步 Agent · trace 树 + 流式
        </p>
      </header>

      {/* 表单不依赖数据库，所以放在 Suspense 外面 —— 页面外壳立刻可见，能马上开始输入 */}
      <RunForm providers={listProviderMeta()} defaultProviderId={DEFAULT_PROVIDER_ID} />

      {/* 查库的部分包在 Suspense 里。
          Next 16 默认开启 Cache Components：预渲染静态外壳时遇到「未缓存数据」会报错，
          正确解法就是这里 —— 外壳先出去，数据流式补上。 */}
      <Suspense fallback={<RecordsFallback />}>
        <Records />
      </Suspense>

      <footer className="py-6 text-xs text-faint">
        成本为上限估算（按高峰价、输入未命中缓存计算），实际账单通常更低。
      </footer>
    </div>
  );
}

async function Records() {
  const spans = await prisma.span.findMany({
    orderBy: { createdAt: "desc" },
    take: SPAN_SCAN_LIMIT,
  });

  const rows: RunRow[] = groupByRun(spans.map(serializeSpan)).map((group) => ({
    ...group,
    timeLabel: timeFormatter.format(new Date(group.createdAt)),
  }));

  // 汇总读数。只统计成功的运行 —— 失败的没有 token 和耗时，混进去会拉低平均值。
  // 判定用解析后的 output.error，不用字符串匹配 —— 否则模型回复正文里
  // 恰好出现 "error" 这个词就会被误判成失败。
  const succeeded = rows.filter((r) => !r.failed);
  const totalIn = succeeded.reduce((sum, r) => sum + r.inputTokens, 0);
  const totalOut = succeeded.reduce((sum, r) => sum + r.outputTokens, 0);
  const totalCost = succeeded.reduce(
    (sum, r) =>
      sum + (estimateCostUsd(r.model, { inputTokens: r.inputTokens, outputTokens: r.outputTokens }) ?? 0),
    0,
  );
  const medLatency = median(
    succeeded.map((r) => r.latencyMs).filter((v): v is number => v !== null),
  );

  return (
    <>
      {/* 读数条：一行，mono，细线分隔。刻意不做成四张统计卡片 ——
          这是一台仪器的状态显示，不是仪表盘营销页。 */}
      <div className="flex flex-wrap items-center gap-y-1 border-y border-line py-2.5 text-xs">
        <Reading label="运行" value={String(rows.length)} />
        <Reading label="输入 token" value={totalIn.toLocaleString("en-US")} tone="steel" />
        <Reading label="输出 token" value={totalOut.toLocaleString("en-US")} tone="brass" />
        <Reading label="花费" value={formatCostUsd(totalCost)} />
        <Reading label="中位耗时" value={formatLatency(medLatency)} last />
      </div>

      <RunList rows={rows} />
    </>
  );
}

/** 数据流进来之前的占位。保持安静 —— 骨架屏不该比内容还抢眼。 */
function RecordsFallback() {
  return (
    <>
      <div className="flex items-center gap-4 border-y border-line py-2.5 text-xs text-faint">
        <span>正在读取记录…</span>
      </div>
      <div className="space-y-px pt-px">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-9 border-b border-line-soft bg-panel/30" />
        ))}
      </div>
    </>
  );
}

function Reading({
  label,
  value,
  tone,
  last,
}: {
  label: string;
  value: string;
  tone?: "steel" | "brass";
  last?: boolean;
}) {
  const toneClass =
    tone === "steel" ? "text-steel" : tone === "brass" ? "text-brass" : "text-ink";

  return (
    <div
      className={`flex items-baseline gap-2 px-4 first:pl-0 ${last ? "" : "border-r border-line"}`}
    >
      <span className="text-faint">{label}</span>
      <span className={`num ${toneClass}`}>{value}</span>
    </div>
  );
}
