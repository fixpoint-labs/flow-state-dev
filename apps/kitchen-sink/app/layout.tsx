import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";
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
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
