/**
 * A session's delegates: the records in its server-written session state,
 * and the one way they change. Any worker whose file lists `delegates:` has
 * them, on any flow that carries this list (FIX-1802 D1); a coordinator routes
 * its posts to them, and any worker files tasks for the ones that take one.
 *
 * A delegate record is a worker, an optional note on what it's good at, and an
 * optional target a caller resolves (FIX-1793's workstream address). Records
 * are told apart by worker and target together, so one worker with two
 * targets is two delegates; uniqueness and the cap go by the record.
 *
 * The list is `null` until the session's delegates are first read or
 * changed, and is then a copy of the worker's defaults, with any records the
 * flow seeds the session with (a project coordinator's: one per workstream
 * its user has open in the project). The defaults are never written back, so
 * a change stays in the session it was made in.
 *
 * Every change is one versioned write that recomputes on retry: two changes
 * arriving together both land, and neither is lost. Only this module writes
 * the list; a flow declares its fields `serverOwned`, so a session create
 * can't seed them.
 */
import { withOutcome } from "@flow-state-dev/core/helpers";
import type { BlockContext } from "@flow-state-dev/core/types";
import { z } from "zod";
import { delegateKey, deliveryDelegateSchema, type DeliveryDelegate } from "../delivery-ledger";
import { DELEGATES_STATE, FALLBACK_STATE, MAX_DELEGATES } from "./delegate-keys";

/** One delegate record. */
export const delegateRecordSchema = deliveryDelegateSchema.extend({
  /** What it's good at, for best fit. Preferred over the worker's description. */
  note: z.string().min(1).optional()
});

export type DelegateRecord = z.infer<typeof delegateRecordSchema>;

/**
 * A session's delegate list, as a flow spreads it into its session
 * `stateSchema`: server-written, and declared `serverOwned`
 * ({@link DELEGATE_SERVER_OWNED}) so a session create can't seed it.
 */
export const delegateStateShape = {
  [DELEGATES_STATE]: z.array(delegateRecordSchema).nullable().default(null),
  [FALLBACK_STATE]: deliveryDelegateSchema.nullable().default(null)
} as const;

/** The delegate list's fields: only this module writes them. */
export const DELEGATE_SERVER_OWNED: readonly string[] = [DELEGATES_STATE, FALLBACK_STATE];

export const delegateSessionStateSchema = z.object(delegateStateShape);

/**
 * A worker's defaults: the worker ids its configuration lists, and its
 * fallback; and the records the flow seeds this session with, beside them.
 */
export type DelegateDefaults = { delegates: readonly string[]; fallback?: string; records?: readonly DelegateRecord[] };

/** The conversation's delegates and fallback, seeded from the defaults when never set. */
export type DelegateList = { delegates: DelegateRecord[]; fallback: DeliveryDelegate | null };

/** How a record reads to a person and to the evaluator: its worker, with its target when it has one. */
export function delegateLabel(delegate: DeliveryDelegate): string {
  return delegate.target === undefined ? delegate.worker : `${delegate.worker} (${delegate.target})`;
}

/** Whether two values name the same delegate record. */
export function sameDelegate(a: DeliveryDelegate, b: DeliveryDelegate): boolean {
  return delegateKey(a) === delegateKey(b);
}

/** The conversation's list as it stands, or the defaults when it was never set. */
export function currentDelegates(state: Readonly<Record<string, unknown>>, defaults: DelegateDefaults): DelegateList {
  const parsed = delegateSessionStateSchema.partial().safeParse(state);
  const stored = parsed.success ? parsed.data : {};
  if (stored[DELEGATES_STATE] === null || stored[DELEGATES_STATE] === undefined) {
    return {
      delegates: [...defaults.delegates.map((worker) => ({ worker })), ...(defaults.records ?? []).map((record) => ({ ...record }))],
      fallback: defaults.fallback === undefined ? null : { worker: defaults.fallback }
    };
  }
  return { delegates: stored[DELEGATES_STATE], fallback: stored[FALLBACK_STATE] ?? null };
}

/** A change to a conversation's delegates. */
export type DelegateChange =
  | { readonly add: DelegateRecord }
  | { readonly remove: DeliveryDelegate }
  | { readonly fallback: DeliveryDelegate | null };

/** What a change came to: the list after it, or why it was refused. */
export type DelegateChangeOutcome = { ok: true; list: DelegateList } | { ok: false; message: string };

/**
 * Apply one change to a list. Pure: the refusals that depend on the list
 * (already there, the cap, not on the list) are decided here, on whatever list
 * the write is retried against.
 */
export function applyDelegateChange(list: DelegateList, change: DelegateChange): DelegateChangeOutcome {
  if ("add" in change) {
    if (list.delegates.some((record) => sameDelegate(record, change.add))) {
      return { ok: false, message: `"${delegateLabel(change.add)}" is already a delegate in this conversation.` };
    }
    if (list.delegates.length >= MAX_DELEGATES) {
      return {
        ok: false,
        message: `This conversation already has ${MAX_DELEGATES} delegates, the most it can hold. Remove one first.`
      };
    }
    return { ok: true, list: { ...list, delegates: [...list.delegates, { ...change.add }] } };
  }
  if ("remove" in change) {
    if (!list.delegates.some((record) => sameDelegate(record, change.remove))) {
      return { ok: false, message: `"${delegateLabel(change.remove)}" isn't a delegate in this conversation.` };
    }
    const fallback = list.fallback !== null && sameDelegate(list.fallback, change.remove) ? null : list.fallback;
    return {
      ok: true,
      list: { delegates: list.delegates.filter((record) => !sameDelegate(record, change.remove)), fallback }
    };
  }
  if (change.fallback === null) return { ok: true, list: { ...list, fallback: null } };
  const named = change.fallback;
  const record = list.delegates.find((candidate) => sameDelegate(candidate, named));
  if (record === undefined) {
    return {
      ok: false,
      message: `"${delegateLabel(named)}" isn't a delegate in this conversation, so it can't be the fallback.`
    };
  }
  return {
    ok: true,
    list: {
      ...list,
      fallback: { worker: record.worker, ...(record.target === undefined ? {} : { target: record.target }) }
    }
  };
}

/** The session-state patch that writes a list. */
function listPatch(list: DelegateList): Partial<z.infer<typeof delegateSessionStateSchema>> {
  return { [DELEGATES_STATE]: list.delegates, [FALLBACK_STATE]: list.fallback };
}

type StateWriter = Pick<BlockContext["session"], "atomicState">;

/**
 * Change a conversation's delegates, as one versioned write that recomputes
 * on retry. A refused change writes nothing.
 *
 * @param session The conversation's session handle.
 * @param defaults The coordinator's defaults, copied in when the list was never set.
 * @param change The change.
 */
export async function changeDelegates(
  session: StateWriter,
  defaults: DelegateDefaults,
  change: DelegateChange
): Promise<DelegateChangeOutcome> {
  const outcome = await withOutcome(
    (mutator: (state: Readonly<Record<string, unknown>>) => Record<string, unknown>) =>
      session.atomicState(mutator as never),
    (state: Readonly<Record<string, unknown>>) => {
      const result = applyDelegateChange(currentDelegates(state, defaults), change);
      return { state: result.ok ? listPatch(result.list) : {}, result };
    }
  );
  if (outcome === undefined) throw new Error("The change to this conversation's delegates was not written.");
  return outcome;
}

/**
 * The conversation's delegates, copying the defaults in if they were never
 * set: reading them is the first use, as changing them is.
 */
export async function readDelegates(session: StateWriter, defaults: DelegateDefaults): Promise<DelegateList> {
  const outcome = await withOutcome(
    (mutator: (state: Readonly<Record<string, unknown>>) => Record<string, unknown>) =>
      session.atomicState(mutator as never),
    (state: Readonly<Record<string, unknown>>) => {
      const list = currentDelegates(state, defaults);
      const seeded = state[DELEGATES_STATE] !== null && state[DELEGATES_STATE] !== undefined;
      return { state: seeded ? {} : listPatch(list), result: list };
    }
  );
  if (outcome === undefined) throw new Error("This conversation's delegates could not be read.");
  return outcome;
}
