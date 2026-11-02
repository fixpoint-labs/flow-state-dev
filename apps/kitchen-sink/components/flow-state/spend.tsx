"use client";

import { cn } from "@/lib/utils";

/*
 * What a run spent, as one line: the model, the tokens, the vendor's charge
 * when it reported one, and optionally the attempts and how long it took. The
 * numbers are read from what the server folded (a task row's or a harness
 * turn's `spend`), never summed here. A count nobody reported reads as such,
 * never as 0; one still missing a source is marked partial. A run billed by
 * subscription reports no charge and shows none: there is no dollar figure
 * to show, and an estimate would be one nobody billed.
 */

/**
 * What the line reads: the fields of orchestration's `TaskSpendView`, which a
 * task row and a harness session's turn both carry. `costUsd` absent reads as
 * none reported.
 */
export interface SpendSummary {
  harness: string | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd?: number | null;
  unreported: boolean;
  live: boolean;
}

/** What else the line can say. */
export interface SpendLineOptions {
  /** Input and output apart ("10.1k in · 2.3k out") rather than one total. */
  split?: boolean;
  /** The harness's name, first, for a view with no harness tag of its own. */
  harnessLabel?: string;
  /** The task's attempts; shown from the second on. */
  attempts?: number;
  /** How long it took, in ms. */
  durationMs?: number | null;
}

/** 980, 12.4k, 1.2M. */
export function tokenCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** $0.0042, $0.42, $12.40. */
export function costAmount(usd: number): string {
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}

/** 42s, 4m 12s, 1h 3m. */
export function durationText(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * "claude-sonnet-4-5 · 12.4k tokens · $0.42 · 2 attempts · 4m 12s". Empty
 * when there is no spend to show.
 */
export function spendLine(spend: SpendSummary | null | undefined, options: SpendLineOptions = {}): string {
  if (spend == null) return "";
  const partial = spend.unreported ? " (partial)" : "";
  const side = (n: number | null) => (n === null ? "not reported" : tokenCount(n));
  const tokens =
    spend.inputTokens === null && spend.outputTokens === null
      ? "no tokens reported yet"
      : options.split === true
        ? `${side(spend.inputTokens)} in · ${side(spend.outputTokens)} out${partial}`
        : `${tokenCount((spend.inputTokens ?? 0) + (spend.outputTokens ?? 0))} tokens${partial}`;
  const cost = spend.costUsd == null ? null : costAmount(spend.costUsd);
  const attempts = options.attempts !== undefined && options.attempts > 1 ? `${options.attempts} attempts` : null;
  const duration = options.durationMs == null ? null : durationText(options.durationMs);
  return [options.harnessLabel, spend.model, tokens, cost, attempts, duration].filter(Boolean).join(" · ");
}

/** The spend line, or nothing when there is no spend to show. */
export function Spend({ spend, className, ...options }: SpendLineOptions & { spend: SpendSummary | null | undefined; className?: string }) {
  const line = spendLine(spend, options);
  if (!line) return null;
  return (
    <span className={cn("block truncate font-mono text-[10px] text-muted-foreground", className)} data-spend={spend?.live ? "live" : "final"}>
      {line}
    </span>
  );
}
