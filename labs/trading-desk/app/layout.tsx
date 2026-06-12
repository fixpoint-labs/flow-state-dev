import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trading Desk — @flow-state-dev example",
  description:
    "Phase 1 of a multi-stage agent-pipeline showcase. Research / demo only.",
};

// `viewportFit: "cover"` extends the page under the iOS notch / home
// indicator so `env(safe-area-inset-*)` resolves to real values — without it
// the mobile shell's safe-area padding computes to 0 (FIX-757).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
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
