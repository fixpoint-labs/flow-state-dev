// FIX-2725.
/**
 * A user's sessions with a worker, and one session's turns, as views on the
 * roster flow at user scope: what a sidebar and a conversation's status read, kept
 * live by the server with no poll and no assembly in the app.
 *
 * Both read the caller's sessions through the request host (`sessions.list`,
 * `sessions.turns`, `sessions.read`), so the engine answers only sessions the
 * caller may read and records what each read hears: the list on the user
 * topic's `run`, a session's turns on its `request` and its delete (`state`), never `items`, which a
 * reply publishes once per streamed chunk. The words of a conversation stay on the
 * session stream (`sessionFeed`).
 *
 * The client's handles are `workerSessionsViewRef` and `sessionTurnsViewRef`
 * (`session-views-ref.ts`), which hold no block.
 */
import { defineView, handler, type ViewDefinition } from "@flow-state-dev/core";
import { requireRequestHost, type ListedSession, type RequestSessions, type SessionTurn } from "@flow-state-dev/core/internal";
import type { BlockContext, BlockDefinition } from "@flow-state-dev/core/types";
import { inboxItems } from "@flow-state-dev/orchestration/inbox";
import { z } from "zod";
import { conversationLedgerAt, conversationLedgerResources } from "../conversation-board/ledger";
import { filingSessionIdOf } from "../conversation-board/filing-session";
import { criteriaState, deriveWorkerSessionId, workerConversations } from "./derive-session-id";
import type { WorkerInstallation } from "./installation";
import { readRosterEntries, rosterResources } from "./roster-view";
import { TURN_ACTIONS } from "./turn-actions";

// FIX-2725 Q2.
/** What a session with no title yet shows. */
const UNTITLED_SESSION = "Untitled";

/** The most sessions the worker sessions view lists: `sessions.list`'s bound. */
const LISTED_MAX = 100;
/** The most pages of `sessions.list` one run reads looking for them (BP-042). */
const LISTED_PAGES_MAX = 10;

/**
 * The worker's sessions newest first, read a page at a time until
 * {@link LISTED_MAX} of them are conversations (`workerConversations`' rule)
 * or none are left, at most {@link LISTED_PAGES_MAX} pages. The store can't
 * filter on a field being absent, and a project's, a task's, a delegate's and
 * a lead's sessions carry the worker's id too, so newer ones of those must
 * not crowd out a conversation.
 */
async function conversationCandidates(
  sessions: RequestSessions,
  flow: string,
  criteria: { worker: string }
): Promise<ListedSession[]> {
  const read: ListedSession[] = [];
  let eligible = 0;
  for (let page = 0; page < LISTED_PAGES_MAX && eligible < LISTED_MAX; page += 1) {
    const listed = await sessions.list({ flowKind: flow, fields: criteriaState(criteria), limit: LISTED_MAX, offset: page * LISTED_MAX });
    read.push(...listed.sessions);
    eligible += workerConversations(listed.sessions, "").length;
    if (!listed.more) break;
  }
  return read;
}

/** A task of a session's board that waits on the user: by id and attempt, so an app can take away what it dismissed. */
const waitingSchema = z.object({ taskId: z.string(), attempt: z.number() });

/** One of a user's conversations with a worker, as the worker sessions view answers it. */
const listedWorkerSessionSchema = z.object({
  id: z.string(),
  /** Its title, or "Untitled" until one is set. */
  title: z.string(),
  worker: z.string(),
  /** When it last changed, in ms. */
  updatedAt: z.number(),
  /** Whether one of its turns is running now. */
  running: z.boolean(),
  /** Its readonly state fields. */
  fields: z.record(z.unknown()),
  /** The conversation `findWorkerSession({ worker })` returns. */
  isDefault: z.boolean(),
  /** Its board's tasks that wait on the user: a question, a review, or a failure to retry. */
  waiting: z.array(waitingSchema)
});

const workerSessionsSchema = z.array(listedWorkerSessionSchema);
const workerSessionsInputSchema = z.object({ worker: z.string().min(1) });

/** One turn of a session, as the session turns view answers it: its status, never its words. */
const sessionTurnSchema = z.object({
  id: z.string(),
  action: z.string(),
  status: z.string(),
  source: z.string(),
  startedAt: z.number(),
  completedAt: z.number().nullable(),
  error: z.object({ code: z.string(), message: z.string() }).nullable()
});

const sessionTurnsSchema = z.array(sessionTurnSchema);
const sessionTurnsInputSchema = z.object({ sessionId: z.string().min(1) });

/** The worker sessions view, as {@link defineWorkerSessionsView} builds it. Import as a type in client code. */
export type WorkerSessionsView = ViewDefinition<BlockDefinition<typeof workerSessionsInputSchema, typeof workerSessionsSchema>, "user">;
/** The session turns view, as {@link defineSessionTurnsView} builds it. Import as a type in client code. */
export type SessionTurnsView = ViewDefinition<BlockDefinition<typeof sessionTurnsInputSchema, typeof sessionTurnsSchema>, "user">;
/** One entry of the worker sessions view. */
export type ListedWorkerSession = z.infer<typeof listedWorkerSessionSchema>;
/** One entry of the session turns view. */
export type ListedTurn = z.infer<typeof sessionTurnSchema>;

/** The request host's session reads: a view on a host that can't read session records refuses by name. */
function sessionsOf(ctx: BlockContext): RequestSessions {
  const sessions = requireRequestHost(ctx).sessions;
  if (sessions === undefined) throw new Error("This host can't read your sessions, so these views can't answer here.");
  return sessions;
}

/**
 * The tasks of session `sessionId`'s board that wait on the user: a failed
 * one, and one with a hold open for the user (`inboxItems`' rule). Read from
 * the conversation ledger at the session's partition, heard on its board
 * notices, the session named in the running one's place.
 */
async function waitingTasksOf(ctx: BlockContext, sessionId: string, lineageId: string): Promise<Array<z.infer<typeof waitingSchema>>> {
  const ledger = await conversationLedgerAt(ctx, await filingSessionIdOf({ identity: { id: sessionId }, lineageId }), { readFor: sessionId });
  const tasks = ledger?.list() ?? [];
  const held = new Set(
    inboxItems({
      rows: tasks.map((task) => ({
        board: sessionId,
        id: task.id,
        title: task.title ?? null,
        status: task.status,
        run: task.run ?? null,
        holds: task.holds ?? [],
        steers: task.steers ?? []
      })),
      suspensions: [],
      // Only which tasks hold the user is read here, not where an answer goes.
      flowOf: () => null
    }).flatMap((item) => (item.task === null ? [] : [item.task.taskId]))
  );
  return tasks
    .filter((task) => task.status === "errored" || held.has(task.id))
    .map((task) => ({ taskId: task.id, attempt: task.attempts ?? 0 }));
}

/**
 * The worker sessions view: the user's top-level conversations with a
 * worker on its flow, the default first and marked, then by latest activity,
 * at most 100. A task's, a delegate's, a workstream lead's and a project
 * coordinator's session are left out (`workerConversations`, the workforce
 * client's own rule), read on page by page so newer ones of those never crowd
 * a conversation out (`conversationCandidates`). Per row: whether a turn runs in it, read in one batched
 * `turns` read across the listed sessions by the turn actions, so a newer
 * request of another action never hides a running reply; and the tasks of
 * its board that wait on the user. Install it in the roster flow's `views`.
 */
export function defineWorkerSessionsView(installation: WorkerInstallation): WorkerSessionsView {
  return defineView({
    scope: "user",
    key: (entry) => entry.id,
    block: handler({
      name: "workforce-worker-sessions",
      inputSchema: workerSessionsInputSchema,
      outputSchema: workerSessionsSchema,
      resources: { ...rosterResources(installation), ...conversationLedgerResources },
      execute: async (input, ctx) => {
        const sessions = sessionsOf(ctx);
        const roster = await readRosterEntries(ctx, installation);
        // The user's own worker first, since a hire can't take a standard id.
        const found = roster.find((entry) => entry.id === input.worker && !entry.standard) ?? roster.find((entry) => entry.id === input.worker);
        if (found === undefined) throw new Error(`No worker "${input.worker}" on your roster.`);
        const criteria = { worker: input.worker };
        // The user and organization the run was admitted as: the default is derived under them.
        const { userId, orgId } = ctx.request.identity;
        if (userId === undefined || orgId === undefined) throw new Error("The worker sessions view needs the user and organization it runs as.");
        const [defaultId, listed] = await Promise.all([
          deriveWorkerSessionId({ userId, orgId, flow: found.flow, criteria }),
          conversationCandidates(sessions, found.flow, criteria)
        ]);
        const conversations = workerConversations(listed, defaultId).slice(0, LISTED_MAX);
        const ids = conversations.map(({ session }) => session.id);
        const running: SessionTurn[] = ids.length === 0 ? [] : await sessions.turns(ids, { status: ["in_progress"], actions: [...TURN_ACTIONS] });
        const runningIn = new Set(running.map((turn) => turn.sessionId));
        return Promise.all(
          conversations.map(async ({ session, isDefault }) => ({
            id: session.id,
            title: session.title ?? UNTITLED_SESSION,
            worker: input.worker,
            updatedAt: session.updatedAt,
            running: runningIn.has(session.id),
            fields: { ...session.state },
            isDefault,
            waiting: await waitingTasksOf(ctx, session.id, session.lineageId)
          }))
        );
      }
    })
  });
}

/**
 * The session turns view: a session's turns, oldest first, each its status,
 * times, source and error, never its words (those stay on the session
 * stream). A turn is a request of one of the turn actions (`TURN_ACTIONS`),
 * at most the 50 newest requests of the session. A session the caller may not
 * read answers nothing. Install it in the roster flow's `views`.
 */
export function defineSessionTurnsView(): SessionTurnsView {
  return defineView({
    scope: "user",
    key: (entry) => entry.id,
    block: handler({
      name: "workforce-session-turns",
      inputSchema: sessionTurnsInputSchema,
      outputSchema: sessionTurnsSchema,
      execute: async (input, ctx) => {
        const turns = (await sessionsOf(ctx).turns(input.sessionId, { actions: [...TURN_ACTIONS] })) ?? [];
        return [...turns].reverse().map((turn) => ({
          id: turn.id,
          action: turn.action,
          status: turn.status,
          source: turn.source,
          startedAt: turn.startedAtMs,
          completedAt: turn.completedAtMs ?? null,
          error: turn.error ?? null
        }));
      }
    })
  });
}
