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
 *   never from input (the view takes none);
 * - the caller's pending asks on those flows, every page of
 *   `sessions.userSuspensions`, heard on the user topic's `suspension` alone;
 * - the whole conversation ledger, every conversation's rows at once, heard on
 *   its resource notices, so a row written from any session re-runs it;
 * - one `sessions.read` per session an ask sits in or a board is held by, for
 *   its worker, its flow and its board owner's label, heard on that session's
 *   topic alone. Never `sessions.list`, which hears every turn on the user
 *   topic;
 * - orchestration's `inboxItems`, which groups the asks under their tasks.
 *
 * Which asks are listed, and whose they are, is the rule a browser applied
 * on each listed session before (a session's own worker on that worker's
 * flow, an unnamed worker on a worker flow, or a worker the inventory
 * registers). An ask in a session `sessions.read` doesn't answer (gone, or
 * not the caller's) is dropped, as are the rows of a conversation that is
 * gone. An ask from a run with no conversation is listed, attributed to no
 * worker.
 *
 * A read that fails fails the whole view, never a shorter list: a missing
 * ask would make the count wrong.
 *
 * The client's handle is `inboxViewRef` (`inbox-view-ref.ts`), which holds no block.
 */
import { defineView, handler, type ViewDefinition } from "@flow-state-dev/core";
import { requireRequestHost, type PeerSessionView, type RequestSessions } from "@flow-state-dev/core/internal";
import type { BlockContext, BlockDefinition, PendingUserSuspension } from "@flow-state-dev/core/types";
import { parseBlobRef } from "@flow-state-dev/core/attachments";
import type { FileContent } from "@flow-state-dev/core/items";
import { inboxItems, taskActionName, taskHoldSchema, taskView, type InboxItem, type TaskHold, type TaskViewInput } from "@flow-state-dev/orchestration/inbox";
import { taskSpendViewSchema, withRetiredShapes, type TaskSpendView } from "@flow-state-dev/orchestration/tasks";
import { resolveResourceCollection } from "@flow-state-dev/orchestration/tasks";
import { z } from "zod";
import { CONVERSATION_LEDGER_ID, conversationLedgerResources } from "../conversation-board/ledger";
import { filingSessionIdOf, sessionIdOfFiling } from "../conversation-board/filing-session";
import { defineWorkerInventoryCollection } from "../inventory/collections";
import type { WorkerInstallation } from "./installation";
import { WORKER_ID_STATE_KEY, WORKSTREAM_STATE_KEY } from "./keys";
import { readRosterEntries, rosterResources } from "./roster-view";

/** The most pages of pending asks one run reads: past it the view fails, never a shorter list. */
const ASK_PAGES_MAX = 50;

/**
 * The accessor the view reads the organization's worker inventory under, and
 * the one declaration the roster flow declares it with: a block and its flow
 * must name the same one.
 */
export const INVENTORY_RESOURCE = "inventoryWorkers";
export const inventoryWorkers = defineWorkerInventoryCollection();

/** An ask's detail: the projection the pending-asks read answers, and the worker that asked. */
export type InboxAsk = Omit<PendingUserSuspension, "sessionId"> & {
  /** The session the ask waits in; `null` for a run with no conversation. */
  readonly sessionId: string | null;
  /** The worker that asked, when its session names one; `null` otherwise, and for a run with no conversation. */
  readonly workerId: string | null;
};

const runLinkSchema = z.object({ sessionId: z.string(), requestId: z.string(), attempt: z.number() });

/** One board row, with the fields a browser reads of it, its board and its board owner's label. */
const boardTaskSchema = z.object({
  /** The board's ref: `<sessionId>.tasks`, the conversation that holds it and the collection. */
  boardRef: z.string(),
  /** The conversation that holds the board. */
  ownerSessionId: z.string(),
  /** What the board is called on a screen: the workstream the conversation leads, else `@<worker>`, else its id. */
  owner: z.string(),
  id: z.string(),
  /** Never absent: a row filed with none reads its goal here. */
  title: z.string(),
  goal: z.string().nullable(),
  context: z.string().nullable(),
  attachments: z.array(z.custom<FileContent>((value) => typeof value === "object" && value !== null)),
  status: z.string(),
  assignee: z.string().nullable(),
  priority: z.string().nullable(),
  labels: z.array(z.string()),
  deps: z.array(z.string()),
  /** The run the board linked to the row, or `null`. */
  run: runLinkSchema.nullable(),
  error: z.string().nullable(),
  holds: z.array(z.custom<TaskHold>((value) => typeof value === "object" && value !== null)),
  steers: z.array(z.object({ id: z.string(), answers: z.string().optional() })),
  spend: taskSpendViewSchema.nullable(),
  createdAt: z.number().nullable(),
  updatedAt: z.number().nullable(),
  startedAt: z.number().nullable(),
  completedAt: z.number().nullable()
});

const inboxViewSchema = z.object({
  /** What waits on the user, oldest first: one item per task that holds them, one per ask no task claims. */
  items: z.array(z.custom<InboxItem<InboxAsk>>((value) => typeof value === "object" && value !== null)),
  /** Every row on the user's conversation boards, in ledger order. */
  tasks: z.array(boardTaskSchema)
});

const inboxViewInputSchema = z.object({}).strict();

/** The inbox view, as {@link defineInboxView} builds it. Import as a type in client code. */
export type InboxView = ViewDefinition<BlockDefinition<typeof inboxViewInputSchema, typeof inboxViewSchema>, "user">;
/** What the inbox view answers. */
export type InboxViewValue = z.infer<typeof inboxViewSchema>;
/** One board row of the inbox view. */
export type InboxBoardTask = z.infer<typeof boardTaskSchema>;

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);
const time = (value: unknown): number | null => (typeof value === "number" ? value : null);
const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);

/** A row's run link: all three values, or none. */
function runLinkOf(value: unknown): z.infer<typeof runLinkSchema> | null {
  const parsed = runLinkSchema.safeParse(value);
  return parsed.success ? { sessionId: parsed.data.sessionId, requestId: parsed.data.requestId, attempt: parsed.data.attempt } : null;
}

/** A row's holds, each read against the hold's own shape: one that doesn't parse is none. */
function holdsOf(value: unknown): TaskHold[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((hold) => {
    const parsed = taskHoldSchema.safeParse(hold);
    return parsed.success ? [parsed.data] : [];
  });
}

/** A row's steers as the Inbox reads them: each one's id, and the question it answers. */
function steersOf(value: unknown): Array<{ id: string; answers?: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((steer) => {
    const id = text(field(steer, "id"));
    const answers = text(field(steer, "answers"));
    return id === null ? [] : [{ id, ...(answers !== null ? { answers } : {}) }];
  });
}

/** A row's brief files: each a file part whose `data` is a stored file's reference. */
function filesOf(value: unknown): FileContent[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): FileContent[] => {
    const file = entry as Partial<FileContent> | null;
    if (file?.type !== "file" || typeof file.mediaType !== "string" || typeof file.data !== "string") return [];
    if (parseBlobRef(file.data) === undefined) return [];
    return [{ type: "file", mediaType: file.mediaType, data: file.data, ...(typeof file.filename === "string" ? { filename: file.filename } : {}) }];
  });
}

/** A row's spend, folded by orchestration's task view; `null` when it has none. */
function spendOf(boardRef: string, data: unknown): TaskSpendView | null {
  const spend = field(data, "spend") as TaskViewInput["spend"];
  if (spend == null) return null;
  return taskView({ board: boardRef, id: text(field(data, "id")) ?? "", status: text(field(data, "status")) ?? "pending", spend }).spend;
}

/** A stored ledger row, as a browser reads it, on the board of conversation `owner`. */
function boardTaskOf(owner: string, ownerLabel: string, taskId: string, stored: unknown): InboxBoardTask {
  // A row stored `blocked` (orchestration 0.5.0 and earlier) reads as `held`.
  const data = withRetiredShapes(stored);
  const boardRef = `${owner}.${CONVERSATION_LEDGER_ID}`;
  return {
    boardRef,
    ownerSessionId: owner,
    owner: ownerLabel,
    id: text(field(data, "id")) ?? taskId,
    title: text(field(data, "title")) ?? text(field(data, "goal")) ?? taskId,
    goal: text(field(data, "goal")),
    context: text(field(data, "context")),
    attachments: filesOf(field(data, "attachments")),
    status: text(field(data, "status")) ?? "pending",
    assignee: text(field(data, "assignee")),
    priority: field(data, "priority") == null ? null : String(field(data, "priority")),
    labels: strings(field(data, "labels")),
    deps: strings(field(data, "deps")),
    run: runLinkOf(field(data, "run")),
    error: field(data, "error") == null ? null : String(field(data, "error")),
    holds: holdsOf(field(data, "holds")),
    steers: steersOf(field(data, "steers")),
    spend: spendOf(boardRef, data),
    createdAt: time(field(data, "createdAt")),
    updatedAt: time(field(data, "updatedAt")),
    startedAt: time(field(data, "startedAt")),
    completedAt: time(field(data, "completedAt"))
  };
}

/** The request host's session reads: a host that can't read session records refuses by name. */
function sessionsOf(ctx: BlockContext): RequestSessions {
  const sessions = requireRequestHost(ctx).sessions;
  if (sessions === undefined) throw new Error("This host can't read your sessions, so the Inbox can't answer here.");
  return sessions;
}

/** Every pending ask of the caller's on `flowKinds`, every page: past the ceiling the view fails, never a shorter list. */
async function everyPendingAsk(sessions: RequestSessions, flowKinds: readonly string[]): Promise<PendingUserSuspension[]> {
  const all: PendingUserSuspension[] = [];
  let page = await sessions.userSuspensions({ flowKinds });
  all.push(...page.suspensions);
  for (let read = 1; page.more; read += 1) {
    if (read >= ASK_PAGES_MAX) throw new Error(`The Inbox reads at most ${ASK_PAGES_MAX} pages of your pending asks, and more are waiting.`);
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
      resources: { ...rosterResources(installation), ...conversationLedgerResources, [INVENTORY_RESOURCE]: inventoryWorkers },
      execute: async (_input, ctx) => {
        const sessions = sessionsOf(ctx);
        const [inventory, roster] = await Promise.all([inventoryOf(ctx), readRosterEntries(ctx, installation)]);
        // The worker flows: the inventory's flows and the caller's own roster flows, read here, never from input.
        const ownWorkers = new Map(roster.filter((entry) => !entry.standard).map((entry) => [entry.id, entry.flow]));
        const workerIds = new Set(inventory.map((worker) => worker.id));
        const workerFlows = new Set(inventory.map((worker) => worker.kind));
        const flowKinds = [...new Set([...workerFlows, ...ownWorkers.values()])].sort();

        const ledger = resolveResourceCollection(ctx, CONVERSATION_LEDGER_ID);
        const [pending, stored] = await Promise.all([everyPendingAsk(sessions, flowKinds), ledger === undefined ? [] : ledger.list()]);

        // One read per session an ask sits in or a board is held by.
        const filed = stored.flatMap((entry) => {
          // `tasks/<partition segment>/<task id>`.
          const parts = entry.path.split("/");
          if (parts.length !== 3 || parts[0] !== CONVERSATION_LEDGER_ID) return [];
          const partition = decodeURIComponent(parts[1]!);
          return [{ partition, holder: sessionIdOfFiling(partition), taskId: parts[2]!, state: entry.state as unknown }];
        });
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
          .map((filing) => boardTaskOf(filing.holder, boardOwnerLabel(filing.holder, found.get(filing.holder)!), filing.taskId, filing.state));

        // Whose each ask is: today's rule on its session, or nobody's for a run with no conversation.
        const asks = pending.flatMap((entry): InboxAsk[] => {
          if (entry.sessionId === undefined) return [{ ...entry, sessionId: null, workerId: null }];
          const session = found.get(entry.sessionId);
          if (session === undefined) return [];
          const workerId = text(session.state[WORKER_ID_STATE_KEY]);
          const ask = (worker: string | null): InboxAsk[] => [{ ...entry, sessionId: entry.sessionId!, workerId: worker, ...(entry.flowId === undefined && session.flowId !== undefined ? { flowId: session.flowId } : {}) }];
          if (workerId !== null && ownWorkers.get(workerId) === session.flowKind) return ask(workerId);
          if (!workerFlows.has(session.flowKind)) return [];
          if (workerId === null) return ask(null);
          return workerIds.has(workerId) ? ask(workerId) : [];
        });

        const flows = new Map([...found].map(([id, session]) => [id, session.flowId ?? null]));
        const items = inboxItems<InboxAsk>({
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
