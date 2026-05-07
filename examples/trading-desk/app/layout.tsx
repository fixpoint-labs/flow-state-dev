import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trading Desk — @flow-state-dev example",
  description:
    "Phase 1 of a multi-stage agent-pipeline showcase. Research / demo only.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
