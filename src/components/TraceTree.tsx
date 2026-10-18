"use client";

import { useState } from "react";
import type { TreeNode } from "@/lib/agent/tree";
import { estimateCostUsd, formatCostUsd, formatLatency } from "@/lib/pricing";
import type { SerializedSpan } from "@/lib/spans";
import { DetailBlock, Meta, formatValue } from "./DetailBlock";

/**
 * trace 树。
 *
 * 这是 Stage 1 的核心交付物：一次运行产生的多个 span 渲染成**可展开的树**。
 *
 * 为什么必须是树而不是列表：agent 的每一步都依赖上一步的结果 ——
 * 「第 2 步看到了第 1 步查出来的数据，才决定去算平均」这件事，
 * 只有层级关系能表达。平铺列表里这几条看起来是并列的，因果关系就丢了。
 */

interface Props {
  roots: TreeNode<SerializedSpan>[];
  /** 默认展开几层。1 = 只展开根节点；给个大数字就是全展开（实时运行时要这样） */
  expandDepth?: number;
}

const TYPE_STYLE: Record<string, { bar: string; label: string }> = {
  agent_run: { bar: "bg-brass", label: "运行" },
  llm_call: { bar: "bg-steel", label: "模型" },
  tool_call: { bar: "bg-line", label: "工具" },
};

const FALLBACK_STYLE = { bar: "bg-line", label: "未知" };

export default function TraceTree({ roots, expandDepth = 1 }: Props) {
  // 只记「用户手动翻过的」节点，其余按 expandDepth 算默认值。
  // 这样流式运行时新出现的节点能自动按默认规则展开，不用挨个初始化状态。
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  if (roots.length === 0) {
    return <p className="px-3 py-6 text-xs text-faint">这次运行没有记录到 span。</p>;
  }

  const maxLatency = Math.max(...collectLatencies(roots), 1);

  const toggle = (id: string, current: boolean) =>
    setToggled((prev) => ({ ...prev, [id]: !current }));

  return (
    <div className="text-sm">
      {roots.map((node) => (
        <Node
          key={node.node.id}
          node={node}
          depth={0}
          expandDepth={expandDepth}
          maxLatency={maxLatency}
          toggled={toggled}
          onToggle={toggle}
        />
      ))}
    </div>
  );
}

function Node({
  node,
  depth,
  expandDepth,
  maxLatency,
  toggled,
  onToggle,
}: {
  node: TreeNode<SerializedSpan>;
  depth: number;
  expandDepth: number;
  maxLatency: number;
  toggled: Record<string, boolean>;
  onToggle: (id: string, current: boolean) => void;
}) {
  const span = node.node;
  const hasChildren = node.children.length > 0;
  const open = toggled[span.id] ?? depth < expandDepth;
  const style = TYPE_STYLE[span.type] ?? FALLBACK_STYLE;
  const failed = Boolean(span.output?.error);

  const barPct = span.latencyMs ? Math.max(2, (span.latencyMs / maxLatency) * 100) : 0;
  const cost = estimateCostUsd(span.model, {
    inputTokens: span.inputTokens,
    outputTokens: span.outputTokens,
  });

  return (
    <div>
      <Row
        expandable={hasChildren}
        open={open}
        onToggle={() => onToggle(span.id, open)}
        label={`${style.label} ${span.name}${hasChildren ? (open ? "，已展开" : "，已收起") : ""}`}
      >
        {/* 缩进导轨：每深一层退 16px，并用一条竖线把同层串起来 */}
        <span className="flex shrink-0" style={{ paddingLeft: depth * 16 }}>
          <span className="w-4 text-center text-xs text-faint select-none">
            {hasChildren ? (open ? "▾" : "▸") : "·"}
          </span>
        </span>

        {/* 类型色条。放在行首而不是缩进线上 —— 缩进线是整棵子树的，
            把类型色画上去会让「这个颜色属于哪个节点」变得含混 */}
        <span className={`h-3.5 w-0.5 shrink-0 rounded-full ${style.bar}`} />

        <span className="min-w-0 flex-1 truncate text-xs">
          <span className="text-ink">{span.name}</span>
          <span className="ml-2 text-faint">{style.label}</span>
          {failed && <span className="ml-2 text-danger">失败</span>}
        </span>

        <span className="hidden w-28 shrink-0 truncate text-xs text-faint md:block">
          {span.model ?? ""}
        </span>

        <span className="num w-14 shrink-0 text-right text-xs text-steel">
          {failed ? "—" : (span.inputTokens?.toLocaleString("en-US") ?? "—")}
        </span>
        <span className="num w-14 shrink-0 text-right text-xs text-brass">
          {failed ? "—" : (span.outputTokens?.toLocaleString("en-US") ?? "—")}
        </span>

        <span className="flex w-24 shrink-0 items-center gap-2">
          <span className="h-1.5 w-10 shrink-0 overflow-hidden rounded-xs bg-panel-2">
            <span
              className={`block h-full ${failed ? "bg-danger/60" : "bg-brass"}`}
              style={{ width: `${barPct}%` }}
            />
          </span>
          <span className="num text-xs whitespace-nowrap text-muted">
            {formatLatency(span.latencyMs)}
          </span>
        </span>

        {/* finish_reason 只在「不是正常结束」时显示。
            每行都挂一个 stop 是纯噪音 —— 异常的那个才需要被看见。 */}
        <span className="num hidden w-24 shrink-0 text-xs text-faint lg:block">
          {span.output?.finishReason && span.output.finishReason !== "stop"
            ? span.output.finishReason
            : ""}
        </span>
      </Row>

      {open && (
        <div className="border-b border-line-soft bg-base/60">
          <SpanDetail span={span} cost={cost} />
        </div>
      )}

      {hasChildren && open && (
        <div className="border-l border-line-soft" style={{ marginLeft: depth * 16 + 8 }}>
          {node.children.map((child) => (
            <Node
              key={child.node.id}
              node={child}
              depth={depth + 1}
              expandDepth={expandDepth}
              maxLatency={maxLatency}
              toggled={toggled}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 行外壳。
 *
 * 为什么用 `aria-expanded` 的展开按钮，而不是 `role="treeitem"` 的 ARIA 树：
 * ARIA 的 tree 角色是有配套义务的 —— 要求 `aria-selected`、要求方向键导航、
 * 要求 roving tabindex。只挂一个 role 不实现这些，屏幕阅读器会按树的规则念，
 * 但键盘操作对不上，**比不用这个 role 更糟**。
 * 展开按钮是个自洽的、浏览器和读屏都原生支持的模式，这里够用且不会说谎。
 */
function Row({
  expandable,
  open,
  onToggle,
  label,
  children,
}: {
  expandable: boolean;
  open: boolean;
  onToggle: () => void;
  label: string;
  children: React.ReactNode;
}) {
  const className = `flex w-full items-center gap-2 border-b border-line-soft py-1.5 pr-3 text-left ${
    open ? "bg-panel/40" : ""
  }`;

  if (!expandable) {
    return <div className={className}>{children}</div>;
  }

  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={label}
      onClick={onToggle}
      className={`${className} cursor-pointer transition-colors hover:bg-panel/60`}
    >
      {children}
    </button>
  );
}

/** 展开后的详情。按 span 类型决定显示哪些字段 —— 三种 span 装的东西不一样。 */
function SpanDetail({
  span,
  cost,
}: {
  span: SerializedSpan;
  cost: number | null;
}) {
  const input = span.input;
  const output = span.output;
  const failed = Boolean(output?.error);

  return (
    <div className="px-3 py-3 pl-8">
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {span.type === "tool_call" ? (
          <>
            <DetailBlock title="参数" body={formatValue(input.args)} tone="muted" />
            <DetailBlock
              title={failed ? "错误" : "返回"}
              body={failed ? (output?.error ?? "") : formatValue(output?.result)}
              tone={failed ? "danger" : undefined}
            />
          </>
        ) : (
          <>
            {input.prompt ? (
              <DetailBlock title="prompt" body={input.prompt} />
            ) : (
              <DetailBlock
                title="输入"
                body={`第 ${input.step ?? "?"} 步 · 模型 ${input.model ?? span.model ?? "—"}`}
                tone="muted"
              />
            )}

            {output?.reasoningText && (
              <DetailBlock title="思考过程" body={output.reasoningText} tone="brass" />
            )}

            <DetailBlock
              title={failed ? "错误" : span.type === "agent_run" ? "最终回复" : "本步回复"}
              body={
                failed
                  ? (output?.error ?? "")
                  : output?.text
                    ? output.text
                    : "（本步没有输出正文 —— 模型直接去调工具了）"
              }
              tone={failed ? "danger" : undefined}
            />
          </>
        )}
      </div>

      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 border-t border-line pt-2.5 text-xs">
        <Meta label="span_id" value={span.id} mono />
        <Meta label="parent_id" value={span.parentId ?? "null（根）"} mono />
        <Meta label="type" value={span.type} mono />
        {input.step !== undefined && <Meta label="step" value={String(input.step)} mono />}
        {input.maxSteps !== undefined && (
          <Meta label="max_steps" value={String(input.maxSteps)} mono />
        )}
        {output?.stepCount !== undefined && (
          <Meta label="实际步数" value={String(output.stepCount)} mono />
        )}
        {span.type !== "tool_call" && (
          <Meta
            label="温度"
            value={
              input.thinking
                ? "不适用（思考模式已开启）"
                : (input.temperature?.toString() ?? "默认")
            }
          />
        )}
        <Meta label="成本（上限）" value={cost === null ? "—" : formatCostUsd(cost)} mono />
      </dl>
    </div>
  );
}

function collectLatencies(roots: TreeNode<SerializedSpan>[]): number[] {
  const out: number[] = [];
  const walk = (nodes: TreeNode<SerializedSpan>[]) => {
    for (const n of nodes) {
      if (n.node.latencyMs) out.push(n.node.latencyMs);
      walk(n.children);
    }
  };
  walk(roots);
  return out;
}
