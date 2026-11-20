/**
 * Control `count-queued`: a queued task counts as a slot in use.
 *
 * Built into the control page in place of `src/lib/shift.ts`. Everything is
 * the real module except `workerStates`, whose `held` also takes each worker's
 * queued tasks (`pending`, `held`) off the Inbox view's tasks. Statuses are
 * left as the real rule gives them. The goal must fail at "slots equal held
 * rows" on the worker with a queued task.
 */
import { workerFor, workerStates as asWritten, type WorkerStates } from "../../../../packages/shift-manager/src/lib/shift.ts";

export * from "../../../../packages/shift-manager/src/lib/shift.ts";

export function workerStates(...args: Parameters<typeof asWritten>): WorkerStates {
  const [workers, view] = args;
  const real = asWritten(...args);
  const seats = new Map([...real.workers].map(([id, state]) => [id, { ...state, held: [...state.held] }]));
  for (const task of view?.tasks ?? []) {
    if (task.status !== "pending" && task.status !== "held") continue;
    const owner = workerFor(workers, task);
    if (owner !== undefined) seats.get(owner.id)?.held.push(task);
  }
  return { ...real, workers: seats };
}
