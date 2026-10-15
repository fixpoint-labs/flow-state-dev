/**
 * A task that ended errored owes the Error Reporter an occurrence (FIX-1983),
 * marked in the ending's write the way a notice is (`./ledger`). Orchestration
 * never reads the mark.
 */
import { dispatchThroughSeam } from "@flow-state-dev/core/types";
import type { BlockContext } from "@flow-state-dev/core/types";
import type { Task, TaskCollectionRef, TaskEnding } from "@flow-state-dev/orchestration/tasks";
import { ERROR_REPORTER_INTAKE_FLOW, INTAKE_ENTRY, INTAKE_SESSION_ID } from "../error-reporter/keys";

/** The marker each owed report is kept under, in the row's metadata. */
const REPORT_OWED_PREFIX = "reportOwed:";

/** The metadata key a task's owed report for `attempt` is kept under. The intake clears it once it holds the report. */
export function reportOwedKey(attempt: number): string {
  return `${REPORT_OWED_PREFIX}${attempt}`;
}

interface ReportMarker {
  readonly attempt: number;
  readonly error: string;
  /** When a send was last accepted: the intake has it, or will clear the mark once it holds it. */
  readonly sentAt?: number;
}

/** How long an accepted send is waited on before the mark is sent again: the intake may have failed. */
const RESEND_AFTER_MS = 5 * 60_000;

/**
 * The row an ending writes, with an owed report marked when the task ended
 * errored. A pure function of what it is handed: the ledger's recorder runs
 * it inside the ending's write, perhaps more than once.
 */
export function markReportOwed(row: Task, ending: TaskEnding): Task {
  if (ending.kind !== "errored") return row;
  const marker: ReportMarker = { attempt: row.attempts, error: ending.error };
  return { ...row, metadata: { ...(row.metadata ?? {}), [reportOwedKey(row.attempts)]: marker } };
}

/** The reports a row still owes, by marker key. */
export function owedReports(row: Task): Array<{ key: string; marker: ReportMarker }> {
  return Object.entries(row.metadata ?? {})
    .filter(([key, value]) => key.startsWith(REPORT_OWED_PREFIX) && value !== null && typeof value === "object")
    .map(([key, value]) => ({ key, marker: value as ReportMarker }));
}

/** `metadata` without any owed-report marker: a caller can't forge or clear one. */
export function withoutReportMarkers(metadata: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(metadata).filter(([key]) => !key.startsWith(REPORT_OWED_PREFIX)));
}

/**
 * Send each report the rows owe to the Error Reporter's intake. The intake
 * clears the mark once the report holds it; an accepted send only notes when
 * it went, and is sent again after {@link RESEND_AFTER_MS} if the mark is
 * still there (the intake counts a redelivery once). A Lab with no reporter
 * refuses `flow-not-found`, which clears the mark: nobody will ever take it.
 * Any other refusal, or a thrown send, leaves it for the next touch.
 *
 * @param ref The ledger the rows are on, to clear a mark.
 * @param rows The rows to send from.
 * @param board The ledger's id and the partition the rows are in.
 * @param from The sending block, for provenance.
 * @returns How many the reporter took.
 */
export async function sendOwedReports(
  ctx: BlockContext,
  ref: TaskCollectionRef,
  rows: readonly Task[],
  board: { readonly boardId: string; readonly partition: string },
  from: string
): Promise<number> {
  let sent = 0;
  const now = Date.now();
  for (const row of rows) {
    for (const { key, marker } of owedReports(row)) {
      const userId = ctx.session.identity.userId;
      if (userId === undefined) continue;
      if (marker.sentAt !== undefined && now - marker.sentAt < RESEND_AFTER_MS) continue;
      let outcome;
      try {
        outcome = await dispatchThroughSeam(ctx, {
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
              attempt: marker.attempt,
              error: marker.error,
              userId,
              ...(row.assignee !== undefined ? { assignee: row.assignee } : {}),
              ...(row.title !== undefined ? { title: row.title } : {}),
              ...(row.goal !== undefined ? { goal: row.goal } : {}),
              ...(row.run !== undefined ? { requestId: row.run.requestId, sessionId: row.run.sessionId } : {})
            }
          },
          from
        });
      } catch {
        continue;
      }
      if (outcome.ok) {
        sent += 1;
        await ref.patchMetadata(row.id, { [key]: { ...marker, sentAt: now } });
      } else if (outcome.refused === "flow-not-found") {
        await ref.patchMetadata(row.id, { [key]: null });
      }
    }
  }
  return sent;
}
