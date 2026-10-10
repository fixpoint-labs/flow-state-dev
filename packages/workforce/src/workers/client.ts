/**
 * `createWorkforceClient`: find or start a session with a worker, from an app.
 *
 * Built on the session and resource clients, with no endpoint of its own. The
 * user's roster is read through a session of the roster flow (one per user),
 * which declares the two worker collections; a worker's sessions are listed by
 * their readonly `workerId` and created with it as initial state, which the
 * worker flow's create check confirms.
 *
 * Isomorphic: no Node built-ins, so the browser entry exports it too.
 */
import {
  ClientHttpError,
  createResourceClient,
  createSessionClient,
  readEveryCollectionPage,
  type ClientFetch,
  type SessionSummary
} from "@flow-state-dev/client";
import {
  CRITERIA_STATE_KEYS,
  criteriaState,
  deriveWorkerSessionId,
  type WorkerSessionCriteria
} from "./derive-session-id";
import { ownerSegment } from "@flow-state-dev/core/types";
import { workstreamsAccessor, workstreamStorageKey, type WorkstreamAddress } from "../projects/workstream-ref";
import { ROSTER_FLOW_KIND, STANDARD_WORKERS_RESOURCE, WORKERS_RESOURCE } from "./keys";

/** The transport options `createSessionClient` takes, plus the user the client acts for. */
export type WorkforceClientOptions = {
  /** The user whose roster and sessions this client reads. With authentication, the signed-in user. */
  userId: string;
  baseUrl?: string;
  apiPath?: string;
  fetcher?: ClientFetch;
};

/** One worker on a user's roster. */
export type RosterEntry = {
  /** The worker's id: what `ensureWorkerSession({ worker })` takes. */
  id: string;
  /** The flow it runs on, and the flow its sessions are created on. */
  flow: string;
  /** Whether it is a standard worker (from the installation's files) rather than the user's own. */
  standard: boolean;
  /** What it is for, or `null`. */
  description: string | null;
  /** For one of the user's own workers forked from a standard one: that worker's id. `null` otherwise. */
  forkedFrom: string | null;
};

/** A user's roster, and their sessions with each worker. */
export interface WorkforceClient {
  /**
   * The user's roster: their own workers and every standard worker, by id,
   * each naming its flow. Read again after any turn: a turn that hires, forks
   * or fires changes it.
   */
  roster(): Promise<RosterEntry[]>;
  /**
   * The user's most recent session with the worker the criteria name, on the
   * worker's current flow, or `undefined` when there is none. Matches on the
   * criteria's keys: a session that carries a criteria key the call doesn't
   * name is not returned. With `workstreamId`, the one session the user's
   * entry for that workstream names, or `undefined` while it names none.
   */
  findWorkerSession(criteria: WorkerSessionCriteria): Promise<SessionSummary | undefined>;
  /**
   * What {@link findWorkerSession} returns, or a new session with the worker
   * when there is none, created on the worker's flow at an id derived from
   * the user, the organization, the flow and the criteria. Two calls at once
   * get the same session. With `workstreamId` it never creates one: a
   * workstream's open starts its lead's session, and until the entry names
   * it this throws. With `taskId` it never creates one either: a task's
   * session is opened when its conversation's board hands it over, and until
   * then this throws.
   */
  ensureWorkerSession(criteria: WorkerSessionCriteria): Promise<SessionSummary>;
}

function stateOf(session: SessionSummary): Record<string, unknown> {
  const state = (session as { state?: unknown }).state;
  return state !== null && typeof state === "object" ? (state as Record<string, unknown>) : {};
}

function mostRecent<T extends { updatedAt: number; createdAt: number }>(rows: readonly T[]): T | undefined {
  return [...rows].sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt)[0];
}

/**
 * Build a workforce client.
 *
 * @param options The user, and the transport options `createSessionClient` takes.
 */
export function createWorkforceClient(options: WorkforceClientOptions): WorkforceClient {
  const transport = {
    ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
    ...(options.apiPath !== undefined ? { apiPath: options.apiPath } : {}),
    ...(options.fetcher !== undefined ? { fetcher: options.fetcher } : {})
  };
  const sessions = createSessionClient(transport);
  const resources = createResourceClient(transport);
  const { userId } = options;

  /**
   * The user's roster session, and the organization it was created in. Found
   * by listing, and created without an id when there is none: the client
   * can't derive an id that includes the organization before it knows which
   * one the server binds it to. Two first calls at once may create two; either
   * reads the same roster.
   */
  let rosterSession: Promise<{ id: string; orgId: string }> | undefined;
  const roster = (): Promise<{ id: string; orgId: string }> =>
    (rosterSession ??= (async () => {
      const listed = mostRecent(await sessions.listSessions({ flowKind: ROSTER_FLOW_KIND, userId }));
      const detail =
        listed !== undefined
          ? await sessions.getSession(listed.id)
          : await sessions.createSession({ flowKind: ROSTER_FLOW_KIND, userId });
      return { id: detail.id, orgId: detail.orgId };
    })().catch((error: unknown) => {
      rosterSession = undefined;
      throw error;
    }));

  const listAll = (sessionId: string, ref: string) => readEveryCollectionPage(resources, sessionId, ref);

  /** The roster as it is now: read on every call, since a hire changes it. */
  const readRoster = async (id: string): Promise<RosterEntry[]> => {
    const [own, standard] = await Promise.all([listAll(id, WORKERS_RESOURCE), listAll(id, STANDARD_WORKERS_RESOURCE)]);
    const entry = (item: { topic: string; clientData?: unknown }, isStandard: boolean): RosterEntry => {
      const data = (item.clientData ?? {}) as { flow?: unknown; description?: unknown; forkedFrom?: unknown };
      const topic = item.topic.slice(item.topic.lastIndexOf("/") + 1);
      return {
        id: topic,
        flow: String(data.flow),
        standard: isStandard,
        description: typeof data.description === "string" ? data.description : null,
        forkedFrom: !isStandard && typeof data.forkedFrom === "string" ? data.forkedFrom : null
      };
    };
    return [...own.map((item) => entry(item, false)), ...standard.map((item) => entry(item, true))];
  };

  /** The worker's flow on the roster: the user's own worker first, since a hire can't take a standard id. */
  const flowOf = (entries: readonly RosterEntry[], worker: string): string => {
    const found =
      entries.find((entry) => entry.id === worker && !entry.standard) ?? entries.find((entry) => entry.id === worker);
    if (found === undefined) throw new Error(`No worker "${worker}" on your roster.`);
    return found.flow;
  };

  /**
   * The session the user's own entry for `workstream` names, or `null` when it
   * names none or there is no entry. Read through the roster session, whose
   * flow declares the entries with a browser read.
   */
  const namedLeadSession = async (rosterId: string, workstream: WorkstreamAddress): Promise<string | null> => {
    const item = await resources.getCollectionItemState(
      rosterId,
      workstreamsAccessor(workstream.project.visibility),
      workstreamStorageKey(workstream, ownerSegment(userId))
    );
    const sessionId = (item?.clientData as { sessionId?: unknown } | undefined)?.sessionId;
    return typeof sessionId === "string" ? sessionId : null;
  };

  const find = async (
    criteria: WorkerSessionCriteria,
    flow: string,
    rosterId: string
  ): Promise<SessionSummary | undefined> => {
    const filter = criteriaState(criteria);
    const named = new Set(Object.keys(filter));
    const rows = await sessions.listSessions({
      flowKind: flow,
      userId,
      state: filter,
      // A coordinator's delivery opens its delegate's session as a dispatch run
      // of the conversation, a workstream's open opens its lead's session as
      // a dispatch run of the session that opened it, and a conversation's
      // board opens a task's session as a dispatch run of the conversation, so
      // a lookup for any of them includes those. A lookup that names none
      // keeps to the sessions a person started.
      ...(criteria.filingSessionId === undefined &&
      criteria.workstreamId === undefined &&
      criteria.taskId === undefined
        ? {}
        : { include: "dispatch-runs" as const })
    });
    const matching = rows.filter((row) => {
      const state = stateOf(row);
      return CRITERIA_STATE_KEYS.every((key) => named.has(key) || !Object.hasOwn(state, key));
    });
    if (criteria.workstreamId === undefined) return mostRecent(matching);
    // A workstream's entry names its lead's session, and is the one source of
    // it: an open that stalled can leave another session linked to the same
    // workstream, which is never handed out.
    const leadSession = await namedLeadSession(rosterId, criteria.workstreamId);
    return leadSession === null ? undefined : matching.find((row) => row.id === leadSession);
  };

  return {
    roster: async () => readRoster((await roster()).id),
    findWorkerSession: async (criteria) => {
      const { id } = await roster();
      return find(criteria, flowOf(await readRoster(id), criteria.worker), id);
    },
    ensureWorkerSession: async (criteria) => {
      // One roster read per call, and the roster session's organization from
      // the same lookup.
      const { id, orgId } = await roster();
      const flow = flowOf(await readRoster(id), criteria.worker);
      const existing = await find(criteria, flow, id);
      if (existing !== undefined) return existing;
      if (criteria.taskId !== undefined) {
        // Only the hand-over opens a task's session: it is a child of the
        // conversation that filed the task, and one started here would be a
        // session the task never runs in (BR-20).
        throw new Error(
          `Task "${criteria.taskId}" has no session with "${criteria.worker}" yet: a task's session is opened ` +
            `when the task is handed over, never by ensureWorkerSession.`
        );
      }
      if (criteria.workstreamId !== undefined) {
        // Only a workstream's open starts its lead's session and names it on
        // the entry; one started here would be a second session nobody names.
        const { project, id: workstream } = criteria.workstreamId;
        throw new Error(
          `Workstream "${workstream}" in project "${project.id}" has no lead session yet for "${criteria.worker}": ` +
            `openWorkstream starts it.`
        );
      }
      const sessionId = await deriveWorkerSessionId({ userId, orgId, flow, criteria });
      try {
        return await sessions.createSession({
          flowKind: flow,
          userId,
          sessionId,
          // Every criteria key is a readonly field the session starts with, so
          // a later lookup by the same criteria finds it.
          state: criteriaState(criteria)
        });
      } catch (error) {
        // A racing call created it first: the store's create-if-absent let
        // one write win, and this is that session.
        if (error instanceof ClientHttpError && error.status === 409) return sessions.getSession(sessionId);
        throw error;
      }
    }
  };
}
