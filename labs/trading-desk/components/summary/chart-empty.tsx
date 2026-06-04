/**
 * ChartEmpty — the "not available for this run" placeholder a Summary chart
 * renders instead of drawing against missing/partial stored data.
 *
 * The real-money honesty gate: a chart never renders against absent data; it
 * surfaces the gap with a muted one-liner so a missing signal reads as missing,
 * never as a real (zeroed) value.
 */
import type { ReactElement } from "react";
import { cn } from "@/lib/utils";

export type ChartEmptyProps = {
  label: string;
};

export function ChartEmpty({ label }: ChartEmptyProps): ReactElement {
  return (
    <div
      className={cn(
        "flex min-h-16 items-center justify-center rounded-md border border-dashed p-4 text-center",
        "border-[color:var(--c-border)] bg-[color:var(--c-surface)]",
        "text-[11px] text-[color:var(--c-fg-faint)]",
      )}
    >
      {label}
    </div>
  );
}
