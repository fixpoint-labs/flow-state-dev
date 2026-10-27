"use client";

/**
 * Kitchen Sink's two themes, as the design system names them. Light is the
 * warm Draft stock (the `evening` class), the DevTool's Draft; dark is Night
 * (the `dark` class, which Tailwind's `dark:` variant also keys on). Before a
 * person picks, the OS setting decides.
 *
 * Both are written as a class because next-themes' pre-paint script maps
 * theme names only for the class attribute; a mapped `data-theme` would read
 * `light` until hydration and paint day first.
 */
import { ThemeProvider } from "next-themes";

/** next-themes' theme name → the class written on the root. */
const THEME_VALUES = { light: "evening", dark: "dark" } as const;

/** The root theme provider every Kitchen Sink page sits in. */
export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      value={THEME_VALUES}
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </ThemeProvider>
  );
}
