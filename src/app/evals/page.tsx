import type { Prisma } from "@prisma/client";
import Link from "next/link";
import { Suspense } from "react";
import DatasetForm from "@/components/DatasetForm";
import PromptVersionForm from "@/components/PromptVersionForm";
import SiteHeader from "@/components/SiteHeader";
import StartEvalForm from "@/components/StartEvalForm";
import { sectionTitleClass } from "@/components/form-styles";
import { prisma } from "@/lib/db";
import { listProviderMeta } from "@/lib/providers";

// 和首页一致：固定东八区，服务端渲染结果才稳定
const TIME_ZONE = "Asia/Shanghai";

const timestampFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: TIME_ZONE,
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export default function EvalsPage() {
  return (
    <div className="mx-auto max-w-[1180px] px-6">
      <SiteHeader active="evals" note="Stage 2 · 数据集 · LLM-as-judge · 版本对比" />

      {/* 查库的部分包在 Suspense 里：Next 16 的 Cache Components 要求
          未缓存的数据必须显式流式处理，不能整页等服务端查完 */}
      <Suspense fallback={<IndexFallback />}>
        <EvalIndex />
      </Suspense>

      {/* 两个创建表单不依赖数据库，放在 Suspense 外面 —— 页面一出来就能填 */}
      <section className="mt-10 grid gap-8 border-t border-line pt-6 lg:grid-cols-2">
        <div className="space-y-4">
          <h2 className={sectionTitleClass}>新建数据集</h2>
          <DatasetForm />
        </div>
        <div className="space-y-4">
          <h2 className={sectionTitleClass}>新建 prompt 版本</h2>
          <PromptVersionForm models={listProviderMeta().flatMap((p) => p.models)} />
        </div>
      </section>

      <footer className="py-6 text-xs text-faint">
        评测的调用不写进 Span 表 —— judge 烧的 token 不该混进被测模型的账里。
        每条例用一次请求，中途断了可以接着跑，已完成的不会重复花钱。
      </footer>
    </div>
  );
}

async function EvalIndex() {
  const [datasets, prompts, evalRuns] = await Promise.all([
    prisma.dataset.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { cases: true } } },
    }),
    prisma.promptVersion.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.evalRun.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        dataset: { select: { name: true } },
        promptVersion: { select: { name: true, model: true } },
        // 只取分数和错误两列：算均分和失败数够用，不用把几百条回答正文拉进内存
        results: { select: { score: true, error: true } },
      },
    }),
  ]);

  const totalCases = datasets.reduce((sum, d) => sum + d._count.cases, 0);

  return (
    <>
      <div className="flex flex-wrap items-center gap-y-1 border-y border-line py-2.5 text-xs">
        <Reading label="数据集" value={String(datasets.length)} />
        <Reading label="用例" value={String(totalCases)} />
        <Reading label="prompt 版本" value={String(prompts.length)} />
        <Reading label="评测" value={String(evalRuns.length)} last />
      </div>

      <section className="mt-6 space-y-4">
        <h2 className={sectionTitleClass}>发起评测</h2>
        <StartEvalForm
          datasets={datasets.map((d) => ({ id: d.id, name: d.name, caseCount: d._count.cases }))}
          prompts={prompts.map((p) => ({ id: p.id, name: p.name, model: p.model }))}
        />
      </section>

      <section className="mt-8 space-y-3">
        <h2 className={sectionTitleClass}>评测记录</h2>
        {evalRuns.length === 0 ? (
          <p className="py-6 text-xs leading-relaxed text-faint">
            还没有评测。下面先建一个数据集和一个 prompt 版本，再回到上面发起。
          </p>
        ) : (
          <EvalTable evalRuns={evalRuns} />
        )}
      </section>
    </>
  );
}

/** Prisma 自带的「按 include 推导返回类型」，不用手写一遍形状 */
type EvalRunRow = Prisma.EvalRunGetPayload<{
  include: {
    dataset: { select: { name: true } };
    promptVersion: { select: { name: true; model: true } };
    results: { select: { score: true; error: true } };
  };
}>;

function EvalTable({ evalRuns }: { evalRuns: EvalRunRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-faint">
            <th className="py-2 pr-4 font-normal">发起</th>
            <th className="py-2 pr-4 font-normal">数据集</th>
            <th className="py-2 pr-4 font-normal">prompt 版本</th>
            <th className="py-2 pr-4 font-normal">被判 / judge</th>
            <th className="py-2 pr-4 font-normal">进度</th>
            <th className="py-2 pr-4 font-normal">均分</th>
            <th className="py-2 font-normal">状态</th>
          </tr>
        </thead>
        <tbody>
          {evalRuns.map((run) => {
            const scored = run.results.filter((r) => r.score !== null);
            const avg =
              scored.length > 0
                ? scored.reduce((sum, r) => sum + (r.score ?? 0), 0) / scored.length
                : null;
            const failed = run.results.filter((r) => r.error).length;

            return (
              <tr
                key={run.id}
                className="border-b border-line-soft transition-colors hover:bg-panel/50"
              >
                <td className="py-2 pr-4 text-xs whitespace-nowrap text-faint num">
                  {timestampFormatter.format(run.createdAt)}
                </td>
                {/* 一行整行可点：链接放在主语上，但用 after:absolute 铺满整行 */}
                <td className="relative py-2 pr-4">
                  <Link href={`/evals/${run.id}`} className="after:absolute after:inset-0">
                    {run.dataset.name}
                  </Link>
                </td>
                <td className="py-2 pr-4 text-muted">{run.promptVersion.name}</td>
                <td className="num py-2 pr-4 text-xs text-faint">
                  {run.promptVersion.model} / {run.judgeModel}
                </td>
                <td className="num py-2 pr-4 text-xs text-muted">
                  {run.results.length}/{run.caseCount}
                  {failed > 0 && <span className="text-danger"> · {failed} 失败</span>}
                </td>
                <td className="num py-2 pr-4">
                  {avg === null ? (
                    <span className="text-faint">—</span>
                  ) : (
                    <span className={avg >= 8 ? "text-ink" : avg >= 5 ? "text-brass" : "text-danger"}>
                      {avg.toFixed(1)}
                    </span>
                  )}
                </td>
                <td className="py-2 text-xs">
                  <StatusLabel status={run.status} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StatusLabel({ status }: { status: string }) {
  if (status === "done") return <span className="text-muted">已完成</span>;
  if (status === "failed") return <span className="text-danger">失败</span>;
  return <span className="text-brass">进行中</span>;
}

function IndexFallback() {
  return (
    <>
      <div className="flex items-center gap-4 border-y border-line py-2.5 text-xs text-faint">
        <span>正在读取数据集…</span>
      </div>
      <div className="mt-6 space-y-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-8 border-b border-line-soft bg-panel/30" />
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
