/**
 * `createWorkforceClient`: find or start a session with a worker from an app.
 * A user's conversations with a worker are the roster flow's worker sessions
 * view (`workerSessionsViewRef`), which the server assembles and keeps live.
 *
 * Built on the one client (`createClient`), with no endpoint of its own. The
 * user's roster is the roster flow's roster view, read at user scope with no
 * session. `watchRoster` follows it through the client's shared view watch
 * (`watchView`, on `client.live`): the view's answer names the topics it read.
 * A hire, fork, edit, reset or fire is a send addressed to the user's workers
 * collection, which the roster flow writes (`runBy`), and the organization a
 * worker's conversation is derived under is the roster flow's identity read. A
 * workstream's entry is read by scope with no session. No roster session is
 * found or made. A worker's sessions are listed by their readonly `workerId`
 * and created with it as initial state, which the worker flow's create check
 * confirms.
 *
 * Isomorphic: no Node built-ins, so the browser entry exports it too.
 */
import {
  ClientHttpError,
  ResourceWriteError,
  type Client,
  type SessionSummary,
  type UploadRequest
} from "@flow-state-dev/client";
import {
  byRecent,
  carriesOnly,
  criteriaState,
  deriveWorkerSessionId,
  type WorkerSessionCriteria
} from "./derive-session-id";
import { ownerSegment } from "@flow-state-dev/core/types";
import type { FileContent } from "@flow-state-dev/core/items";
import { WORKSTREAMS_PATTERN, workstreamStorageKey, type WorkstreamAddress } from "../projects/workstream-ref";
import {
  FILING_SESSION_STATE_KEY,
  ROSTER_FLOW,
  SET_SESSION_FIELDS_ACTION,
  SET_WORK_PROJECT_ACTION,
  WORKER_ID_STATE_KEY,
  WORKERS_PATTERN
} from "./keys";
import { RESPOND_ACTION } from "../worker-door";
import { TURN_ACTIONS } from "./turn-actions";
import { watchView } from "@flow-state-dev/client/internal";
import { rosterView } from "./roster-view-ref";
import { STANDING_RULES_ACTION } from "../standing-rules/keys";
import { ADD_DELEGATE, REMOVE_DELEGATE } from "../delegates/delegate-keys";
import type { StandingRulesActionInput, StandingRulesActionOutput } from "../standing-rules/rules-action";
import type { SetWorkProjectOutput } from "../projects/work-project";

/**
 * The slice of the one client a workforce client reads and writes through.
 * Its user is the one whose roster and sessions are read: with
 * authentication, the signed-in user.
 */
export type WorkforceClientSource = Pick<Client, "userId" | "flow" | "sessions" | "resource" | "view" | "subscribe">;

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
  /**
   * Its display name, or `null` when it has none (a view shows its id): the
   * user's own row's `name`, else a standard worker's file's `name:`. Display
   * only; the id stays its address.
   */
  name: string | null;
  /** Its team's display name, or `null` when the team has none or the worker has no team. */
  teamName: string | null;
  /** For one of the user's own workers forked from a standard one: that worker's id. `null` otherwise. */
  forkedFrom: string | null;
  /**
   * A standard worker the user has edited: the row read is their own copy of
   * it, under its id, until {@link WorkforceClient.reset}. `false` otherwise.
   */
  edited: boolean;
  /**
   * The settings its flow shows (`showSettings` where the app registers the
   * flow), with the worker's values: a coding worker's `harness`, say. Only
   * the keys the worker sets; `{}` when its flow shows none.
   */
  settings: Readonly<Record<string, unknown>>;
};

/**
 * A new worker of the user's own, as {@link WorkforceClient.hire} takes it:
 * the roster flow's `hire` action's input.
 */
export type HireWorkerInput = {
  /** The new worker's id: one path segment, not a standard worker's. */
  id: string;
  /** The name a user reads it by. Omitted, none: a view shows its id. */
  name?: string;
  /** The worker flow it runs on. Omitted, `agent`. */
  flow?: string;
  description?: string;
  instructions?: string;
  /** Skills by name. */
  skills?: string[];
  /** The keys a `WORKER.md` frontmatter accepts other than `flow` and `description`. */
  settings?: Record<string, unknown>;
};

/** A change to one of the user's own workers, as {@link WorkforceClient.edit} takes it: each field given replaces the stored one. */
export type EditWorkerInput = {
  id: string;
  /** A new display name; `null` clears it. The id never changes. */
  name?: string | null;
  flow?: string;
  description?: string | null;
  instructions?: string | null;
  skills?: string[];
  /** Replaces the stored settings whole. */
  settings?: Record<string, unknown>;
};

/** A user's roster, and their sessions with each worker. */
export interface WorkforceClient {
  // FIX-2775.
  /**
   * The organization the server acts in for this user under the roster
   * flow's sign-in: the verified principal's, never one the caller names, and
   * the one a worker's conversation is derived under. Read once per client,
   * with no session; a failed read is not kept, so the next call asks again.
   * Rejects with the server's `ClientHttpError`: a 401 or 403 is a refusal.
   */
  organization(): Promise<string>;
  /**
   * The user's roster: their own workers and every standard worker, by id,
   * each naming its flow. Read again after any turn: a turn that hires, forks
   * or fires changes it.
   */
  roster(): Promise<RosterEntry[]>;
  /**
   * Follow the user's roster: `onRoster` gets it once read, and again each
   * time a hire, fork, edit or fire, from any tab or any worker's turn,
   * changes it. Only a change is reported. It watches the roster view: each
   * answer names the topics its run read, and a notice on one reads again,
   * as do a connect, a reconnect and a `resync`; where push can miss a change
   * the client's timer reads every three seconds. Every watcher of the roster
   * in one client shares one read. A failed read goes to `onError`
   * and is tried again on its own (1 s, doubling to 30 s); the next read that
   * lands is reported even if the roster didn't change. Returns the stop
   * function; nothing is reported after it.
   */
  watchRoster(onRoster: (entries: RosterEntry[]) => void, options?: { onError?: (error: unknown) => void }): () => void;
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
  /**
   * Open a new session with `worker` on its flow, at a fresh id: another
   * conversation beside the user's others, where {@link ensureWorkerSession}
   * finds or makes the one at the derived address. With `fields`, the server
   * writes the app's session fields (the installation's `sessionFields`) once,
   * through the worker flow's `setSessionFields`, before this resolves; a
   * refused field rejects, naming it, and the session stays without it.
   * Throws when the worker isn't on the user's roster.
   */
  startSession(worker: string, options?: { fields?: Record<string, unknown> }): Promise<SessionSummary>;
  /**
   * Send `message` to the user's session `sessionId` through the worker
   * flow's door (`respond`), with any uploaded `attachments`. The client sets
   * the send's request id before anything is awaited, so it is known before
   * the server answers and {@link stopTurns} can tell a line sent after a stop
   * began. Resolves once the server took the send, to `{ requestId }`: what a
   * screen matches the line and its turn by, or stops it by ({@link stopRun}). With
   * `{ stream: true }` it resolves to the send's streamed `Response` instead,
   * for a screen showing the answer as it is written (a session feed's
   * `followResponse`), and rejects, naming the status, when the server
   * refused it.
   *
   * `taskId`: the task the line is sent from. It goes only to a door that
   * takes one (the worker inventory's `doorTakesTask` for the session's flow),
   * which stamps it on the line and its reply; a strict door that takes none
   * would refuse the key, so it is left out there, and where the inventory
   * can't be read.
   */
  send(sessionId: string, message: string, options?: { attachments?: readonly FileContent[]; taskId?: string }): Promise<{ requestId: string }>;
  send(
    sessionId: string,
    message: string,
    options: { attachments?: readonly FileContent[]; taskId?: string; stream: true }
  ): Promise<Response>;
  // FIX-2776 D3.
  /**
   * Stop the one run `requestId` of session `sessionId`, through the flow the
   * session runs on: the abort {@link stopTurns} makes for each turn, by id.
   * A run that already ended is no failure. Resolves once the server took the
   * abort; the run's own status says when it stopped. Rejects when an answer
   * resumed the run before the stop reached it, so it still runs: stop it again.
   */
  stopRun(sessionId: string, requestId: string): Promise<void>;
  // FIX-2776 D3.
  /**
   * Upload one file for a line to `worker`, through the worker's flow, whose
   * sign-in a send to it runs: the reference a send's `attachments` take. A
   * first line, with no session yet, uploads this way too. Throws when the
   * worker isn't on the user's roster.
   */
  upload(worker: string, request: UploadRequest): Promise<FileContent>;
  // FIX-2776 D3.
  /**
   * Add `worker` to the delegates of the user's conversation `sessionId`,
   * with an optional `note` on what it's good at, through the conversation's
   * `addDelegate` action. Rejects with the coordinator's reason, changing
   * nothing, for a worker that isn't on the roster, takes no task, or is
   * already there.
   */
  addDelegate(sessionId: string, worker: string, note?: string): Promise<void>;
  // FIX-2776 D3.
  /** Take `worker` off the conversation's delegates, through its `removeDelegate` action. */
  removeDelegate(sessionId: string, worker: string): Promise<void>;
  /**
   * Stop every turn of session `sessionId` running when it reads them (its
   * in-progress requests of `TURN_ACTIONS`, oldest first), each turn this
   * client sent before the call among them. It leaves each turn this client
   * sent after the call began: a follow-up sent straight after Stop runs on.
   * It reads the running turns once, so another client's turn which starts
   * after the read may run. A turn that ended meanwhile is no failure; one
   * that went on past the stop (an answer resumed it first) rejects, asking
   * for another stop. Resolves to the ids of the turns it stopped, for a
   * screen that shows the stop until each has ended.
   */
  stopTurns(sessionId: string): Promise<string[]>;
  /** Run the turn `requestId` of session `sessionId` again, through its retry route. */
  retryTurn(sessionId: string, requestId: string): Promise<void>;
  /**
   * Hire a worker of the user's own, through the roster flow's `hire`. It is
   * on {@link roster} at once, and its first turn runs on its row: nothing is
   * registered and nothing restarts. Rejects, writing nothing, for a standard
   * worker's id or one already on the roster, a flow that isn't a worker
   * flow, or settings that flow refuses.
   */
  hire(input: HireWorkerInput): Promise<{ id: string; flow: string }>;
  /**
   * Copy a standard worker, or one of the user's own, to a new worker of the
   * user's own under `id`, through the roster flow's `fork`.
   */
  fork(from: string, id: string): Promise<{ id: string; flow: string }>;
  /**
   * Change one of the user's own workers, through the roster flow's `edit`.
   * The worker's next turn reads the change; a turn already running keeps
   * what it started with. On a standard worker, the first edit copies it to
   * the user's own roster under the same id, and the change lands on that
   * copy: its conversations, tasks and messages stay where they are. It
   * keeps its file's flow, since board tasks reach it there.
   */
  edit(input: EditWorkerInput): Promise<{ id: string; flow: string }>;
  /**
   * Delete the user's copy of a standard worker, through the roster flow's
   * `reset`, so its next turn reads the file again. Rejects for a worker that
   * isn't standard, or one the user hasn't edited.
   */
  reset(id: string): Promise<{ id: string }>;
  /**
   * Fire one of the user's own workers, through the roster flow's `fire`. It
   * leaves the roster; its conversations stay readable, and a new turn there
   * is refused. Rejects for a standard worker.
   */
  fire(id: string): Promise<{ id: string }>;
}

function stateOf(session: SessionSummary): Record<string, unknown> {
  const state = (session as { state?: unknown }).state;
  return state !== null && typeof state === "object" ? (state as Record<string, unknown>) : {};
}

function mostRecent<T extends { updatedAt: number; createdAt: number }>(rows: readonly T[]): T | undefined {
  return [...rows].sort(byRecent)[0];
}

/** How many of a session's requests a stop reads: its running turns, and a turn's record after a 409. */
const RUNNING_TURNS = 50;

/** The worker inventory's collection, read by org scope: which flows' doors take a task. */
const WORKER_INVENTORY_PATTERN = "inventory/workers/*";

/**
 * A request id for a turn this client sends, in the engine's own form (`req_<ms>_<hex>`): a store
 * breaks a same-millisecond tie between turns by id, so this one orders as an id the engine made
 * would. `getRandomValues`, not `randomUUID`: a page served over plain HTTP from another host has
 * no `randomUUID`.
 */
function newRequestId(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(7));
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 13);
  return `req_${Date.now()}_${hex}`;
}

/** How often an action run through the client checks whether its request ended, and how long it waits. */
const ACTION_POLL_MS = 100;
const ACTION_TIMEOUT_MS = 30_000;

/**
 * Build a workforce client over the one client, as that client's user.
 *
 * @param fsd The app's client (`createClient`): its user, transport and credential.
 */
export function createWorkforceClient(fsd: WorkforceClientSource): WorkforceClient {
  const { sessions, userId } = fsd;

  // FIX-2624.
  /**
   * The organization the server acts in for this user under the roster flow's
   * sign-in: the one a worker's conversation is derived under. Asked once, with
   * no session.
   */
  let signedInOrg: Promise<string> | undefined;
  const orgOf = (): Promise<string> =>
    (signedInOrg ??= fsd
      .flow(ROSTER_FLOW)
      .identity()
      .then((identity) => identity.orgId)
      .catch((error: unknown) => {
        signedInOrg = undefined;
        throw error;
      }));

  // FIX-2624.
  /**
   * The user's workers collection, written through the flow its `runBy` names
   * (the roster flow): each write runs in the writer's own write session,
   * which the server keeps; no roster session is found or made to write.
   */
  const rosterWrite = async <TOutput>(action: string, input: unknown): Promise<TOutput> => {
    try {
      return await fsd.resource({ scope: "user", pattern: WORKERS_PATTERN }).send<TOutput>(action, input);
    } catch (error) {
      if (error instanceof ResourceWriteError) throw new Error(error.message);
      throw error;
    }
  };

  /** The roster as it is now, through the roster view: read on every call, since a hire changes it. */
  const readRoster = async (): Promise<RosterEntry[]> => (await fsd.view(rosterView)).value;

  /** The worker's flow on the roster: the user's own worker first, since a hire can't take a standard id. */
  const flowOf = (entries: readonly RosterEntry[], worker: string): string => {
    const found =
      entries.find((entry) => entry.id === worker && !entry.standard) ?? entries.find((entry) => entry.id === worker);
    if (found === undefined) throw new Error(`No worker "${worker}" on your roster.`);
    return found.flow;
  };

  // FIX-2624.
  /**
   * The session the user's own entry for `workstream` names, or `null` when it
   * names none or there is no entry. Read by scope with no session: a shared
   * project's entries are the organization's, a private one's the user's.
   */
  const namedLeadSession = async (workstream: WorkstreamAddress): Promise<string | null> => {
    const { value } = await fsd
      .resource({ scope: workstream.project.visibility === "private" ? "user" : "org", pattern: WORKSTREAMS_PATTERN })
      .entry(workstreamStorageKey(workstream, ownerSegment(userId)))
      .read();
    const sessionId = (value as { sessionId?: unknown } | null)?.sessionId;
    return typeof sessionId === "string" ? sessionId : null;
  };

  // FIX-1989.
  /**
   * Whether the criteria name a session the client opens itself: a worker's
   * own conversation, or a project coordinator's for one project. Those live
   * at one derived address, the one a worker's message lands in.
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
    const rows = await sessions.list({ flowKind: flow, userId, state: criteriaState(criteria) });
    return rows.find((row) => row.id === sessionId);
  };

  const find = async (
    criteria: WorkerSessionCriteria,
    flow: string,
    orgId: string
  ): Promise<SessionSummary | undefined> => {
    // A conversation opened at another id (a random one, from before the
    // derived address) stays in the session lists but is never returned.
    if (derivable(criteria)) return atDerived(criteria, flow, orgId);
    const filter = criteriaState(criteria);
    const named = new Set(Object.keys(filter));
    const rows = await sessions.list({
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
      return carriesOnly(state, named);
    });
    if (criteria.workstreamId === undefined) return mostRecent(matching);
    // A workstream's entry names its lead's session, and is the one source of
    // it: an open that stalled can leave another session linked to the same
    // workstream, which is never handed out.
    const leadSession = await namedLeadSession(criteria.workstreamId);
    return leadSession === null ? undefined : matching.find((row) => row.id === leadSession);
  };

  /** The turns this client sent, by session, newest last: a stop leaves the ones sent after it began. */
  const sentTurns = new Map<string, string[]>();

  /**
   * The flow session `sessionId` runs on, as the server records it: the instance that owns it, or its
   * base flow for a session written before instance ownership.
   */
  const flowOfSession = async (sessionId: string): Promise<string> => {
    const session = await sessions.get(sessionId);
    return session.flowId ?? session.flowKind;
  };

  /** Whether a flow's door takes a task, by flow, once read: the inventory changes only when a Lab boots. */
  const takesTask = new Map<string, Promise<boolean>>();
  /**
   * Whether the door of flow `flowKind` takes a `taskId`, by the worker
   * inventory's row for it. `false` with no row, or when the inventory can't
   * be read: the line then goes without the task, which a strict door would
   * refuse. A failed read is not kept, so the next send reads again.
   */
  const doorTakesTask = (flowKind: string): Promise<boolean> => {
    let pending = takesTask.get(flowKind);
    if (pending === undefined) {
      pending = fsd
        .resource({ scope: "org", pattern: WORKER_INVENTORY_PATTERN })
        .listAll()
        .then((entries) =>
          entries.some((entry) => {
            const value = entry.value as { kind?: unknown; doorTakesTask?: unknown } | null;
            return value?.kind === flowKind && value.doorTakesTask === true;
          })
        )
        .catch(() => {
          takesTask.delete(flowKind);
          return false;
        });
      takesTask.set(flowKind, pending);
    }
    return pending;
  };

  /** Run one action in `sessionId` on `flow` and return its output, or reject with the reason it failed. */
  const runIn = async (flow: string, sessionId: string, action: string, input: unknown): Promise<unknown> => {
    const started = await fsd.flow(flow).send(action, input, { sessionId });
    const settled = await started.result({ pollMs: ACTION_POLL_MS, timeoutMs: ACTION_TIMEOUT_MS }).catch((error: unknown) => {
      if (error instanceof ClientHttpError && error.status === 0) throw new Error(`${action} did not finish in time.`);
      throw error;
    });
    if (settled.status !== "completed") throw new Error(settled.error?.message ?? `${action} ended ${settled.status}.`);
    if (settled.outputNotRecorded === true) throw new Error(`${action} finished, but its answer could not be read.`);
    return settled.output;
  };

  const client: WorkforceClient = {
    organization: orgOf,
    roster: readRoster,
    // The roster view names the topics it read; the shared watch listens to them.
    watchRoster: (onRoster, watchOptions) =>
      watchView<RosterEntry[]>(fsd, rosterView, undefined, {
        onValue: onRoster,
        ...(watchOptions?.onError !== undefined ? { onError: watchOptions.onError } : {})
      }),
    findWorkerSession: async (criteria) => {
      return find(criteria, flowOf(await readRoster(), criteria.worker), await orgOf());
    },
    ensureWorkerSession: async (criteria) => {
      // One roster read per call; the organization is the sign-in's.
      const orgId = await orgOf();
      const flow = flowOf(await readRoster(), criteria.worker);
      const existing = await find(criteria, flow, orgId);
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
        return await fsd.flow(flow).createSession({
          sessionId,
          // Every criteria key is a readonly field the session starts with, so
          // a later lookup by the same criteria finds it.
          state: criteriaState(criteria)
        });
      } catch (error) {
        // A racing call created it first: the store's create-if-absent let
        // one write win, and this is that session.
        if (error instanceof ClientHttpError && error.status === 409) return sessions.get(sessionId);
        throw error;
      }
    },
    standingRules: async (worker, input) => {
      const session = await client.ensureWorkerSession({ worker });
      const flow = flowOf(await readRoster(), worker);
      return (await runIn(flow, session.id, STANDING_RULES_ACTION, input)) as StandingRulesActionOutput;
    },
    setWorkProject: async (worker, project, setOptions) => {
      const sessionId = setOptions?.sessionId ?? (await client.ensureWorkerSession({ worker })).id;
      const flow = flowOf(await readRoster(), worker);
      return (await runIn(flow, sessionId, SET_WORK_PROJECT_ACTION, { project, worker })) as SetWorkProjectOutput;
    },
    startSession: async (worker, startOptions) => {
      const flow = flowOf(await readRoster(), worker);
      const created = await fsd.flow(flow).createSession({ state: { [WORKER_ID_STATE_KEY]: worker } });
      const fields = startOptions?.fields;
      if (fields !== undefined && Object.keys(fields).length > 0) await runIn(flow, created.id, SET_SESSION_FIELDS_ACTION, { worker, fields });
      return created;
    },
    send: (async (
      sessionId: string,
      message: string,
      sendOptions: { attachments?: readonly FileContent[]; taskId?: string; stream?: true } = {}
    ) => {
      // Named before anything is awaited: a stop that begins after this call leaves the turn.
      const requestId = newRequestId();
      sentTurns.set(sessionId, [...(sentTurns.get(sessionId) ?? []), requestId].slice(-RUNNING_TURNS));
      const session = await sessions.get(sessionId);
      const flow = fsd.flow(session.flowId ?? session.flowKind);
      const attachments = [...(sendOptions.attachments ?? [])];
      const taskId = sendOptions.taskId;
      const input = taskId !== undefined && (await doorTakesTask(session.flowKind)) ? { message, taskId } : { message };
      if (sendOptions.stream !== true) {
        // The server may answer another id for one another principal already holds: its answer names the request.
        const sent = await flow.send(RESPOND_ACTION, input, { sessionId, attachments, requestId });
        return { requestId: sent.id };
      }
      const response = await flow.send(RESPOND_ACTION, input, { sessionId, stream: true, attachments, requestId });
      if (!response.ok) throw new Error(`The send was refused (${response.status}).`);
      return response;
    }) as WorkforceClient["send"],
    stopRun: async (sessionId, requestId) => {
      await fsd
        .flow(await flowOfSession(sessionId))
        .request(requestId)
        .abort()
        .catch(async (error: unknown) => {
          // A 409 is a run that ended meanwhile, or one an answer resumed first: the record decides.
          if ((error as { status?: number }).status !== 409) throw error;
          const now = (await sessions.requests(sessionId, { limit: RUNNING_TURNS })).find((request) => request.id === requestId);
          if (now?.status === "in_progress") throw new Error("The run went on before the stop reached it. Stop it again.");
        });
    },
    upload: async (worker, request) => fsd.flow(flowOf(await readRoster(), worker)).upload(request),
    addDelegate: async (sessionId, worker, note) => {
      await runIn(await flowOfSession(sessionId), sessionId, ADD_DELEGATE, note === undefined ? { worker } : { worker, note });
    },
    removeDelegate: async (sessionId, worker) => {
      await runIn(await flowOfSession(sessionId), sessionId, REMOVE_DELEGATE, { worker });
    },
    stopTurns: async (sessionId) => {
      // The running requests, not a turns view: a view lists a session's newest turns only, and a turn
      // still running behind them is stopped all the same.
      // What this client had sent when the stop began: a line it sends while the read is out runs on.
      const sentBefore = new Set(sentTurns.get(sessionId));
      const read = await sessions.requests(sessionId, { status: "in_progress", limit: RUNNING_TURNS });
      const sentAfter = new Set((sentTurns.get(sessionId) ?? []).filter((id) => !sentBefore.has(id)));
      const turns = read
        .filter((request) => TURN_ACTIONS.includes(request.actionName) && !sentAfter.has(request.id))
        .sort((a, b) => (a.startedAtMs ?? 0) - (b.startedAtMs ?? 0));
      const flow = fsd.flow(await flowOfSession(sessionId));
      for (const turn of turns) {
        await flow
          .request(turn.id)
          .abort()
          .catch(async (error: unknown) => {
            // A 409 is a turn that ended meanwhile, or one an answer resumed first: the record decides.
            if ((error as { status?: number }).status !== 409) throw error;
            const now = (await sessions.requests(sessionId, { limit: RUNNING_TURNS })).find((request) => request.id === turn.id);
            if (now?.status === "in_progress") throw new Error("The turn went on before the stop reached it. Stop it again.");
          });
      }
      return turns.map((turn) => turn.id);
    },
    retryTurn: async (sessionId, requestId) => {
      await fsd.flow(await flowOfSession(sessionId)).request(requestId).retry();
    },
    hire: (input) => rosterWrite<{ id: string; flow: string }>("hire", input),
    fork: (from, id) => rosterWrite<{ id: string; flow: string }>("fork", { from, id }),
    edit: (input) => rosterWrite<{ id: string; flow: string }>("edit", input),
    fire: (id) => rosterWrite<{ id: string }>("fire", { id }),
    reset: (id) => rosterWrite<{ id: string }>("reset", { id })
  };
  return client;
}
