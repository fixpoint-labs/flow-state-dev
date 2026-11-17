import { cn } from "../lib/utils";

/** A text status with a decorative dot; motion never carries its meaning. */
export function StatusBadge({ status, active = status === "running" || status === "working", className }: { status: string; active?: boolean; className?: string }) {
  const tone = status === "failed" ? "border-destructive/25 bg-destructive/10 text-destructive"
    : status === "done" || status === "replied" ? "border-success/25 bg-success/10 text-success"
    : status.toLowerCase() === "waiting on you" || status === "Needs review" ? "border-attention/25 bg-attention/10 text-attention"
    : active ? "border-info/25 bg-info/10 text-info"
    : "border-border bg-muted/50 text-muted-foreground";
  return (
    <span data-status-badge className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] font-medium leading-4 tracking-wide uppercase", tone, className)}>
      <span aria-hidden="true" data-task-dot className={cn("size-1.5 rounded-full bg-current", active && "motion-safe:animate-pulse")} />
      {status}
    </span>
  );
}
