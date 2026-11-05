"use client";

import { useState } from "react";

/**
 * A task's action row, drawn in the opened task: **Cancel**, **Steer** and
 * **Release** while it is open, **Retry** and **Re-run on ‹harness›** once it
 * failed or was cancelled. Which buttons show follows the row's board
 * `status`, and only that: the row never pre-checks what the board would
 * refuse. Each press holds the row busy, then shows its outcome in place, or
 * the board's own words when it refused.
 *
 * Plain props, no package: pass the row's status and the board's calls,
 * shaped like orchestration's `BoardActions` (`inbox.board(at)` from
 * `@flow-state-dev/orchestration/inbox`), so an app hands that object
 * straight in.
 *
 * Cancel asks once, inline, because it ends a run that can't be resumed and
 * cancels the tasks waiting on it; its outcome names the ones the board took.
 */

/** The board's calls the row makes, as orchestration's `BoardActions` has them. Each rejects with the board's words on a refusal. */
export interface TaskActionCalls {
  /** Cancel the task. Resolves to the ids of the waiting tasks the board cancelled with it. */
  cancel(id: string): Promise<string[]>;
  /** Send words to an open task: they join its brief. */
  steer(id: string, message: string): Promise<void>;
  /** Release a held task: it goes back to pending. */
  release(id: string): Promise<void>;
  /** Run a failed or cancelled task again as the same task. */
  retry(id: string): Promise<void>;
}

/** One way to run a failed or cancelled task again somewhere else: "Re-run on ‹label›". */
export interface TaskRerunOption {
  /** What it runs on, e.g. a harness's name. */
  label: string;
  /** File the new task. Rejects with the board's words on a refusal. */
  run(): Promise<unknown>;
}

/** The board statuses the row draws buttons for. Any other word, `completed` included, draws nothing. */
const OPEN = new Set(["pending", "held", "in_progress"]);
const ENDED = new Set(["errored", "cancelled"]);

/** What the confirm says in place of Cancel. */
export const CANCEL_CONFIRM = "Cancel? Tasks waiting on it go too";

/** The words a cancel's outcome shows: the dependents it took, by id, when there were any. */
export function cancelOutcome(dependents: readonly string[]): string {
  return dependents.length === 0 ? "Cancelled." : `Cancelled, with the tasks waiting on it: ${dependents.join(", ")}.`;
}

type Press = "cancel" | "steer" | "release" | "retry" | `rerun:${number}`;

const BUTTON =
  "rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * The row. `steer` draws the one-line Steer box; leave it off where the view
 * already has a composer that reaches the run. `rerun` adds a "Re-run on"
 * button per option to a failed or cancelled task. `onSettled` runs after
 * every press ends, either way, so the app can read the row again and the
 * buttons follow its new status.
 */
export function TaskActions({
  id,
  status,
  actions,
  steer = false,
  rerun = [],
  onSettled,
}: {
  /** The task's id on its board. */
  id: string;
  /** The row's board status: `pending`, `held`, `in_progress`, `completed`, `errored` or `cancelled`. */
  status: string;
  actions: TaskActionCalls;
  steer?: boolean;
  rerun?: readonly TaskRerunOption[];
  onSettled?: () => void;
}) {
  const [busy, setBusy] = useState<Press | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [words, setWords] = useState("");
  // Kept with the task it was for, so a row reused for another task shows neither.
  const [said, setSaid] = useState<{ id: string; outcome?: string; refusal?: string } | null>(null);

  const open = OPEN.has(status);
  const ended = ENDED.has(status);
  if (!open && !ended) return null;

  const press = async (which: Press, call: () => Promise<string>) => {
    if (busy !== null) return;
    setBusy(which);
    setSaid(null);
    try {
      setSaid({ id, outcome: await call() });
    } catch (error) {
      setSaid({ id, refusal: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
      onSettled?.();
    }
  };
  const sendSteer = () => {
    const message = words.trim();
    if (message === "") return;
    void press("steer", async () => {
      await actions.steer(id, message);
      setWords("");
      return "Sent to the task.";
    });
  };
  const shown = said?.id === id ? said : null;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs" data-testid="task-action-row" data-status={status} aria-busy={busy !== null}>
      {open ? (
        confirming ? (
          <span className="flex items-center gap-2" data-testid="task-action-confirm">
            <span>{CANCEL_CONFIRM}</span>
            <button
              type="button"
              disabled={busy !== null}
              data-testid="task-action-confirm-yes"
              className={BUTTON}
              onClick={() =>
                void press("cancel", async () => {
                  const dependents = await actions.cancel(id);
                  setConfirming(false);
                  return cancelOutcome(dependents);
                })
              }
            >
              {busy === "cancel" ? "Cancelling…" : "Yes"}
            </button>
            <button type="button" disabled={busy !== null} data-testid="task-action-confirm-no" className={BUTTON} onClick={() => setConfirming(false)}>
              No
            </button>
          </span>
        ) : (
          <button
            type="button"
            disabled={busy !== null}
            data-testid="task-action-cancel"
            title="End this task. A running request stops with it, and tasks waiting on it are cancelled too."
            className={BUTTON}
            onClick={() => {
              setSaid(null);
              setConfirming(true);
            }}
          >
            Cancel
          </button>
        )
      ) : null}
      {status === "held" ? (
        <button
          type="button"
          disabled={busy !== null}
          data-testid="task-action-release"
          className={BUTTON}
          onClick={() =>
            void press("release", async () => {
              await actions.release(id);
              return "Released.";
            })
          }
        >
          {busy === "release" ? "Releasing…" : "Release"}
        </button>
      ) : null}
      {ended ? (
        <>
          <button
            type="button"
            disabled={busy !== null}
            data-testid="task-action-retry"
            title="Run this task again, as the same task."
            className={BUTTON}
            onClick={() =>
              void press("retry", async () => {
                await actions.retry(id);
                return "Sent back to run again.";
              })
            }
          >
            {busy === "retry" ? "Retrying…" : "Retry"}
          </button>
          {rerun.map((option, i) => (
            <button
              key={`${i}:${option.label}`}
              type="button"
              disabled={busy !== null}
              data-testid="task-action-rerun"
              data-label={option.label}
              title={`File this task again as a new one on ${option.label}. This one stays as it is.`}
              className={BUTTON}
              onClick={() =>
                void press(`rerun:${i}`, async () => {
                  await option.run();
                  return `Filed again on ${option.label}.`;
                })
              }
            >
              {busy === `rerun:${i}` ? "Filing…" : `Re-run on ${option.label}`}
            </button>
          ))}
        </>
      ) : null}
      {open && steer ? (
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <input
            type="text"
            aria-label="Steer this task"
            placeholder="Steer: a line for the task"
            value={words}
            disabled={busy !== null}
            data-testid="task-action-steer-input"
            onChange={(e) => setWords(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                sendSteer();
              }
            }}
            className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
          <button type="button" disabled={busy !== null || words.trim() === ""} data-testid="task-action-steer" className={BUTTON} onClick={sendSteer}>
            {busy === "steer" ? "Sending…" : "Steer"}
          </button>
        </span>
      ) : null}
      {shown?.outcome === undefined ? null : (
        <span role="status" className="text-muted-foreground" data-testid="task-action-outcome">
          {shown.outcome}
        </span>
      )}
      {shown?.refusal === undefined ? null : (
        <span role="alert" className="text-destructive" data-testid="task-action-refusal">
          {shown.refusal}
        </span>
      )}
    </div>
  );
}
