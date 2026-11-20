/**
 * Control `status-from-snapshot`: a worker's asks read from the snapshot's
 * walked asks, as before the status moved onto the Inbox view.
 *
 * Built into the control page in place of `src/lib/shift.ts`. Everything is
 * the real module except `workerStates`, whose status counts the page's
 * snapshot's asks, read through its provider, while the Inbox lists the
 * view's (and the waits-on entries stay the view's). The two are separate reads, so a new ask is listed in one update and
 * the worker reads on shift in another. The goal must fail at "one answer".
 */
import { useLab } from "../../../../packages/shift-manager/src/lib/lab-data.tsx";
import { workerStates as asWritten, type WorkerStates } from "../../../../packages/shift-manager/src/lib/shift.ts";

export * from "../../../../packages/shift-manager/src/lib/shift.ts";

export function workerStates(...args: Parameters<typeof asWritten>): WorkerStates {
  const real = asWritten(...args);
  // Every caller computes states while it renders, so the provider is in reach (a production build).
  const { snapshot } = useLab();
  const asks = snapshot !== undefined && "asks" in snapshot && snapshot.asks.ok ? snapshot.asks.value : [];
  const seats = new Map(
    [...real.workers].map(([id, state]) => {
      const mine = asks.filter((ask) => ask.workerId === id);
      return [id, { ...state, status:state.held.length > 0 || mine.length > 0 ? ("on shift" as const) : ("off shift" as const) }];
    }),
  );
  return { ...real, workers: seats };
}
