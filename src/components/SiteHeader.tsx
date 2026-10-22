import Link from "next/link";

/**
 * 站点头部：品牌 + 当前阶段 + 导航。
 *
 * 为什么是服务端组件（不用 usePathname）：当前页由页面自己传 `active` 进来。
 * 这样整块头部是纯静态的，不需要为了判断「我在哪一页」往客户端塞一段 JS。
 * 只有两个入口的时候，显式传参比隐式的全局状态更好读。
 */

const LINKS = [
  { key: "runs", href: "/", label: "运行记录" },
  { key: "evals", href: "/evals", label: "评测" },
] as const;

export type NavKey = (typeof LINKS)[number]["key"];

export default function SiteHeader({ active, note }: { active: NavKey; note: string }) {
  return (
    <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 py-6">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          agent-eval
        </Link>
        <p className="text-xs text-faint">{note}</p>
      </div>

      <nav aria-label="主导航" className="flex items-baseline gap-5 text-xs">
        {LINKS.map((link) => {
          const isActive = active === link.key;
          return (
            <Link
              key={link.key}
              href={link.href}
              // aria-current 是给读屏软件的「你在这一页」——
              // 视觉上靠颜色和下划线，但那对看不见颜色的人等于没说
              aria-current={isActive ? "page" : undefined}
              className={
                isActive
                  ? "text-ink underline decoration-brass decoration-1 underline-offset-4"
                  : "text-faint transition-colors hover:text-muted"
              }
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
