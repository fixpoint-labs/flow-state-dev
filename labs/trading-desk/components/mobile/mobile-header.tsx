/**
 * MobileHeader — the mobile shell's slim top chrome (FIX-757): brand mark,
 * the active run context (`ticker · date`, truncating), the instructions gear
 * (relocated from the desktop StatusBar), and the theme toggle.
 *
 * Pads its top edge with `env(safe-area-inset-top)` so the chrome clears the
 * iOS notch (`viewport-fit=cover` is set in `app/layout.tsx`). The view nav
 * does NOT live here — the bottom tab bar owns navigation on mobile.
 */
"use client";

import type { ReactElement } from "react";
import { Moon, Settings, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { FlowStateMark } from "@/components/flow-state-mark";

type MobileHeaderProps = {
  /** The bound run's context line (`ticker · date`), or null when no session
   *  matches the current inputs. Truncates rather than wrapping the chrome. */
  context: string | null;
  theme: "light" | "dark";
  onThemeToggle: () => void;
  /** Opens the custom-instructions dialog (the StatusBar gear's mobile home). */
  onOpenSettings: () => void;
  /** True when no session exists yet to read the instructions resource from. */
  settingsDisabled: boolean;
};

export function MobileHeader({
  context,
  theme,
  onThemeToggle,
  onOpenSettings,
  settingsDisabled,
}: MobileHeaderProps): ReactElement {
  return (
    <header
      className={cn(
        "flex items-center gap-2 border-b px-3 py-2",
        "border-[color:var(--c-border)] bg-[color:var(--c-surface)]",
        "pt-[calc(env(safe-area-inset-top)+0.5rem)]",
      )}
    >
      <FlowStateMark theme={theme} aria-hidden className="h-[20px] w-[20px] shrink-0" />
      <span className="shrink-0 text-[12.5px] font-semibold text-[color:var(--c-fg)]">
        trading desk
      </span>
      {context !== null ? (
        <span className="min-w-0 truncate font-mono text-[11px] text-[color:var(--c-fg-muted)]">
          {context}
        </span>
      ) : null}
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={onOpenSettings}
          disabled={settingsDisabled}
          title={
            settingsDisabled
              ? "Run an analysis to enable custom instructions."
              : "Open custom instructions"
          }
          aria-label="Custom instructions"
          className={cn(
            "inline-flex h-8 w-8 items-center justify-center rounded-md",
            "border border-[color:var(--c-border)] text-[color:var(--c-fg-muted)]",
            settingsDisabled
              ? "cursor-not-allowed opacity-50"
              : "hover:text-[color:var(--c-fg)]",
          )}
        >
          <Settings className="h-3.5 w-3.5" aria-hidden />
        </button>
        <button
          type="button"
          onClick={onThemeToggle}
          aria-label={
            theme === "dark" ? "Switch to light theme" : "Switch to dark theme"
          }
          className={cn(
            "inline-flex h-8 w-8 items-center justify-center rounded-md",
            "border border-[color:var(--c-border)] text-[color:var(--c-fg-muted)]",
            "hover:text-[color:var(--c-fg)]",
          )}
        >
          {theme === "dark" ? (
            <Sun className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <Moon className="h-3.5 w-3.5" aria-hidden />
          )}
        </button>
      </div>
    </header>
  );
}
