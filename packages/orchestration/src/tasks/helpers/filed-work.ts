/**
 * Filed work still holding a task (FIX-2077, rule 6): the one answer to
 * "is anything this task filed keeping it open?".
 *
 * A row a task filed (`Task.filedByTask`) holds it while the row isn't
 * terminal, and after that while the row's ending is still owed to the
 * task's session (its notice marker is on the row). So the task stays open
 * until the turn its last piece's ending wakes has run, and that turn decides
 * what the piece meant (D3).
 *
 * In orchestration, with no Workforce read: Workforce hands in the ledger its
 * pieces are on.
 */
import type { TaskCollectionRef } from "../collection/types";
import { owesAnyNotice } from "../notice/task-notice";
import type { Task } from "../schema/task";
import { isTerminalStatus } from "../schema/task-status";

/** Whether a row a task filed still holds that task: it is open, or its ending is still owed. */
export function holdsItsFiler(row: Task): boolean {
  return !isTerminalStatus(row.status) || owesAnyNotice(row);
}

/**
 * Whether any row on `ledger` that `taskId` filed still holds it. Filters at
 * the source (`filedByTask`) and stops at the first that holds.
 */
export function filedWorkHolds(ledger: TaskCollectionRef, taskId: string): boolean {
  for (const row of ledger.list({ filedByTask: taskId })) {
    if (holdsItsFiler(row)) return true;
  }
  return false;
}
