/**
 * Control `ignore-asks`: a worker's status read from its board rows only.
 *
 * Built into the control page in place of `src/lib/derive.ts`. Everything is
 * the real module except `workerStates`, whose statuses ignore pending asks: a
 * worker waiting on you only through an ask reads off shift. Its asks are still
 * listed. The goal must fail at "status equals the store's" on the asking
 * worker.
 */
import { workerStates as asWritten, type LoadedSnapshot, type WorkerStates } from "../../../../packages/shift-manager/src/lib/derive.ts";

export * from "../../../../packages/shift-manager/src/lib/derive.ts";

const computed = new WeakMap<LoadedSnapshot, WorkerStates>();

export function workerStates(snapshot: LoadedSnapshot): WorkerStates {
  const cached = computed.get(snapshot);
  if (cached !== undefined) return cached;
  const real = asWritten(snapshot);
  const seats = new Map(
    [...real.workers].map(([id, state]) => [
      id,
      {
        ...state,
        status: state.held.length > 0 ? ("on shift" as const) : ("off shift" as const),
      },
    ]),
  );
  const result = { ...real, workers: seats };
  computed.set(snapshot, result);
  return result;
}
