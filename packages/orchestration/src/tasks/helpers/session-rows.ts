/**
 * The rows that run in one session (FIX-2160): the one answer to "which tasks
 * is this session working?".
 *
 * A row names the session it ran in by its run link (`run.sessionId`). A
 * follow-up runs in its root's session once the root's run there ends, one at
 * a time, so before it starts it carries no run link of its own. The rows of a
 * session are therefore every row whose run link names it, and every row of
 * their chains (the root and its follow-ups, `followUpOf`).
 *
 * Read by a coding run's door to find the row a line is about, and by a
 * message's send to refuse one to a coding task still running. In
 * orchestration, with no Workforce read: the caller hands in the ledger.
 */
import type { TaskCollectionRef } from "../collection/types";
import type { Task } from "../schema/task";

/** The rows of `ledger` that run in `sessionId`, in ledger order. Empty when none ran there. */
export function rowsInSession(ledger: TaskCollectionRef, sessionId: string): Task[] {
  const rows = ledger.list() as Task[];
  const roots = new Set<string>();
  for (const task of rows) if (task.run?.sessionId === sessionId) roots.add(task.followUpOf ?? task.id);
  if (roots.size === 0) return [];
  return rows.filter((task) => roots.has(task.followUpOf ?? task.id));
}
