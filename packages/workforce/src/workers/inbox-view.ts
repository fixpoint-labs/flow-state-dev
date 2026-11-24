// FIX-2774 D1.
/**
 * What waits on one user across their sessions, and every board row, as one
 * user view on the roster flow: an app's Inbox, its count, its Tasks board
 * and a task's asks all read this one answer, so a count and its list never
 * disagree.
 *
 * It composes pieces that exist, on the server:
 *
 * - the worker flows, read off the inventory and the caller's own roster,
 *   never from input;
 * - the caller's pending asks on those flows, every page of
 *   `sessions.userSuspensions`, heard on the user topic's `suspension` alone;
 * - the whole conversation ledger, every conversation's tasks at once, heard on
 *   its resource notices, so a task written from any session re-runs it. A
 *   finished task (completed or cancelled) is dropped before anything else is
 *   read for it, unless the input asks for `done` ones (Jump to, while open);
 * - one `sessions.read` per session a suspension sits in or a kept task's board
 *   is held by, each once, for its worker, its flow and its board owner's
 *   label, heard on that session's topic alone. Never `sessions.list`, which
 *   hears every turn on the user topic;
 * - orchestration's `inboxItems`, which groups the asks under their tasks.
 *
 * Which asks are listed, and whose they are, is the rule a browser applied
 * on each listed session before (a session's own worker on that worker's
 * flow, an unnamed worker on a worker flow, or a worker the inventory
 * registers). A suspension in a session `sessions.read` doesn't answer (gone, or
 * not the caller's) is dropped, as are the rows of a conversation that is
 * gone. A suspension from a run with no conversation is listed, attributed to no
 * worker.
 *
 * A read that fails fails the whole view, never a shorter list: a missing
 * ask would make the count wrong.
 *
 * The client's handle is `inboxViewRef` (`inbox-view-ref.ts`), which holds no block.
 */
import { defineView, handler, type ViewDefinition } from "@flow-state-dev/core";
import { isOneOffSessionId } from "@flow-state-dev/core/helpers";
import { requireRequestHost, type PeerSessionView, type RequestSessions } from "@flow-state-dev/core/internal";
import type { BlockContext, BlockDefinition, PendingUserSuspension } from "@flow-state-dev/core/types";
import { inboxItems, taskActionName, type InboxItem } from "@flow-state-dev/orchestration/inbox";
import { resolveResourceCollection } from "@flow-state-dev/orchestration/tasks";
import { z } from "zod";
import { boardTaskOf, boardTaskSchema, isFinished } from "../conversation-board/board-task";
import { CONVERSATION_LEDGER_ID, conversationLedgerResources } from "../conversation-board/ledger";
import { filingSessionIdOf, sessionIdOfFiling } from "../conversation-board/filing-session";
import { INVENTORY_RESOURCE, inventoryWorkerEntries } from "../inventory/inventory-resource";
import type { WorkerInstallation } from "./installation";
import { WORKER_ID_STATE_KEY, WORKSTREAM_STATE_KEY } from "./keys";
import { readRosterEntries, rosterResources } from "./roster-view";

/**
 * The most pages of pending suspensions one run reads: past it the view fails,
 * never a shorter list. A page is 200, so this is 10,000 waiting at once; it
 * bounds what each re-run reads.
 */
const SUSPENSION_PAGES_MAX = 50;

/** A suspension's detail: the projection the pending-suspensions read answers, and the worker whose run it is. */
export type InboxSuspensionDetail = Omit<PendingUserSuspension, "sessionId"> & {
  /** The session the suspension waits in; `null` for a run with no conversation. */
  readonly sessionId: string | null;
  /** The worker that asked, when its session names one; `null` otherwise, and for a run with no conversation. */
  readonly workerId: string | null;
};

/** One board task of the inbox view: the shared board task, and what its board is called. */
const inboxBoardTaskSchema = boardTaskSchema.extend({
  /** What the board is called on a screen: the workstream the conversation leads, else `@<worker>`, else its id. */
  owner: z.string()
});

const inboxViewSchema = z.object({
  /** What waits on the user, oldest first: one item per task that holds them, one per suspension no task claims. */
  items: z.array(z.custom<InboxItem<InboxSuspensionDetail>>((value) => typeof value === "object" && value !== null)),
  /** The tasks on the user's conversation boards, in ledger order: open ones, and finished ones too when `done` asks. */
  tasks: z.array(inboxBoardTaskSchema)
});

const inboxViewInputSchema = z
  .object({
    /** Answer finished tasks too (completed or cancelled). Off by default: only Jump to lists them. */
    done: z.boolean().optional()
  })
  .strict();

/** The inbox view, as {@link defineInboxView} builds it. Import as a type in client code. */
export type InboxView = ViewDefinition<BlockDefinition<typeof inboxViewInputSchema, typeof inboxViewSchema>, "user">;
/** What the inbox view answers. */
export type InboxViewValue = z.infer<typeof inboxViewSchema>;
/** One board task of the inbox view. */
export type InboxBoardTask = z.infer<typeof inboxBoardTaskSchema>;

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);
const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;

/** The request host's session reads: a host that can't read session records refuses by name. */
function sessionsOf(ctx: BlockContext): RequestSessions {
  const sessions = requireRequestHost(ctx).sessions;
  if (sessions === undefined) throw new Error("This host can't read your sessions, so the Inbox can't answer here.");
  return sessions;
}

/** Every pending ask of the caller's on `flowKinds`, every page: past the ceiling the view fails, never a shorter list. */
async function everyPendingSuspension(sessions: RequestSessions, flowKinds: readonly string[]): Promise<PendingUserSuspension[]> {
  const all: PendingUserSuspension[] = [];
  let page = await sessions.userSuspensions({ flowKinds });
  all.push(...page.suspensions);
  for (let read = 1; page.more; read += 1) {
    if (read >= SUSPENSION_PAGES_MAX) {
      throw new Error(
        `More than ${SUSPENSION_PAGES_MAX} pages of questions and approvals are waiting on you, more than the Inbox lists at once. ` +
          "Answer or cancel some in their conversations, then press Retry."
      );
    }
    page = await sessions.userSuspensions({ flowKinds, ...(page.next !== undefined ? { after: page.next } : {}) });
    all.push(...page.suspensions);
  }
  return all;
}

/** The org's worker inventory rows: each worker's id and the worker flow it runs on. */
async function inventoryOf(ctx: BlockContext): Promise<Array<{ id: string; kind: string }>> {
  const collection = (ctx.resources as unknown as Record<string, { list(): Promise<Array<{ state: unknown }>> } | undefined>)[INVENTORY_RESOURCE];
  if (collection === undefined) return [];
  return (await collection.list()).flatMap((entry) => {
    const id = text(field(entry.state, "id"));
    const kind = text(field(entry.state, "kind"));
    return id === null || kind === null ? [] : [{ id, kind }];
  });
}

/** What a board is called on a screen: the workstream its conversation leads, else `@<worker>`, else the conversation's id. */
function boardOwnerLabel(sessionId: string, session: PeerSessionView): string {
  const workstream = text(session.state[WORKSTREAM_STATE_KEY]);
  if (workstream !== null) return workstream;
  const worker = text(session.state[WORKER_ID_STATE_KEY]);
  return worker === null ? sessionId : `@${worker}`;
}

/**
 * The inbox view over `installation`'s roster, the worker inventory and the
 * conversation ledger. Install it in the roster flow's `views`.
 */
export function defineInboxView(installation: WorkerInstallation): InboxView {
  return defineView({
    scope: "user",
    block: handler({
      name: "workforce-inbox",
      inputSchema: inboxViewInputSchema,
      outputSchema: inboxViewSchema,
      resources: { ...rosterResources(installation), ...conversationLedgerResources, [INVENTORY_RESOURCE]: inventoryWorkerEntries },
      execute: async (input, ctx) => {
        const sessions = sessionsOf(ctx);
        const [inventory, roster] = await Promise.all([inventoryOf(ctx), readRosterEntries(ctx, installation)]);
        // The worker flows: the inventory's flows and the caller's own roster flows, read here, never from input.
        const ownWorkers = new Map(roster.filter((entry) => !entry.standard).map((entry) => [entry.id, entry.flow]));
        const workerIds = new Set(inventory.map((worker) => worker.id));
        const workerFlows = new Set(inventory.map((worker) => worker.kind));
        const flowKinds = [...new Set([...workerFlows, ...ownWorkers.values()])].sort();

        const ledger = resolveResourceCollection(ctx, CONVERSATION_LEDGER_ID);
        const [pending, stored] = await Promise.all([everyPendingSuspension(sessions, flowKinds), ledger === undefined ? [] : ledger.list()]);

        // Each stored task, mapped once; a finished one is dropped here unless asked for, before any session is read for it.
        const filed = stored.flatMap((entry) => {
          // `tasks/<partition segment>/<task id>`.
          const parts = entry.path.split("/");
          if (parts.length !== 3 || parts[0] !== CONVERSATION_LEDGER_ID) return [];
          const partition = decodeURIComponent(parts[1]!);
          const holder = sessionIdOfFiling(partition);
          const task = boardTaskOf(`${holder}.${CONVERSATION_LEDGER_ID}`, holder, parts[2]!, entry.state);
          return input.done === true || !isFinished(task.status) ? [{ partition, holder, task }] : [];
        });
        // One read per session a suspension sits in or a kept task's board is held by.
        const ids = [...new Set([...pending.flatMap((ask) => (ask.sessionId === undefined ? [] : [ask.sessionId])), ...filed.map((filing) => filing.holder)])];
        const read = await Promise.all(ids.map((id) => sessions.read(id)));
        const found = new Map<string, PeerSessionView>();
        ids.forEach((id, at) => {
          if (read[at] !== undefined) found.set(id, read[at]!);
        });

        // A conversation's rows: its current incarnation's partition only, and none once it is gone.
        const partitions = new Map<string, string>();
        await Promise.all(
          [...new Set(filed.map((filing) => filing.holder))].map(async (holder) => {
            const session = found.get(holder);
            if (session !== undefined) partitions.set(holder, await filingSessionIdOf({ identity: { id: holder }, lineageId: session.lineageId }));
          })
        );
        const tasks = filed
          .filter((filing) => partitions.get(filing.holder) === filing.partition)
          .map((filing) => ({ ...filing.task, owner: boardOwnerLabel(filing.holder, found.get(filing.holder)!) }));

        // Whose each suspension is: today's rule on its session, or nobody's for a run with no
        // conversation: one recorded with no session, or one in a one-off session (a server run,
        // a webhook delivery, a per-fire schedule fire), which nobody converses in.
        const asks = pending.flatMap((entry): InboxSuspensionDetail[] => {
          if (entry.sessionId === undefined || isOneOffSessionId(entry.sessionId)) return [{ ...entry, sessionId: null, workerId: null }];
          const session = found.get(entry.sessionId);
          if (session === undefined) return [];
          const workerId = text(session.state[WORKER_ID_STATE_KEY]);
          const ask = (worker: string | null): InboxSuspensionDetail[] => [{ ...entry, sessionId: entry.sessionId!, workerId: worker, ...(entry.flowId === undefined && session.flowId !== undefined ? { flowId: session.flowId } : {}) }];
          if (workerId !== null && ownWorkers.get(workerId) === session.flowKind) return ask(workerId);
          if (!workerFlows.has(session.flowKind)) return [];
          if (workerId === null) return ask(null);
          return workerIds.has(workerId) ? ask(workerId) : [];
        });

        const flows = new Map([...found].map(([id, session]) => [id, session.flowId ?? null]));
        const items = inboxItems<InboxSuspensionDetail>({
          rows: tasks.map((task) => ({
            ...task,
            board: task.boardRef,
            holder: { sessionId: task.ownerSessionId, action: taskActionName("updateTask", CONVERSATION_LEDGER_ID) }
          })),
          suspensions: asks.map((ask) => ({
            sessionId: ask.sessionId,
            flowId: ask.flowId ?? null,
            requestId: ask.requestId,
            suspensionId: ask.suspensionId,
            kind: ask.kind,
            prompt: ask.message,
            ...(ask.title !== undefined ? { title: ask.title } : {}),
            since: ask.createdAt,
            ...(ask.expiresAt !== undefined ? { due: ask.expiresAt } : {}),
            detail: ask
          })),
          flowOf: (sessionId) => flows.get(sessionId)
        });
        return { items, tasks };
      }
    })
  });
}
