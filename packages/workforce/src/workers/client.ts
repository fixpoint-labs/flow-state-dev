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
  createClient,
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
import { FILING_SESSION_STATE_KEY, ROSTER_FLOW, SET_WORK_PROJECT_ACTION, STANDARD_WORKERS_RESOURCE, WORKERS_RESOURCE } from "./keys";
import { STANDING_RULES_ACTION } from "../standing-rules/keys";
import type { StandingRulesActionInput, StandingRulesActionOutput } from "../standing-rules/rules-action";
import type { SetWorkProjectOutput } from "../projects/work-project";

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
  /** Its display name, or `null` when it has none (a view shows its id). Only a standard worker has one. */
  name: string | null;
  /** Its team's display name, or `null` when the team has none or the worker has no team. */
  teamName: string | null;
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
   * The user's session with the worker the criteria name, on the worker's
   * current flow, or `undefined` when there is none. With `worker` alone, or
   * with `projectId`, that is the session at the derived address
   * {@link ensureWorkerSession} creates, where another worker's message
   * lands: a session the user opened at any other id is not returned.
   * Otherwise the most recent match on the criteria's keys: a session that
   * carries a criteria key the call doesn't name is not returned. With `workstreamId`, the one session the user's
   * entry for that workstream names, or `undefined` while it names none.
   * Throws when the worker isn't on the user's roster.
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
   * then this throws. Nor with `filingSessionId`: a conversation's delegate
   * session is opened when the conversation hands it a post or a task, and
   * until then this throws. Throws, too, when the worker isn't on the
   * user's roster.
   */
  ensureWorkerSession(criteria: WorkerSessionCriteria): Promise<SessionSummary>;
  /**
   * Read or edit the user's standing rules with `worker`, in that user's
   * session with the worker. The worker's flow must declare the rules action
   * (its inventory row says `rules: true`). A refused write rejects with the
   * reason and stores nothing.
   */
  standingRules(worker: string, input: StandingRulesActionInput): Promise<StandingRulesActionOutput>;
  /**
   * Set the project one of the user's own conversations with `worker` works
   * in: its runs, and the tasks it files from now on. With no `sessionId`,
   * the user's default conversation with the worker (created when there is
   * none); with one, that session of the user's, such as a new session just
   * created. A later call replaces the project; tasks already filed keep the
   * one they were filed in. Rejects, storing nothing, for a project the user
   * isn't a member of (a private one: isn't theirs), and for a session that
   * isn't the user's own conversation: the project coordinator's, a task's,
   * a delegate's or a workstream lead's, or one running another worker.
   */
  setWorkProject(
    worker: string,
    project: { visibility: "shared" | "private"; id: string },
    options?: { sessionId?: string }
  ): Promise<SetWorkProjectOutput>;
}

function stateOf(session: SessionSummary): Record<string, unknown> {
  const state = (session as { state?: unknown }).state;
  return state !== null && typeof state === "object" ? (state as Record<string, unknown>) : {};
}

function mostRecent<T extends { updatedAt: number; createdAt: number }>(rows: readonly T[]): T | undefined {
  return [...rows].sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt)[0];
}

/** How often an action run through the client checks whether its request ended, and how long it waits. */
const ACTION_POLL_MS = 100;
const ACTION_TIMEOUT_MS = 30_000;

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
      const listed = mostRecent(await sessions.listSessions({ flowKind: ROSTER_FLOW, userId }));
      const detail =
        listed !== undefined
          ? await sessions.getSession(listed.id)
          : await sessions.createSession({ flowKind: ROSTER_FLOW, userId });
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
      const data = (item.clientData ?? {}) as {
        flow?: unknown;
        description?: unknown;
        forkedFrom?: unknown;
        name?: unknown;
        teamName?: unknown;
      };
      const topic = item.topic.slice(item.topic.lastIndexOf("/") + 1);
      return {
        id: topic,
        flow: String(data.flow),
        standard: isStandard,
        description: typeof data.description === "string" ? data.description : null,
        name: isStandard && typeof data.name === "string" ? data.name : null,
        teamName: isStandard && typeof data.teamName === "string" ? data.teamName : null,
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

  /**
   * Whether the criteria name a session the client opens itself: a worker's
   * own conversation, or a project coordinator's for one project. Those live
   * at one derived address, the one a worker's message lands in (FIX-1989).
   */
  const derivable = (criteria: WorkerSessionCriteria): boolean =>
    criteria.taskId === undefined && criteria.filingSessionId === undefined && criteria.workstreamId === undefined;

  /**
   * The session at the criteria's derived address, or `undefined` while there
   * is none. Found in the listing by its id rather than read by it, so an
   * absent conversation is an empty answer, not a 404 a page logs.
   */
  const atDerived = async (criteria: WorkerSessionCriteria, flow: string, orgId: string): Promise<SessionSummary | undefined> => {
    const sessionId = await deriveWorkerSessionId({ userId, orgId, flow, criteria });
    const rows = await sessions.listSessions({ flowKind: flow, userId, state: criteriaState(criteria) });
    return rows.find((row) => row.id === sessionId);
  };

  const find = async (
    criteria: WorkerSessionCriteria,
    flow: string,
    rosterId: string,
    orgId: string
  ): Promise<SessionSummary | undefined> => {
    // A conversation opened at another id (a random one, from before the
    // derived address) stays in the session lists but is never returned.
    if (derivable(criteria)) return atDerived(criteria, flow, orgId);
    const filter = criteriaState(criteria);
    const named = new Set(Object.keys(filter));
    const rows = await sessions.listSessions({
      flowKind: flow,
      userId,
      state: filter,
      // A coordinator's delegate session, a workstream's lead and a task's
      // session are each a dispatch run of the session that opened it. A
      // lookup naming none of those returned at the derived address above.
      include: "dispatch-runs"
    });
    const matching = rows.filter((row) => {
      const state = stateOf(row);
      // A session naming a conversation is only ever a dispatch run of it; a
      // top-level one is a caller's, from before a create naming one was refused.
      if (Object.hasOwn(state, FILING_SESSION_STATE_KEY) && row.parentSessionId == null) return false;
      return CRITERIA_STATE_KEYS.every((key) => named.has(key) || !Object.hasOwn(state, key));
    });
    if (criteria.workstreamId === undefined) return mostRecent(matching);
    // A workstream's entry names its lead's session, and is the one source of
    // it: an open that stalled can leave another session linked to the same
    // workstream, which is never handed out.
    const leadSession = await namedLeadSession(rosterId, criteria.workstreamId);
    return leadSession === null ? undefined : matching.find((row) => row.id === leadSession);
  };

  /** Run one action in `sessionId` on `flow` and return its output, or reject with the reason it failed. */
  const runIn = async (flow: string, sessionId: string, action: string, input: unknown): Promise<unknown> => {
    const actions = createClient({ flowKind: flow, userId, ...transport });
    const started = await actions.sendAction(action, input, { sessionId });
    const requestId = started.request.id;
    const until = Date.now() + ACTION_TIMEOUT_MS;
    let status: Awaited<ReturnType<typeof actions.getRequestStatus>>["status"] = started.status;
    while (status === "in_progress") {
      if (Date.now() > until) throw new Error(`${action} did not finish in time.`);
      await new Promise((resolve) => setTimeout(resolve, ACTION_POLL_MS));
      status = (await actions.getRequestStatus(requestId)).status;
    }
    const listed = await sessions.listSessionRequests(sessionId, { status, includeResultOutput: true, limit: 100 });
    const found = listed.find((request) => request.id === requestId);
    if (status !== "completed") throw new Error(found?.result?.error?.message ?? `${action} ended ${status}.`);
    if (found === undefined) throw new Error(`${action} finished, but its answer could not be read.`);
    return found.result?.output;
  };

  const client: WorkforceClient = {
    roster: async () => readRoster((await roster()).id),
    findWorkerSession: async (criteria) => {
      const { id, orgId } = await roster();
      return find(criteria, flowOf(await readRoster(id), criteria.worker), id, orgId);
    },
    ensureWorkerSession: async (criteria) => {
      // One roster read per call, and the roster session's organization from
      // the same lookup.
      const { id, orgId } = await roster();
      const flow = flowOf(await readRoster(id), criteria.worker);
      const existing = await find(criteria, flow, id, orgId);
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
      if (criteria.filingSessionId !== undefined) {
        // Only the coordinator's delivery opens a conversation's delegate
        // session; one started here would be a decoy lookups could return.
        throw new Error(
          `Conversation "${criteria.filingSessionId}" has no session with "${criteria.worker}" yet: a conversation's ` +
            `delegate session is opened when the conversation hands it a post or a task, never by ensureWorkerSession.`
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
    },
    standingRules: async (worker, input) => {
      const session = await client.ensureWorkerSession({ worker });
      const flow = flowOf(await readRoster((await roster()).id), worker);
      return (await runIn(flow, session.id, STANDING_RULES_ACTION, input)) as StandingRulesActionOutput;
    },
    setWorkProject: async (worker, project, setOptions) => {
      const sessionId = setOptions?.sessionId ?? (await client.ensureWorkerSession({ worker })).id;
      const flow = flowOf(await readRoster((await roster()).id), worker);
      return (await runIn(flow, sessionId, SET_WORK_PROJECT_ACTION, { project, worker })) as SetWorkProjectOutput;
    }
  };
  return client;
}
