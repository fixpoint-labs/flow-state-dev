import { useContext } from "react";
import type { LabTask } from "../adapter";
import { COLUMNS, columnOf } from "../lib/columns";
import { FINISHED } from "../lib/task-status";
import { HarnessLabels } from "../lib/harness-labels";
import { cn } from "../lib/utils";

/**
 * The name of the harness a task's runs last reported, for a view with no harness tag; `undefined`
 * when none did. Its label from `labels` (the readiness view's), else its id.
 */
export function harnessLabelOf(task: LabTask, labels: Readonly<Record<string, string>>): string | undefined {
  const harness = task.spend?.harness;
  return harness == null ? undefined : (labels[harness] ?? harness);
}

/** The thread's column, ignoring pins: a pinned thread keeps its status icon and line. */
export const statusColumn = (task: LabTask) => columnOf(task, false);

/** Whether a thread's task waits on its pull request to merge or close: its run is done, its work isn't. */
export const waitsOnPullRequest = (task: LabTask) => task.status === "in_progress" && (task.pullRequests?.length ?? 0) > 0;

/** What a pull-request wait reads: "PR open · #7", or "PR open" when no number is known. */
export function pullRequestOpenLine(task: LabTask): string {
  const numbers = (task.pullRequests ?? []).flatMap((pr) => (pr.number === null ? [] : [`#${pr.number}`]));
  return numbers.length === 0 ? "PR open" : `PR open · ${numbers.join(", ")}`;
}

/** The line a thread waiting on its pull request offers, while nothing tells it of a merge. */
export const PULL_REQUEST_HINT = "Merged? Say so here and I'll check.";

/**
 * *PR open · #7*, each number a link to its pull request when the run's
 * record has one: what a card and a thread say while the task waits on it.
 */
export function PullRequestOpen({ task, className }: { task: LabTask; className?: string }) {
  const prs = task.pullRequests ?? [];
  return (
    <span data-testid="pull-request-wait" className={cn("truncate text-xs text-muted-foreground", className)}>
      PR open
      {prs.map((pr, i) =>
        pr.number === null ? null : (
          <span key={`${pr.number}-${i}`}>
            {i === 0 ? " · " : ", "}
            {pr.url === null ? (
              `#${pr.number}`
            ) : (
              <a href={pr.url} target="_blank" rel="noreferrer" title={pr.title ?? undefined} className="underline hover:text-foreground">
                #{pr.number}
              </a>
            )}
          </span>
        ),
      )}
    </span>
  );
}

/**
 * A thread's status icon: a ring while it works, a dashed ring while it waits
 * on its pull request (open, not resolved), a filled dot when it needs you
 * (`attention` for a question, `success` for a review), a cross when it
 * failed, a check when resolved.
 */
export function ThreadIcon({ task }: { task: LabTask }) {
  const column = statusColumn(task);
  if (task.status === "errored") return <span aria-hidden className="mt-0.5 w-3 shrink-0 text-center text-xs leading-none text-destructive">✕</span>;
  if (column === "resolved") return <span aria-hidden className="mt-0.5 w-3 shrink-0 text-center text-xs leading-none text-muted-foreground">✓</span>;
  if (waitsOnPullRequest(task)) return <span aria-hidden data-icon="pull-request-wait" className="mt-1 size-3 shrink-0 rounded-full border-2 border-dashed border-info" />;
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
const notReviewed = (task: LabTask) => task.status === "completed" && task.review === "deadline";

/** A note's first non-empty line, whitespace collapsed; `undefined` when it has none. A status line is one line, and a note can be a whole command or a paragraph. */
const firstLine = (text: string | undefined) => text?.split("\n").find((line) => line.trim() !== "")?.replace(/\s+/g, " ").trim();

/**
 * "Working · Comparing SLA tiers", "Waiting on you · Which region…", "Failed · <why>", "Resolved · not reviewed", "PR open · #7":
 * the column's board label, then the note. A settled task's note is how it ended, never its last progress note:
 * a harness run's notes are its tool calls, so that would read as whatever the run last did.
 */
export function statusLine(task: LabTask): string {
  if (notReviewed(task)) return "Resolved · not reviewed";
  if (waitsOnPullRequest(task)) return pullRequestOpenLine(task);
  const column = statusColumn(task);
  const label =
    task.status === "errored" ? "Failed" : task.status === "cancelled" ? "Cancelled" : COLUMNS.find((c) => c.id === column)!.label;
  const note = task.status === "errored" ? firstLine(task.error) : FINISHED.has(task.status) ? undefined : firstLine(task.openHold?.prompt ?? task.statusNote);
  return note ? `${label} · ${note}` : label;
}

/** A board row's note: its group already says the status, so only what it's on, or why it failed; nothing once resolved. */
export function rowNote(task: LabTask): string {
  if (waitsOnPullRequest(task)) return pullRequestOpenLine(task);
  // `statusLine` already says how a failed or cancelled task ended, never its progress note.
  if (task.status === "errored" || task.status === "cancelled") return statusLine(task);
  return FINISHED.has(task.status) ? "" : (task.openHold?.prompt ?? task.statusNote ?? "");
}

/**
 * The tag naming the harness a thread runs through, or nothing for a plain
 * thread; and a *Not reviewed* mark on a run that completed at its review
 * deadline, so it never reads as approved.
 */
export function HarnessTag({ task }: { task: LabTask }) {
  const labels = useContext(HarnessLabels);
  return (
    <>
      {task.harness ? (
        <span className="shrink-0 rounded-sm bg-muted px-1.5 py-px font-mono text-[10px] text-muted-foreground">
          {labels[task.harness] ?? task.harness}
        </span>
      ) : null}
      {notReviewed(task) ? (
        <span className="shrink-0 rounded-sm border border-warning/60 px-1.5 py-px font-mono text-[10px] text-warning">Not reviewed</span>
      ) : null}
    </>
  );
}
