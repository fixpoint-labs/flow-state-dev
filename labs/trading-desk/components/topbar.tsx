/**
 * TopBar — 44px chrome with brand mark, view nav, a "New Analysis" button,
 * layout label, and theme toggle.
 *
 * The run-input surface (ticker/date inputs, cost-preset and data-source
 * toggles, the run button, and the thesis fields) now lives in
 * `NewAnalysisDialog`; the header only opens it. Theme toggle flips
 * `data-theme` on the document root.
 */
"use client";

import { type ReactElement } from "react";
import { Sun, Moon, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { FlowStateMark } from "@/components/flow-state-mark";

export type CostPreset = "fast" | "full";
// `record` runs the live provider chain AND writes every tool payload to the
// fixture corpus (FIX-787), so the run replays offline afterward. It keys its
// own report, distinct from a plain `live` run.
export type DataSourceMode = "fixture" | "live" | "record";

/** The in-page views the TopBar nav toggles between. All three render a nav
 *  item: Desk (analysis), Past Reports, and Portfolio (BUILD_PLAN §8 contract). */
export type TradingDeskView = "desk" | "reports" | "portfolio";

type TopBarProps = {
  /** Opens the New Analysis modal, which owns the entire run-input surface. */
  onNewAnalysis: () => void;
  /** Current in-page view. The nav toggle is its own flex group and coexists
   *  with the New Analysis button. */
  view: TradingDeskView;
  onViewChange: (view: TradingDeskView) => void;
  theme: "light" | "dark";
  onThemeToggle: () => void;
};

/** The nav items rendered today. */
const NAV_ITEMS: ReadonlyArray<{ value: TradingDeskView; label: string }> = [
  { value: "desk", label: "Desk" },
  { value: "reports", label: "Past Reports" },
  { value: "portfolio", label: "Portfolio" },
];

export function TopBar({
  onNewAnalysis,
  view,
  onViewChange,
  theme,
  onThemeToggle,
}: TopBarProps): ReactElement {
  return (
    <header
      className={cn(
        "flex h-11 items-center gap-3 px-4",
        "border-b border-[color:var(--c-border)] bg-[color:var(--c-surface)]",
      )}
    >
      <div className="flex items-center gap-2">
        <FlowStateMark theme={theme} aria-hidden className="h-[22px] w-[22px] shrink-0" />
        <span className="text-[13px] font-semibold text-[color:var(--c-fg)]">
          flow-state
        </span>
        <span className="text-[color:var(--c-fg-faint)]">/</span>
        <span className="font-mono text-[11.5px] text-[color:var(--c-fg-muted)]">
          labs/trading-desk
        </span>
      </div>

      {/* Nav toggle — its OWN flex group (BUILD_PLAN §8 / spec 02 §6.4) so it
          coexists with either the inline analyze form (today) or the slimmed-
          header "New Analysis" button a later slice swaps in. */}
      <nav
        className="ml-4 flex items-center gap-0.5 rounded-md border border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] p-0.5"
        aria-label="View"
      >
        {NAV_ITEMS.map((item) => {
          const isActive = item.value === view;
          return (
            <button
              key={item.value}
              type="button"
              aria-current={isActive ? "page" : undefined}
              onClick={() => {
                if (!isActive) onViewChange(item.value);
              }}
              className={cn(
                "h-6 rounded px-2.5 text-[11.5px] font-medium",
                isActive
                  ? "bg-[color:var(--c-surface)] text-[color:var(--c-fg)]"
                  : "text-[color:var(--c-fg-muted)] hover:text-[color:var(--c-fg)]",
              )}
            >
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* New Analysis — its own flex group, coexisting with the nav. Opens the
          modal that owns the entire run-input surface. Always enabled so the
          user can configure a fresh run while another streams. */}
      <button
        type="button"
        onClick={onNewAnalysis}
        className={cn(
          "ml-4 inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-[11.5px] font-medium",
          "bg-[color:var(--c-accent)] text-white",
          "hover:opacity-90",
        )}
      >
        <Plus className="h-3 w-3" aria-hidden />
        New Analysis
      </button>

      <div className="ml-auto flex items-center gap-3">
        <span className="font-mono text-[10.5px] text-[color:var(--c-fg-faint)]">
          layout: focus
        </span>
        <button
          type="button"
          onClick={onThemeToggle}
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded-md",
            "border border-[color:var(--c-border)] text-[color:var(--c-fg-muted)]",
            "hover:text-[color:var(--c-fg)]",
          )}
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
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
