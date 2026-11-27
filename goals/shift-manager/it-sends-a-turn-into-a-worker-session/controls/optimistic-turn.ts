/**
 * Control `optimistic-turn`: a line is drawn delivered without calling the
 * door.
 *
 * Built into the control page in place of `src/lib/deliver.ts`, Shift
 * Manager's one send path. `useDeliverLine`'s send resolves at once and sends
 * nothing, so every composer shows *delivered* while no session holds the
 * line. The goal must fail at "delivered only once the session holds the line".
 */
export * from "../../../../packages/shift-manager/src/lib/deliver.ts";

export function useDeliverLine() {
  return async () => ({ requestId: "never-sent", suspended: false, stopped: null });
}
