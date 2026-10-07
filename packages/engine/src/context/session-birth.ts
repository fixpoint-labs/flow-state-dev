/**
 * The one function every new session record goes through.
 *
 * Five paths write a session that did not exist: the create route, an action
 * sent to an unused session id, a webhook delivery, `fsdev run`, and a dispatch
 * into a key-derived child. Each used to make the same three decisions on its
 * own: reclaim the previous incarnation's resource-state tombstones, write
 * create-if-absent, and, once a flow could declare `session.createCheck` and
 * `session.serverOwned`, check the create. A check wired per call site is open
 * at the next path someone adds, so it lives here, and the callers keep only
 * what genuinely differs between them: the record they build, and what a lost
 * race means (the route answers 409, the action path adopts the winner, the
 * dispatch path adopts a winner that matches its child).
 *
 * The decisions it carries, and why they are carried once:
 *
 * - **Minting** (FIX-1068). A session's `lineageId` is the address its
 *   `sharedToLineage` resources store under. A creator that omits it leaves the
 *   session on a value derived from its own key, so a deleted id recreated
 *   lands on the same address. The birth mints one unless the caller derives it.
 * - **Racing.** `get`-then-`set` is not create-if-absent: two callers both find
 *   nothing and the loser overwrites the winner. The write is `"absent"`.
 * - **Reclaiming** (FIX-1258). A record coming into existence starts a new
 *   resource-state incarnation, and the previous one's tombstones go with it
 *   ({@link purgeStaleResourceState}).
 * - **Checking.** The session's initial state, parsed through the flow's
 *   `stateSchema` (on a flow that binds its sessions, a state the schema
 *   refuses is refused; see {@link parseInitialSessionState}), the
 *   `serverOwned` refusal for state a caller seeded, and the flow's
 *   `createCheck` on what the schema parsed.
 *
 * The check runs on a miss only. A session that already exists is returned
 * without calling it, so a turn on an existing session costs no check, and a
 * loser of a create race adopts the winner without its own input being checked
 * again: the winner was checked when it was born.
 *
 */
import type {
  FlowInstance,
  JsonObject,
  SessionCreatePath,
  SessionCreatePrincipal
} from "@flow-state-dev/core/types";
import { matchesPattern, resolveCollectionKey } from "@flow-state-dev/core/types";
import type { SessionRecord, StoreRegistry } from "../stores/types";
import { generateId } from "../utils/generate-id";
import { findResourceConfig, isCollectionConfig, isProjectedResourceCollection } from "../resources/internal";
import { ownerKeyAdmits } from "../resources/owner-private";
import {
  resolveResourceIsolation,
  resolveResourceScopeId,
  toIsolationFlow
} from "../stores/scope-keys";
import { toBareState } from "../stores/resource-state-views";
import { deepEqual, getReadonlyStateKeys } from "@flow-state-dev/core/helpers";

/**
 * Release a newborn session from the resource-state tombstones a previous
 * session under the same id left behind.
 *
 * Session ids are caller-supplied, so `chat-42` or a document id can be
 * deleted and used again — an ordinary pattern, not an exotic one. The two
 * stores treat that differently on purpose. `SessionStore.delete` is a hard
 * delete with no tombstone, so the id is genuinely free. `ResourceStateStore`
 * tombstones instead, and a tombstone refuses a write from a context that
 * never saw the key live. That refusal is exactly what keeps a delete deleted
 * while the session is gone — and exactly what would make every **static**
 * resource of the next session under that id permanently unwritable, since a
 * static `ResourceRef` has no create-if-absent verb to escape through, unlike
 * a collection instance.
 *
 * So a tombstone belongs to the incarnation that made it, and this is the
 * moment it stops applying: not when the old session died, but when a new one
 * was born in its place. That is why the reclamation runs at birth and not in the
 * delete route — while the session is merely gone, the tombstones are still
 * doing their job.
 *
 * ## Run this BEFORE the create, never after
 *
 * There is no transaction across the two stores, so one of them commits first
 * and the other can fail behind it. That makes the order the whole design, and
 * only one order has a recoverable failure:
 *
 *  - **Create, then reclaim** leaves a committed session record above intact
 *    tombstones when the reclamation fails or the process dies between the two.
 *    Nothing downstream retries it — a second create returns 409 before
 *    reaching here, and an action-driven create adopts the record and skips it
 *    — so that session's static resources are bricked for its whole life. The
 *    fix would reproduce the exact bug it exists to close, permanently.
 *  - **Reclaim, then create** commits nothing until the reclamation has
 *    succeeded. A failure at either step leaves no record, so the caller's
 *    retry starts clean, and reclaiming twice is a no-op.
 *
 * ## KNOWN LIMIT: the reclamation is unfenced against a concurrent creator
 *
 * Reclaiming first means a caller that then LOSES the create has reclaimed
 * under a session it does not own, and **that can resurrect a deleted
 * resource**:
 *
 *  1. Two creators both read the session id and both find nothing.
 *  2. The winner creates it; its session runs and deletes resource `R`,
 *     leaving a tombstone.
 *  3. The delayed loser reaches the reclamation and removes the winner's
 *     tombstone.
 *  4. The loser then loses the session CAS and goes away.
 *  5. The next ordinary `patchState` on `R` holds no version, so it writes at
 *     `"absent"`; no row exists any more, so **the write lands and `R` is
 *     back**.
 *
 * State it plainly: step 5 is not a straggler or any other rare actor. Every
 * fresh request legitimately holds no version, so the exposure is the deleted
 * resource returning on the next normal write — the very failure this change
 * exists to close, reached through a different door.
 *
 * The birth's existence check is a narrowing, not a fence: it keeps a create
 * against a session that plainly already exists from reclaiming at all, so
 * only a genuine create race can reach step 3. It cannot close the race,
 * because there is no transaction across the two stores. Closing it needs a
 * **scope generation**, which is tracked and specced as FIX-1000 ("A create
 * racing session deletion lands in a purged, caller-reusable scope — fence the
 * scope generation") and deliberately not attempted here. Reach for that, not
 * for a second primitive: `lineageId` is a lineage address (FIX-1068) and
 * answers a different question.
 *
 * The one thing the narrowing to tombstones does buy: a losing reclaimer can
 * touch no live row, so it can destroy no data. What it can do is remove a
 * refusal.
 *
 * (An earlier revision of this ran after the create, on the reasoning that a
 * loser must not touch the winner's scope. That reasoning was written when this
 * removed every row in the scope, live ones included, where a loser really
 * could destroy the winner's data. Narrowing it to tombstones retired the
 * objection, and the ordering it justified with it.)
 *
 * Two residuals stay open, both far narrower than the permanent brick this
 * replaces and neither closable without a scope generation:
 *
 *  - A reclaimed key's version restarts at 1, so a straggler from the old
 *    incarnation holding version N can match a row in the new one.
 *    `purgeTombstones` in `stores/types.ts` carries this.
 *  - A reclamation that succeeds while the create then fails leaves the dead
 *    incarnation's keys with no tombstone and no session, so a straggler can
 *    write orphan rows under an id nothing owns. That is a leak rather than a
 *    revival, and the same one `deleteAll` already documents for a create of a
 *    never-existed key.
 */
export async function purgeStaleResourceState(
  stores: Pick<StoreRegistry, "resourceState">,
  storageKey: string
): Promise<void> {
  await stores.resourceState.purgeTombstones("session", storageKey);
}

/** The flow fields a birth reads. */
export type BirthFlow = Pick<FlowInstance, "kind" | "id" | "session" | "resources"> & {
  isolateUserState?: boolean;
  isolateOrgState?: boolean;
};

/** The stores a session's birth touches. */
export type SessionBirthStores = Pick<StoreRegistry, "session" | "resourceState">;

/**
 * Thrown when a create is refused: the flow's create check said no, the
 * initial state failed the flow's `stateSchema`, or a caller seeded a
 * server-owned state field. Nothing was written. `status` is the HTTP status
 * the create route answers with; `field` names the state field when one was
 * the reason.
 */
export class SessionCreateRefusedError extends Error {
  readonly code = "session-create-refused";

  constructor(
    readonly sessionId: string,
    readonly status: 400 | 403 | 404,
    message: string,
    readonly field?: string
  ) {
    super(message);
    this.name = "SessionCreateRefusedError";
  }
}

/** What a create is checked against, and from. */
export type SessionCreateRequest = {
  flow: BirthFlow;
  /** The bare session id being created. */
  sessionId: string;
  principal: SessionCreatePrincipal;
  /**
   * The state the session starts with, before the flow's `stateSchema` parses
   * it. Absent is `{}`.
   */
  state?: Record<string, unknown>;
  /**
   * Whether `state` came from a caller (the create route's `state`, `fsdev
   * run --seed-session`, an action's seed) rather than from flow code (a
   * dispatcher's child state). A caller's state may not set a `serverOwned`
   * field.
   */
  fromCaller: boolean;
  via: SessionCreatePath;
};

/**
 * Refuse a caller-seeded state field the flow declares server-owned.
 *
 * @throws SessionCreateRefusedError naming the first such field.
 */
export function refuseServerOwnedState(
  flow: Pick<BirthFlow, "kind" | "session">,
  sessionId: string,
  callerState: Record<string, unknown> | undefined
): void {
  const owned = flow.session?.serverOwned;
  if (owned === undefined || callerState === undefined) return;
  for (const field of owned) {
    if (Object.prototype.hasOwnProperty.call(callerState, field)) {
      throw new SessionCreateRefusedError(
        sessionId,
        400,
        `Session state field "${field}" is written only by flow "${flow.kind}"; a caller cannot set it.`,
        field
      );
    }
  }
}

/**
 * Whether a flow binds its sessions: it declares a top-level `.readonly()`
 * session-state field or a `session.createCheck`. A bound session is defined
 * by what it starts with, so its starting state must fit the schema.
 */
function bindsSessions(flow: Pick<BirthFlow, "session">): boolean {
  return (
    flow.session?.createCheck !== undefined ||
    getReadonlyStateKeys(flow.session?.stateSchema).length > 0
  );
}

/**
 * A new session's initial state: `state` parsed through the flow's session
 * `stateSchema`, so every declared key starts with its default and a block
 * never reads `undefined` for one.
 *
 * A state the schema refuses is refused on a flow that binds its sessions
 * ({@link bindsSessions}). Any other flow keeps it as sent, and its actions
 * validate it when they run: some create sessions half-filled on purpose and
 * complete them later (the workforce mailbox reads the missing fields as
 * "not yet opened").
 *
 * @throws SessionCreateRefusedError (400, naming the first failing field) when
 *   a bound flow's schema refuses the state.
 */
export function parseInitialSessionState(
  flow: Pick<BirthFlow, "kind" | "session">,
  sessionId: string,
  state: Record<string, unknown> | undefined
): JsonObject {
  const raw = (state ?? {}) as JsonObject;
  const schema = flow.session?.stateSchema;
  if (schema === undefined) return raw;
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data as JsonObject;
  if (!bindsSessions(flow)) return raw;
  const [issue] = parsed.error.issues;
  const field = issue?.path[0];
  throw new SessionCreateRefusedError(
    sessionId,
    400,
    `The initial state of a session of flow "${flow.kind}" doesn't fit its stateSchema` +
      (issue === undefined ? "." : ` at "${issue.path.join(".")}": ${issue.message}`),
    typeof field === "string" ? field : undefined
  );
}

/**
 * Check a create against the flow's declarations, before anything is written.
 * Resolves the session's initial state as the flow's schema parsed it.
 *
 * @throws SessionCreateRefusedError when the create is refused.
 */
export async function checkSessionCreate(
  stores: Pick<StoreRegistry, "resourceState">,
  request: SessionCreateRequest
): Promise<JsonObject> {
  const { flow, sessionId, principal, via } = request;
  if (request.fromCaller) refuseServerOwnedState(flow, sessionId, request.state);
  const state = parseInitialSessionState(flow, sessionId, request.state);

  const check = flow.session?.createCheck;
  if (check === undefined) return state;

  const verdict = await check({
    principal,
    sessionId,
    flow: { kind: flow.kind, id: flow.id },
    state,
    via,
    readCollectionItem: (ref, topic) => readCollectionItemAt(stores, flow, principal, ref, topic)
  });
  if (!verdict.ok) {
    throw new SessionCreateRefusedError(sessionId, verdict.status ?? 400, verdict.message);
  }
  return state;
}

/**
 * Read one item of a user- or org-scoped collection the flow declares, at the
 * creating principal's own cell. The create check's only read: bound to the
 * principal so the check cannot name another user's scope.
 */
async function readCollectionItemAt(
  stores: Pick<StoreRegistry, "resourceState">,
  flow: BirthFlow,
  principal: SessionCreatePrincipal,
  ref: string,
  topic: string | Record<string, string>
): Promise<Record<string, unknown> | undefined> {
  const found = findResourceConfig(flow, ref);
  if (
    found === undefined ||
    !isCollectionConfig(found.config) ||
    isProjectedResourceCollection(found.config) ||
    found.scope === "session"
  ) {
    throw new Error(
      `readCollectionItem: "${ref}" is not a user- or org-scoped collection of flow "${flow.kind}".`
    );
  }
  const { config, scope } = found;
  const storageKey = resolveCollectionKey(config.pattern, topic);
  if (!matchesPattern(config.pattern, storageKey)) return undefined;
  if (!ownerKeyAdmits(config, storageKey, principal.userId)) return undefined;
  const isolationFlow = toIsolationFlow(flow);
  const isolated = resolveResourceIsolation(
    (config as { flowIsolation?: boolean }).flowIsolation,
    isolationFlow,
    scope
  );
  const scopeId = resolveResourceScopeId(
    { userId: principal.userId, orgId: principal.orgId },
    isolationFlow,
    scope,
    isolated
  );
  return toBareState(await stores.resourceState.get(scope, scopeId, storageKey)) as
    | JsonObject
    | undefined;
}

/**
 * A session record as a birth's caller builds it: everything but its state,
 * which the birth parses and checks from the request, and the lineage id,
 * which is minted unless the caller derives it.
 */
export type SessionRecordSeed = Omit<SessionRecord, "lineageId" | "state"> & {
  /** Supplied by a caller that derives the lineage (a cross-flow child); minted otherwise. */
  lineageId?: string;
};

/** What a birth came to. */
export type SessionBirthOutcome =
  /** This call created the record. */
  | { readonly born: true; readonly record: SessionRecord }
  /**
   * The record already existed (`raced: false`), or another creator wrote it
   * between this call's read and its write (`raced: true`). `record` is the
   * stored record; `undefined` when the id is tombstoned or the record was
   * deleted mid-create, which the store contract says to treat as deleted.
   */
  | { readonly born: false; readonly raced: boolean; readonly record: SessionRecord | undefined };

/**
 * Bring a session record into existence, or return the one already there.
 *
 * In order: the existing record, if any, is returned unchecked; the create is
 * checked (`checkSessionCreate`); the previous incarnation's tombstones are
 * reclaimed (`purgeStaleResourceState`, which must run before the write); the
 * record is written create-if-absent with the checked state and a lineage id.
 *
 * @throws SessionCreateRefusedError when the create is refused. Nothing is
 *   written.
 */
export async function birthSession(
  stores: SessionBirthStores,
  storageKey: string,
  request: SessionCreateRequest,
  build: () => SessionRecordSeed
): Promise<SessionBirthOutcome> {
  // Often a repeat of a miss the caller just observed (admission and the
  // execution context each read the record first). Kept: it is what keeps an
  // existing session off the check and off the tombstone reclamation.
  const existing = await stores.session.get(storageKey);
  if (existing !== undefined) return { born: false, raced: false, record: existing };

  const state = await checkSessionCreate(stores, request);

  // Before the create, so nothing is committed until it has succeeded. See
  // `purgeStaleResourceState` for why this order and no other.
  await purgeStaleResourceState(stores, storageKey);

  const seed = build();
  const record: SessionRecord = {
    ...seed,
    state,
    lineageId: seed.lineageId ?? generateId("lin")
  };
  const created = await stores.session.set(storageKey, record, "absent");
  if (created.ok) return { born: true, record };
  return { born: false, raced: true, record: created.conflict.currentValue };
}

/**
 * Return the session record at `storageKey`, creating it through
 * {@link birthSession} if absent. The action, webhook and `fsdev run` paths'
 * caller: a lost create race adopts the winner.
 *
 * The returned record is **authoritative**: on a lost create race it is the
 * winner's, not the one this caller built. Callers that go on to read
 * `lineageId` (or anything else) must use what comes back rather than what they
 * passed in, or they are back to two answers for one question.
 *
 * @throws SessionCreateRefusedError when the create is refused.
 * @throws when the key is tombstoned — the store contract requires a caller to
 * treat that as deleted and stop, never as "reuse my copy".
 */
export async function ensureSessionRecord(
  stores: SessionBirthStores,
  storageKey: string,
  request: SessionCreateRequest,
  build: () => SessionRecordSeed
): Promise<SessionRecord> {
  const outcome = await birthSession(stores, storageKey, request, build);
  if (outcome.record !== undefined) return outcome.record;
  const winner = await stores.session.get(storageKey);
  if (winner === undefined) {
    throw new Error(
      `Session "${storageKey}" was deleted while this request was creating it`
    );
  }
  return winner;
}

/**
 * Thrown when a write would change a session's readonly state field: a
 * top-level `.readonly()` field of the flow's session `stateSchema`, set when
 * the session was created. Nothing is written.
 */
export class ReadonlySessionStateError extends Error {
  readonly code = "readonly-session-state";

  constructor(
    readonly flowKind: string,
    readonly sessionId: string,
    readonly field: string
  ) {
    super(
      `Session "${sessionId}" of flow "${flowKind}" can't change state field "${field}": it is ` +
        `readonly, set when the session was created. Start a new session for another value.`
    );
    this.name = "ReadonlySessionStateError";
  }
}

/**
 * Refuse a proposed session state that changes a readonly field from what the
 * session was created with.
 *
 * @throws ReadonlySessionStateError naming the first field that changed.
 */
export function refuseReadonlyStateChange(
  flowKind: string,
  sessionId: string,
  readonlyFields: readonly string[],
  createdWith: Readonly<Record<string, unknown>>,
  next: Readonly<Record<string, unknown>>
): void {
  for (const field of readonlyFields) {
    const had = Object.hasOwn(createdWith, field);
    const has = Object.hasOwn(next, field);
    if (had !== has || (has && !deepEqual(createdWith[field], next[field]))) {
      throw new ReadonlySessionStateError(flowKind, sessionId, field);
    }
  }
}
