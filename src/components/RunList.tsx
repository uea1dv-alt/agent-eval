"use client";

import { Fragment, useState } from "react";
import { estimateCostUsd, formatCostUsd, formatLatency } from "@/lib/pricing";
import type { RunGroup } from "@/lib/runs";
import { Meta } from "./DetailBlock";
import TraceTree from "./TraceTree";

/**
 * 历史运行列表。
 *
 * Stage 0 时这里列的是**每次调用**（一条 span 一行）。Stage 1 之后列的是**每次运行** ——
 * 因为一次 agent 运行会产生 8 个 span，平铺出来看不出它们是一回事。
 * 展开一行，里面才是那棵树。
 */

export interface RunRow extends RunGroup {
  /** 时间标签在服务端算好再传过来 —— 客户端算会因时区不同导致 hydration 不匹配 */
  timeLabel: string;
}

export default function RunList({ rows }: { rows: RunRow[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <div className="px-6 py-16 text-center">
        <p className="text-sm text-muted">还没有运行记录。</p>
        <p className="mt-1.5 text-xs text-faint">
          在上面输入一个 prompt 并运行，这次运行的每一步、每个工具调用都会出现在这里。
        </p>
      </div>
    );
  }

  // 耗时条的基准：当前列表里最慢的一次。
  // 用相对值而不是绝对刻度 —— 目的是「哪次明显更慢」一眼可见。
  const maxLatency = Math.max(...rows.map((r) => r.latencyMs ?? 0), 1);

  const headClass = "px-3 py-2 text-left text-xs font-normal text-faint whitespace-nowrap";

  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-line">
          <th className={headClass}>时间</th>
          <th className={headClass}>模型</th>
          <th className={`${headClass} w-full`}>prompt</th>
          <th className={headClass}>过程</th>
          <th className={`${headClass} text-right`}>输入</th>
          <th className={`${headClass} text-right`}>输出</th>
          <th className={headClass}>耗时</th>
          <th className={`${headClass} text-right`}>成本（上限）</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const open = openId === row.runId;
          const cost = estimateCostUsd(row.model, {
            inputTokens: row.inputTokens,
            outputTokens: row.outputTokens,
          });
          const barPct = row.latencyMs ? (row.latencyMs / maxLatency) * 100 : 0;
          const toggle = () => setOpenId(open ? null : row.runId);

          // 只有一步、也没调工具 = Stage 0 那种单次调用，不用显示「1 步」
          const isSingle = row.stepCount <= 1 && row.toolCount === 0;

          return (
            <Fragment key={row.runId}>
              <tr
                onClick={toggle}
                // 键盘也要能展开 —— 只用鼠标才能操作的行，键盘用户完全够不着
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggle();
                  }
                }}
                tabIndex={0}
                aria-expanded={open}
                className={`cursor-pointer border-b border-line-soft transition-colors hover:bg-panel/60 ${
                  open ? "bg-panel/60" : ""
                }`}
              >
                <td className="num px-3 py-2 text-xs whitespace-nowrap text-muted">
                  {row.timeLabel}
                </td>

                <td className="px-3 py-2 text-xs whitespace-nowrap">
                  <span className="text-ink">{row.model ?? "—"}</span>
                  {row.root.input.thinking && (
                    <span className="ml-1.5 text-brass" title="开启了思考模式">
                      ◆
                    </span>
                  )}
                </td>

                <td className="max-w-0 px-3 py-2">
                  <span className="block truncate text-xs text-muted">
                    {row.failed ? (
                      <span className="text-danger">运行失败 · {row.error}</span>
                    ) : (
                      row.prompt
                    )}
                  </span>
                </td>

                <td className="num px-3 py-2 text-xs whitespace-nowrap">
                  {isSingle ? (
                    <span className="text-faint">单次</span>
                  ) : (
                    <>
                      <span className="text-muted">{row.stepCount} 步</span>
                      {row.toolCount > 0 && (
                        <span className="text-faint"> · {row.toolCount} 工具</span>
                      )}
                    </>
                  )}
                </td>

                {/* 失败的运行显示「—」而不是 0：0 读起来像「测到了零个 token」，
                    实际是「这次没有可测量的结果」。 */}
                <td className="num px-3 py-2 text-right text-xs text-steel">
                  {row.failed ? "—" : row.inputTokens.toLocaleString("en-US")}
                </td>

                <td className="num px-3 py-2 text-right text-xs text-brass">
                  {row.failed ? "—" : row.outputTokens.toLocaleString("en-US")}
                </td>

                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    {/* 耗时条：按列表内最慢的一次等比缩放 */}
                    <span className="h-1.5 w-16 shrink-0 overflow-hidden rounded-xs bg-panel-2">
                      <span
                        className={`block h-full ${row.failed ? "bg-danger/60" : "bg-brass"}`}
                        style={{ width: `${barPct}%` }}
                      />
                    </span>
                    <span className="num text-xs whitespace-nowrap text-muted">
                      {formatLatency(row.latencyMs)}
                    </span>
                  </div>
                </td>

                <td className="num px-3 py-2 text-right text-xs whitespace-nowrap text-muted">
                  {formatCostUsd(cost)}
                </td>
              </tr>

              {open && (
                <tr className="border-b border-line-soft bg-panel/40">
                  <td colSpan={8} className="px-3 pt-3 pb-4">
                    <TraceTree roots={row.tree} expandDepth={1} />

                    <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 border-t border-line pt-2.5 text-xs">
                      <Meta label="run_id" value={row.runId} mono />
                      <Meta label="span 总数" value={String(row.spans.length)} mono />
                      <Meta
                        label="max_steps"
                        value={row.root.input.maxSteps?.toString() ?? "—"}
                        mono
                      />
                      <Meta
                        label="finish_reason"
                        value={row.root.output?.finishReason ?? "—"}
                        mono
                      />
                    </dl>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
