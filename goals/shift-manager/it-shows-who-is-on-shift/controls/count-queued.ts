/**
 * Control `count-queued`: a queued row counts as a slot in use.
 *
 * Built into the control page in place of `src/lib/derive.ts`. Everything is
 * the real module except `workerStates`, whose `held` also takes each worker's
 * queued rows (`pending`, `blocked`). Statuses are left as the real rule gives
 * them. The goal must fail at "slots equal held rows" on the worker with a
 * queued row.
 */
import { readStatus } from "../../../../packages/shift-manager/src/lib/columns.ts";
import {
  allRows,
  rosterOf,
  workerFor,
  workerStates as asWritten,
  type LoadedSnapshot,
  type WorkerStates,
} from "../../../../packages/shift-manager/src/lib/derive.ts";

export * from "../../../../packages/shift-manager/src/lib/derive.ts";

const computed = new WeakMap<LoadedSnapshot, WorkerStates>();

export function workerStates(snapshot: LoadedSnapshot): WorkerStates {
  const cached = computed.get(snapshot);
  if (cached !== undefined) return cached;
  const real = asWritten(snapshot);
  const roster = rosterOf(snapshot);
  const seats = new Map([...real.workers].map(([id, state]) => [id, { ...state, held: [...state.held] }]));
  for (const row of allRows(snapshot)) {
    const status = readStatus(row.status);
    if (status !== "pending" && status !== "held") continue;
    const owner = workerFor(roster, row);
    if (owner !== undefined) seats.get(owner.id)?.held.push(row);
  }
  const result = { ...real, workers: seats };
  computed.set(snapshot, result);
  return result;
}
