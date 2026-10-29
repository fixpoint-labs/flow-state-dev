/**
 * What a task card says about its run's spend: the harness, the model and the
 * tokens, as the board's `spend` reports them. A count no source has reported
 * yet shows as not reported, never as 0, and one still missing a source says so.
 */
import type { TaskSpendView } from "@flow-state-dev/orchestration/tasks";

/** A token count the way a card prints it: `950`, `12.3k`, `1.2M`. */
export function tokens(count: number): string {
  const short = (value: number, digits: number) => value.toFixed(digits).replace(/\.0$/, "");
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${short(count / 1000, count < 100_000 ? 1 : 0)}k`;
  return `${short(count / 1_000_000, 1)}M`;
}

/** The tokens in total, or what stands for them while none are reported. */
function total(spend: TaskSpendView): string {
  if (spend.inputTokens === null && spend.outputTokens === null) return "tokens not reported yet";
  const sum = (spend.inputTokens ?? 0) + (spend.outputTokens ?? 0);
  return `${tokens(sum)} tokens${spend.unreported ? " so far reported" : ""}`;
}

/** A card's one line: harness · model · tokens, leaving out what isn't known. */
export function spendLine(spend: TaskSpendView): string {
  return [spend.harness, spend.model, total(spend)].filter((part): part is string => part !== null).join(" · ");
}

/** A finished row's tokens in total, marked partial when a source never reported, or nothing while none are reported. */
export function spendTotal(spend: TaskSpendView): string | undefined {
  if (spend.inputTokens === null && spend.outputTokens === null) return undefined;
  return `${tokens((spend.inputTokens ?? 0) + (spend.outputTokens ?? 0))}${spend.unreported ? " (partial)" : ""}`;
}

/** The sheet's line: harness · model · input and output, each as reported. */
export function spendSplit(spend: TaskSpendView): string {
  const side = (count: number | null) => (count === null ? "not reported" : tokens(count));
  const split = `${side(spend.inputTokens)} in · ${side(spend.outputTokens)} out${spend.unreported ? " · a source hasn't reported yet" : ""}`;
  return [spend.harness, spend.model, split].filter((part): part is string => part !== null).join(" · ");
}
