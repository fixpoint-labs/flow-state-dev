/**
 * Where a request of this session stands, as the engine records it
 * (`RequestWaits.running` and `RequestWaits.ended`): running its own work,
 * parked (on a person or a wait), or ended. The one reading a board makes
 * when it decides by a request's state: whether a notice is held for a filing
 * request, whether a notice's taker still delivers it, and whether a lapsed
 * wait slot is released.
 */
import type { BlockContext } from "@flow-state-dev/core/types";

/** Where one request stands: running its own work, parked on a person or a wait, or ended (its process died too). */
export type RequestState = "running" | "parked" | "ended";

/**
 * Read where each of `ids` stands, in one read of each engine record.
 *
 * Read off the engine's records, never decided here: `running` says the
 * request runs, `ended` that it ended, and a request neither says reads
 * `parked`. Neither says so for a request that is parked, but also for one
 * of another session (both answer `false` for it on purpose), for one whose
 * record can't be read, and for one that crashed and is being driven again.
 * A caller that acts on `parked` checks the request is this session's own.
 * A host that records only one of the two can't see every state. With only
 * `running`, a request not running reads `ended`: it can't tell a park from
 * an end. With only `ended`, a request not ended has no entry: it can't tell
 * a park from a run, and the caller decides what that means for it.
 *
 * @returns Each request's state, or `undefined` when the host records
 *   neither, or `ids` is empty.
 */
export async function requestStates(
  ctx: BlockContext,
  ids: readonly string[]
): Promise<Readonly<Partial<Record<string, RequestState>>> | undefined> {
  const waits = ctx.requestHost?.waits;
  if (ids.length === 0 || (waits?.running === undefined && waits?.ended === undefined)) return undefined;
  const unique = [...new Set(ids)];
  const [running, ended] = await Promise.all([waits.running?.(unique), waits.ended?.(unique)]);
  const states: Partial<Record<string, RequestState>> = {};
  for (const id of unique) {
    if (running?.[id] === true) states[id] = "running";
    else if (ended?.[id] === true || (running !== undefined && ended === undefined)) states[id] = "ended";
    else if (running !== undefined) states[id] = "parked";
  }
  return states;
}
