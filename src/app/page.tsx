import Link from "next/link";
import { Suspense } from "react";
import RunForm from "@/components/RunForm";
import RunList, { type RunRow } from "@/components/RunList";
import SiteHeader from "@/components/SiteHeader";
import { estimateCostUsd, formatCostUsd, formatLatency } from "@/lib/pricing";
import { DEFAULT_PROVIDER_ID, listProviderMeta } from "@/lib/providers";
import { listRunPage } from "@/lib/run-queries";

// 时间固定用东八区显示，保证服务端渲染结果稳定（部署到别的时区的机器上也不会跳）
const TIME_ZONE = "Asia/Shanghai";

interface HomeProps {
  searchParams: Promise<{ page?: string }>;
}

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

export default function Home({ searchParams }: HomeProps) {
  return (
    <div className="mx-auto max-w-[1180px] px-6">
      <SiteHeader active="runs" note="Stage 1 · 多步 Agent · trace 树 + 流式" />

      {/* 表单不依赖数据库，所以放在 Suspense 外面 —— 页面外壳立刻可见，能马上开始输入 */}
      <RunForm providers={listProviderMeta()} defaultProviderId={DEFAULT_PROVIDER_ID} />

      {/* 查库的部分包在 Suspense 里。
          Next 16 默认开启 Cache Components：预渲染静态外壳时遇到「未缓存数据」会报错，
          正确解法就是这里 —— 外壳先出去，数据流式补上。
          searchParams 也是 Promise，必须原样传进来、在 Suspense 内部 await。 */}
      <Suspense fallback={<RecordsFallback />}>
        <Records searchParams={searchParams} />
      </Suspense>

      <footer className="py-6 text-xs text-faint">
        成本为上限估算（按高峰价、输入未命中缓存计算），实际账单通常更低。
      </footer>
    </div>
  );
}

async function Records({ searchParams }: HomeProps) {
  // Next 16：searchParams 是 Promise。页码解析失败一律回第 1 页 ——
  // 手改 URL 的人不该看到 500
  const { page: pageParam } = await searchParams;
  const page = Number.parseInt(pageParam ?? "1", 10) || 1;

  const { runs, hasPrev, hasNext } = await listRunPage(page);

  const rows: RunRow[] = runs.map((group) => ({
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
        <Reading label="本页运行" value={String(rows.length)} />
        <Reading label="输入 token" value={totalIn.toLocaleString("en-US")} tone="steel" />
        <Reading label="输出 token" value={totalOut.toLocaleString("en-US")} tone="brass" />
        <Reading label="花费" value={formatCostUsd(totalCost)} />
        <Reading label="中位耗时" value={formatLatency(medLatency)} last />
      </div>

      <RunList rows={rows} />

      {/* 分页在「运行」这一层，不在 span 层 —— 一次运行要么整页出现，要么不出现 */}
      {(hasPrev || hasNext) && (
        <nav
          className="flex items-center justify-between border-t border-line py-3 text-xs"
          aria-label="分页"
        >
          {hasPrev ? (
            <Link
              href={page <= 2 ? "/" : `/?page=${page - 1}`}
              className="text-muted transition-colors hover:text-ink"
            >
              ← 较新的
            </Link>
          ) : (
            <span />
          )}
          <span className="num text-faint">第 {page} 页</span>
          {hasNext ? (
            <Link
              href={`/?page=${page + 1}`}
              className="text-muted transition-colors hover:text-ink"
            >
              更早的 →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
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
