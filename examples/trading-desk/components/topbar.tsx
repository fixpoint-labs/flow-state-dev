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
import { Segmented } from "@/components/ui/segmented";

export type CostPreset = "fast" | "full";
export type DataSourceMode = "fixture" | "live";

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
  theme: "light" | "dark";
  onThemeToggle: () => void;
};

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
        <span
          aria-hidden
          className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-sm bg-[color:var(--c-fg)] font-mono text-[10px] font-semibold text-[color:var(--c-bg)]"
        >
          FS
        </span>
        <span className="text-[13px] font-semibold text-[color:var(--c-fg)]">
          flow-state
        </span>
        <span className="text-[color:var(--c-fg-faint)]">/</span>
        <span className="font-mono text-[11.5px] text-[color:var(--c-fg-muted)]">
          examples/trading-desk
        </span>
      </div>

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
          {isRunning ? "running…" : "re-run"}
        </button>
      </form>

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
