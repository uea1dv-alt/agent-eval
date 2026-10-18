"use client";

import { buildTree } from "@/lib/agent/tree";
import type { AgentStreamState } from "@/lib/use-agent-stream";
import TraceTree from "./TraceTree";

/**
 * 正在跑的这次 agent 运行。
 *
 * 和 `RunList` 里的树是同一个 `TraceTree` 组件 —— 差别只在数据来源：
 * 这边是 SSE 边推边建，那边是从数据库一次查出来的。
 * **同一个东西不该有两套画法**，所以这里没有复制一份渲染逻辑。
 */
export default function AgentRun({
  state,
  onCancel,
}: {
  state: AgentStreamState;
  onCancel: () => void;
}) {
  const running = state.status === "running";
  const roots = buildTree(state.spans);

  return (
    <section className="border-b border-line">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-6 py-2.5 text-xs">
        <span className={statusClass(state.status)}>{statusLabel(state.status)}</span>

        {running && state.step > 0 && (
          <span className="text-faint">
            第 <span className="num text-ink">{state.step}</span> 步
          </span>
        )}

        {/* 工具执行是 agent 里最慢的一段，而且看不出在动 ——
            必须显式说「正在跑哪个工具」，否则界面看起来像卡住了 */}
        {state.activeTools.length > 0 && (
          <span className="num text-brass">
            正在执行 {state.activeTools.join("、")}…
          </span>
        )}

        <span className="text-faint">
          已落库 <span className="num text-muted">{state.spans.length}</span> 个 span
        </span>

        {state.latencyMs !== null && (
          <span className="text-faint">
            总耗时{" "}
            <span className="num text-muted">
              {(state.latencyMs / 1000).toFixed(2)} s
            </span>
          </span>
        )}

        {running && (
          <button
            type="button"
            onClick={onCancel}
            className="ml-auto rounded-xs border border-line px-2.5 py-1 text-xs text-muted transition-colors hover:border-danger/60 hover:text-danger"
          >
            断开
          </button>
        )}
      </div>

      {state.error && (
        <p
          role="alert"
          className="mx-6 mb-3 rounded-xs border border-danger/40 bg-danger/10 px-3 py-2 text-xs leading-relaxed text-danger"
        >
          {state.error}
        </p>
      )}

      {state.warnings.map((w, i) => (
        <p
          key={i}
          className="mx-6 mb-3 rounded-xs border border-brass/40 bg-brass/10 px-3 py-2 text-xs leading-relaxed text-brass"
        >
          {w}
        </p>
      ))}

      {/* 流式正文。用 min-h 占位，避免第一个字到达时整块内容突然往下跳 */}
      {(state.streamReasoning || state.streamText) && (
        <div className="px-6 pb-3">
          {state.streamReasoning && (
            <pre className="num max-h-40 overflow-auto rounded-xs border border-line-soft bg-base p-3 text-xs leading-relaxed whitespace-pre-wrap text-brass/80">
              {state.streamReasoning}
            </pre>
          )}
          {state.streamText && (
            <pre
              className={`num max-h-56 overflow-auto rounded-xs border border-line-soft bg-base p-3 text-xs leading-relaxed whitespace-pre-wrap text-ink ${
                state.streamReasoning ? "mt-2" : ""
              }`}
            >
              {state.streamText}
            </pre>
          )}
        </div>
      )}

      {roots.length > 0 && (
        <div className="pb-3">
          {/* 实时运行时全展开 —— 就是要看它一层层长出来 */}
          <TraceTree roots={roots} expandDepth={99} />
        </div>
      )}
    </section>
  );
}

function statusLabel(status: AgentStreamState["status"]): string {
  switch (status) {
    case "running":
      return "运行中";
    case "done":
      return "已完成";
    case "error":
      return "失败";
    default:
      return "待运行";
  }
}

function statusClass(status: AgentStreamState["status"]): string {
  switch (status) {
    case "running":
      return "text-brass";
    case "done":
      return "text-ink";
    case "error":
      return "text-danger";
    default:
      return "text-faint";
  }
}
