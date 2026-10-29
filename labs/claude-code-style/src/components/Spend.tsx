import type { TaskRow } from "../adapter";
import { cn } from "../lib/utils";

/*
 * What a task's runs spent, as its card, row and sheet show it: the model and
 * a token count read from the board's row (`spend`), never summed here. The
 * count rises while the run works, and stays as the final total once it ends.
 */

/** 980, 12.4k, 1.2M. */
export function tokenCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/**
 * "claude-sonnet-4-5 · 12.4k tokens", or with `split`, "… · 10.1k in · 2.3k
 * out". Tokens nobody has reported yet read as such, never as 0. Empty when
 * the task never ran.
 */
export function spendLine(task: TaskRow, split = false): string {
  const spend = task.spend;
  if (spend === undefined) return "";
  const tokens =
    spend.inputTokens === null && spend.outputTokens === null
      ? spend.unreported
        ? "no tokens reported yet"
        : ""
      : split
        ? `${tokenCount(spend.inputTokens ?? 0)} in · ${tokenCount(spend.outputTokens ?? 0)} out`
        : `${tokenCount((spend.inputTokens ?? 0) + (spend.outputTokens ?? 0))} tokens`;
  return [spend.model, tokens].filter(Boolean).join(" · ");
}

/** The spend line under a card's status, or nothing for a task that never ran. */
export function Spend({ task, split = false, className }: { task: TaskRow; split?: boolean; className?: string }) {
  const line = spendLine(task, split);
  if (!line) return null;
  return (
    <span className={cn("block truncate font-mono text-[10px] text-muted-foreground", className)} data-spend={task.spend?.live ? "live" : "final"}>
      {line}
    </span>
  );
}
