/**
 * A task that ended errored owes the Error Reporter an occurrence (FIX-1983).
 *
 * The same outbox as a notice (`./ledger`): the ledger's ending recorder puts
 * a `reportOwed:<attempt>` mark on the row in the write that records the
 * errored ending, so the ending and the debt land together or not at all.
 * The board's next touch and the task session's tell send it to the
 * reporter's intake, and clear it once the reporter took it, or once the Lab
 * turns out to run no reporter.
 *
 * Orchestration never reads the mark: what it means is Workforce's.
 */
import { dispatchThroughSeam } from "@flow-state-dev/core/types";
import type { BlockContext } from "@flow-state-dev/core/types";
import type { Task, TaskCollectionRef, TaskEnding } from "@flow-state-dev/orchestration/tasks";

/** The marker each owed report is kept under, in the row's metadata. */
const REPORT_OWED_PREFIX = "reportOwed:";

/**
 * The flow and entry a board sends an owed report to. **Pinned**: they are the
 * Error Reporter's intake (`../error-reporter/flow`), named here so the board
 * does not import the reporter; a test pins the two to each other.
 */
export const REPORTER_FLOW = "error-reporter-intake";
export const REPORTER_INTAKE_ENTRY = "intake";

/** The child session a board's intakes run in, one per sending session. */
export const REPORTER_INTAKE_KEY = "error-report-intake";

interface ReportMarker {
  readonly attempt: number;
  readonly error: string;
}

/**
 * The row an ending writes, with an owed report marked when the task ended
 * errored. A pure function of what it is handed: the ledger's recorder runs
 * it inside the ending's write, perhaps more than once.
 */
export function markReportOwed(row: Task, ending: TaskEnding): Task {
  if (ending.kind !== "errored") return row;
  const marker: ReportMarker = { attempt: row.attempts, error: ending.error };
  return { ...row, metadata: { ...(row.metadata ?? {}), [`${REPORT_OWED_PREFIX}${row.attempts}`]: marker } };
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
 * Send each report the rows owe to the Error Reporter's intake, and clear its
 * mark once taken. A Lab with no reporter refuses `flow-not-found`, which
 * clears the mark too: nobody will ever take it. Any other refusal, or a
 * thrown send, leaves it for the next touch.
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
  for (const row of rows) {
    for (const { key, marker } of owedReports(row)) {
      const userId = ctx.session.identity.userId;
      if (userId === undefined) continue;
      try {
        const outcome = await dispatchThroughSeam(ctx, {
          type: "internal",
          action: REPORTER_INTAKE_ENTRY,
          flowKind: REPORTER_FLOW,
          session: { key: REPORTER_INTAKE_KEY },
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
        if (outcome.ok) sent += 1;
        if (!outcome.ok && outcome.refused !== "flow-not-found") continue;
      } catch {
        continue;
      }
      await ref.patchMetadata(row.id, { [key]: null });
    }
  }
  return sent;
}
