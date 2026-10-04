/**
 * Control `ignore-asks`: a worker's status read from its board rows only.
 *
 * Built into the control page in place of `src/lib/derive.ts`. Everything is
 * the real module except `seatStates`, whose statuses ignore pending asks: a
 * worker waiting on you only through an ask reads off shift. Its asks are still
 * listed. The goal must fail at "status equals the store's" on the asking
 * worker.
 */
import { readStatus } from "../../../../labs/shift-manager/src/lib/columns.ts";
import { seatStates as asWritten, type LoadedSnapshot, type SeatStates } from "../../../../labs/shift-manager/src/lib/derive.ts";

export * from "../../../../labs/shift-manager/src/lib/derive.ts";

const computed = new WeakMap<LoadedSnapshot, SeatStates>();

export function seatStates(snapshot: LoadedSnapshot): SeatStates {
  const cached = computed.get(snapshot);
  if (cached !== undefined) return cached;
  const real = asWritten(snapshot);
  const seats = new Map(
    [...real.seats].map(([id, state]) => [
      id,
      {
        ...state,
        status: state.held.some((row) => readStatus(row.status) === "in_progress")
          ? ("on shift" as const)
          : state.held.length > 0
            ? ("on call" as const)
            : ("off shift" as const),
      },
    ]),
  );
  const result = { ...real, seats };
  computed.set(snapshot, result);
  return result;
}
