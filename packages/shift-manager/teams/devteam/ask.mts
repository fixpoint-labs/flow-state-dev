/**
 * Raising the EM worker's ask — the one step a host calls to put an approval in
 * front of a user, before anyone has done anything.
 *
 * Its own module because two kinds of host call it:
 * `openLab` (the goal checks) and a host that builds its own flow state rather
 * than opening through the lab, such as an `fsdev` config Shift Manager serves. The
 * host keeps one option and one call; the rule for when to ask lives here.
 *
 * What it does, and nothing else: in the EM worker's own session (`s_<worker id>`,
 * the one `file` and `drain` run in, and which a session listing returns),
 * opened naming the EM worker if it isn't there yet ({@link openWorkerSession}),
 * run the asking door as the given user until it suspends on a stock
 * `user_approval`. The answer is not this module's business: it arrives
 * through the engine's resume route, the one Shift Manager's Inbox uses.
 *
 * **Once per feature, per store, claimed atomically.** Before it runs anything
 * the step writes a claim for the feature with the resource-state store's
 * create-if-absent write, naming the request id it is about to start. Two hosts
 * raising at once over one store both try that write, and exactly one wins; the
 * other raises nothing. A later call reads the claim and the request it names:
 *
 * - pending (`suspended`), being acted on (`in_progress`) or answered
 *   (`completed`, which an ask only reaches through Approve or Deny) — nothing
 *   is raised. A denied feature stays denied until the store is fresh: asking
 *   again on every restart would put back in a user's Inbox an ask they
 *   already declined. The Deny is read off the request, not recorded twice.
 * - `failed`, `interrupted`, `aborted` or `incomplete` — no user ever decided
 *   it, so the claim is taken over (a compare-and-set on its version, so two
 *   hosts cannot both take it) and a fresh ask is raised.
 *
 * A row another door already filed also means nothing is raised.
 *
 * **Known limit.** A claim whose request was never recorded reads as "in
 * flight" and raises nothing. That is the window between the claim and the
 * request's first write; a failure there that this step sees releases the
 * claim, but a process killed inside it leaves the feature claimed until the
 * store is fresh.
 *
 * **It throws rather than reporting.** A host that asked for the ask and got
 * none would show an empty Inbox, which the closure could not tell from a shell
 * that failed to read one. Every refusal, including a store that rejects a
 * read, names this step.
 */

import { ensureSessionRecord, resolveUserStorageKey, runAction, type FlowState } from "@flow-state-dev/engine";
import { WORKER_ID_STATE_KEY } from "@flow-state-dev/workforce/browser";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { ASK_ENTRY } from "./worker-config.mts";

/** The step's name, as every refusal spells it. */
export const RAISE_ASK_STEP = "raiseAsk";

/**
 * Where a feature's claim lives in the user's resource state. Outside the
 * board's prefix, so enumerating the board's rows never sees it.
 */
export const ASK_CLAIM_PREFIX = "devforce-lab-asks/";

/**
 * Request statuses that mean a user has the ask, or has answered it. Any
 * other status means nobody decided, and a fresh ask may take the claim over.
 */
const HELD_STATUSES: ReadonlySet<string> = new Set(["suspended", "in_progress", "completed"]);

/** The feature a user is asked to approve. */
export interface AskFeature {
  /** The feature's identity: the issue slug its row names. */
  issue: string;
  /** What the feature is, in one line. */
  goal: string;
  /** The project its coding run works in, by its address. Absent, a fixed repository's. */
  project?: { visibility: "shared" | "private"; id: string };
}

export interface RaiseAskOptions {
  /** The flow state the workers are registered in. Must have durable execution on. */
  state: FlowState;
  /** The EM worker flow's registered copy. */
  emFlow: FlowInstance;
  /** The EM worker, whose own session the ask is raised in. */
  emWorker: string;
  /** What to ask about. */
  feature: AskFeature;
  /** The user the ask runs as, and whose Inbox lists it. */
  principal: { userId: string; orgId: string };
  /**
   * Read the row filed for a feature, by its issue, off the board of the EM's
   * own session, so "the row already exists" is read where the row would be.
   */
  filed: (issue: string) => Promise<unknown>;
}

/** What the step did. */
export type RaiseAskResult =
  | { raised: true; requestId: string; sessionId: string }
  | { raised: false; reason: string; sessionId: string };

/**
 * The session a worker's own actions run in — one per worker, stable across runs.
 *
 * Top-level, not a dispatch run: nothing has to post first for it to exist.
 */
export function workerSessionId(workerId: string): string {
  return `s_${workerId.replace(/\./g, "_")}`;
}

/**
 * Open a worker's own session ({@link workerSessionId}) on `flow`, naming its
 * worker, unless it is there already. Through the engine's one session-birth
 * path, so the flow's create check judges the worker it names.
 *
 * @returns The session id.
 * @throws When the flow's create check refuses the worker.
 */
export async function openWorkerSession(
  stores: Parameters<typeof ensureSessionRecord>[0],
  options: { flow: FlowInstance; workerId: string; principal: { userId: string; orgId: string } },
): Promise<string> {
  const { flow, workerId, principal } = options;
  const sessionId = workerSessionId(workerId);
  const now = Date.now();
  await ensureSessionRecord(
    stores,
    sessionId,
    {
      flow: flow as never,
      sessionId,
      principal,
      state: { [WORKER_ID_STATE_KEY]: workerId },
      fromCaller: true,
      via: "create",
    },
    () => ({
      id: sessionId,
      flowKind: flow.kind,
      flowId: flow.id,
      userId: principal.userId,
      orgId: principal.orgId,
      version: 0,
      createdAt: now,
      updatedAt: now,
      journal: [],
    }),
  );
  return sessionId;
}

/** One wording for whatever an error turns out to be. */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

/**
 * Raise the ask once, in the EM worker's own session, and return once it is
 * pending.
 *
 * @param options The flow state, the EM worker, the feature and the user.
 * @returns `raised: true` with the request id, or `raised: false` naming the
 *   claim, request or row that made another ask wrong.
 * @throws If durable execution is off, the worker has no asking door, a store
 *   refuses, or the request ended in anything but a pending suspension. Every
 *   message starts with {@link RAISE_ASK_STEP}.
 */
export async function raiseAsk(options: RaiseAskOptions): Promise<RaiseAskResult> {
  const { state, emFlow, emWorker, feature, principal } = options;
  const sessionId = workerSessionId(emWorker);
  const refuse = (why: string): never => {
    throw new Error(`${RAISE_ASK_STEP}: the ask for "${feature.issue}" was not raised — ${why}`);
  };
  /** Run one store call, turning its rejection into a refusal that names this step. */
  const guarded = async <T,>(what: string, call: () => Promise<T>): Promise<T> => {
    try {
      return await call();
    } catch (error) {
      return refuse(`${what} failed: ${messageOf(error)}`);
    }
  };
  const skip = (reason: string): RaiseAskResult => ({ raised: false, sessionId, reason });

  const runtime = await guarded("opening the runtime", () => state.getRuntime());
  if (runtime.runtimeConfig.durabilityProvider === undefined) {
    refuse("the flow state has no durable execution, so there is nothing for the answer to resume");
  }
  if ((emFlow as { actions?: Record<string, unknown> }).actions?.[ASK_ENTRY] === undefined) {
    refuse(`flow "${emFlow.id}" has no "${ASK_ENTRY}" action`);
  }
  const { stores } = runtime;

  // The principal's cell in their org, where every flow keeps their user data.
  const userCell = resolveUserStorageKey(principal.userId, principal.orgId, { id: emFlow.id, isolateUserState: false });
  const row = await guarded("reading the board", () => options.filed(feature.issue));
  if (row !== undefined) return skip(`"${feature.issue}" is already on the board`);

  // ---- the claim: create-if-absent, or take over an undecided one ---------
  const claimKey = `${ASK_CLAIM_PREFIX}${feature.issue}`;
  const requestId = `req_ask_${globalThis.crypto.randomUUID()}`;
  const existing = await guarded("reading the claim", () =>
    stores.resourceState.get("user", userCell, claimKey),
  );
  let expected: number = 0;
  if (existing !== undefined) {
    const heldBy = String((existing.state as { requestId?: unknown }).requestId);
    const earlier = await guarded("reading the earlier ask", () => stores.request.get(heldBy));
    if (earlier === undefined) return skip(`request ${heldBy} holds the claim and is still starting`);
    if (HELD_STATUSES.has(earlier.status)) {
      return skip(`request ${heldBy} already asked about "${feature.issue}" (${earlier.status})`);
    }
    // Nobody decided it: take the claim over, on its version.
    expected = existing.version;
  }
  const claimed = await guarded("claiming the feature", () =>
    stores.resourceState.set(
      "user",
      userCell,
      claimKey,
      { requestId, issue: feature.issue, claimedAt: Date.now() },
      expected,
    ),
  );
  if (!claimed.ok) {
    const winner = (claimed.conflict.currentValue as { requestId?: unknown } | undefined)?.requestId;
    return skip(`another raise claimed "${feature.issue}" first (request ${String(winner)})`);
  }

  /** Give the claim back, so a failure this step saw does not hold the feature. */
  const release = async (): Promise<void> => {
    try {
      await stores.resourceState.delete("user", userCell, claimKey, claimed.version);
    } catch {
      // The refusal below is the failure worth reporting.
    }
  };

  let result: { requestId?: string; error?: unknown };
  try {
    await openWorkerSession(stores, { flow: emFlow, workerId: emWorker, principal });
    // `runAction`, the entry the action route dispatches into, rather than the
    // route itself: the route answers 202 before the run reaches its gate, and
    // this step's promise is that the ask is pending when it returns.
    result = (await runAction({
      flow: emFlow,
      actionName: ASK_ENTRY,
      input: {
        issue: feature.issue,
        goal: feature.goal,
        ...(feature.project === undefined ? {} : { project: feature.project }),
      },
      userId: principal.userId,
      orgId: principal.orgId,
      sessionId,
      requestId,
      stores,
      runtimeConfig: { ...runtime.runtimeConfig },
    } as never)) as { requestId?: string; error?: unknown };
  } catch (error) {
    await release();
    return refuse(messageOf(error));
  }
  if (result.error !== undefined) {
    // Released like a throw: the request this failure left, if any, may never
    // be read back, and a claim naming a missing request holds the feature.
    await release();
    return refuse(messageOf(result.error));
  }

  // Graded on what the store recorded rather than on what came back: a
  // pending ask is a fact about the request a user's Inbox reads.
  const request = await guarded("reading the new ask", () => stores.request.get(requestId));
  if (request === undefined) {
    await release();
    return refuse("no request was recorded in the worker's session");
  }
  if (request.status !== "suspended") {
    return refuse(`the request ended "${request.status}" instead of waiting on a user`);
  }
  return { raised: true, requestId, sessionId };
}
