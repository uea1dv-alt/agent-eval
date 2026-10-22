"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { alertClass, hintClass, inputClass, labelClass, primaryButtonClass } from "./form-styles";

/** 一行一条用例；想给参考答案就用 `||` 分隔。 */
const REFERENCE_SEPARATOR = "||";

interface ParsedCase {
  input: string;
  reference?: string;
}

/**
 * 把多行文本拆成用例数组。
 *
 * 为什么用 `||` 而不是再开一个「参考答案」输入框：
 * 一个题目一个答案框，录入 20 条就是 40 个控件，还没填完人就烦了。
 * 一行一条、可选的第二部分，录入和读回是一回事 —— 复制粘贴整段也能用。
 */
function parseCases(text: string): ParsedCase[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const at = line.indexOf(REFERENCE_SEPARATOR);
      if (at === -1) return { input: line };
      const input = line.slice(0, at).trim();
      const reference = line.slice(at + REFERENCE_SEPARATOR.length).trim();
      return { input, reference: reference || undefined };
    })
    .filter((c) => c.input.length > 0);
}

export default function DatasetForm() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [casesText, setCasesText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedName, setSavedName] = useState<string | null>(null);

  const cases = parseCases(casesText);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving || !name.trim() || cases.length === 0) return;

    setSaving(true);
    setError(null);
    setSavedName(null);

    try {
      const res = await fetch("/api/datasets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          cases,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? `保存失败（HTTP ${res.status}）`);
        return;
      }

      setSavedName(data.dataset.name);
      setName("");
      setDescription("");
      setCasesText("");
      // 让服务端的下拉框和列表立刻出现这个数据集
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
        <label htmlFor="ds-name" className={labelClass}>
          数据集名字
        </label>
        <input
          id="ds-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如：算术-基础 20 题"
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="ds-desc" className={labelClass}>
          说明（可选）
        </label>
        <input
          id="ds-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="这批题考什么"
          className={inputClass}
        />
      </div>

      <div>
        <div className="mb-1.5 flex items-baseline justify-between">
          <label htmlFor="ds-cases" className={labelClass + " mb-0"}>
            用例
          </label>
          <span className="num text-xs text-faint">{cases.length} 条</span>
        </div>
        <textarea
          id="ds-cases"
          value={casesText}
          onChange={(e) => setCasesText(e.target.value)}
          rows={7}
          placeholder={
            "一行一条。参考答案可以不填：\n17 乘以 24 等于多少？只回答数字。 || 408\n把 3.7 和 8.35 相加，保留两位小数。"
          }
          className={`${inputClass} num resize-y leading-relaxed`}
        />
        <p className={`mt-1.5 ${hintClass}`}>
          参考答案用 <span className="num text-muted">||</span> 分隔，填了 judge 会拿它当标准，
          不填就按自己的知识判断。
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving || !name.trim() || cases.length === 0}
          className={primaryButtonClass}
        >
          {saving ? "保存中…" : "保存数据集"}
        </button>
        {savedName && (
          <span className="text-xs text-muted" role="status">
            已保存「{savedName}」，可以在上面发起评测了
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
