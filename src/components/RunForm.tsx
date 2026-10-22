"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { ModelInfo } from "@/lib/providers/types";
import { useAgentStream } from "@/lib/use-agent-stream";
import AgentRun from "./AgentRun";
import { inputClass, labelClass } from "./form-styles";

interface ProviderMeta {
  id: string;
  label: string;
  models: ModelInfo[];
}

interface Props {
  providers: ProviderMeta[];
  defaultProviderId: string;
}

type Mode = "single" | "agent";

const MODES: { id: Mode; label: string; hint: string }[] = [
  {
    id: "agent",
    label: "多步 Agent",
    hint: "模型可以查库、算数，来回好几步。边跑边看 trace 树长出来。",
  },
  {
    id: "single",
    label: "单次调用",
    hint: "一问一答，只调一次模型。用来做最基础的对照。",
  },
];

// 输入框和标签的样式放在 form-styles.ts —— 评测页的几个表单也用同一套

export default function RunForm({ providers, defaultProviderId }: Props) {
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("agent");

  // 目前只注册了一个 provider，所以这不是 state。
  // 等真加了第二个再改成可切换的 —— 现在摆一个永远只有一项的下拉框是假选项。
  const providerId = defaultProviderId;
  const provider = providers.find((p) => p.id === providerId) ?? providers[0];

  const [model, setModel] = useState(provider.models[0]?.id ?? "");
  const [prompt, setPrompt] = useState("");
  const [thinking, setThinking] = useState(false);
  const [temperature, setTemperature] = useState("1");
  const [maxOutputTokens, setMaxOutputTokens] = useState("2048");
  const [reasoningEffort, setReasoningEffort] = useState("high");
  const [maxSteps, setMaxSteps] = useState("6");

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const agent = useAgentStream();

  const currentModel = useMemo(
    () => provider.models.find((m) => m.id === model),
    [provider, model],
  );

  // thinking 开关是否对当前模型有意义 —— 由 provider 声明，不在这里硬编码模型名
  const thinkingAvailable = currentModel?.supportsThinking ?? false;
  // thinking 开着时温度无效，直接禁用而不是让它「看起来能调」
  const temperatureDisabled = thinking && thinkingAvailable;

  const busy = running || agent.state.status === "running";

  // agent 跑完让服务端组件重新查库，历史列表里立刻出现这次运行。
  // 不能像单次调用那样提交后马上 refresh —— 那时候 span 才刚建了根节点，
  // 刷出来是一棵只有根的空树。
  useEffect(() => {
    if (agent.state.status === "done") router.refresh();
  }, [agent.state.status, router]);

  /** 收集所有模式下共用的参数。空字符串不能直接 Number() —— Number("") 是 0，会静默把温度设成 0 */
  function commonParams() {
    return {
      providerId,
      model,
      prompt,
      thinking: thinkingAvailable ? thinking : false,
      temperature:
        temperatureDisabled || temperature.trim() === "" ? undefined : Number(temperature),
      maxOutputTokens: maxOutputTokens ? Number(maxOutputTokens) : undefined,
      reasoningEffort: thinkingAvailable && thinking ? reasoningEffort : undefined,
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || busy) return;

    if (mode === "agent") {
      setError(null);
      await agent.run({ ...commonParams(), maxSteps: Number(maxSteps) || 6 });
      return;
    }

    setRunning(true);
    setError(null);

    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(commonParams()),
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

  const activeMode = MODES.find((m) => m.id === mode)!;

  return (
    <>
      <div className="border-b border-line">
        {/* 模式切换。两个模式共用下面所有输入项，只有提交路径不同 ——
            所以做成切换而不是两个并排的表单 */}
        <div className="flex items-center gap-1 px-6 pt-3">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              aria-pressed={mode === m.id}
              disabled={busy}
              className={`-mb-px border-b-2 px-3 py-1.5 text-xs transition-colors disabled:opacity-40 ${
                mode === m.id
                  ? "border-brass text-ink"
                  : "border-transparent text-faint hover:text-muted"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="px-6 pt-2 text-xs text-faint">{activeMode.hint}</p>

        <form onSubmit={handleSubmit}>
          <div className="px-6 py-4">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={
                mode === "agent"
                  ? "问一个需要查数据 + 算数的问题，比如「最近 5 次调用的平均耗时是多少？」"
                  : "输入 prompt，Ctrl+Enter 直接运行"
              }
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

              {mode === "agent" && (
                <div>
                  <label htmlFor="maxSteps" className={labelClass}>
                    最大步数
                  </label>
                  <input
                    id="maxSteps"
                    type="number"
                    min="1"
                    max="12"
                    value={maxSteps}
                    onChange={(e) => setMaxSteps(e.target.value)}
                    className={`${inputClass} num`}
                  />
                </div>
              )}

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
                  disabled={busy || !prompt.trim()}
                  className="w-full rounded-xs bg-brass px-4 py-1.5 text-sm font-medium text-base
                             transition-colors hover:bg-brass/85
                             disabled:cursor-not-allowed disabled:bg-panel-2 disabled:text-faint"
                >
                  {busy ? "运行中…" : "运行"}
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
      </div>

      {/* 跑过之后才出现 —— 没跑之前这块是空的，不该占位置 */}
      {agent.state.status !== "idle" && (
        <AgentRun state={agent.state} onCancel={agent.cancel} />
      )}
    </>
  );
}
