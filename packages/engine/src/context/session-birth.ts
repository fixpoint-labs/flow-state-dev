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
 * The check runs on a miss only. A session that already exists is returned
 * without calling it, so a turn on an existing session costs no check, and a
 * loser of a create race adopts the winner without its own input being checked
 * again: the winner was checked when it was born.
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
import { purgeStaleResourceState } from "./ensure-session-record";
import { findResourceConfig, isCollectionConfig, isProjectedResourceCollection } from "../resources/internal";
import { ownerKeyAdmits } from "../resources/owner-private";
import {
  resolveResourceIsolation,
  resolveResourceScopeId,
  toIsolationFlow
} from "../stores/scope-keys";
import { toBareState } from "../stores/resource-state-views";

/** The flow fields a birth reads. */
export type BirthFlow = Pick<FlowInstance, "kind" | "id" | "session" | "resources"> & {
  isolateUserState?: boolean;
  isolateOrgState?: boolean;
};

/** The stores a session's birth touches. */
export type SessionBirthStores = Pick<StoreRegistry, "session" | "resourceState">;

/**
 * Thrown when a create is refused: the flow's create check said no, the create
 * named no link for a flow that requires one, or it seeded a server-owned
 * state field. Nothing was written. `status` is the HTTP status the create
 * route answers with; `field` names the state field when that was the reason.
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
  /** The create's link input. */
  link: string | undefined;
  /**
   * State the caller asked the session to start with (the create route's
   * `state`, `fsdev run --seed-session`). Only its keys are read, to refuse a
   * server-owned field.
   */
  callerState?: Record<string, unknown>;
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
 * Check a create against the flow's declarations, before anything is written.
 * Resolves the link to store, or `undefined` for a flow with no create check.
 *
 * @throws SessionCreateRefusedError when the create is refused.
 */
export async function checkSessionCreate(
  stores: Pick<StoreRegistry, "resourceState">,
  request: SessionCreateRequest
): Promise<string | undefined> {
  const { flow, sessionId, principal, link, via } = request;
  refuseServerOwnedState(flow, sessionId, request.callerState);

  const check = flow.session?.createCheck;
  if (check === undefined) return undefined;

  const verdict = await check({
    principal: Object.freeze({ ...principal }),
    sessionId,
    flow: Object.freeze({ kind: flow.kind, id: flow.id }),
    link,
    via,
    readCollectionItem: (ref, topic) => readCollectionItemAt(stores, flow, principal, ref, topic)
  });
  if (!verdict.ok) {
    throw new SessionCreateRefusedError(sessionId, verdict.status ?? 400, verdict.message);
  }
  // A create that named nothing has nothing to have been checked. Refused
  // here whatever the check answered, so a check that forgets the case cannot
  // admit a session with no link on a flow that links every session.
  if (link === undefined || link.length === 0) {
    throw new SessionCreateRefusedError(
      sessionId,
      400,
      `Creating a session of flow "${flow.kind}" requires a link.`
    );
  }
  if (typeof verdict.link !== "string" || verdict.link.length === 0) {
    throw new Error(
      `Flow "${flow.kind}" session.createCheck accepted a create without returning a non-empty link.`
    );
  }
  return verdict.link;
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
  topic: string
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
 * A session record as a birth's caller builds it: everything but the link,
 * which only the create check decides, and the lineage id, which is minted
 * unless the caller derives it.
 */
export type SessionRecordSeed = Omit<SessionRecord, "lineageId" | "link"> & {
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
 * record is written create-if-absent with the check's link and a lineage id.
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
  const existing = await stores.session.get(storageKey);
  if (existing !== undefined) return { born: false, raced: false, record: existing };

  const link = await checkSessionCreate(stores, request);

  // Before the create, so nothing is committed until it has succeeded. See
  // `purgeStaleResourceState` for why this order and no other.
  await purgeStaleResourceState(stores, storageKey);

  const seed = build();
  const record: SessionRecord = {
    ...seed,
    lineageId: seed.lineageId ?? generateId("lin"),
    ...(link !== undefined ? { link } : {})
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
