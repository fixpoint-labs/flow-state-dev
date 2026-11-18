/**
 * A status as a pill: its words, and a decorative dot that pulses while the
 * work is live. The colour comes from the caller (a task's from
 * `taskPresentation`), never from reading the words, so every surface that
 * draws one status draws it in one colour. Motion never carries the meaning.
 */
import type { BadgeTone } from "../lib/task-presentation";
import { cn } from "../lib/utils";

const TONES: Record<BadgeTone, string> = {
  attention: "border-attention/25 bg-attention/10 text-attention",
  warning: "border-warning/25 bg-warning/10 text-warning",
  destructive: "border-destructive/25 bg-destructive/10 text-destructive",
  success: "border-success/25 bg-success/10 text-success",
  info: "border-info/25 bg-info/10 text-info",
  muted: "border-border bg-muted/50 text-muted-foreground",
};

export function StatusBadge({ label, tone, active = false, className }: { label: string; tone: BadgeTone; active?: boolean; className?: string }) {
  return (
    <span data-status-badge data-tone={tone} className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-xs font-medium leading-4 tracking-wide uppercase", TONES[tone], className)}>
      <span aria-hidden="true" data-task-dot className={cn("size-1.5 rounded-full bg-current", active && "motion-safe:animate-pulse")} />
      {label}
    </span>
  );
}
