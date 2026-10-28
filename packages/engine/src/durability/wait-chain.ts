/**
 * The engine's half of a wait (FIX-2082): the depth a chain of waits reaches,
 * the host's deadline bounds, and the resume a waited-on request's parent is
 * owed when that request ends.
 *
 * ## The depth
 *
 * A request may wait on work whose own request waits, and so on: a chain of
 * parked waits. One count bounds it (`MAX_WAIT_DEPTH`), read live from the
 * wait gates parked now, from both ends:
 *
 * - **Above** the running request: the gate parked on its own work (a row it
 *   works, or the request itself for a dispatched child), then the gate parked
 *   on that waiter's own work, and so on up.
 * - **Below** the work a new wait would wait on: a gate whose waiting request
 *   works that row (or is that request), then what that gate waits on, and so
 *   on down, the deepest branch.
 *
 * Nothing is copied when a request starts: a chain built below a task nobody
 * waits on, then waited on late, counts the same as one built top down. One
 * fact is carried, and only one hop: a request a `dispatcher({ wait: true })`
 * started is stamped with its sender and the row the sender works, since its
 * sender parks on it only after the dispatch returns, and the child may count
 * before that park is written. The walk goes on from the sender's row, live. Rows
 * are matched by ledger and task id: a task id is unique only within its
 * ledger. A row whose ledger isn't known (`board: ""`) matches by task id: a
 * dispatch names its board, not the ledger, and a board's id can differ from
 * its ledger's.
 *
 * ## The parent's resume
 *
 * A `dispatcher({ wait: true })` parks its request on a gate bound to the
 * request it dispatched. When that request ends, the engine finds the gate in
 * the sender's session and resumes it with the request's result. A child that
 * ended before its parent parked is caught as the parent parks.
 *
 * A gate may also wait on a request of its own session that nobody dispatched:
 * a message queued behind a request stopped for a person (FIX-2239). That
 * request ends only by a run that resumed it (the person answered, stopped it,
 * or let it expire), so the run of a resumed request looks in its own session
 * too. A request that never parked costs nothing more.
 */
import {
  isUserSuspension,
  isWaitGate,
  taskDispatchInputSchema,
  waitGateDataOf,
  type RequestWaits,
  type SuspensionRecord,
  type WaitDeadlines,
  type WaitGateBinding,
  type WaitOutcome,
  type WaitRow
} from "@flow-state-dev/core/types";
import type { ActiveRequestEntry, RequestRecord, StoreRegistry } from "../stores/types";
import { isFresh } from "../context/liveness-read";
import type { DurabilityProvider } from "./types";
import { resumeWaitGate, type WaitResumeDeps } from "./resume-wait-gate";
import { drivenAgain } from "./stop-suspended";
import { readDispatchStamp } from "../execution/dispatch-metadata";
import { TASK_SOURCE } from "../execution/transport-sources";

/** A wait that names no deadline waits this long: five minutes. */
const DEFAULT_WAIT_DEADLINE_MS = 5 * 60_000;

/**
 * The shortest deadline a wait may name: the durability sweep's resolution
 * (its shortest tick). A shorter one can't come due sooner, and would only
 * spin park and resume.
 */
const MIN_WAIT_DEADLINE_MS = 1_000;

/** The longest deadline a wait may name: 24 hours. */
const MAX_WAIT_DEADLINE_MS = 86_400_000;

/** A host's wait deadline settings, each optional. */
export type WaitDeadlineSettings = {
  readonly defaultMs?: number;
  readonly minMs?: number;
  readonly maxMs?: number;
};

/** The bounds a host holds waits to, its settings over the defaults. */
function resolveWaitDeadlines(settings: WaitDeadlineSettings = {}): WaitDeadlines {
  const minMs = settings.minMs ?? MIN_WAIT_DEADLINE_MS;
  const maxMs = settings.maxMs ?? MAX_WAIT_DEADLINE_MS;
  const defaultMs = settings.defaultMs ?? DEFAULT_WAIT_DEADLINE_MS;
  // Finite first: an infinite bound passes the ordering, and an infinite
  // deadline is a wake that never comes due.
  const finite = [minMs, maxMs, defaultMs].every((ms) => Number.isFinite(ms));
  if (!finite || !(minMs > 0) || !(maxMs >= minMs) || !(defaultMs >= minMs && defaultMs <= maxMs)) {
    throw new Error(
      `[flow-state] wait deadlines must be finite and satisfy 0 < min <= default <= max; got min ${minMs}, ` +
        `default ${defaultMs}, max ${maxMs}.`
    );
  }
  return { defaultMs, minMs, maxMs };
}

/**
 * Install the waits' construction input on a host's request-host inputs: the
 * provider the depth is read from and the deadline bounds. Only where the host
 * keeps wakes, since a wait's deadline is a wake (D1): a host with none offers
 * no wait. Call after the wakes are installed.
 */
export function installWaits(
  requestHost: { wakes?: unknown; waits?: { provider: DurabilityProvider; deadlines: WaitDeadlines } },
  provider: DurabilityProvider | undefined,
  settings: WaitDeadlineSettings | undefined
): void {
  if (requestHost.waits !== undefined || provider === undefined || requestHost.wakes === undefined) return;
  requestHost.waits = { provider, deadlines: resolveWaitDeadlines(settings) };
}

/**
 * The row a request works, as the engine can tell it: a request a task
 * dispatch started (its trusted source is `task`) carries the claim envelope
 * the board minted as its input. `undefined` for any other request; a caller
 * that knows more (a later request working the same task) says so itself.
 *
 * Its ledger is left unknown (`board: ""`): the envelope names the board,
 * whose id can differ from the ledger's that a wait names, so the walk
 * matches this row by task id.
 */
export function ownRowOf(source: string | undefined, metadata: unknown, input: unknown): WaitRow | undefined {
  if (source !== TASK_SOURCE || readDispatchStamp(source, metadata) === undefined) return undefined;
  const parsed = taskDispatchInputSchema.safeParse(input);
  return parsed.success ? { board: "", taskId: parsed.data.taskId } : undefined;
}

/**
 * Whether two rows are the same: the same task id on the same ledger, or the
 * same task id where either ledger is unknown (`""`).
 */
function sameRow(a: { readonly board: string; readonly taskId: string }, b: { readonly board: string; readonly taskId: string }): boolean {
  return a.taskId === b.taskId && (a.board === "" || b.board === "" || a.board === b.board);
}

/** The request that dispatched a request and waits on it, and the row it works. */
export type WaiterOf = { readonly requestId: string; readonly own?: WaitRow };

/**
 * The sender that waits on a request it dispatched (`dispatcher({ wait: true })`),
 * read off the request's trusted dispatch stamp, where the seam wrote it from
 * the sender's own facts. `undefined` for any other request.
 */
export function waitedByOf(source: string | undefined, metadata: unknown): WaiterOf | undefined {
  if (readDispatchStamp(source, metadata) === undefined) return undefined;
  const waitedBy = (metadata as { dispatch?: { waitedBy?: unknown } }).dispatch?.waitedBy as
    | { requestId?: unknown; own?: { board?: unknown; taskId?: unknown } }
    | undefined;
  if (waitedBy == null || typeof waitedBy.requestId !== "string") return undefined;
  const own = waitedBy.own;
  return typeof own?.board === "string" && typeof own.taskId === "string"
    ? { requestId: waitedBy.requestId, own: { board: own.board, taskId: own.taskId } }
    : { requestId: waitedBy.requestId };
}

/** One parked wait, as the depth count reads it. */
type ParkedWait = {
  readonly requestId: string;
  readonly binding: WaitGateBinding;
  readonly own: WaitRow | undefined;
};

/** The deepest a walk goes before it stops counting: past this the answer is "too deep" whatever it is. */
const WALK_LIMIT = 64;

/**
 * Count the chain a new wait would join (see the module header): the parked
 * waits above the running request, the new wait, and the parked waits below
 * the work it waits on. `binding` omitted is new work with nothing below it
 * yet (a request about to be dispatched).
 */
export async function waitChainDepth(
  provider: Pick<DurabilityProvider, "listSuspended">,
  userId: string,
  running: { readonly requestId: string; readonly own: WaitRow | undefined },
  binding: WaitGateBinding | undefined,
  waitedBy?: WaiterOf
): Promise<number> {
  // One user's parked waits: a chain stays within one user's work.
  const parked: ParkedWait[] = [];
  for (const record of await provider.listSuspended({ userId, status: "pending" })) {
    if (!isWaitGate(record)) continue;
    const data = waitGateDataOf(record);
    if (data === undefined) continue;
    parked.push({ requestId: record.requestId, binding: data.binding, own: data.own });
  }
  const waitsOn = (wait: ParkedWait, work: { own?: WaitRow; requestId?: string }): boolean =>
    "taskId" in wait.binding
      ? work.own !== undefined && sameRow(wait.binding, work.own)
      : work.requestId !== undefined && wait.binding.requestId === work.requestId;

  // Above: whoever waits on this request's work, then on theirs.
  let above = 0;
  const seen = new Set<string>([running.requestId]);
  for (let at: { requestId: string; own: WaitRow | undefined } = running; above < WALK_LIMIT; ) {
    const parkedWaiter = parked.find((wait) => waitsOn(wait, { requestId: at.requestId, ...(at.own ? { own: at.own } : {}) }));
    // The sender of a waited dispatch waits on it from the start, parked yet or not.
    const waiter =
      parkedWaiter ?? (at === running && waitedBy !== undefined ? { requestId: waitedBy.requestId, own: waitedBy.own } : undefined);
    if (waiter === undefined || seen.has(waiter.requestId)) break;
    seen.add(waiter.requestId);
    above += 1;
    at = waiter;
  }

  // Below: the deepest chain of waits under the work.
  const below = (work: WaitGateBinding, depth: number, path: ReadonlySet<string>): number => {
    if (depth >= WALK_LIMIT) return depth;
    let deepest = 0;
    for (const wait of parked) {
      const works = "taskId" in work ? wait.own !== undefined && sameRow(wait.own, work) : wait.requestId === work.requestId;
      if (!works || path.has(wait.requestId)) continue;
      deepest = Math.max(deepest, 1 + below(wait.binding, depth + 1, new Set([...path, wait.requestId])));
    }
    return deepest;
  };

  return above + 1 + (binding === undefined ? 0 : below(binding, 0, seen));
}

/** Build the running request's `RequestHost.waits`. */
export function createRequestWaits(inputs: {
  readonly provider: Pick<DurabilityProvider, "listSuspended" | "loadSuspension">;
  readonly deadlines: WaitDeadlines;
  readonly userId: string;
  readonly requestId: string;
  /** The row this request works, as the engine reads it off its own dispatch. */
  readonly own: WaitRow | undefined;
  /** The sender that waits on this request, when a waited dispatch started it. */
  readonly waitedBy?: WaiterOf;
  /** The running request's session: `ended` answers only for requests in it. */
  readonly sessionId: string;
  /** A request's record, with its item log, from the request store. */
  readonly readRequest: (requestId: string) => Promise<Pick<RequestRecord, "id" | "status" | "sessionId" | "items"> | undefined>;
  /**
   * How `running` tells a request whose process died from one still running
   * (FIX-2166): its registry entry's heartbeat, read against the host's stale
   * threshold, the one past which the stale-request sweep marks it
   * interrupted. Absent where heartbeats can't say (they are off, or beat
   * slower than half the threshold): there `running` reads the record alone.
   *
   * The threshold is per process, as the sweep's is: each process reads with
   * its own `staleSweepThresholdMs` and the heartbeat interval of the flow
   * version it runs, and its sweep trusts the same values. A process
   * configured tighter than the one running the request, or a deploy that
   * slows the heartbeat, can read a live request as stopped, exactly as its
   * sweep would reap it.
   *
   * The read stays on with sweeping off (`staleSweepIntervalMs: 0`), on
   * purpose: nothing then marks a dead request interrupted, so this read is
   * the only thing that frees a notice held for it.
   */
  readonly heartbeat?: {
    readonly readEntry: (requestId: string) => Promise<Pick<ActiveRequestEntry, "lastHeartbeatAt" | "queuedAt"> | undefined>;
    readonly staleThresholdMs: number;
    readonly now: () => number;
  };
}): RequestWaits {
  // An `in_progress` record whose heartbeat stopped past the stale threshold
  // is a request whose process died before the sweep marked it interrupted
  // (FIX-2166). No entry reads as the record says: a request with no
  // registration is no proof that its process is gone, nor is an entry with
  // no heartbeat recorded (a custom registry's), nor a registry that can't be
  // read: each fails safe, to the record's answer.
  const stillBeating = async (requestId: string): Promise<boolean> => {
    const heartbeat = inputs.heartbeat;
    if (heartbeat === undefined) return true;
    let entry: Pick<ActiveRequestEntry, "lastHeartbeatAt" | "queuedAt"> | undefined;
    try {
      entry = await heartbeat.readEntry(requestId);
    } catch {
      return true;
    }
    if (entry === undefined || entry.lastHeartbeatAt == null) return true;
    return isFresh(entry, heartbeat.now(), heartbeat.staleThresholdMs);
  };
  return {
    deadlines: inputs.deadlines,
    depth: ({ binding, own }) =>
      waitChainDepth(inputs.provider, inputs.userId, { requestId: inputs.requestId, own: own ?? inputs.own }, binding, inputs.waitedBy),
    ended: async (requestIds) => {
      const endedOne = async (requestId: string): Promise<boolean> => {
        const record = await inputs.readRequest(requestId);
        if (record === undefined) return true;
        // A request of another session is never answered as ended: not this session's to release.
        if (record.sessionId !== inputs.sessionId) return false;
        return WORK_OVER.has(record.status) || (record.status === "interrupted" && !(await drivenAgain(inputs.provider, record)));
      };
      const answers: Record<string, boolean> = {};
      for (const requestId of new Set(requestIds)) {
        try {
          answers[requestId] = await endedOne(requestId);
        } catch {
          // A record or gate that can't be read answers for itself only: not ended, for now.
          answers[requestId] = false;
        }
      }
      return answers;
    },
    userStop: async () => {
      const pending = await inputs.provider.listSuspended({ userId: inputs.userId, sessionId: inputs.sessionId, status: "pending" });
      const stop = pending.find((gate) => isUserSuspension(gate) && gate.requestId !== inputs.requestId);
      return stop === undefined ? undefined : { requestId: stop.requestId };
    },
    running: async (requestIds) => {
      const answers: Record<string, boolean> = {};
      for (const requestId of new Set(requestIds)) {
        try {
          const record = await inputs.readRequest(requestId);
          answers[requestId] =
            record !== undefined &&
            record.sessionId === inputs.sessionId &&
            RUNNING.has(record.status) &&
            (await stillBeating(requestId));
        } catch {
          // A record that can't be read answers for itself only: not running, so nothing waits on it.
          answers[requestId] = false;
        }
      }
      return answers;
    }
  };
}

/** Request statuses of a request running its own work: started, and neither parked nor ended. */
const RUNNING: ReadonlySet<RequestRecord["status"]> = new Set(["in_progress"]);

/** Request statuses after which a request runs no more of its own work. */
const WORK_OVER: ReadonlySet<RequestRecord["status"]> = new Set(["completed", "incomplete", "failed", "aborted"]);

/** Request statuses after which a request does no more work. */
const ENDED: ReadonlySet<RequestRecord["status"]> = new Set(["completed", "incomplete", "failed", "aborted"]);

/** How a waited-on request's ending resumes the request waiting on it. */
export function outcomeOfRequest(record: Pick<RequestRecord, "status" | "result">): WaitOutcome | undefined {
  if (!ENDED.has(record.status)) return undefined;
  if (record.status === "completed") return { answered: true, answer: record.result?.output };
  if (record.status === "aborted") {
    return { answered: false, error: { code: "wait_task_cancelled", message: "The request was stopped." } };
  }
  return {
    answered: false,
    error: {
      code: "wait_task_failed",
      message: record.result?.error?.message ?? `The request ended ${record.status}.`
    }
  };
}

/**
 * Resume what waits on `child` now that it has ended: the gates parked on it
 * (`{ requestId }`) in the session that dispatched it. A no-op for a request
 * nobody dispatched, one that has not ended, or one nothing waits on. A gate
 * whose request is not parked yet is caught as it parks
 * ({@link resumeIfChildEnded}), and one whose resume is refused `busy` by the
 * deadline sweep, which looks again.
 */
export async function resumeRequestWaiters(
  deps: WaitResumeDeps & { stores: Pick<StoreRegistry, "request"> },
  child: Pick<RequestRecord, "id" | "status" | "result" | "source" | "metadata" | "userId" | "sessionId">,
  options: { readonly ownSession?: boolean } = {}
): Promise<void> {
  const outcome = outcomeOfRequest(child);
  if (outcome === undefined) return;
  const sessions = new Set<string>();
  const stamp = readDispatchStamp(child.source, child.metadata);
  if (stamp !== undefined) sessions.add(stamp.from.sessionId);
  if (options.ownSession === true && child.sessionId != null) sessions.add(child.sessionId);
  for (const sessionId of sessions) {
    const gates = await deps.provider.listSuspended({ userId: child.userId, sessionId, status: "pending" });
    for (const gate of gates) {
      if (!isWaitGate(gate)) continue;
      const data = waitGateDataOf(gate);
      if (data === undefined || !("requestId" in data.binding) || data.binding.requestId !== child.id) continue;
      await resumeWaitGate(deps, gate, outcome, `request:${child.id}`);
    }
  }
}

/**
 * As a request parks on a gate bound to another request: if that request has
 * already ended, resume the gate now. Its own ending found no gate to resume.
 */
export async function resumeIfChildEnded(
  deps: WaitResumeDeps & { stores: Pick<StoreRegistry, "request"> },
  gate: SuspensionRecord
): Promise<void> {
  if (!isWaitGate(gate)) return;
  const data = waitGateDataOf(gate);
  if (data === undefined || !("requestId" in data.binding)) return;
  const child = await deps.stores.request.get(data.binding.requestId);
  const outcome = child === undefined ? undefined : outcomeOfRequest(child);
  if (outcome === undefined) return;
  await resumeWaitGate(deps, gate, outcome, `request:${data.binding.requestId}`);
}
