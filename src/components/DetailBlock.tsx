/**
 * 展开后的详情块：一块等宽正文 + 一行元信息。
 *
 * 为什么抽成独立组件：记录列表和 trace 树都要用它。
 * 各写一份的话，「错误用红色、思考过程用黄铜色」这套约定迟早会漂移成两套。
 */

export function DetailBlock({
  title,
  body,
  tone,
}: {
  title: string;
  body: string;
  tone?: "brass" | "danger" | "muted";
}) {
  const toneClass =
    tone === "brass"
      ? "text-brass/80"
      : tone === "danger"
        ? "text-danger"
        : tone === "muted"
          ? "text-muted"
          : "text-ink";

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

export function Meta({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-faint">{label}</dt>
      <dd className={`${mono ? "num" : ""} text-muted`}>{value}</dd>
    </div>
  );
}

/** JSON 值的展示：对象转成缩进 JSON，字符串原样显示 */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
