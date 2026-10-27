import type { Metadata } from "next";
import { AppThemeProvider } from "@/components/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kitchen Sink — @flow-state-dev example",
  description:
    "Multi-modal AI assistant demonstrating all @flow-state-dev building blocks",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        {process.env.KITCHEN_SINK_TEST_MODE === "1" && (
          <style>{`*, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; }`}</style>
        )}
        <AppThemeProvider>
          {children}
        </AppThemeProvider>
      </body>
    </html>
  );
}
