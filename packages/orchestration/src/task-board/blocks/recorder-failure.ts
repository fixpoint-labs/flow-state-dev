/**
 * What a board says when it saved a task's result and then could not announce
 * it (FIX-963).
 *
 * ## The event this names
 *
 * Both backings announce a task change as a tail call, strictly after the
 * durable write resolves and outside its `try`. So an announcement that throws
 * rejects a call whose write already committed. The write is fine; the board's
 * own bookkeeping is not.
 *
 * That is a different event from a task going wrong, and it is reported
 * differently. `onError` is a policy about a worker's outcome and is not
 * consulted here — a substrate that cannot say what it recorded has nothing
 * left to be honest with, so the run fails whatever `onError` says.
 *
 * ## Three values, not two
 *
 * `didWriteLand` (FIX-989) answers `true`, `false`, or *cannot tell*, and the
 * third is a first-class answer rather than a shrug. It is the permanent answer
 * for any caller-supplied task store — nothing there keeps the receipt the
 * question is answered from, and `stampWrite` stays package-internal by
 * design — and it is also the answer for a row that was already in a
 * persistent store before write provenance shipped, since nothing backfills the
 * identity nonce those rows lack. Only `false` (the write committed nothing) is
 * routine and keeps its existing behaviour; `true` and *cannot tell* are both
 * reported, under the two verdicts below.
 *
 * ## Why the report is a persisted item, and an awaited one
 *
 * The bug this closes hid on transient block traces that nothing saved. So the
 * report is an ordinary persisted component item — something a caller still has
 * after the run — and it is emitted through `ctx._emitComponentAwaited`, which
 * rejects rather than discarding its promise. `ctx.emit.component` returns
 * `void` and voids both emitter calls, so a report emitted that way could fail
 * in exactly the silence this issue is about.
 *
 * It is stamped with the task it was recording, which would otherwise make it
 * read as that worker's output; `task-attribution.ts` excludes this type for
 * that reason.
 */
import type { BlockContext } from "@flow-state-dev/core/types";

/**
 * Component type for a recorder-failure report.
 *
 * Mirrored as a literal in `@flow-state-dev/contracts`'
 * `items/task-attribution.ts`, which cannot import this package. Changing it
 * here means changing it there.
 */
export const TASK_BOARD_RECORDER_FAILURE_COMPONENT_TYPE =
  "task-board-recorder-failure";

/**
 * What the board could establish about the write it could not announce.
 *
 * - `committed` — the write landed. The work is saved; only the announcement
 *   failed.
 * - `undetermined` — the board cannot tell whether it landed. Never collapsed
 *   into either neighbour: collapsing restores the confident wrong answer the
 *   write record exists to remove, and it is the *permanent* answer for every
 *   custom store, so the collapse would be silent and total.
 *
 * A write that demonstrably committed nothing produces no verdict and no
 * report — it is routine, and takes the path it always took.
 */
export type RecorderWriteVerdict = "committed" | "undetermined";

/** Which of the two recorders hit this. */
export type RecorderKind = "complete" | "fail";

/** The report's payload, as it appears on the emitted item's `data`. */
export interface RecorderFailureReport {
  collectionId: string;
  taskId: string;
  recorder: RecorderKind;
  verdict: RecorderWriteVerdict;
  /** The announcement failure's message, verbatim. */
  error: string;
  /**
   * The drain run this belongs to, when there is one. Entries accumulate on
   * the per-REQUEST item buffer and a request can drain a board more than
   * once, so the tail filters on this rather than on collection id — a second
   * batch must not inherit the first one's failure. Absent for a settlement
   * with no batch around it (the hand-off gate), which raises immediately and
   * never filters.
   */
  runId?: string;
}

/**
 * Emit one recorder-failure report and wait for it to land.
 *
 * @throws {TaskBoardReportFailureError} when the emission rejects, or when the
 *   awaited seam is absent (a hand-built context). Deliberately, and
 *   deliberately as its own class: this is the one failure that is fatal
 *   *immediately* rather than at the drain's tail, so every recorder recognises
 *   it and refuses to let `onError` or a rescue swallow it. Falling back to
 *   `ctx.emit.component` when the seam is missing would give up the one
 *   property this call exists for, without saying so.
 */
export async function reportRecorderFailure(
  ctx: BlockContext,
  report: RecorderFailureReport
): Promise<void> {
  const emit = ctx._emitComponentAwaited;
  if (emit === undefined) {
    throw new TaskBoardReportFailureError(
      report,
      new Error(
        "this execution context provides no awaited emission seam, and the " +
          "fire-and-forget emitter cannot confirm the report was delivered"
      )
    );
  }
  try {
    await emit.call(
      ctx,
      TASK_BOARD_RECORDER_FAILURE_COMPONENT_TYPE,
      { ...report },
      {
        // Persisted: the entry has to survive the run. The original defect hid
        // on items that did not.
        transient: false,
        // Neither rendered nor fed to a model. It is substrate bookkeeping, and
        // the caller-visible signal is the run's own failure — same shape as
        // `goal-seek-loop`'s termination entry.
        itemVisibility: { client: false, history: false },
      }
    );
  } catch (err) {
    throw new TaskBoardReportFailureError(report, err);
  }
}

/**
 * Read one drain's recorder-failure reports off a request's item buffer.
 *
 * Scoped by `runId` alone, deliberately. The stamp is minted per drain and read
 * from a slot keyed by board name, so it already identifies both which board
 * and which of its runs — including a board nested inside another board's
 * worker, whose reports carry the inner stamp and are none of the outer tail's
 * business. Collection id would be the intuitive second filter and is the wrong
 * one: a board given a collection FACTORY reports under the ref's own id while
 * the drain knows it only as `factory-supplied`, so adding it would silently
 * drop every report on exactly the boards a custom store is reached through —
 * the population `undetermined` is permanent for.
 */
export function recorderFailuresForRun(
  items: readonly unknown[],
  runId: string
): RecorderFailureReport[] {
  const found: RecorderFailureReport[] = [];
  for (const raw of items) {
    const item = raw as {
      type?: string;
      component?: string;
      data?: Partial<RecorderFailureReport>;
    };
    if (item.type !== "component") continue;
    if (item.component !== TASK_BOARD_RECORDER_FAILURE_COMPONENT_TYPE) continue;
    const data = item.data;
    if (data?.runId !== runId) continue;
    found.push(data as RecorderFailureReport);
  }
  return found;
}

/**
 * The board could not even report that it had failed to record something.
 *
 * Its own class because its containment rule is the opposite of every other
 * failure here: a recorder failure waits for the drain's tail so the siblings
 * finish first, but a **report** that could not be delivered is fatal where it
 * happens. There is nothing left to defer to — the deferral works by leaving
 * the report on the stream for the tail to find, and that is exactly what just
 * did not happen. Every recorder rethrows this on sight, whatever `onError`
 * says and whatever site it is composed at.
 */
export class TaskBoardReportFailureError extends Error {
  readonly code = "task-board-report-failure";
  readonly report: RecorderFailureReport;

  constructor(report: RecorderFailureReport, cause: unknown) {
    super(
      `task board could not report a recorder failure on task ` +
        `"${report.taskId}" (${report.recorder}, ${report.verdict}): ` +
        (cause instanceof Error ? cause.message : String(cause))
    );
    this.name = "TaskBoardReportFailureError";
    this.report = report;
    this.cause = cause;
  }
}

/**
 * The error a run fails with once its reports are in.
 *
 * Its own class so the error recorder can recognise it when it arrives as a
 * rescued error and refuse to let `onError` swallow it — the hand-off gate's
 * whole raise travels that path.
 */
export class TaskBoardRecorderFailureError extends Error {
  readonly code = "task-board-recorder-failure";
  readonly reports: readonly RecorderFailureReport[];

  constructor(reports: readonly RecorderFailureReport[]) {
    super(describeReports(reports));
    this.name = "TaskBoardRecorderFailureError";
    this.reports = reports;
  }
}

/**
 * Name every task whose bookkeeping failed, not just the first — a run with two
 * of them should not read as a run with one.
 */
function describeReports(reports: readonly RecorderFailureReport[]): string {
  const each = reports
    .map(
      (r) =>
        `task "${r.taskId}" (${r.recorder}, ${r.verdict}): ${r.error}`
    )
    .join("; ");
  const subject =
    reports.length === 1 ? "1 task's result" : `${reports.length} tasks' results`;
  return (
    `task board could not record ${subject} — the write was saved, or may have ` +
    `been, and the change could not be announced: ${each}`
  );
}
