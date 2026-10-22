"use client";

import { Fragment, useState } from "react";
import { formatLatency, formatTokens } from "@/lib/pricing";
import { DetailBlock, Meta } from "./DetailBlock";

export interface EvalResultRow {
  /** 用例 id —— 用它当 key，没跑过的用例也得有一行 */
  caseId: string;
  position: number;
  input: string;
  reference: string | null;
  /** null 表示这条还没跑 */
  done: boolean;
  output: string | null;
  score: number | null;
  scoreReason: string | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  judgeInputTokens: number | null;
  judgeOutputTokens: number | null;
  error: string | null;
}

/** 分数用颜色分档：只有「好 / 一般 / 差」三档，够用且不制造假的精度 */
function scoreTone(score: number): string {
  if (score >= 8) return "text-ink";
  if (score >= 5) return "text-brass";
  return "text-danger";
}

export default function EvalResults({ rows }: { rows: EvalResultRow[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const headClass = "px-3 py-2 text-left text-xs font-normal text-faint whitespace-nowrap";

  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-line">
          <th className={headClass}>#</th>
          <th className={`${headClass} w-full`}>题目</th>
          <th className={`${headClass} text-right`}>分数</th>
          <th className={headClass}>judge 理由</th>
          <th className={headClass}>耗时</th>
          <th className={`${headClass} text-right`}>token</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const open = openId === row.caseId;
          const toggle = () => setOpenId(open ? null : row.caseId);

          return (
            <Fragment key={row.caseId}>
              <tr
                onClick={toggle}
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
                <td className="num px-3 py-2 text-xs text-faint">{row.position + 1}</td>

                <td className="max-w-0 px-3 py-2">
                  <span className="block truncate text-xs text-muted">{row.input}</span>
                </td>

                <td className="num px-3 py-2 text-right">
                  {!row.done ? (
                    <span className="text-xs text-faint">未跑</span>
                  ) : row.score === null ? (
                    // 判分失败 ≠ 0 分。显示 0 会把「没测出来」说成「答得很差」
                    <span className="text-xs text-danger" title={row.error ?? "判分失败"}>
                      失败
                    </span>
                  ) : (
                    <span className={scoreTone(row.score)}>{row.score}</span>
                  )}
                </td>

                <td className="max-w-0 px-3 py-2">
                  <span className="block truncate text-xs text-faint">
                    {row.error ? (
                      <span className="text-danger">{row.error}</span>
                    ) : (
                      (row.scoreReason ?? "—")
                    )}
                  </span>
                </td>

                <td className="num px-3 py-2 text-xs whitespace-nowrap text-muted">
                  {formatLatency(row.latencyMs)}
                </td>

                <td className="num px-3 py-2 text-right text-xs whitespace-nowrap text-faint">
                  {row.inputTokens === null ? "—" : `${formatTokens(row.inputTokens)} / ${formatTokens(row.outputTokens)}`}
                </td>
              </tr>

              {open && (
                <tr className="border-b border-line-soft bg-panel/40">
                  <td colSpan={6} className="space-y-3 px-3 pt-3 pb-4">
                    <DetailBlock title="题目" body={row.input} />
                    {row.reference && <DetailBlock title="参考答案" body={row.reference} tone="muted" />}
                    {row.output !== null && <DetailBlock title="模型回答" body={row.output} />}
                    {row.scoreReason && (
                      <DetailBlock
                        title={`judge 理由${row.score !== null ? ` · ${row.score} 分` : ""}`}
                        body={row.scoreReason}
                      />
                    )}
                    {row.error && (
                      <DetailBlock title="错误" body={row.error} tone="danger" />
                    )}

                    <dl className="flex flex-wrap gap-x-6 gap-y-1.5 border-t border-line pt-2.5 text-xs">
                      <Meta label="case_id" value={row.caseId} mono />
                      <Meta label="输入 token" value={formatTokens(row.inputTokens)} mono />
                      <Meta label="输出 token" value={formatTokens(row.outputTokens)} mono />
                      <Meta label="judge 输入" value={formatTokens(row.judgeInputTokens)} mono />
                      <Meta label="judge 输出" value={formatTokens(row.judgeOutputTokens)} mono />
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
