/**
 * The request host's session reads: a running request checks a target session
 * before it writes anything to it (FIX-2160 D2), and reads what another of its
 * principal's sessions has said (FIX-2173).
 *
 * The owner rule is the dispatch seam's own (`resolveExistingSession` in
 * `./create-request-host`): another user's or tenant's session, and one bound
 * to another org, are not this principal's. Here every one of them, and a
 * session that doesn't exist, answers `undefined`, so neither read is an
 * existence oracle. The flow is not checked: the caller asks which flow it runs.
 *
 * `read` crosses the flow and the state the session's flow declares readonly
 * (server-written markers, as the HTTP session list's state filter keeps
 * them), never the record. `history` crosses the session's settled turns, by
 * the one read a turn's own history window uses (`./settled-turns`), and
 * writes nothing.
 */
import { getReadonlyStateKeys } from "@flow-state-dev/core/helpers";
import type {
  FlowInstance,
  HistoryTurn,
  RequestSessions,
  SessionHistory,
  SessionHistoryQuery,
  SessionView,
  TokenCounter
} from "@flow-state-dev/core/types";
import type { DurabilityProvider } from "../durability/types";
import { resolveSessionStorageKey } from "../stores/scope-keys";
import type { RequestStore, SessionRecord, SessionStore } from "../stores/types";
import { LLM_AUDIENCE_TYPES, selectRequestsByLimit } from "./history";
import { sessionRequestScope } from "./session-request-scope";
import { readSettledTurns } from "./settled-turns";

/** The most turns `history` reads from the store, whatever its limit asks. */
const SESSION_HISTORY_MAX_TURNS = 50;
const SESSION_HISTORY_DEFAULT_TURNS = 20;

export type RequestSessionsInputs = {
  sessions: Pick<SessionStore, "get">;
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
  const owned = async (sessionId: string): Promise<SessionRecord | undefined> => {
    if (typeof sessionId !== "string" || sessionId.length === 0) return undefined;
    return principalSession(await sessions.get(resolveSessionStorageKey(sessionId, identity.tenantId)), identity);
  };

  return {
    async read(sessionId: string): Promise<SessionView | undefined> {
      const record = await owned(sessionId);
      if (record === undefined) return undefined;
      // The owner as `record-owner` reads it: the stored instance id, or, on a
      // legacy row, the singleton named by its kind. A flow of another kind
      // under that address is not its owner, and declares nothing for it.
      const owner = flowAt(record.flowId ?? record.flowKind);
      const readonly = owner?.kind === record.flowKind ? getReadonlyStateKeys(owner.session?.stateSchema) : [];
      const state: Record<string, unknown> = {};
      for (const key of readonly) {
        if (Object.prototype.hasOwnProperty.call(record.state, key)) state[key] = structuredClone(record.state[key]);
      }
      return {
        flowKind: record.flowKind,
        ...(record.flowId != null ? { flowId: record.flowId } : {}),
        state: Object.freeze(state),
      };
    },

    async history(sessionId: string, query?: SessionHistoryQuery): Promise<SessionHistory | undefined> {
      const reads = inputs.history;
      if (reads === undefined) return undefined;
      const record = await owned(sessionId);
      if (record === undefined) return undefined;
      const limit = query?.limit ?? { turns: SESSION_HISTORY_DEFAULT_TURNS };
      // Bounded at the store: a count of turns reads that many, a token limit
      // the most a read takes (BP-033).
      const count = typeof limit === "number" ? limit : "turns" in limit ? limit.turns : SESSION_HISTORY_MAX_TURNS;
      const turns = Math.max(0, Math.min(SESSION_HISTORY_MAX_TURNS, Math.floor(count)));
      // The session's own request scope, as its own turns load their window.
      const scope = sessionRequestScope(sessionId, record, identity.tenantId);
      const open = (await reads.requests.list({ ...scope, status: ["in_progress", "suspended"], orderBy: "startedAtMs" })).filter(
        (r) => r.id !== reads.runningRequestId
      );
      const past = await readSettledTurns({
        requests: reads.requests,
        scope,
        turns,
        runningRequestId: reads.runningRequestId,
        openTurns: open,
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
        settled: true,
        messages: selected[at]!.messages
      }));
      const newest = kept.at(-1);
      const first = kept[0];
      const leftOut = kept.length < past.settled.length || past.start !== undefined;
      return {
        turns: read,
        ...(first !== undefined && leftOut ? { startRequestId: first.id } : {}),
        ...(newest !== undefined ? { asOf: { requestId: newest.id, atMs: newest.completedAtMs ?? newest.updatedAt } } : {}),
        running: open.length > 0 || past.parked.size > 0
      };
    },
  };
}
