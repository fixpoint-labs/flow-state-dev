/**
 * The concurrency arbiter (FIX-837) — the one owner of concurrency policy,
 * layered over an ordered-lease backend. One instance is shared by every host
 * in a process, so a session-scoped concurrency policy is enforced once at the
 * shared seam rather than re-implemented per transport adapter.
 *
 * The arbiter decides; the backend only keeps the line (`lease-backend.ts`).
 * Policy — key resolution, `reject` / `queue` / `allow`, the wait budget,
 * naming the holder, `ConcurrencyRejectedError` — lives here and nowhere else,
 * whichever backend is underneath.
 *
 *   - `resolve` derives the effective policy + key for a dispatch (pure).
 *   - `admit` takes the dispatch's place before any request record or live
 *     stream is created: for `reject` it claims the key only if it is free and
 *     refuses with `ConcurrencyRejectedError` otherwise (so the dropped caller
 *     never materializes a run); for `queue` it joins the key's line; for
 *     `allow` it takes nothing. The admission then runs the kickoff in its turn
 *     and gives the place back when the run settles, or gives it back unrun.
 *     While it runs a place on a shared backend it renews it, so a run longer
 *     than the backend's lease keeps its place.
 *
 * Over the in-memory default backend all of this is synchronous where it was
 * before backends existed: a `reject` throws from `dispatch`, and a queued run
 * is woken when the run ahead of it settles. Over an adapter-supplied backend
 * (FIX-1634) admission is asynchronous — a `reject` refusal arrives through the
 * dispatch's `accepted` — and a queued run re-checks its turn on the schedule
 * `planQueueWait` sets. An unreachable backend refuses the dispatch; nothing
 * runs unarbitrated.
 *
 * Without a supplied backend the arbiter holds keys in this process only, so a
 * host whose dispatcher hands work to another process skips arbitration there
 * (`arbitratesAcrossProcesses` is false) and the dispatch operation keeps
 * refusing a delivery into an existing session by name.
 */

import type {
  ConcurrencyConfig,
  ConcurrencyKey,
  ConcurrencyKeyContext,
  ConcurrencyPolicyName
} from "@flow-state-dev/core";
import { resolveEntry } from "../../execution/resolve-entry";
import { DEFAULT_RUNTIME_LOGGER, logRuntimeEvent, type RuntimeLogger } from "../../execution/logging";
import { ConcurrencyRejectedError } from "../errors";
import type { DispatchEnvelope } from "../dispatcher";
import {
  QUEUE_WAIT_TIMEOUT_MS,
  createInMemoryLeaseBackend,
  inMemoryInternalsOf,
  planQueueWait,
  type ConcurrencyLeaseBackend,
  type LeasePlace,
  type LeaseTakeResult
} from "./lease-backend";

/** The one field the arbiter reads off an entry. */
type EntryPolicyView = { concurrency?: ConcurrencyConfig } | undefined;

/**
 * Minimal view of a flow the arbiter reads to resolve a policy: the typed
 * entry maps, narrowed to `concurrency`, plus the flow-level default. Every
 * dispatch type gets the same ladder — default → per-entry — because the entry
 * is found through the same keyed lookup a dispatch resolves its handler with.
 */
export interface ConcurrencyFlowView {
  actions: Record<string, EntryPolicyView>;
  internal?: { actions?: Record<string, EntryPolicyView> };
  task?: { actions?: Record<string, EntryPolicyView> };
  webhooks?: Record<string, { on?: Record<string, EntryPolicyView> } | undefined>;
  schedules?: { static?: Record<string, EntryPolicyView> };
  request?: { concurrency?: ConcurrencyConfig };
}

/** The effective policy + resolved key for a single dispatch. A `key` of
 *  `undefined` means no arbitration applies (the dispatch runs as `allow`). */
export interface ResolvedDecision {
  policy: ConcurrencyPolicyName;
  key: string | undefined;
}

/**
 * A dispatch's standing on its concurrency key, taken by `admit` before
 * anything is written.
 */
export interface ConcurrencyAdmission {
  /** The place this dispatch holds or waits in; `undefined` when nothing is arbitrated. */
  readonly place: LeasePlace | undefined;
  /**
   * Run `start` in this place's turn and give the place back when it settles.
   * A `queue` place waits for its turn first, bounded by the wait budget, and
   * fails `ConcurrencyQueueTimeoutError` past it. Call at most once.
   */
  run<T>(start: () => Promise<T>): Promise<T>;
  /**
   * Give the place back without running, for a dispatch that failed after
   * admission. Idempotent, and a no-op once `run` has settled.
   */
  release(): Promise<void>;
}

export interface ConcurrencyArbiter {
  /** Resolve the effective policy + key for a dispatch. Pure. */
  resolve(
    flow: ConcurrencyFlowView,
    actionName: string,
    envelope: DispatchEnvelope
  ): ResolvedDecision;
  /**
   * Take a dispatch's place on its key. Call at the top of `dispatch`, before
   * any record/stream is created:
   *   - `reject` → claim the key only if it is free; if another request holds
   *     it, refuse with `ConcurrencyRejectedError(key, inFlightRequestId)` (so
   *     no record is created for the dropped caller).
   *   - `queue` → join the key's line, in the order admissions are taken.
   *   - `allow` / no key → take nothing (today's timing).
   *
   * Synchronous over the in-memory default backend — a refusal is thrown here.
   * Over a supplied backend it returns a promise, which rejects with the
   * refusal or with the backend's own error when the backend is unreachable.
   * `allow` is synchronous over any backend.
   */
  admit(
    decision: ResolvedDecision,
    requestId: string
  ): ConcurrencyAdmission | Promise<ConcurrencyAdmission>;
  /**
   * Whether this arbiter's keys are shared with other processes: true when a
   * backend was supplied rather than defaulted. A host whose dispatcher runs
   * work in another process arbitrates it only when this is true.
   */
  readonly arbitratesAcrossProcesses: boolean;
}

/** Tenant-namespace a raw id so identical ids in different tenants never
 *  collide on the same key (mirrors FIX-682 store-key isolation). */
function namespaced(tenantId: string | undefined, id: string): string {
  return tenantId == null ? id : `${tenantId}:${id}`;
}

/** Normalize the string-or-object config into a `(policy, key)` pair. */
function normalizeConfig(
  config: ConcurrencyConfig | undefined
): { policy: ConcurrencyPolicyName; key: ConcurrencyKey } {
  if (config === undefined) return { policy: "allow", key: "session" };
  if (typeof config === "string") return { policy: config, key: "session" };
  return { policy: config.policy, key: config.key ?? "session" };
}

/** Resolve a key spec against a dispatch envelope. Returns `undefined` to mean
 *  "no arbitration" (the action runs as `allow`). */
function resolveKey(key: ConcurrencyKey, envelope: DispatchEnvelope): string | undefined {
  if (key === "none") return undefined;
  if (key === "session") {
    return envelope.sessionId === undefined
      ? undefined
      : namespaced(envelope.tenantId, envelope.sessionId);
  }
  if (key === "user") {
    return namespaced(envelope.tenantId, envelope.userId);
  }
  // Custom function: build the minimal serializable context.
  const ctx: ConcurrencyKeyContext = {
    flowKind: envelope.flowKind,
    actionName: envelope.actionName,
    sessionId: envelope.sessionId,
    userId: envelope.userId,
    tenantId: envelope.tenantId,
    orgId: envelope.orgId,
    source: envelope.source,
    metadata: envelope.metadata
  };
  return key(ctx);
}


/** Whether a value returned by `admit` is still pending. */
export function isPendingAdmission(
  admission: ConcurrencyAdmission | Promise<ConcurrencyAdmission>
): admission is Promise<ConcurrencyAdmission> {
  return typeof (admission as { then?: unknown }).then === "function";
}

/**
 * How often the arbiter renews a place it is running on a shared backend.
 * Matches the longest wait between a waiter's turn checks (and so its
 * renewals), so one lease length serves both; see
 * `ConcurrencyLeaseBackend.renew`.
 */
const HOLDER_RENEW_INTERVAL_MS = 2_000;

/** Nothing to hold: the run starts on the caller's own timing. */
const UNARBITRATED: ConcurrencyAdmission = {
  place: undefined,
  run: (start) => start(),
  release: async () => {}
};

/**
 * Run `start`, then give the place back however it settles — including a
 * synchronous throw from `start`, so a failed kickoff never strands the key.
 * When the give-back is asynchronous (a shared backend) the run settles only
 * once it lands, so a caller that sees the run end finds its key free. The
 * give-back never rejects; the run's own outcome is what settles.
 */
function runThenGiveBack<T>(
  start: () => Promise<T>,
  giveBack: () => Promise<void> | undefined
): Promise<T> {
  let p: Promise<T>;
  try {
    p = start();
  } catch (e) {
    const pending = giveBack();
    if (pending === undefined) throw e;
    return pending.then(() => {
      throw e;
    });
  }
  return p.then(
    (v) => {
      const pending = giveBack();
      return pending === undefined ? v : pending.then(() => v);
    },
    (e) => {
      const pending = giveBack();
      if (pending === undefined) throw e;
      return pending.then(() => {
        throw e;
      });
    }
  );
}

export interface CreateConcurrencyArbiterOptions {
  /**
   * The ordered-lease backend to keep lines in. Supplied by a queue adapter
   * whose runs land in several processes (`WorkerAdapter.leaseBackend`), so
   * every process lines up on the same keys. Default: a fresh in-memory
   * backend, private to this arbiter.
   */
  backend?: ConcurrencyLeaseBackend;
  /**
   * Where a failed give-back on a supplied backend is reported. The run's own
   * outcome still settles; the place lapses with the backend's lease. Default:
   * the runtime's console logger.
   */
  logger?: RuntimeLogger;
}

export function createConcurrencyArbiter(
  options: CreateConcurrencyArbiterOptions = {}
): ConcurrencyArbiter {
  const backend = options.backend ?? createInMemoryLeaseBackend();
  const inMemory = inMemoryInternalsOf(backend);
  const logger = options.logger ?? DEFAULT_RUNTIME_LOGGER;

  /**
   * Wait for a place's turn on a backend with no in-process wake: re-check on
   * the schedule `planQueueWait` sets, renewing the place on each tick so a
   * waiter's lease outlives its wait.
   */
  const pollForTurn = async (place: LeasePlace): Promise<void> => {
    const since = Date.now();
    for (let attempt = 0; ; attempt += 1) {
      if (await backend.isMyTurn(place)) return;
      const step = planQueueWait({ key: place.key, waitedMs: Date.now() - since, attempt });
      if (step.kind === "timeout") throw step.error;
      await backend.renew(place);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, step.delayMs);
        // Don't keep the event loop alive solely for a queued wait.
        (timer as { unref?: () => void }).unref?.();
      });
    }
  };

  /** Build the admission for a place, once taken. Shared by both backends. */
  const admissionFor = (policy: ConcurrencyPolicyName, place: LeasePlace): ConcurrencyAdmission => {
    let running = false;
    // Undefined until given back; then the give-back itself, which never
    // rejects, so `release()` and a settling run share one round trip.
    let givenBack: Promise<void> | undefined;
    /**
     * Give the place back. Synchronous in memory (returns `undefined`), so the
     * next waiter is woken before the run settles, as it always was. On a
     * supplied backend it is awaited; a failure is logged, not thrown: the
     * place lapses with the backend's lease, and the run's outcome is what the
     * caller needs.
     */
    const giveBack = (): Promise<void> | undefined => {
      if (inMemory !== undefined) {
        inMemory.giveBack(place);
        return undefined;
      }
      givenBack ??= backend.giveBack(place).catch((error: unknown) => {
        logRuntimeEvent(
          logger,
          "warn",
          "[flow-state] could not give a concurrency place back; it stays held until the lease backend expires it",
          {
            key: place.key,
            ticket: place.ticket,
            error: error instanceof Error ? error.message : String(error)
          }
        );
      });
      return givenBack;
    };

    // `reject` claimed a free key: it is this place's turn already. Every other
    // arbitrated policy waits in line as `queue` does.
    const waitForTurn =
      policy === "reject"
        ? undefined
        : inMemory !== undefined
          ? () => inMemory.waitForTurn(place, QUEUE_WAIT_TIMEOUT_MS)
          : () => pollForTurn(place);

    /**
     * Run in this place's turn. On a shared backend the place is renewed for
     * as long as the run holds it: a run started here (a web process's HTTP
     * run, say) is renewed by nobody else, and a place whose lease lapsed
     * mid-run would let another process's run start alongside it. In-memory
     * places never expire, so the default path starts no timer.
     */
    const holdAndRun = <T>(start: () => Promise<T>): Promise<T> => {
      if (inMemory !== undefined) return runThenGiveBack(start, giveBack);
      const renewal = setInterval(() => {
        backend.renew(place).catch(() => undefined);
      }, HOLDER_RENEW_INTERVAL_MS);
      // Don't keep the event loop alive solely to renew a lease.
      (renewal as { unref?: () => void }).unref?.();
      return runThenGiveBack(start, () => {
        clearInterval(renewal);
        return giveBack();
      });
    };

    return {
      place,
      run(start) {
        running = true;
        if (waitForTurn === undefined) return holdAndRun(start);
        return waitForTurn().then(
          () => holdAndRun(start),
          async (error: unknown) => {
            await giveBack();
            throw error;
          }
        );
      },
      async release() {
        if (!running) await giveBack();
      }
    };
  };

  /** Turn `take`'s answer into an admission, or the `reject` refusal. */
  const admitted = (
    policy: ConcurrencyPolicyName,
    key: string,
    result: LeaseTakeResult
  ): ConcurrencyAdmission => {
    if ("heldBy" in result) throw new ConcurrencyRejectedError(key, result.heldBy);
    return admissionFor(policy, result.place);
  };

  const admit: ConcurrencyArbiter["admit"] = (decision, requestId) => {
    const { policy, key } = decision;
    if (key === undefined || policy === "allow") return UNARBITRATED;
    const input = { key, requestId, ...(policy === "reject" ? { ifEmpty: true } : {}) };
    // In memory the take is synchronous, so two racing callers can't both win
    // and a refusal is thrown before `dispatch` returns.
    if (inMemory !== undefined) return admitted(policy, key, inMemory.take(input));
    return backend.take(input).then((result) => admitted(policy, key, result));
  };

  return {
    arbitratesAcrossProcesses: options.backend !== undefined,

    resolve(flow, actionName, view): ResolvedDecision {
      // Every dispatch resolves the entry's own policy through the same
      // keyed lookup the dispatch resolves its handler with: the trusted
      // `source` (set by the adapter or the dispatch seam, never the caller)
      // decides the type, and the type's own map is read — `flow.actions` by
      // name for a `public` dispatch, the adapter's namespaced coordinate for
      // webhook / schedule, the entry name for task / internal. A forged
      // `metadata.webhook` on an HTTP dispatch therefore still resolves the
      // named action's policy, and a task hand-off whose name collides with a
      // public action never inherits that action's `queue` / `reject` — each
      // reads only its own map.
      // A dynamic schedule has no static coordinate: its core is produced by
      // the resolver at dispatch time and carried on the envelope, so its
      // policy is read from there — the same core `runAction` will run.
      const carried = view.resolvedActionCore;
      const entryConfig =
        carried !== undefined
          ? carried.concurrency
          : resolveEntry(flow, actionName, view.source, view.metadata)?.concurrency;
      const effective = entryConfig ?? flow.request?.concurrency;
      const { policy, key } = normalizeConfig(effective);
      return { policy, key: resolveKey(key, view) };
    },

    admit
  };
}
