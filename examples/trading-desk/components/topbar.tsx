/**
 * TopBar — 44px chrome with brand mark, ticker/date inputs, cost-preset and
 * data-source segmented toggles, re-run button, layout label, and theme
 * toggle.
 *
 * Inputs and toggles are controlled by the parent so submitting the form
 * invokes the `analyze` action with the current values. Theme toggle flips
 * `data-theme` on the document root.
 */
"use client";

import { useCallback, type ReactElement } from "react";
import { Sun, Moon, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { FlowStateMark } from "@/components/flow-state-mark";
import { Segmented } from "@/components/ui/segmented";

export type CostPreset = "fast" | "full";
export type DataSourceMode = "fixture" | "live";

/** The in-page views the TopBar nav toggles between. `"portfolio"` is reserved
 *  by the shared view-switcher contract (BUILD_PLAN §8) for the Portfolio slice
 *  to add; only `"desk"` and `"reports"` render a nav item today. */
export type TradingDeskView = "desk" | "reports" | "portfolio";

type TopBarProps = {
  ticker: string;
  date: string;
  costPreset: CostPreset;
  dataSource: DataSourceMode;
  onTickerChange: (value: string) => void;
  onDateChange: (value: string) => void;
  onCostPresetChange: (value: CostPreset) => void;
  onDataSourceChange: (value: DataSourceMode) => void;
  onRun: () => void;
  isRunning: boolean;
  /** Whether the current inputs map to an existing session. Drives the button
   *  label: "re-run" for an existing run, "Run" for a fresh tuple. */
  isExistingSession: boolean;
  /** Current in-page view. The inline analyze form is desk-only and is hidden
   *  in any non-desk view. */
  view: TradingDeskView;
  onViewChange: (view: TradingDeskView) => void;
  theme: "light" | "dark";
  onThemeToggle: () => void;
};

/** The nav items rendered today. Kept as a list so the reserved `"portfolio"`
 *  view is a one-entry addition for the Portfolio slice. */
const NAV_ITEMS: ReadonlyArray<{ value: TradingDeskView; label: string }> = [
  { value: "desk", label: "Desk" },
  { value: "reports", label: "Past Reports" },
];

const COST_PRESET_OPTIONS = [
  { value: "fast" as const, label: "fast", title: "Cheap utility models" },
  { value: "full" as const, label: "full", title: "Higher-tier chat models" },
];

const DATA_SOURCE_OPTIONS = [
  { value: "fixture" as const, label: "fixture", title: "Hand-curated JSON" },
  {
    value: "live" as const,
    label: "live",
    title:
      "Live data — Yahoo for prices/fundamentals (no key); FINNHUB_API_KEY required for news",
  },
];

export function TopBar({
  ticker,
  date,
  costPreset,
  dataSource,
  onTickerChange,
  onDateChange,
  onCostPresetChange,
  onDataSourceChange,
  onRun,
  isRunning,
  isExistingSession,
  view,
  onViewChange,
  theme,
  onThemeToggle,
}: TopBarProps): ReactElement {
  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      onRun();
    },
    [onRun],
  );

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
          examples/trading-desk
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

      {view === "desk" ? (
      <form onSubmit={handleSubmit} className="ml-6 flex items-center gap-3">
        <label className="flex items-center gap-1.5">
          <span className="text-[10.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
            ticker
          </span>
          <input
            value={ticker}
            onChange={(e) => onTickerChange(e.currentTarget.value.toUpperCase())}
            className={cn(
              "h-7 w-[84px] rounded-md border bg-[color:var(--c-surface-2)] px-2",
              "border-[color:var(--c-border)] font-mono text-[12px] text-[color:var(--c-fg)]",
              "focus:outline-none focus:border-[color:var(--c-accent)]",
            )}
            spellCheck={false}
            autoComplete="off"
          />
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-[10.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
            date
          </span>
          <input
            value={date}
            onChange={(e) => onDateChange(e.currentTarget.value)}
            className={cn(
              "h-7 w-[112px] rounded-md border bg-[color:var(--c-surface-2)] px-2",
              "border-[color:var(--c-border)] font-mono text-[12px] text-[color:var(--c-fg)]",
              "focus:outline-none focus:border-[color:var(--c-accent)]",
            )}
            spellCheck={false}
            autoComplete="off"
          />
        </label>
        <Segmented
          label="preset"
          value={costPreset}
          options={COST_PRESET_OPTIONS}
          onChange={onCostPresetChange}
          disabled={isRunning}
        />
        <Segmented
          label="source"
          value={dataSource}
          options={DATA_SOURCE_OPTIONS}
          onChange={onDataSourceChange}
          disabled={isRunning}
        />
        <button
          type="submit"
          disabled={isRunning}
          className={cn(
            "inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-[11.5px] font-medium",
            "bg-[color:var(--c-accent)] text-white",
            "disabled:opacity-50",
          )}
        >
          <Play className="h-3 w-3" aria-hidden />
          {isRunning ? "running…" : isExistingSession ? "re-run" : "Run"}
        </button>
      </form>
      ) : null}

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
