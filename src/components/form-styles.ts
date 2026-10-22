/**
 * 表单控件的公共类名。
 *
 * 为什么抽出来：评测页有三个表单，加上原来的 RunForm 就是四个。
 * 各写一份的话，改一次边框颜色要改四处，而且迟早会漂成四种不一样的输入框。
 *
 * 项目里没有 clsx / tailwind-merge —— 类名用模板字符串拼。
 * 所以这里的常量只放**互不覆盖**的样式，拼接时不会互相打架。
 */

export const inputClass =
  "w-full rounded-xs border border-line bg-base px-2.5 py-1.5 text-sm " +
  "placeholder:text-faint focus:border-brass/60 disabled:opacity-40 disabled:cursor-not-allowed";

export const labelClass = "block text-xs text-muted mb-1.5";

export const primaryButtonClass =
  "rounded-xs bg-brass px-4 py-1.5 text-sm font-medium text-base " +
  "transition-colors hover:bg-brass/85 " +
  "disabled:cursor-not-allowed disabled:bg-panel-2 disabled:text-faint";

export const secondaryButtonClass =
  "rounded-xs border border-line px-3 py-1.5 text-xs text-muted " +
  "transition-colors hover:border-line-soft hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed";

/** 每个区块的小标题。用细线把它和上面的内容分开，视觉上分节不靠留白靠规则线 */
export const sectionTitleClass =
  "border-b border-line pb-2 text-xs font-medium tracking-wide text-muted";

export const alertClass =
  "rounded-xs border border-danger/40 bg-danger/10 px-3 py-2 text-xs leading-relaxed text-danger";

export const hintClass = "text-xs leading-relaxed text-faint";
