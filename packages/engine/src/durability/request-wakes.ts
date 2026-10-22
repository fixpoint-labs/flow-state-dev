/**
 * The request host's wake verb (FIX-2078 D1): how a running request owes, reads
 * and settles a debt's due time.
 *
 * A wake names a session, an internal entry, a due time and the owner the
 * sweeper fires it as. Everything but the entry and the due time is
 * server-written here: for the request's own session, from its identity; for
 * another session (a task session owing its filer), from that session's stored
 * record, once it is checked to be this principal's, in this tenant and org.
 * The caller supplies the target, never the authority (`RequestHost`).
 *
 * The fence: a wake carries the time its guarded write must have landed by,
 * this request's lease (the stale threshold, past which the request counts as
 * dead and its recovery reruns it). A settle that would clear the wake before
 * then moves it there instead, so a writer that stalls between its wake and
 * its write can't lose the wake to a pass.
 *
 * Owing a wake in this process tells the sweeper listening on the same store
 * ({@link onWakeOwed}), so it comes forward rather than wait for its interval.
 */
import type { RequestWakes, WakeSettleResult, WakeView } from "@flow-state-dev/core/types";
import { logRuntimeEvent, type RuntimeLogger } from "../execution/logging";
import { resolveSessionStorageKey } from "../stores/scope-keys";
import type { SessionStore, WakeRecord, WakeStore } from "../stores/types";
import { INTERNAL_SOURCE } from "../execution/transport-sources";
import type { InboundTransportHost } from "../transports/types";

type Listener = (dueAt: number) => void;

const listeners = new WeakMap<WakeStore, Set<Listener>>();

/** Listen for wakes owed on `store` in this process. Returns the unsubscribe. */
export function onWakeOwed(store: WakeStore, listener: Listener): () => void {
  let set = listeners.get(store);
  if (set === undefined) {
    set = new Set();
    listeners.set(store, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
  };
}

function noteWakeOwed(store: WakeStore, dueAt: number): void {
  for (const listener of listeners.get(store) ?? []) listener(dueAt);
}

/**
 * Fire a wake through a host (the durability sweeper's `fireWake`): dispatch
 * the internal entry it names, in its session, as its owner, the way the
 * dispatch seam starts a dispatched request. Resolves once the host accepted
 * it; rejects when the host refused or failed to. `onStarted` receives the
 * run's completion and a way to abort it, so a host that closes its stores can
 * wait for it, for a while.
 */
export async function fireWakeThrough(
  host: Pick<InboundTransportHost, "dispatch">,
  wake: WakeRecord,
  onStarted?: (run: { finished: Promise<unknown>; abort(): void }) => void
): Promise<void> {
  const controller = new AbortController();
  const handle = host.dispatch({
    source: INTERNAL_SOURCE,
    flowKind: wake.flowKind,
    action: wake.entry,
    input: {},
    sessionId: wake.sessionId,
    principal: { userId: wake.userId, orgId: wake.orgId },
    orgId: wake.orgId,
    ...(wake.tenantId !== undefined ? { tenantId: wake.tenantId } : {}),
    metadata: { wake: { entry: wake.entry, dueAt: wake.dueAt } },
    responseEmitter: null,
    signal: controller.signal
  });
  onStarted?.({ finished: handle.finished, abort: () => controller.abort() });
  if (handle.accepted !== undefined) await handle.accepted;
}

/** The default most a debt may stay outstanding past its due time: 24 hours. */
const DEFAULT_MAX_DEBT_AGE_MS = 86_400_000;

/** Process-wide, so a host built many times (tests, a worker beside a router) says it once. */
let warnedNoWakes = false;

/**
 * Install the wake verb's construction input on a host's request-host inputs,
 * checked once as the host starts: a host with durable execution whose stores
 * keep wakes offers `RequestHost.wakes`. Any other host logs once that it pays
 * debts on their fast paths only, and offers none.
 */
export function installWakes(
  requestHost: { wakes?: { readonly maxDebtAgeMs: number } },
  host: {
    readonly stores: { readonly wakes?: WakeStore };
    readonly durable: boolean;
    readonly maxDebtAgeMs?: number;
    readonly logger: RuntimeLogger;
  }
): void {
  if (requestHost.wakes !== undefined) return;
  if (host.durable && host.stores.wakes !== undefined) {
    requestHost.wakes = { maxDebtAgeMs: host.maxDebtAgeMs ?? DEFAULT_MAX_DEBT_AGE_MS };
    return;
  }
  if (warnedNoWakes) return;
  warnedNoWakes = true;
  logRuntimeEvent(host.logger, "info", "[flow-state] this host keeps no wakes: debts are paid on their fast paths only", {
    reason: host.durable ? "the store registry has no `wakes` store" : "no durable execution"
  });
}

/** Process-wide, like {@link warnedNoWakes}: an unreadable wake store is said once. */
let warnedUnreadable = false;

/**
 * Read the wake store once as the host starts, and withdraw the verb when it
 * can't: a database upgraded without the schema migration that adds wakes
 * (a host that runs its migrations itself) has the store and no table. Logged
 * once; debts are then paid on their fast paths only, as on a host that keeps
 * none, and the sweeper's wake step stays off.
 */
export async function probeWakes(
  requestHost: { wakes?: { readonly maxDebtAgeMs: number } },
  stores: { readonly wakes?: WakeStore },
  logger: RuntimeLogger
): Promise<void> {
  if (requestHost.wakes === undefined || stores.wakes === undefined) return;
  try {
    await stores.wakes.earliestDueAt();
  } catch (error) {
    requestHost.wakes = undefined;
    if (warnedUnreadable) return;
    warnedUnreadable = true;
    logRuntimeEvent(
      logger,
      "warn",
      "[flow-state] this host's wake store can't be read, so it keeps no wakes: debts are paid on their fast paths only. Rerun your store's schema migration (or let it initialize its schema) after upgrading",
      { error: (error as Error).message }
    );
  }
}

/** What {@link createRequestWakes} is built from. */
export type RequestWakesInputs = {
  store: WakeStore;
  sessions: Pick<SessionStore, "get">;
  /** The running request's server-derived identity. */
  identity: { userId: string; tenantId: string | undefined; orgId: string; sessionId: string };
  /** The running flow instance's id: the address the request's own session's wakes fire on. */
  flowId: string;
  /** How long a write this request owes may take to land: its lease. */
  fenceMs: number;
  maxDebtAgeMs: number;
  now?: () => number;
};

/** Build the wake verb for one request. */
export function createRequestWakes(inputs: RequestWakesInputs): RequestWakes {
  const { store, sessions, identity } = inputs;
  const now = inputs.now ?? Date.now;
  const tenant = identity.tenantId !== undefined && identity.tenantId.length > 0 ? identity.tenantId : undefined;
  const keyOf = (sessionId: string, entry: string) => ({
    ...(tenant !== undefined ? { tenantId: tenant } : {}),
    sessionId,
    entry
  });

  /** The flow `sessionId` runs on, when it is a session this request may reach. */
  const flowOf = async (sessionId: string): Promise<string | undefined> => {
    if (sessionId === identity.sessionId) return inputs.flowId;
    const record = await sessions.get(resolveSessionStorageKey(sessionId, tenant));
    if (
      record === undefined ||
      record.userId !== identity.userId ||
      (record.tenantId ?? undefined) !== tenant ||
      (record.orgId ?? undefined) !== identity.orgId
    ) {
      return undefined;
    }
    return record.flowId ?? record.flowKind;
  };

  return {
    maxDebtAgeMs: inputs.maxDebtAgeMs,

    async owe(spec) {
      const sessionId = spec.sessionId ?? identity.sessionId;
      const flowKind = await flowOf(sessionId);
      if (flowKind === undefined) return false;
      const record = await store.owe({
        ...keyOf(sessionId, spec.entry),
        flowKind,
        userId: identity.userId,
        orgId: identity.orgId,
        dueAt: spec.dueAt,
        landBy: now() + inputs.fenceMs
      });
      // The due time the wake keeps after coalescing, not the one asked for.
      noteWakeOwed(store, record.dueAt);
      return true;
    },

    async read(entry): Promise<WakeView | undefined> {
      const wake = await store.get(keyOf(identity.sessionId, entry));
      return wake === null ? undefined : { dueAt: wake.dueAt, landBy: wake.landBy, version: wake.version };
    },

    async settle(entry, read, next): Promise<WakeSettleResult> {
      const key = keyOf(identity.sessionId, entry);
      // Nothing owed, but a writer may still be landing what it owes: wait for it.
      const dueAt = next ?? (now() < read.landBy ? read.landBy : null);
      if (dueAt === null) return (await store.clear(key, read.version)) ? "cleared" : "stale";
      if (!(await store.move(key, read.version, dueAt))) return "stale";
      // A sweeper armed for later (the fire moved the wake on before this
      // pass ran) comes forward to the new due time.
      noteWakeOwed(store, dueAt);
      return "moved";
    }
  };
}
