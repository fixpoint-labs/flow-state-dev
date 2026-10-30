import type { TaskRow } from "../adapter";
import { cn } from "../lib/utils";
import { HARNESS_LABEL } from "./ThreadStatus";

/*
 * What a task's runs spent, as its card, row and sheet show it: the model and
 * a token count read from the board's row (`spend`), never summed here. The
 * count rises while the run works, and stays as the final total once it ends.
 * A count nobody reported reads as such, never as 0; one still missing a
 * source is marked partial.
 */

/** 980, 12.4k, 1.2M. */
export function tokenCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/**
 * "claude-sonnet-4-5 · 12.4k tokens", or with `split`, "… · 10.1k in · 2.3k
 * out"; with `harness`, the harness's name first, for a view with no harness
 * tag. Empty when the task never ran.
 */
export function spendLine(task: TaskRow, { split = false, harness = false } = {}): string {
  const spend = task.spend;
  if (spend === undefined) return "";
  const partial = spend.unreported ? " (partial)" : "";
  const side = (n: number | null) => (n === null ? "not reported" : tokenCount(n));
  const tokens =
    spend.inputTokens === null && spend.outputTokens === null
      ? "no tokens reported yet"
      : split
        ? `${side(spend.inputTokens)} in · ${side(spend.outputTokens)} out${partial}`
        : `${tokenCount((spend.inputTokens ?? 0) + (spend.outputTokens ?? 0))} tokens${partial}`;
  const named = harness && spend.harness !== null ? (HARNESS_LABEL[spend.harness] ?? spend.harness) : null;
  return [named, spend.model, tokens].filter(Boolean).join(" · ");
}

/** The spend line under a card's status, or nothing for a task that never ran. */
export function Spend({ task, split = false, harness = false, className }: { task: TaskRow; split?: boolean; harness?: boolean; className?: string }) {
  const line = spendLine(task, { split, harness });
  if (!line) return null;
  return (
    <span className={cn("block truncate font-mono text-[10px] text-muted-foreground", className)} data-spend={task.spend?.live ? "live" : "final"}>
      {line}
    </span>
  );
}
