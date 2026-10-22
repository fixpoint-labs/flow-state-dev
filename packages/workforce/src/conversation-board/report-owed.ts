/**
 * A task that failed for good is reported to the Error Reporter's intake
 * (FIX-1983), riding its ending's delivery (FIX-2078, epic decision (f)): the
 * filer's `onTaskSettled` sends it before it acknowledges the notice, so a
 * failed send leaves the notice owed and the report goes again with it. The
 * intake takes it as the task occurrence it already dedupes.
 *
 * A notice nobody can take (its conversation is gone) sends the report where
 * that refusal is handled. A routed task's report goes the same way (FIX-2083).
 *
 * **Upgrade (BP-030).** A row stored before FIX-2078 may carry a report-owed
 * marker (`reportOwed:<attempt>`) whose notice is already acknowledged. The
 * filer's pass sends each such marker once as the task occurrence, and drops
 * it once the intake took it ({@link sendLegacyReports}). Nothing writes one now.
 */
import { dispatchThroughSeam } from "@flow-state-dev/core/types";
import type { BlockContext } from "@flow-state-dev/core/types";
import type { Task, TaskCollectionRef } from "@flow-state-dev/orchestration/tasks";
import { ERROR_REPORTER_INTAKE_FLOW, INTAKE_ENTRY, INTAKE_SESSION_ID } from "../error-reporter/keys";

/** The marker an owed report was kept under before FIX-2078, in the row's metadata. */
const REPORT_OWED_PREFIX = "reportOwed:";

/** The metadata key a stored owed report for `attempt` is kept under. The intake clears it once it holds the report. */
export function reportOwedKey(attempt: number): string {
  return `${REPORT_OWED_PREFIX}${attempt}`;
}

interface ReportMarker {
  readonly attempt: number;
  readonly error: string;
}

/** The reports a row stored before FIX-2078 still owes, by marker key. */
export function owedReports(row: Task): Array<{ key: string; marker: ReportMarker }> {
  return Object.entries(row.metadata ?? {})
    .filter(([key, value]) => key.startsWith(REPORT_OWED_PREFIX) && value !== null && typeof value === "object")
    .map(([key, value]) => ({ key, marker: value as ReportMarker }));
}

/** `metadata` without any owed-report marker: a caller can't forge or clear one. */
export function withoutReportMarkers(metadata: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(metadata).filter(([key]) => !key.startsWith(REPORT_OWED_PREFIX)));
}

/** What the intake did with a report. */
export type ReportOutcome = "taken" | "no-reporter" | "not-taken";

/**
 * Send one task failure to the Error Reporter's intake, as the task
 * occurrence it takes and dedupes. A Lab with no reporter refuses
 * `flow-not-found`: nobody will ever take it. Never throws.
 *
 * @param board The ledger's id and the partition the row is on.
 */
export async function sendTaskReport(
  ctx: BlockContext,
  row: Task,
  failure: { readonly attempt: number; readonly error: string },
  board: { readonly boardId: string; readonly partition: string },
  from: string
): Promise<ReportOutcome> {
  const userId = ctx.session.identity.userId;
  if (userId === undefined) return "not-taken";
  try {
    const outcome = await dispatchThroughSeam(ctx, {
      type: "internal",
      action: INTAKE_ENTRY,
      flowKind: ERROR_REPORTER_INTAKE_FLOW,
      session: { key: INTAKE_SESSION_ID },
      payload: {
        occurrence: {
          kind: "task",
          at: row.completedAt ?? row.updatedAt ?? Date.now(),
          taskId: row.id,
          boardId: board.boardId,
          partition: board.partition,
          attempt: failure.attempt,
          error: failure.error,
          userId,
          ...(row.assignee !== undefined ? { assignee: row.assignee } : {}),
          ...(row.title !== undefined ? { title: row.title } : {}),
          ...(row.goal !== undefined ? { goal: row.goal } : {}),
          ...(row.run !== undefined ? { requestId: row.run.requestId, sessionId: row.run.sessionId } : {})
        }
      },
      from
    });
    if (outcome.ok) return "taken";
    return outcome.refused === "flow-not-found" ? "no-reporter" : "not-taken";
  } catch {
    return "not-taken";
  }
}

/**
 * Send each report a row stored before FIX-2078 still owes, once, and drop its
 * marker once the intake took it (or no reporter ever will). Any other outcome
 * leaves the marker for the next pass.
 *
 * @returns How many the reporter took.
 */
export async function sendLegacyReports(
  ctx: BlockContext,
  ref: TaskCollectionRef,
  rows: readonly Task[],
  board: { readonly boardId: string; readonly partition: string },
  from: string
): Promise<number> {
  let taken = 0;
  for (const row of rows) {
    for (const { key, marker } of owedReports(row)) {
      const outcome = await sendTaskReport(ctx, row, marker, board, from);
      if (outcome === "not-taken") continue;
      if (outcome === "taken") taken += 1;
      await ref.patchMetadata(row.id, { [key]: null });
    }
  }
  return taken;
}
