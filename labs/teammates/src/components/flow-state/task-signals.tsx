"use client";

import type { ReactNode } from "react";
import { leaseLapsed } from "@flow-state-dev/orchestration/tasks";
import { durationText } from "./spend";

/*
 * A task row's time, and whether its run has stopped answering, as one short
 * signal; and a list's per-state counts. Read from what the board's
 * `listTasks` action answers for a row: orchestration's `taskRowView` of it,
 * its run link's `startedAt`, and its `leaseUntil`.
 *
 * - **working · 4m 12s**: a running row, timed from this attempt's run start
 *   (`run.startedAt`), so a retried task never counts its earlier attempts.
 * - **quiet for 7m**: a running row whose lease has lapsed, by the board's own
 *   rule (`leaseLapsed`): no live run renews it. A live run in one long step
 *   keeps renewing, so it never reads quiet. Counted from the row's last
 *   write. Never while the app's feed is stale: a feed that lost the server
 *   says nothing about the run.
 * - **12m ago**: an ended row (done, failed, cancelled).
 *
 * The item runs no timer: the app passes `now`, from its own clock.
 */

/** What the signal reads of a row: orchestration's `TaskRowView` fits. */
export interface TaskSignalView {
  /** `taskRowView`'s `state`: queued, held, running, waiting, failed, done or cancelled. */
  state: string;
  times: { updatedAt: number | null; completedAt: number | null };
}

/** What a row carries beside its view: its run link's start, and its lease deadline, epoch ms. */
export interface TaskSignalRun {
  startedAt?: number | null;
  leaseUntil?: number | null;
}

/** Which signal a row shows; an app maps each to its own tone. */
export type TaskSignalKind = "working" | "quiet" | "ended";

export interface TaskSignal {
  kind: TaskSignalKind;
  text: string;
}

const ENDED = new Set(["done", "failed", "cancelled"]);

/** "just now", "12m ago", "3h ago", "2d ago". */
export function agoText(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

/** "7m", "1h 3m": how long a quiet row has said nothing. */
function quietFor(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * A row's signal at `now`, or `null` when it has none: a queued, held or
 * waiting row, a running row whose run hasn't linked itself yet, or an ended
 * row with no time.
 */
export function taskSignal(view: TaskSignalView, run: TaskSignalRun | null | undefined, now: number, options: { stale?: boolean } = {}): TaskSignal | null {
  const { updatedAt, completedAt } = view.times;
  if (ENDED.has(view.state)) {
    const at = completedAt ?? updatedAt;
    return at == null ? null : { kind: "ended", text: agoText(now - at) };
  }
  if (view.state !== "running") return null;
  // The board's rule, on the row as listed: only the status and the lease deadline are read.
  const lapsed = leaseLapsed({ status: "in_progress", leaseUntil: run?.leaseUntil ?? undefined } as Parameters<typeof leaseLapsed>[0], now);
  if (lapsed && options.stale !== true) return { kind: "quiet", text: updatedAt == null ? "quiet" : `quiet for ${quietFor(now - updatedAt)}` };
  return run?.startedAt == null ? null : { kind: "working", text: `working · ${durationText(now - run.startedAt)}` };
}

/** "2 running · 1 waiting · 1 failed · 28 done": the states a person acts on, without zeros. Empty when none. */
export function taskCounts(views: readonly Pick<TaskSignalView, "state">[]): string {
  return (["running", "waiting", "failed", "done"] as const)
    .map((state) => [state, views.filter((v) => v.state === state).length] as const)
    .filter(([, n]) => n > 0)
    .map(([state, n]) => `${n} ${state}`)
    .join(" · ");
}

/** A row's signal as a span, toned by the app (`tone`), or `fallback` when it has none. */
export function TaskTime({
  view,
  run,
  now,
  stale,
  tone,
  fallback = null,
}: {
  view: TaskSignalView;
  run?: TaskSignalRun | null;
  now: number;
  stale?: boolean;
  tone?: (kind: TaskSignalKind) => string;
  fallback?: ReactNode;
}) {
  const signal = taskSignal(view, run, now, { stale });
  if (signal === null) return <>{fallback}</>;
  return (
    <span className={tone?.(signal.kind)} data-task-signal={signal.kind}>
      {signal.text}
    </span>
  );
}
