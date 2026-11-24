/**
 * Control `optimistic-post`: the one send path reads a line delivered and
 * sends nothing.
 *
 * Built into the control page in place of `src/lib/deliver.ts`, which every
 * composer that talks to a worker sends through: a workstream entry's
 * conversation with its lead, the task composer, Inbox's reply and Shift
 * Coordinator.
 *
 * `useDeliverLine`'s send resolves at once and calls no door, so a composer
 * reads the line delivered while no session holds it. The goal must fail at
 * "the post is in the stored transcript" on both Labs; on DevTeam it also
 * fails "the post appears on screen", since the entry's conversation draws a
 * line only once its session holds it.
 */
export * from "../../../../packages/shift-manager/src/lib/deliver.ts";

/** Read the line as delivered; the worker's door is never called. */
export function useDeliverLine() {
  return async () => ({ requestId: "never-sent", suspended: false, stopped: null });
}
