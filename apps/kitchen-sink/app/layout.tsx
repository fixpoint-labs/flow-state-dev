import type { Metadata } from "next";
import { IBM_Plex_Mono, Space_Grotesk } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";

// The registry's `--font-sans` / `--font-mono` tokens read these variables.
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk" });
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-ibm-plex-mono",
});

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
    <html lang="en" className={`${spaceGrotesk.variable} ${plexMono.variable}`} suppressHydrationWarning>
      <body className="font-sans">
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
