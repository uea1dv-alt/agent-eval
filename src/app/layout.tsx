import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

// 字体选择：IBM Plex 系列。选它而不是脚手架默认给的 Geist，有两个理由 ——
// 一是 Plex 有真实的仪表/技术血统，和「观测工具」这个题材对得上；
// 二是它自带配套的 mono，数字和文字能用同一个家族，排版上是连贯的。
const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "agent-eval · 调用记录本",
  description: "LLM Agent 运行追踪与评测平台 —— Stage 0：单次调用的 token / 耗时记录",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="zh-CN"
      className={`${plexSans.variable} ${plexMono.variable} h-full`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
