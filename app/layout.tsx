import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent 自动化测试平台",
  description: "本地运行的 Agent 自动化测试 MVP，支持模块化 Profile、测试集运行和报告复核。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
