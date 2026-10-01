/**
 * Control `count-queued`: a queued row counts as a slot in use.
 *
 * Built into the control page in place of `src/lib/derive.ts`. Everything is
 * the real module except `seatStates`, whose `held` also takes each worker's
 * queued rows (`pending`, `blocked`). Statuses are left as the real rule gives
 * them. The goal must fail at "slots equal held rows" on the worker with a
 * queued row.
 */
import { readStatus } from "../../../../labs/shift-manager/src/lib/columns.ts";
import {
  allRows,
  rosterOf,
  seatFor,
  seatStates as asWritten,
  type LoadedSnapshot,
  type SeatStates,
} from "../../../../labs/shift-manager/src/lib/derive.ts";

export * from "../../../../labs/shift-manager/src/lib/derive.ts";

const computed = new WeakMap<LoadedSnapshot, SeatStates>();

export function seatStates(snapshot: LoadedSnapshot): SeatStates {
  const cached = computed.get(snapshot);
  if (cached !== undefined) return cached;
  const real = asWritten(snapshot);
  const roster = rosterOf(snapshot);
  const seats = new Map([...real.seats].map(([id, state]) => [id, { ...state, held: [...state.held] }]));
  for (const row of allRows(snapshot)) {
    const status = readStatus(row.status);
    if (status !== "pending" && status !== "blocked") continue;
    const owner = seatFor(roster, row);
    if (owner !== undefined) seats.get(owner.id)?.held.push(row);
  }
  const result = { ...real, seats };
  computed.set(snapshot, result);
  return result;
}
