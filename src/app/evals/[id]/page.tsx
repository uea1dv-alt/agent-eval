import type { Prisma } from "@prisma/client";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import CompareSelect from "@/components/CompareSelect";
import EvalResults, { type EvalResultRow } from "@/components/EvalResults";
import EvalRunner from "@/components/EvalRunner";
import SiteHeader from "@/components/SiteHeader";
import { sectionTitleClass } from "@/components/form-styles";
import { prisma } from "@/lib/db";
import { estimateCostUsd, formatCostUsd } from "@/lib/pricing";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ compare?: string }>;
}

export default function EvalDetailPage({ params, searchParams }: PageProps) {
  return (
    <div className="mx-auto max-w-[1180px] px-6">
      <SiteHeader active="evals" note="Stage 2 · 数据集 · LLM-as-judge · 版本对比" />

      {/* 注意：params / searchParams 这两个 Promise 要**原样传进去**、在 Suspense 内部 await。
          在外面 await 的话，整页就没法预渲染了 —— 构建会直接报
          "encountered uncached or runtime data during prerendering"。
          因为主页的外壳（页头、页脚）跟 id 无关，它完全可以先发出去。 */}
      <Suspense fallback={<DetailFallback />}>
        <EvalDetail params={params} searchParams={searchParams} />
      </Suspense>

      <footer className="py-6 text-xs text-faint">
        分数由另一个模型给出（judge 与被评模型不同，避免自己给自己打分）。
        判分失败记为「失败」而不是 0 分 —— 「没测出来」和「答得差」是两回事。
      </footer>
    </div>
  );
}

async function EvalDetail({ params, searchParams }: PageProps) {
  // Next 16：params 和 searchParams 都是 Promise，必须 await
  const { id: evalId } = await params;
  const compareId = (await searchParams).compare ?? null;

  const run = await prisma.evalRun.findUnique({
    where: { id: evalId },
    include: {
      dataset: { include: { cases: { orderBy: { position: "asc" } } } },
      promptVersion: true,
      results: true,
    },
  });

  if (!run) notFound();

  // 一条用例一行，没跑过的也占一行 —— 进度是「还差哪些」，不是「跑完了哪些」
  const byCase = new Map(run.results.map((r) => [r.caseId, r]));
  const rows: EvalResultRow[] = run.dataset.cases.map((c) => {
    const r = byCase.get(c.id);
    return {
      caseId: c.id,
      position: c.position,
      input: c.input,
      reference: c.reference,
      done: Boolean(r),
      output: r?.output ?? null,
      score: r?.score ?? null,
      scoreReason: r?.scoreReason ?? null,
      latencyMs: r?.latencyMs ?? null,
      inputTokens: r?.inputTokens ?? null,
      outputTokens: r?.outputTokens ?? null,
      judgeInputTokens: r?.judgeInputTokens ?? null,
      judgeOutputTokens: r?.judgeOutputTokens ?? null,
      error: r?.error ?? null,
    };
  });

  const pendingCaseIds = run.dataset.cases.filter((c) => !byCase.has(c.id)).map((c) => c.id);
  const doneCount = run.results.length;

  const scored = rows.filter((r) => r.score !== null);
  const avg =
    scored.length > 0 ? scored.reduce((sum, r) => sum + (r.score ?? 0), 0) / scored.length : null;
  const failedCount = rows.filter((r) => r.error).length;

  // 成本分两块算：判分也是真花钱的，混在一起会让人低估评测开销
  const answerCost = run.results.reduce(
    (sum, r) =>
      sum +
      (estimateCostUsd(run.promptVersion.model, {
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
      }) ?? 0),
    0,
  );
  const judgeCost = run.results.reduce(
    (sum, r) =>
      sum +
      (estimateCostUsd(run.judgeModel, {
        inputTokens: r.judgeInputTokens,
        outputTokens: r.judgeOutputTokens,
      }) ?? 0),
    0,
  );

  // 只允许和用**同一个数据集**的评测对比 —— 不同数据集的平均分没有可比性
  const siblings = await prisma.evalRun.findMany({
    where: { datasetId: run.datasetId, id: { not: run.id } },
    orderBy: { createdAt: "desc" },
    include: {
      promptVersion: { select: { name: true } },
      results: { select: { score: true } },
    },
  });

  const compareRun =
    compareId && siblings.some((s) => s.id === compareId)
      ? await prisma.evalRun.findUnique({
          where: { id: compareId },
          include: { promptVersion: true, results: true },
        })
      : null;

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b border-line pb-4">
        <div className="space-y-1">
          <Link href="/evals" className="text-xs text-faint hover:text-muted">
            ← 评测
          </Link>
          <h1 className="text-base font-medium">
            {run.dataset.name}
            <span className="mx-2 text-faint">×</span>
            {run.promptVersion.name}
          </h1>
          <p className="num text-xs text-faint">
            被判 {run.promptVersion.model} · judge {run.judgeModel}
            {run.finishedAt && <span> · 完成于 {formatTime(run.finishedAt)}</span>}
          </p>
        </div>

        <CompareSelect
          evalId={run.id}
          current={compareRun?.id ?? null}
          options={siblings.map((s) => ({
            id: s.id,
            label: `${s.promptVersion.name} · 均分 ${avgOf(s.results)?.toFixed(1) ?? "—"}`,
          }))}
        />
      </div>

      <div className="flex flex-wrap items-center gap-y-1 border-b border-line py-2.5 text-xs">
        <Reading label="用例" value={String(run.caseCount)} />
        <Reading label="已完成" value={`${doneCount}/${run.caseCount}`} tone="brass" />
        <Reading label="均分" value={avg === null ? "—" : avg.toFixed(2)} />
        <Reading label="失败" value={String(failedCount)} />
        <Reading label="作答成本" value={formatCostUsd(answerCost)} last={false} />
        <Reading label="判分成本" value={formatCostUsd(judgeCost)} last />
      </div>

      {compareRun && (
        <ComparePanel base={{ run, rows }} other={compareRun} />
      )}

      <section className="mt-6 space-y-3">
        <h2 className={sectionTitleClass}>运行</h2>
        <EvalRunner
          evalId={run.id}
          pendingCaseIds={pendingCaseIds}
          total={run.caseCount}
          done={doneCount}
        />
      </section>

      <section className="mt-6 space-y-3">
        <h2 className={sectionTitleClass}>逐条结果</h2>
        {rows.length === 0 ? (
          <p className="py-6 text-xs text-faint">这个数据集里没有用例。</p>
        ) : (
          <EvalResults rows={rows} />
        )}
      </section>
    </>
  );
}

type CompareRun = Prisma.EvalRunGetPayload<{
  include: { promptVersion: true; results: true };
}>;

function avgOf(results: { score: number | null }[]): number | null {
  const scored = results.filter((r) => r.score !== null);
  if (scored.length === 0) return null;
  return scored.reduce((sum, r) => sum + (r.score ?? 0), 0) / scored.length;
}

/**
 * 两次评测的并排对比。
 *
 * 为什么按用例逐条摆开，而不是只给两个平均分：平均分相同可能掩盖
 * 「A 在这几题更好、B 在那几题更好」。要看出版本的性格差异，必须逐条看。
 */
function ComparePanel({
  base,
  other,
}: {
  base: { run: { id: string; promptVersion: { name: string } }; rows: EvalResultRow[] };
  other: CompareRun;
}) {
  const otherByCase = new Map(other.results.map((r) => [r.caseId, r]));

  // 只对两边都跑过的用例算差异 —— 单边有分的比较不了
  const paired = base.rows
    .map((row) => {
      const mine = row.score;
      const theirs = otherByCase.get(row.caseId)?.score ?? null;
      return { row, mine, theirs };
    })
    .filter((p) => p.mine !== null && p.theirs !== null);

  const deltas = paired.map((p) => (p.mine as number) - (p.theirs as number));
  const meanDelta =
    deltas.length > 0 ? deltas.reduce((a, b) => a + b, 0) / deltas.length : null;
  const baseAvg = avgOf(base.rows.map((r) => ({ score: r.score })));
  const otherAvg = avgOf(other.results);

  const headClass = "px-3 py-2 text-left text-xs font-normal text-faint whitespace-nowrap";

  return (
    <section className="mt-6 space-y-3">
      <h2 className={sectionTitleClass}>对比</h2>

      <div className="flex flex-wrap items-baseline gap-x-8 gap-y-1 text-xs">
        <span className="text-muted">
          当前 <span className="text-ink">{base.run.promptVersion.name}</span>
          <span className="num ml-2 text-faint">{baseAvg?.toFixed(2) ?? "—"}</span>
        </span>
        <span className="text-muted">
          对比 <span className="text-ink">{other.promptVersion.name}</span>
          <span className="num ml-2 text-faint">{otherAvg?.toFixed(2) ?? "—"}</span>
        </span>
        <span className="text-muted">
          平均差{" "}
          <span
            className={`num ${
              meanDelta === null ? "text-faint" : meanDelta > 0 ? "text-ink" : meanDelta < 0 ? "text-danger" : "text-muted"
            }`}
          >
            {meanDelta === null ? "—" : `${meanDelta > 0 ? "+" : ""}${meanDelta.toFixed(2)}`}
          </span>
          <span className="ml-1 text-faint">（{paired.length} 条可比）</span>
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line">
              <th className={headClass}>#</th>
              <th className={`${headClass} w-full`}>题目</th>
              <th className={`${headClass} text-right`}>{base.run.promptVersion.name}</th>
              <th className={`${headClass} text-right`}>{other.promptVersion.name}</th>
              <th className={`${headClass} text-right`}>差</th>
            </tr>
          </thead>
          <tbody>
            {paired.map(({ row, mine, theirs }) => {
              const delta = (mine as number) - (theirs as number);
              return (
                <tr key={row.caseId} className="border-b border-line-soft">
                  <td className="num px-3 py-2 text-xs text-faint">{row.position + 1}</td>
                  <td className="max-w-0 px-3 py-2">
                    <span className="block truncate text-xs text-muted">{row.input}</span>
                  </td>
                  <td className="num px-3 py-2 text-right">{mine}</td>
                  <td className="num px-3 py-2 text-right">{theirs}</td>
                  <td
                    className={`num px-3 py-2 text-right ${
                      delta > 0 ? "text-ink" : delta < 0 ? "text-danger" : "text-faint"
                    }`}
                  >
                    {delta > 0 ? `+${delta}` : delta}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {paired.length === 0 && (
        <p className="text-xs text-faint">
          两次评测还没有共同跑完的用例，暂时没法逐条对比。
        </p>
      )}
    </section>
  );
}

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function DetailFallback() {
  return (
    <div className="space-y-3 py-6">
      <div className="h-6 w-64 bg-panel/40" />
      <div className="h-8 border-y border-line bg-panel/30" />
      <div className="h-32 border-b border-line-soft bg-panel/20" />
    </div>
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
