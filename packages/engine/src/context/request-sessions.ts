// FIX-2160 D2; FIX-2173.
/**
 * The request host's session reads: a running request checks a target session
 * before it writes anything to it, and reads what another of its
 * principal's sessions has said.
 *
 * The owner rule is the dispatch seam's own (`resolveExistingSession` in
 * `./create-request-host`): another user's or tenant's session, and one bound
 * to another org, are not this principal's. Here every one of them, and a
 * session that doesn't exist, answers `undefined`, so neither read is an
 * existence oracle. The flow is not checked: the caller asks which flow it runs.
 *
 * `read` crosses the flow, the lineage id and the state the session's flow
 * declares readonly (server-written markers, as the HTTP session list's state
 * filter keeps them), never the record. `history` crosses the session's
 * settled turns, by the one read a turn's own history window uses
 * (`./settled-turns`), and writes nothing. `list` lists the
 * principal's top-level sessions, filtered at the store by readonly fields
 * and bounded, or, asked for `ids`, read by id under the same filters; each
 * with the state the HTTP session list shows the caller, exposed and readonly
 * (`./client-visible-state`), which is display data: `read` and the filter
 * stay readonly-only, what a block may decide on. `turns` reads a session's
 * requests by status, never their words. `userSuspensions` reads the
 * principal's pending suspensions on named flows in one store query joined to their
 * requests, each row then passing the instance's own credential
 * check, and the session admission when it has a session.
 *
 * In a view, `admit` adds the HTTP session list's per-row admission on top of
 * the owner rule (`view-routes.ts`): a session it refuses reads as one that
 * doesn't exist, on every verb.
 */
import { getReadonlyStateKeys } from "@flow-state-dev/core/helpers";
import { readonlyStateFilter } from "./readonly-state-filter";
import { clientVisibleStateKeys } from "./client-visible-state";
import { resolveRecordOwner } from "./record-owner";
import { isWriteRecord } from "../resources/default-write-flow";
import { terminalAtMs } from "../stores/request-ended-at";
import { applyScopeStateDefaults, scopeStateSchema } from "./scope-state-defaults";
import type {
  FlowInstance,
  HistoryTurn,
  PendingUserSuspension,
  TokenCounter
} from "@flow-state-dev/core/types";
import type {
  RequestSessions,
  SessionHistory,
  SessionHistoryQuery,
  SessionList,
  SessionListQuery,
  ListedSession,
  SessionTurn,
  SessionTurnsQuery,
  PeerSessionView,
  UserSuspensionPage,
  UserSuspensionsQuery
} from "@flow-state-dev/core/internal";
import { FlowStateConfigError } from "../errors/flow-error";
import type { DurabilityProvider } from "../durability/types";
import {
  matchesParentageFilter,
  matchesStateFilter,
  resolveLineageId,
  resolveSessionStorageKey,
  toBareSessionId
} from "../stores/scope-keys";
import type { RequestRecord, RequestStore, SessionRecord, SessionStore, SuspensionStore } from "../stores/types";
import { LLM_AUDIENCE_TYPES, selectRequestsByLimit } from "./history";
import { sessionRequestScope } from "./session-request-scope";
import { parkedInterruptedIds } from "../durability/stop-suspended";
import { readSettledTurns } from "./settled-turns";
import { isPublicReentryAllowed } from "../routes/public-reentry";
import type { SessionReadObserver } from "./view-reads";

/** The most turns `history` reads from the store, whatever its limit asks. */
const SESSION_HISTORY_MAX_TURNS = 50;
const SESSION_HISTORY_DEFAULT_TURNS = 20;
/** The most sessions `list` answers, and `turns` reads at once. */
const SESSION_LIST_MAX = 100;
/** The most requests `turns` answers a session. */
const SESSION_TURNS_MAX = 50;
// FIX-2770 D2.
/** The most flow kinds `userSuspensions` reads. */
const USER_SUSPENSION_FLOW_KINDS_MAX = 50;
/** The most suspensions `userSuspensions` answers a page. */
const USER_SUSPENSION_PAGE = 200;

/**
 * A view's per-row admission on top of the owner rule: whether the caller may
 * be answered this session at all (`view-routes.ts`).
 */
export type SessionAdmission = (record: SessionRecord) => Promise<boolean>;

// FIX-2770.
/**
 * A view's credential check on one pending suspension, judged on its
 * request: the flow instance and session it runs under, and the principal's
 * user and organization, which the store matched exactly
 * (`ownResolverVerdict`, `view-routes.ts`).
 */
export type SuspensionAdmission = (entry: {
  flowKind: string;
  flowId?: string;
  sessionId?: string;
  userId: string;
  orgId: string;
}) => Promise<boolean>;

export type RequestSessionsInputs = {
  sessions: Pick<SessionStore, "get" | "list">;
  /** Where `turns` reads a session's requests. Without it, `turns` answers nothing. */
  requests?: Pick<RequestStore, "list">;
  /** A view's admission: every verb answers only a session it admits. */
  admit?: SessionAdmission;
  /** Where `userSuspensions` reads. Without it, `userSuspensions` throws. */
  suspensions?: Pick<SuspensionStore, "listPendingForUser">;
  /** A view's credential check on each pending suspension `userSuspensions` reads. */
  admitSuspension?: SuspensionAdmission;
  /** The engine's clock, for a suspension's expiry. Defaults to `Date.now`. */
  now?: () => number;
  /** A view's recording: told of each session a verb answers, and of each list. */
  observe?: SessionReadObserver;
  // FIX-2848 D3.
  /** The host's `publicReentrySources`: what `turns` reads each turn's `retryable` with, as the retry route does. */
  publicReentrySources?: readonly string[];
  /** Server-derived identity of the running request. */
  identity: { userId: string; tenantId: string | undefined; orgId: string };
  /** The running request's flow. */
  flow: FlowInstance;
  /** Another flow instance registered in this process, by its exact address. */
  resolveFlow?: (address: string) => FlowInstance | undefined;
  /** What `history` needs. Without it, `history` reads nothing (`undefined`). */
  history?: {
    requests: Pick<RequestStore, "list">;
    /** The running request: never read as a past turn of any session. */
    runningRequestId: string;
    /** Where parked gates are read. Without one, nothing is treated as parked. */
    durability?: Pick<DurabilityProvider, "listSuspended" | "loadSuspension">;
    /** Counts a `{ tokens }` limit, as the running request's own history does. */
    tokenCounter: () => TokenCounter;
    resolveModelId: () => string;
    /** Called when the parked gates of the read session could not be read. */
    onGateReadError: (error: unknown) => void;
  };
};

/**
 * Whether an interrupted turn older than the turns read is parked to run
 * again: the session still has an open turn, though the window doesn't hold
 * it. Read only when earlier turns fell out of the window; bounded like it.
 */
async function parkedBefore(
  reads: NonNullable<RequestSessionsInputs["history"]>,
  scope: ReturnType<typeof sessionRequestScope>,
  window: readonly { id: string }[]
): Promise<boolean> {
  if (reads.durability === undefined) return false;
  const inWindow = new Set(window.map((r) => r.id));
  const interrupted = (
    await reads.requests.list({ ...scope, status: ["interrupted"], limit: SESSION_HISTORY_MAX_TURNS, orderBy: "startedAtMs", withItems: true })
  ).filter((r) => !inWindow.has(r.id) && r.id !== reads.runningRequestId);
  try {
    return (await parkedInterruptedIds(reads.durability, interrupted)).size > 0;
  } catch (error) {
    reads.onGateReadError(error);
    return false;
  }
}

/**
 * The owner rule both reads share: the session record, when it is the
 * principal's (the same user, tenant and organization); otherwise `undefined`.
 */
function principalSession(
  record: SessionRecord | undefined,
  identity: RequestSessionsInputs["identity"]
): SessionRecord | undefined {
  if (
    record === undefined ||
    record.userId !== identity.userId ||
    (record.tenantId ?? undefined) !== identity.tenantId ||
    (record.orgId ?? undefined) !== identity.orgId
  ) {
    return undefined;
  }
  return record;
}

export function createRequestSessions(inputs: RequestSessionsInputs): RequestSessions {
  const { sessions, identity, flow } = inputs;
  const flowAt = (address: string): FlowInstance | undefined =>
    address === flow.id ? flow : inputs.resolveFlow?.(address);
  /** The owner rule, then a view's admission: the record, or `undefined` for a session neither lets through. */
  const admitted = async (record: SessionRecord | undefined): Promise<SessionRecord | undefined> => {
    const own = principalSession(record, identity);
    if (own === undefined || inputs.admit === undefined) return own;
    return (await inputs.admit(own)) ? own : undefined;
  };
  const owned = async (sessionId: string): Promise<SessionRecord | undefined> => {
    if (typeof sessionId !== "string" || sessionId.length === 0) return undefined;
    return admitted(await sessions.get(resolveSessionStorageKey(sessionId, identity.tenantId)));
  };
  /**
   * The sessions `ids` names, at most the first {@link SESSION_LIST_MAX}, that
   * the store's list would hold for this principal and `filter`: the
   * principal's, top-level, of the flow and readonly fields asked for, newest
   * first. Read by id, so a missing session is simply not among them; a
   * view's admission is the list's own step after.
   */
  const byIds = async (
    ids: readonly string[],
    filter: { flowKind: string | undefined; flowId: string | undefined; state: Readonly<Record<string, string>> | undefined }
  ): Promise<SessionRecord[]> => {
    const wanted = [...new Set(ids)].filter((id) => typeof id === "string" && id.length > 0).slice(0, SESSION_LIST_MAX);
    const records = await Promise.all(wanted.map((id) => sessions.get(resolveSessionStorageKey(id, identity.tenantId))));
    return records
      .filter((record): record is SessionRecord => principalSession(record, identity) !== undefined)
      .filter(
        (record) =>
          matchesParentageFilter(undefined, record.parentSessionId) &&
          (filter.flowKind === undefined || record.flowKind === filter.flowKind) &&
          (filter.flowId === undefined || record.flowId === filter.flowId) &&
          matchesStateFilter(filter.state, record.state)
      )
      .sort((a, b) => b.updatedAt - a.updatedAt);
  };
  /**
   * A verb that left a session it was asked for unanswered (one-session, or a
   * member of a `turns` batch) is heard as the caller's list is, on their own
   * user topic, so a session made later under the id wakes the view; never on
   * the id's own topic, which may be someone else's. A refusal and a missing
   * session alike.
   */
  const unanswered = (): undefined => {
    inputs.observe?.list();
    return undefined;
  };

  /**
   * A session's state cut to the fields its owning flow declares readonly
   * (`"readonly"`, what a block may decide on), or to those it shows a client,
   * exposed and readonly (`"visible"`, what the HTTP list shows); defaults filled.
   */
  const stateOf = (record: SessionRecord, cut: "readonly" | "visible"): Readonly<Record<string, unknown>> => {
    // The owner as the HTTP session routes resolve it (`resolveRecordOwner`,
    // as `toClientSession` does): the stored instance id, or, on a legacy row,
    // only the singleton named by its kind. A row it can't attribute (another
    // kind under the address, a collection member whose id is the kind) has
    // no owner here either, and shows no state, as the HTTP list shows none.
    // Only the verdict is read, never a refusal's reason, so the registry's
    // `list` (which names the reason) is not needed.
    const resolved = resolveRecordOwner({ get: flowAt, list: () => [] }, record);
    const owner = resolved.ok ? resolved.flow : undefined;
    const schema = owner === undefined ? undefined : scopeStateSchema(owner, "session");
    const keys = cut === "readonly" ? getReadonlyStateKeys(schema) : owner === undefined ? [] : clientVisibleStateKeys(owner);
    // As the session's own runs read it, defaults filled.
    const effective = applyScopeStateDefaults(schema, record.state);
    const state: Record<string, unknown> = {};
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(effective, key)) state[key] = structuredClone(effective[key]);
    }
    return Object.freeze(state);
  };

  /** `limit` cut to `0..max`, `max` when absent. */
  const bounded = (limit: number | undefined, max: number): number =>
    limit === undefined || !Number.isFinite(limit) ? max : Math.max(0, Math.min(max, Math.floor(limit)));

  const turnOf = (request: RequestRecord): SessionTurn => ({
    id: request.id,
    sessionId: request.sessionId!,
    action: request.actionName,
    status: request.status,
    source: request.source,
    startedAtMs: request.startedAtMs,
    ...(request.completedAtMs != null ? { completedAtMs: request.completedAtMs } : {}),
    ...(terminalAtMs(request) != null ? { endedAtMs: terminalAtMs(request) } : {}),
    updatedAt: request.updatedAt,
    ...(request.result?.error != null ? { error: { code: request.result.error.code, message: request.result.error.message } } : {}),
    ...(request.historyStart != null ? { historyStart: { requestId: request.historyStart.requestId } } : {}),
    // The retry route's own rule, with the same host sources (FIX-2848 D3).
    retryable: isPublicReentryAllowed(request.source, inputs.publicReentrySources)
  });

  async function turns(target: string, query?: SessionTurnsQuery): Promise<SessionTurn[] | undefined>;
  async function turns(target: readonly string[], query?: SessionTurnsQuery): Promise<SessionTurn[]>;
  async function turns(target: string | readonly string[], query?: SessionTurnsQuery): Promise<SessionTurn[] | undefined> {
    const one = typeof target === "string";
    const ids = one ? [target] : [...new Set(target)].slice(0, SESSION_LIST_MAX);
    const records = await Promise.all(ids.map((id) => owned(id)));
    const read = ids.flatMap((id, at) => (records[at] === undefined ? [] : [{ id, record: records[at]! }]));
    for (const entry of read) inputs.observe?.turns(entry.id);
    if (one && read.length === 0) return unanswered();
    // A batch member it doesn't answer is heard the same way, never on its own topic.
    if (read.length < ids.length) unanswered();
    if (read.length === 0 || inputs.requests === undefined) return [];
    const per = bounded(query?.limit, SESSION_TURNS_MAX);
    if (per === 0) return [];
    const statuses = query?.status;
    const requests = inputs.requests;
    // One read a session, each bounded to its own newest `per` and filtered at
    // the store by its own request scope (owner, tenant, organization, flow)
    // and status: a session with many newer requests never crowds another
    // out of a shared limit. At most 100 reads of at most 50 (BP-042). The
    // request stores keep no action column, so `actions` cuts each bounded read.
    const perSession = await Promise.all(
      read.map((entry) =>
        requests.list({
          ...sessionRequestScope(entry.id, entry.record, identity.tenantId),
          ...(statuses !== undefined ? { status: statuses } : {}),
          orderBy: "startedAtMs",
          limit: per
        })
      )
    );
    const actions = query?.actions === undefined ? undefined : new Set(query.actions);
    return perSession
      .flat()
      .filter((request) => actions === undefined || actions.has(request.actionName))
      .sort((a, b) => b.startedAtMs - a.startedAtMs)
      .map(turnOf);
  }

  /**
   * Whether a pending row read in scope is the caller's to see: the
   * instance's own credential check on its request, with or without a
   * session, then, with one, the session's owner rule and admission. It only
   * removes rows; the scope stays in the store's query.
   */
  const admitsSuspension = async (entry: PendingUserSuspension): Promise<boolean> => {
    if (
      inputs.admitSuspension !== undefined &&
      !(await inputs.admitSuspension({
        flowKind: entry.flowKind,
        ...(entry.flowId !== undefined ? { flowId: entry.flowId } : {}),
        ...(entry.sessionId !== undefined ? { sessionId: entry.sessionId } : {}),
        userId: identity.userId,
        orgId: identity.orgId
      }))
    ) {
      return false;
    }
    return entry.sessionId === undefined || (await owned(entry.sessionId)) !== undefined;
  };

  return {
    async userSuspensions(query: UserSuspensionsQuery): Promise<UserSuspensionPage> {
      const flowKinds = [...new Set(query.flowKinds)];
      if (flowKinds.length > USER_SUSPENSION_FLOW_KINDS_MAX) {
        throw new FlowStateConfigError(
          `sessions.userSuspensions reads at most ${USER_SUSPENSION_FLOW_KINDS_MAX} flow kinds; it was given ${flowKinds.length}. ` +
            "Name the flows the screen covers, never every flow."
        );
      }
      // Heard however few rows it answers: a suspension made later is a change to it.
      inputs.observe?.suspensions();
      if (flowKinds.length === 0) return { suspensions: [], more: false };
      if (inputs.suspensions === undefined) throw new FlowStateConfigError("sessions.userSuspensions has no suspension store to read");
      // The scope is the running request's, every key present (BP-031):
      // an unbound tenant or organization matches only unbound requests.
      const stored = await inputs.suspensions.listPendingForUser({
        userId: identity.userId,
        tenantId: identity.tenantId,
        orgId: identity.orgId,
        flowKinds,
        now: (inputs.now ?? Date.now)(),
        limit: USER_SUSPENSION_PAGE + 1,
        ...(query.after !== undefined
          ? { after: { createdAt: query.after.createdAt, requestId: query.after.requestId, suspensionId: query.after.suspensionId } }
          : {})
      });
      const page = stored.slice(0, USER_SUSPENSION_PAGE);
      const admitted = await Promise.all(page.map((entry) => admitsSuspension(entry)));
      const more = stored.length > USER_SUSPENSION_PAGE;
      // `next` is the last row the store returned, never the last one shown,
      // so paging neither stalls on dropped rows nor skips the rows after them.
      const last = page.at(-1);
      return {
        suspensions: page.filter((_, at) => admitted[at]),
        more,
        ...(more && last !== undefined ? { next: { createdAt: last.createdAt, requestId: last.requestId, suspensionId: last.suspensionId } } : {})
      };
    },

    async read(sessionId: string): Promise<PeerSessionView | undefined> {
      const record = await owned(sessionId);
      if (record === undefined) return unanswered();
      inputs.observe?.identity(sessionId);
      const state = stateOf(record, "readonly");
      const view = {
        flowKind: record.flowKind,
        ...(record.flowId != null ? { flowId: record.flowId } : {}),
        state,
        lineageId: resolveLineageId(record)
      };
      const observe = inputs.observe;
      if (observe === undefined) return view;
      // A read of the flow or lineage alone hears `state` too (its birth and
      // delete publish it), never `run`; reading the state records it here.
      return Object.defineProperty(view, "state", {
        enumerable: true,
        get: () => {
          observe.state(sessionId);
          return state;
        }
      });
    },

    async list(query?: SessionListQuery): Promise<SessionList> {
      // Heard however few rows it answers: a session made later is a change to it.
      inputs.observe?.list();
      const limit = bounded(query?.limit, SESSION_LIST_MAX);
      const offset = query?.offset === undefined || !Number.isFinite(query.offset) ? 0 : Math.max(0, Math.floor(query.offset));
      const fields = query?.fields ?? {};
      let state: Record<string, string> | undefined;
      if (Object.keys(fields).length > 0) {
        const address = query?.flowId ?? query?.flowKind;
        const filter = readonlyStateFilter(address === undefined ? undefined : flowAt(address), fields);
        if ("error" in filter) throw new Error(filter.error);
        state = filter.state;
      }
      // Top-level sessions (the store's default parentage) of this principal,
      // filtered at the store (BP-033); one row past the limit says `more`.
      const stored =
        query?.ids === undefined
          ? await sessions.list({
              ...(query?.flowKind !== undefined ? { flowKind: query.flowKind } : {}),
              ...(query?.flowId !== undefined ? { flowId: query.flowId } : {}),
              userId: identity.userId,
              tenantId: identity.tenantId,
              orgId: identity.orgId,
              ...(state !== undefined ? { state } : {}),
              limit: limit + 1,
              ...(offset > 0 ? { offset } : {})
            })
          : (await byIds(query.ids, { flowKind: query.flowKind, flowId: query.flowId, state })).slice(offset, offset + limit + 1);
      const answered: ListedSession[] = [];
      for (const candidate of stored.slice(0, limit)) {
        // A write session is the server's, never a conversation (FIX-2624).
        if (isWriteRecord(candidate)) continue;
        const record = await admitted(candidate);
        if (record === undefined) continue;
        answered.push({
          id: toBareSessionId(record.id, identity.tenantId),
          flowKind: record.flowKind,
          ...(record.flowId != null ? { flowId: record.flowId } : {}),
          lineageId: resolveLineageId(record),
          ...(typeof record.title === "string" && record.title.length > 0 ? { title: record.title } : {}),
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          state: stateOf(record, "visible")
        });
      }
      return { sessions: answered, more: stored.length > limit };
    },

    turns,

    async history(sessionId: string, query?: SessionHistoryQuery): Promise<SessionHistory | undefined> {
      const reads = inputs.history;
      if (reads === undefined) return undefined;
      const record = await owned(sessionId);
      if (record === undefined) return unanswered();
      inputs.observe?.history(sessionId);
      const limit = query?.limit ?? { turns: SESSION_HISTORY_DEFAULT_TURNS };
      // Bounded at the store: a count of turns reads that many, a token limit
      // the most a read takes (BP-033).
      const count = typeof limit === "number" ? limit : "turns" in limit ? limit.turns : SESSION_HISTORY_MAX_TURNS;
      const turns = Math.max(0, Math.min(SESSION_HISTORY_MAX_TURNS, Math.floor(count)));
      // The session's own request scope, as its own turns load their window.
      const scope = sessionRequestScope(sessionId, record, identity.tenantId);
      const past = await readSettledTurns({
        requests: reads.requests,
        scope,
        turns,
        runningRequestId: reads.runningRequestId,
        ...(reads.durability !== undefined ? { durability: reads.durability } : {}),
        onGateReadError: reads.onGateReadError
      });
      const selected = await selectRequestsByLimit(
        past.settled,
        limit,
        reads.tokenCounter(),
        reads.resolveModelId,
        LLM_AUDIENCE_TYPES,
        undefined
      );
      // The selection is the newest turns, in order: the tail of `settled`.
      const kept = past.settled.slice(past.settled.length - selected.length);
      const read: HistoryTurn[] = kept.map((r, at) => ({
        requestId: r.id,
        startedAtMs: r.startedAtMs,
        // A turn waiting on a call is read as far as it got, and has not settled.
        settled: !past.waiting.has(r.id),
        messages: selected[at]!.messages
      }));
      const newest = kept.filter((r) => !past.waiting.has(r.id)).at(-1);
      const first = kept[0];
      const leftOut = kept.length < past.settled.length || past.start !== undefined;
      return {
        turns: read,
        ...(first !== undefined && leftOut ? { startRequestId: first.id } : {}),
        ...(newest !== undefined ? { asOf: { requestId: newest.id, atMs: newest.completedAtMs ?? newest.updatedAt } } : {}),
        running: past.open.length > 0 || past.parked.size > 0 || (past.start !== undefined && (await parkedBefore(reads, scope, past.window)))
      };
    },
  };
}
