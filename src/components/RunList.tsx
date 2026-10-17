"use client";

import { Fragment, useState } from "react";
import { formatCostUsd, formatLatency, estimateCostUsd } from "@/lib/pricing";
import type { SerializedSpan } from "@/lib/spans";

export interface RunRow extends SerializedSpan {
  /** 时间标签在服务端算好再传过来 —— 客户端算会因时区不同导致 hydration 不匹配 */
  timeLabel: string;
}

export default function RunList({ rows }: { rows: RunRow[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <div className="px-6 py-16 text-center">
        <p className="text-sm text-muted">还没有调用记录。</p>
        <p className="mt-1.5 text-xs text-faint">
          在上面输入一个 prompt 并运行，这次调用的 token 数、耗时和花费会出现在这里。
        </p>
      </div>
    );
  }

  // 耗时条的基准：当前列表里最慢的一次。
  // 用相对值而不是绝对刻度 —— 目的是「哪次明显更慢」一眼可见。
  const maxLatency = Math.max(...rows.map((r) => r.latencyMs ?? 0), 1);

  const headClass =
    "px-3 py-2 text-left text-xs font-normal text-faint whitespace-nowrap";

  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-line">
          <th className={headClass}>时间</th>
          <th className={headClass}>模型</th>
          <th className={`${headClass} w-full`}>prompt</th>
          <th className={`${headClass} text-right`}>输入</th>
          <th className={`${headClass} text-right`}>输出</th>
          <th className={headClass}>耗时</th>
          <th className={`${headClass} text-right`}>成本（上限）</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const failed = Boolean(row.output?.error);
          const open = openId === row.id;
          const cost = estimateCostUsd(row.model, {
            inputTokens: row.inputTokens,
            outputTokens: row.outputTokens,
          });
          const barPct = row.latencyMs ? (row.latencyMs / maxLatency) * 100 : 0;
          const toggle = () => setOpenId(open ? null : row.id);

          return (
            <Fragment key={row.id}>
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
                  <span className="text-ink">{row.model ?? row.name}</span>
                  {row.input.thinking && (
                    <span className="ml-1.5 text-brass" title="开启了思考模式">
                      ◆
                    </span>
                  )}
                </td>

                <td className="max-w-0 px-3 py-2">
                  <span className="block truncate text-xs text-muted">
                    {failed ? (
                      <span className="text-danger">调用失败 · {row.output?.error}</span>
                    ) : (
                      row.input.prompt
                    )}
                  </span>
                </td>

                {/* 失败的调用显示「—」而不是 0：0 读起来像「测到了零个 token」，
                    实际是「这次没有可测量的结果」。 */}
                <td className="num px-3 py-2 text-right text-xs text-steel">
                  {failed ? "—" : (row.inputTokens?.toLocaleString("en-US") ?? "—")}
                </td>

                <td className="num px-3 py-2 text-right text-xs text-brass">
                  {failed ? "—" : (row.outputTokens?.toLocaleString("en-US") ?? "—")}
                </td>

                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    {/* 耗时条：按列表内最慢的一次等比缩放 */}
                    <span className="h-1.5 w-16 shrink-0 overflow-hidden rounded-xs bg-panel-2">
                      <span
                        className={`block h-full ${failed ? "bg-danger/60" : "bg-brass"}`}
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
                  <td colSpan={7} className="px-3 py-4">
                    {/* items-start：让每个块按内容高度排，不被同行的长块拉伸 */}
                    <div className="grid items-start gap-4 lg:grid-cols-2">
                      <DetailBlock title="prompt" body={row.input.prompt} />

                      {row.output?.reasoningText ? (
                        <DetailBlock
                          title="思考过程"
                          body={row.output.reasoningText}
                          tone="brass"
                        />
                      ) : null}

                      <DetailBlock
                        title={failed ? "错误" : "回复"}
                        body={
                          failed
                            ? (row.output?.error ?? "")
                            : (row.output?.text ?? "(空回复)")
                        }
                        tone={failed ? "danger" : undefined}
                      />
                    </div>

                    <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-line pt-3 text-xs">
                      <Meta label="run_id" value={row.runId} mono />
                      <Meta label="span_id" value={row.id} mono />
                      <Meta label="parent_id" value={row.parentId ?? "null（Stage 0）"} mono />
                      <Meta label="type" value={row.type} mono />
                      <Meta
                        label="温度"
                        value={
                          row.input.thinking
                            ? "不适用（思考模式已开启）"
                            : (row.input.temperature?.toString() ?? "默认")
                        }
                      />
                      <Meta
                        label="finish_reason"
                        value={row.output?.finishReason ?? "—"}
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

function DetailBlock({
  title,
  body,
  tone,
}: {
  title: string;
  body: string;
  tone?: "brass" | "danger";
}) {
  const toneClass =
    tone === "brass" ? "text-brass/80" : tone === "danger" ? "text-danger" : "text-ink";

  return (
    <div>
      <h3 className="mb-1.5 text-xs text-faint">{title}</h3>
      <pre
        className={`num max-h-72 overflow-auto rounded-xs border border-line-soft bg-base p-3 text-xs leading-relaxed whitespace-pre-wrap ${toneClass}`}
      >
        {body}
      </pre>
    </div>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-faint">{label}</dt>
      <dd className={`${mono ? "num" : ""} text-muted`}>{value}</dd>
    </div>
  );
}
