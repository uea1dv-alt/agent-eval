"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { ModelInfo } from "@/lib/providers/types";
import { alertClass, hintClass, inputClass, labelClass, primaryButtonClass } from "./form-styles";

interface Props {
  models: ModelInfo[];
}

/**
 * 新建一个 prompt 版本。
 *
 * 为什么模型、温度这些也要存进版本里：评测要回答的是「哪个 prompt 更好」。
 * 如果两个版本用的模型或温度不一样，分数差就分不清是谁的功劳 ——
 * 那不是对比，是两个变量一起动。所以一组条件 = 一个版本。
 */
export default function PromptVersionForm({ models }: Props) {
  const router = useRouter();

  const [name, setName] = useState("");
  const [system, setSystem] = useState("");
  const [model, setModel] = useState(models[0]?.id ?? "");
  const [temperature, setTemperature] = useState("0");
  const [maxOutputTokens, setMaxOutputTokens] = useState("1024");
  const [thinking, setThinking] = useState(false);
  const [reasoningEffort, setReasoningEffort] = useState("high");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedName, setSavedName] = useState<string | null>(null);

  const currentModel = useMemo(() => models.find((m) => m.id === model), [models, model]);
  const thinkingAvailable = currentModel?.supportsThinking ?? false;
  // 思考开启时温度会被厂商忽略，所以禁用而不是让它「看起来能调」（和 RunForm 同一条规则）
  const temperatureDisabled = thinking && thinkingAvailable;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving || !name.trim() || !system.trim()) return;

    setSaving(true);
    setError(null);
    setSavedName(null);

    try {
      const res = await fetch("/api/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          system,
          model,
          temperature:
            temperatureDisabled || temperature.trim() === "" ? undefined : Number(temperature),
          maxOutputTokens: maxOutputTokens ? Number(maxOutputTokens) : undefined,
          thinking: thinkingAvailable ? thinking : false,
          reasoningEffort: thinkingAvailable && thinking ? reasoningEffort : undefined,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? `保存失败（HTTP ${res.status}）`);
        return;
      }

      setSavedName(data.promptVersion.name);
      setName("");
      setSystem("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label htmlFor="pv-name" className={labelClass}>
          版本名
        </label>
        <input
          id="pv-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="v1-直接给答案 / v2-要求写过程"
          className={inputClass}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="col-span-2">
          <label htmlFor="pv-model" className={labelClass}>
            模型
          </label>
          <select
            id="pv-model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className={inputClass}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="pv-temp" className={labelClass}>
            温度
          </label>
          <input
            id="pv-temp"
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
          <label htmlFor="pv-max" className={labelClass}>
            最大输出
          </label>
          <input
            id="pv-max"
            type="number"
            min="1"
            value={maxOutputTokens}
            onChange={(e) => setMaxOutputTokens(e.target.value)}
            className={`${inputClass} num`}
          />
        </div>
      </div>

      <div className="flex items-center gap-4">
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

        {thinkingAvailable && thinking && (
          <select
            value={reasoningEffort}
            onChange={(e) => setReasoningEffort(e.target.value)}
            aria-label="思考强度"
            className={`${inputClass} w-auto`}
          >
            <option value="low">low</option>
            <option value="high">high</option>
            <option value="max">max</option>
          </select>
        )}
      </div>

      <div>
        <label htmlFor="pv-system" className={labelClass}>
          system 提示词 —— 评测比的就是这个
        </label>
        <textarea
          id="pv-system"
          value={system}
          onChange={(e) => setSystem(e.target.value)}
          rows={6}
          placeholder="你是一个数学助手。先写出计算过程，最后单独一行用「答案是：X」给出结果。"
          className={`${inputClass} resize-y leading-relaxed`}
        />
        <p className={`mt-1.5 ${hintClass}`}>
          用例的题目会作为用户消息发进去。版本之间的差别应该只有这段提示词 ——
          想比出结论，一次只改一处。
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving || !name.trim() || !system.trim()}
          className={primaryButtonClass}
        >
          {saving ? "保存中…" : "保存版本"}
        </button>
        {savedName && (
          <span className="text-xs text-muted" role="status">
            已保存「{savedName}」
          </span>
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
