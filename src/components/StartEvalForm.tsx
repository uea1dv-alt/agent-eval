"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { alertClass, hintClass, inputClass, labelClass, primaryButtonClass } from "./form-styles";

interface DatasetOption {
  id: string;
  name: string;
  caseCount: number;
}

interface PromptOption {
  id: string;
  name: string;
  model: string;
}

interface Props {
  datasets: DatasetOption[];
  prompts: PromptOption[];
}

/**
 * 发起一次评测：数据集 × prompt 版本。
 *
 * 这个表单只建一条「待跑」记录，不在这里跑模型 ——
 * 点完跳到详情页，由那边逐条跑、逐条显示进度。
 * 原因见 API 路由的注释：一整批塞进一个请求会撞 Vercel 的 60 秒上限。
 */
export default function StartEvalForm({ datasets, prompts }: Props) {
  const router = useRouter();

  const [datasetId, setDatasetId] = useState(datasets[0]?.id ?? "");
  const [promptId, setPromptId] = useState(prompts[0]?.id ?? "");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dataset = datasets.find((d) => d.id === datasetId);
  const prompt = prompts.find((p) => p.id === promptId);
  const ready = datasets.length > 0 && prompts.length > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (starting || !ready) return;

    setStarting(true);
    setError(null);

    try {
      const res = await fetch("/api/evals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ datasetId, promptVersionId: promptId }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? `发起失败（HTTP ${res.status}）`);
        setStarting(false);
        return;
      }

      // 直接进详情页开始跑。用 push 而不是 refresh：
      // 详情页还不存在于这次会话的服务端缓存里，push 才会真的走一次请求
      router.push(`/evals/${data.evalRun.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStarting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="ev-dataset" className={labelClass}>
            数据集
          </label>
          <select
            id="ev-dataset"
            value={datasetId}
            onChange={(e) => setDatasetId(e.target.value)}
            disabled={datasets.length === 0}
            className={inputClass}
          >
            {datasets.length === 0 && <option value="">还没有数据集</option>}
            {datasets.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}（{d.caseCount} 条）
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="ev-prompt" className={labelClass}>
            prompt 版本
          </label>
          <select
            id="ev-prompt"
            value={promptId}
            onChange={(e) => setPromptId(e.target.value)}
            disabled={prompts.length === 0}
            className={inputClass}
          >
            {prompts.length === 0 && <option value="">还没有 prompt 版本</option>}
            {prompts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}（{p.model}）
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button type="submit" disabled={starting || !ready} className={primaryButtonClass}>
          {starting ? "创建中…" : "发起评测"}
        </button>

        {ready && dataset && prompt && (
          <p className={hintClass}>
            <span className="num text-muted">{dataset.caseCount}</span> 条用例 × 2 次模型调用
            （作答 + 判分）。被判模型 <span className="num text-muted">{prompt.model}</span>，
            judge 会自动选一个不同的模型。
          </p>
        )}
        {!ready && (
          <p className={hintClass}>
            下方建好数据集和 prompt 版本之后，这里才能发起评测。
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className={alertClass}>
          {error}
        </p>
      )}
    </form>
  );
}
