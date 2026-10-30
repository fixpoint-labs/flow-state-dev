import type { TaskRow } from "../adapter";
import { COLUMNS, columnOf } from "../lib/columns";
import { cn } from "../lib/utils";

/** A harness's name as a card and row tag it. */
export const HARNESS_LABEL: Record<string, string> = { "claude-code": "Claude Code", codex: "Codex", cursor: "Cursor" };

/** The thread's column, ignoring pins: a pinned thread keeps its status icon and line. */
export const statusColumn = (task: TaskRow) => columnOf(task, false);

/**
 * A thread's status icon: a ring while it works, a filled dot when it needs
 * you (`attention` for a question, `success` for a review), a cross when it
 * failed, a check when resolved.
 */
export function ThreadIcon({ task }: { task: TaskRow }) {
  const column = statusColumn(task);
  if (task.status === "errored") return <span aria-hidden className="mt-0.5 w-3 shrink-0 text-center text-xs leading-none text-destructive">✕</span>;
  if (column === "resolved") return <span aria-hidden className="mt-0.5 w-3 shrink-0 text-center text-xs leading-none text-muted-foreground">✓</span>;
  return (
    <span
      aria-hidden
      className={cn(
        "mt-1 size-3 shrink-0 rounded-full border-2",
        column === "working" && "border-info",
        column === "waiting" && "border-attention bg-attention",
        column === "review" && "border-success bg-success",
      )}
    />
  );
}

/** A run that completed at the review deadline: resolved, but never approved. */
const notReviewed = (task: TaskRow) => task.status === "completed" && task.review === "deadline";

/** "Working · Comparing SLA tiers", "Waiting on you · Which region…", "Failed · …", "Resolved · not reviewed": the column's board label, then the note. */
export function statusLine(task: TaskRow): string {
  if (notReviewed(task)) return "Resolved · not reviewed";
  const column = statusColumn(task);
  const label =
    task.status === "errored" ? "Failed" : task.status === "cancelled" ? "Cancelled" : COLUMNS.find((c) => c.id === column)!.label;
  const note = task.waitingOn?.prompt ?? task.statusNote;
  return note ? `${label} · ${note}` : label;
}

/**
 * The tag naming the harness a thread runs through, or nothing for a plain
 * thread; and a *Not reviewed* mark on a run that completed at its review
 * deadline, so it never reads as approved.
 */
export function HarnessTag({ task }: { task: TaskRow }) {
  return (
    <>
      {task.harness ? (
        <span className="shrink-0 border border-border px-1.5 font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
          {HARNESS_LABEL[task.harness] ?? task.harness}
        </span>
      ) : null}
      {notReviewed(task) ? (
        <span className="shrink-0 border border-warning px-1.5 font-mono text-[10px] tracking-widest text-warning uppercase">Not reviewed</span>
      ) : null}
    </>
  );
}
