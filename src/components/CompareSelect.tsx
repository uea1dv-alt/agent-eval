"use client";

import { useRouter } from "next/navigation";

interface Option {
  id: string;
  label: string;
}

/**
 * 选另一次评测来对比。
 *
 * 为什么用 select 而不是「并排两个列表」：同一个数据集可能有十几个版本，
 * 全铺开就没法看了。一次只比两个，选好再看 —— 而且 URL 里带着 ?compare=，
 * 链接可以直接发给别人。
 */
export default function CompareSelect({
  evalId,
  current,
  options,
}: {
  evalId: string;
  current: string | null;
  options: Option[];
}) {
  const router = useRouter();

  return (
    <label className="flex items-center gap-2 text-xs text-faint">
      对比
      <select
        value={current ?? ""}
        onChange={(e) => {
          const value = e.target.value;
          router.push(value ? `/evals/${evalId}?compare=${value}` : `/evals/${evalId}`);
        }}
        className="rounded-xs border border-line bg-base px-2 py-1 text-xs text-ink focus:border-brass/60"
      >
        <option value="">不对比</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
