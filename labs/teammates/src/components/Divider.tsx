/**
 * A labelled break in the conversation: a centred, uppercase label between
 * two hairlines. The window marker ("Earlier turns summarized") uses it, and
 * so does a day break ("Yesterday", "Today"), so every break in the thread
 * reads the same.
 */
import { cn } from "../lib/utils";

/** A `role="separator"` row named by its label, or by `ariaLabel` when the label alone would be unclear. */
export function Divider({ label, ariaLabel, className, ...data }: { label: string; ariaLabel?: string; className?: string } & Record<`data-${string}`, string>) {
  return (
    <div role="separator" aria-label={ariaLabel ?? label} className={cn("my-3 flex items-center gap-3", className)} {...data}>
      <span aria-hidden className="h-px flex-1 bg-border" />
      <span className="text-[11px] font-medium tracking-[0.08em] text-text-3 uppercase">{label}</span>
      <span aria-hidden className="h-px flex-1 bg-border" />
    </div>
  );
}
