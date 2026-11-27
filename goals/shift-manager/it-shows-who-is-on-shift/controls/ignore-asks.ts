/**
 * Control `ignore-asks`: a worker's status read from its held tasks only.
 *
 * Built into the control page in place of `src/lib/shift.ts`. Everything is
 * the real module except `workerStates`, whose statuses ignore pending asks: a
 * worker waiting on you only through an ask reads off shift. Its asks are still
 * listed. The goal must fail at "status equals the store's" on the asking
 * worker.
 */
import { workerStates as asWritten, type WorkerStates } from "../../../../packages/shift-manager/src/lib/shift.ts";

export * from "../../../../packages/shift-manager/src/lib/shift.ts";

export function workerStates(...args: Parameters<typeof asWritten>): WorkerStates {
  const real = asWritten(...args);
  const seats = new Map(
    [...real.workers].map(([id, state]) => [
      id,
      {
        ...state,
        status: state.held.length > 0 ? ("on shift" as const) : ("off shift" as const),
      },
    ]),
  );
  return { ...real, workers: seats };
}
