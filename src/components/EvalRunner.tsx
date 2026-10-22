"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { alertClass, primaryButtonClass } from "./form-styles";

interface Props {
  evalId: string;
  /** 还没跑过的用例 id。已经跑完的不在这里 —— 重跑会重复花钱 */
  pendingCaseIds: string[];
  total: number;
  done: number;
}

/** 一次运行期间的进度。current 是**绝对**条数（含本次开跑前就完成的） */
interface Progress {
  current: number;
  start: number;
}

/**
 * 逐条跑完剩下的用例。
 *
 * **串行**而不是并发：并发确实更快，但每一并发都是一次真实的模型调用。
 * 串行能让用户在进度条上看到「第 3/20 条」，随时可以停；
 * 并发的话，中间出错你根本不知道是哪一条烂了。
 *
 * 中途关页面不要紧：每条用例跑完就落库，下次进来剩几条跑几条。
 */
export default function EvalRunner({ evalId, pendingCaseIds, total, done }: Props) {
  const router = useRouter();

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [failures, setFailures] = useState<string[]>([]);
  const [finished, setFinished] = useState(false);

  const pending = pendingCaseIds.length;

  // 进度直接维护成绝对值，不用 useEffect 去「同步」 done 的变化 ——
  // 那是把可以算出来的东西存了两份，refresh 之后还得记得清掉，容易算重
  const shown = progress?.current ?? done;

  async function run() {
    if (running || pending === 0) return;

    setRunning(true);
    setFailures([]);
    setFinished(false);
    setProgress({ current: done, start: done });

    const fails: string[] = [];
    let current = done;

    for (const caseId of pendingCaseIds) {
      try {
        const res = await fetch(`/api/evals/${evalId}/cases/${caseId}`, { method: "POST" });
        if (!res.ok) {
          // 单条失败不该中断整批 —— 接着跑，最后一起报给你
          const data = await res.json().catch(() => ({}));
          fails.push(data.error ?? `HTTP ${res.status}`);
        }
      } catch (err) {
        fails.push(err instanceof Error ? err.message : String(err));
      }
      current += 1;
      // 每跑完一条就更新进度。React 会把这些更新攒成一次渲染
      setProgress({ current, start: done });
    }

    setFailures(fails);
    setRunning(false);
    setFinished(true);
    // 全部跑完后重新拉服务端数据，表格才有新的回答和分数
    router.refresh();
  }

  if (pending === 0 && !running) {
    return (
      <p className="text-xs text-muted">
        全部 <span className="num">{total}</span> 条都跑完了。想换个版本比，
        回评测列表用同一个数据集再发起一次。
      </p>
    );
  }

  const runningIndex = progress ? progress.current - progress.start + 1 : 1;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={run} disabled={running} className={primaryButtonClass}>
          {running
            ? `正在跑 ${Math.min(runningIndex, pending)}/${pending}…`
            : finished
              ? "再跑一遍剩下的"
              : `跑剩下 ${pending} 条`}
        </button>

        <span className="num text-xs text-muted">
          {Math.min(shown, total)}/{total}
        </span>

        {finished && failures.length === 0 && (
          <span className="text-xs text-muted" role="status">
            跑完了，上面表格已刷新
          </span>
        )}
      </div>

      {/* 进度条：一整批最多几十条，看到它在动比看一个转圈更让人安心 */}
      <div
        className="h-1 w-full max-w-sm overflow-hidden rounded-xs bg-panel-2"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={Math.min(shown, total)}
        aria-label="评测进度"
      >
        <div
          className="h-full bg-brass transition-[width] duration-300"
          style={{ width: total > 0 ? `${(Math.min(shown, total) / total) * 100}%` : "0%" }}
        />
      </div>

      {failures.length > 0 && (
        <p role="alert" className={alertClass}>
          有 {failures.length} 条没跑成（其余已落库）。第一条原因：{failures[0]}
          <br />
          再点一次上面的按钮会重跑剩下的 —— 已经成功的会直接复用，不会重复花钱。
        </p>
      )}
    </div>
  );
}
