/**
 * The one read of a session's settled past turns (FIX-2173).
 *
 * A turn's history window (`createExecutionContext`) loads through it, so the
 * rule for which of a session's turns a model may read is written once: list
 * the newest past turns under the session's request scope, leave out the
 * running request, an interrupted turn that will run again (parked) or that a
 * retry re-ran, keep only the settled items of any other interrupted turn,
 * and order what is left oldest first. A turn still running, suspended or
 * parked is never read: what it says is not final.
 */
import type { DurabilityProvider } from "../durability/types";
import { parkedInterruptedIds } from "../durability/stop-suspended";
import { PAST_TURN_STATUSES, retriedIds } from "../execution/past-turns";
import type { RequestRecord, RequestStore, WakeStore } from "../stores/types";
import { compareTurnsOldestFirst } from "./history";
import type { sessionRequestScope } from "./session-request-scope";

export type SettledTurnsInputs = {
  requests: Pick<RequestStore, "list">;
  /** The session's request scope, from `sessionRequestScope`. */
  scope: ReturnType<typeof sessionRequestScope>;
  /** How many of the most recently started past turns to read. */
  turns: number;
  /** The running request, when it is in this session: never read as a past turn. */
  runningRequestId?: string;
  /** The running request's metadata, when it is in this session: a retry names the turn it re-runs. */
  runningMetadata?: Record<string, unknown>;
  /**
   * The session's turns open now (running or suspended), read by a caller
   * that is not one of them: a retry still running names the turn it re-runs
   * as well.
   */
  openTurns?: readonly Pick<RequestRecord, "metadata">[];
  /** Where parked gates are read. Without one, nothing is treated as parked. */
  durability?: Pick<DurabilityProvider, "listSuspended" | "loadSuspension">;
  /** Where a park a turn owes is read (FIX-2269): a turn that owes one is parked. */
  wakes?: WakeStore;
  /**
   * Called when the parked gates could not be read. The read goes on with
   * nothing treated as parked: a view that may show a parked turn, never a
   * failed turn.
   */
  onGateReadError: (error: unknown) => void;
};

export type SettledTurns = {
  /**
   * The window: the `turns` most recently started past turns, oldest first,
   * before any is left out. A retried or parked turn still holds its place.
   */
  window: RequestRecord[];
  /** The first turn the window holds, when an earlier turn fell out of it. */
  start?: { requestId: string };
  /** The ids of turns a retry re-ran. */
  retried: Set<string>;
  /** The ids of interrupted turns in the window that will run again. */
  parked: Set<string>;
  /** The turns a model reads, oldest first. */
  settled: RequestRecord[];
};

/** Read a session's settled past turns. See the file header for the rule. */
export async function readSettledTurns(inputs: SettledTurnsInputs): Promise<SettledTurns> {
  const { turns, runningRequestId } = inputs;
  // The newest past turns (`PAST_TURN_STATUSES`). The status filter excludes
  // the running request and any in-flight siblings; an `interrupted` request
  // is a turn its host died in, and what it persisted (the message that
  // started it, the calls that ran) is part of the conversation.
  // `orderBy:"startedAtMs"` keeps the selection robust to out-of-order
  // metadata writes. One row past the window is read only to learn whether an
  // earlier turn fell out of it; it is dropped before anything reads the
  // window.
  const listed = await inputs.requests.list({
    ...inputs.scope,
    status: PAST_TURN_STATUSES,
    limit: turns + 1,
    orderBy: "startedAtMs",
    withItems: true
  });

  // The store's newest-first order breaks a start-time tie by id; trimming
  // before reversing keeps the turn at the edge the same as without the extra row.
  const window = listed.slice(0, turns).reverse();
  const start = listed.length > turns && window[0] !== undefined ? { requestId: window[0].id } : undefined;
  const retried = retriedIds([...window, ...(inputs.openTurns ?? [])], inputs.runningMetadata);
  let parked = new Set<string>();
  try {
    parked = await parkedInterruptedIds(inputs.durability, window, inputs.wakes);
  } catch (error) {
    inputs.onGateReadError(error);
  }
  const settled = window
    .filter((r) => r.id !== runningRequestId)
    .filter((r) => r.status !== "interrupted" || (!retried.has(r.id) && !parked.has(r.id)))
    .map((r) => (r.status === "interrupted" && r.items !== undefined ? { ...r, items: r.items.filter((i) => i.status !== "in_progress") } : r))
    .sort((a, b) => compareTurnsOldestFirst(a.startedAtMs, a.id, b.startedAtMs, b.id));

  return { window, ...(start !== undefined ? { start } : {}), retried, parked, settled };
}
