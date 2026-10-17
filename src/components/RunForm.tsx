"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { ModelInfo } from "@/lib/providers/types";

interface ProviderMeta {
  id: string;
  label: string;
  models: ModelInfo[];
}

interface Props {
  providers: ProviderMeta[];
  defaultProviderId: string;
}

const inputClass =
  "w-full rounded-xs border border-line bg-base px-2.5 py-1.5 text-sm " +
  "placeholder:text-faint focus:border-brass/60 disabled:opacity-40 disabled:cursor-not-allowed";

const labelClass = "block text-xs text-muted mb-1.5";

export default function RunForm({ providers, defaultProviderId }: Props) {
  const router = useRouter();

  const [providerId, setProviderId] = useState(defaultProviderId);
  const provider = providers.find((p) => p.id === providerId) ?? providers[0];

  const [model, setModel] = useState(provider.models[0]?.id ?? "");
  const [prompt, setPrompt] = useState("");
  const [thinking, setThinking] = useState(false);
  const [temperature, setTemperature] = useState("1");
  const [maxOutputTokens, setMaxOutputTokens] = useState("2048");
  const [reasoningEffort, setReasoningEffort] = useState("high");

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentModel = useMemo(
    () => provider.models.find((m) => m.id === model),
    [provider, model],
  );

  // thinking 开关是否对当前模型有意义 —— 由 provider 声明，不在这里硬编码模型名
  const thinkingAvailable = currentModel?.supportsThinking ?? false;
  // thinking 开着时温度无效，直接禁用而不是让它「看起来能调」
  const temperatureDisabled = thinking && thinkingAvailable;

  function handleProviderChange(nextId: string) {
    setProviderId(nextId);
    const next = providers.find((p) => p.id === nextId);
    if (next?.models[0]) setModel(next.models[0].id);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || running) return;

    setRunning(true);
    setError(null);

    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId,
          model,
          prompt,
          thinking: thinkingAvailable ? thinking : false,
          // 空字符串不能直接 Number() —— Number("") 是 0，会静默把温度设成 0。
          // 清空就当作「不指定」，交给模型默认值。
          temperature:
            temperatureDisabled || temperature.trim() === ""
              ? undefined
              : Number(temperature),
          maxOutputTokens: maxOutputTokens ? Number(maxOutputTokens) : undefined,
          reasoningEffort: thinkingAvailable && thinking ? reasoningEffort : undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? `请求失败（HTTP ${res.status}）`);
        return;
      }

      // 模型调用失败时后端也返回 200（失败记录同样入库），用 ok 字段区分
      if (!data.ok) {
        setError(data.span?.output?.error ?? "模型调用失败，已记录到下方列表");
      } else {
        setPrompt("");
      }

      // 让服务端组件重新查库，列表立刻出现新记录
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="border-b border-line">
      <div className="px-6 py-5">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="输入 prompt，Ctrl+Enter 直接运行"
          rows={3}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSubmit(e);
          }}
          className={`${inputClass} resize-y leading-relaxed`}
        />

        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
          <div className="col-span-2 lg:col-span-1">
            <label htmlFor="model" className={labelClass}>
              模型
            </label>
            <select
              id="model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className={inputClass}
            >
              {provider.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="temperature" className={labelClass}>
              温度
            </label>
            <input
              id="temperature"
              type="number"
              step="0.1"
              min="0"
              max="2"
              value={temperatureDisabled ? "" : temperature}
              disabled={temperatureDisabled}
              onChange={(e) => setTemperature(e.target.value)}
              className={`${inputClass} num`}
            />
          </div>

          <div>
            <label htmlFor="maxTokens" className={labelClass}>
              最大输出
            </label>
            <input
              id="maxTokens"
              type="number"
              min="1"
              value={maxOutputTokens}
              onChange={(e) => setMaxOutputTokens(e.target.value)}
              className={`${inputClass} num`}
            />
          </div>

          <div className="flex items-end pb-0.5">
            <label className="flex cursor-pointer items-center gap-2 text-sm select-none">
              <input
                type="checkbox"
                checked={thinkingAvailable && thinking}
                disabled={!thinkingAvailable}
                onChange={(e) => setThinking(e.target.checked)}
                className="size-4 accent-brass disabled:opacity-40"
              />
              <span className={thinkingAvailable ? "" : "text-faint"}>思考模式</span>
            </label>
          </div>

          {thinkingAvailable && thinking && (
            <div>
              <label htmlFor="effort" className={labelClass}>
                思考强度
              </label>
              <select
                id="effort"
                value={reasoningEffort}
                onChange={(e) => setReasoningEffort(e.target.value)}
                className={inputClass}
              >
                <option value="low">low</option>
                <option value="high">high</option>
                <option value="max">max</option>
              </select>
            </div>
          )}

          <div className="col-span-2 flex items-end justify-end lg:col-span-1 lg:col-start-6">
            <button
              type="submit"
              disabled={running || !prompt.trim()}
              className="w-full rounded-xs bg-brass px-4 py-1.5 text-sm font-medium text-base
                         transition-colors hover:bg-brass/85
                         disabled:cursor-not-allowed disabled:bg-panel-2 disabled:text-faint"
            >
              {running ? "运行中…" : "运行"}
            </button>
          </div>
        </div>

        {/* 这两个提示是同一个坑的两面：DeepSeek V4 默认开思考，而思考开着时温度被忽略。
            不写清楚的话，用户调温度没反应会以为是代码坏了。 */}
        {temperatureDisabled && (
          <p className="mt-3 border-l-2 border-brass/50 pl-3 text-xs leading-relaxed text-muted">
            思考模式开启时，DeepSeek 会忽略温度和 topP —— 采样参数只在非思考模式下生效。
            想调温度，先把思考模式关掉。
          </p>
        )}
        {currentModel && !currentModel.supportsThinking && (
          <p className="mt-3 text-xs text-faint">该模型不支持思考模式。</p>
        )}
        {currentModel?.description && (
          <p className="mt-2 text-xs text-faint">{currentModel.description}</p>
        )}

        {error && (
          <p
            role="alert"
            className="mt-3 rounded-xs border border-danger/40 bg-danger/10 px-3 py-2 text-xs leading-relaxed text-danger"
          >
            {error}
          </p>
        )}
      </div>
    </form>
  );
}
