"use client";

/**
 * Kitchen Sink's two themes, as the design system names them. Light is the
 * warm Draft stock (`data-theme="evening"`), the DevTool's Draft; dark is
 * Night (`.dark` and `data-theme="dark"`, which Tailwind's `dark:` variant
 * also keys on). Before a person picks, the OS setting decides.
 */
import { ThemeProvider } from "next-themes";

/** next-themes' theme name → the value written to the root's class and `data-theme`. */
const THEME_VALUES = { light: "evening", dark: "dark" } as const;

export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute={["class", "data-theme"]}
      value={THEME_VALUES}
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </ThemeProvider>
  );
}
