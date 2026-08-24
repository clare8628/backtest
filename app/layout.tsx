import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ETF & Stock Backtest Platform",
  description: "Compare ETFs and stocks with AI-assisted multi-factor recommendations",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
