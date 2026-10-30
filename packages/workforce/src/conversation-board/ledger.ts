/**
 * The ledger a conversation's task board keeps its rows in (FIX-1794 S3).
 *
 * One durable collection for every conversation, at the owner's user scope,
 * which crosses flows, so a task session on another flow reads and settles the
 * row it was handed. Each conversation reaches only its own partition: the
 * conversation's `filingSessionId`, its id plus the incarnation the server
 * minted when it was created (FIX-1791's value, epic D6). A conversation
 * deleted and created again under the same id starts with an empty board; the
 * old rows stay in the store, unread.
 *
 * ## What a row owes, and how durably
 *
 * - **A notice** is a marker the ending's own write puts on the row:
 *   orchestration records it for every row a board hands out, so the ending
 *   and the debt to tell its filer land together or not at all, and delivers
 *   it (`./delivery`). Only the filer's delivery clears it (FIX-2078).
 * - **A report** the Error Reporter is owed for a task that failed for good
 *   rides that notice (`./report-owed`): no marker of its own.
 * - **A start** is no marker at all: it is the row's own state. A row that is
 *   pending, assigned and claimable is owed a board run, so whatever wrote it
 *   that way (an add, an assign, a retry, an answered park) wrote the debt in
 *   that same write. The run that claims it pays it. Nothing can strand a
 *   start between two writes, because there is no second write.
 *
 * - **A cascade** a task's ending owes (FIX-2080 D2): its open dependents on
 *   this board, and the open tasks its session filed (`./cascade`), recorded
 *   by orchestration in the ending's own write and paid by the ending's own
 *   pass, or by the board's next touch once past due.
 *
 * Each is a debt with a due time: the ending's writer owes the filer's wake
 * first, and the filer's pass pays what its fast path missed (`./board`).
 */
import type { BlockContext } from "@flow-state-dev/core/types";
import {
  defineTaskCollection,
  getOrCreateTaskCollection,
  hasFrozenLedgerAssignee,
  resolveResourceCollection,
  type TaskCollectionRef,
  type TaskPartitionContext,
  type TaskSettingsSupport,
  taskLedgerResources,
  withoutNoticeMarkers
} from "@flow-state-dev/orchestration/tasks";
import { FILED_HOP, FILED_MARKER, FILED_PROJECT, PIECE_OF, SPLIT_MARKER } from "./board-entries";
import { filedCascadeOver } from "./cascade";
import { filingSessionIdOf } from "./filing-session";
import { withoutReportMarkers } from "./report-owed";
import { conversationDelivery } from "./delivery";

/**
 * The ledger's id: its resource key, and the board id its tasks are handed
 * over under. **Pinned**: the task actions are named for it (`updateTask_tasks`).
 */
export const CONVERSATION_LEDGER_ID = "tasks";

/**
 * The partition a running session's board reads and writes: its
 * `filingSessionId`, from the session's id and the lineage id the server
 * minted at its birth. Never from input.
 */
export function conversationPartition(view: TaskPartitionContext): Promise<string> {
  return filingSessionIdOf({
    identity: { id: view.sessionId },
    ...(view.lineageId !== undefined ? { lineageId: view.lineageId } : {})
  });
}

/**
 * The fields of a row a browser reads: what a task screen or a board column
 * draws, and nothing a run keeps for itself (its input, output, metadata and
 * write log stay on the server, BP-015). What holds a row for the user is
 * `holds`, with the `steers` that answer its questions (FIX-2133): the one
 * thing that says what waits on the user.
 */
export const CONVERSATION_BOARD_CLIENT_FIELDS = [
  "id",
  "title",
  "goal",
  "status",
  "assignee",
  "run",
  "priority",
  "attempts",
  "maxAttempts",
  "deps",
  "labels",
  "error",
  "feedback",
  // What holds a task for the user (FIX-2133): the Inbox lists the task's item from its open holds,
  // and a question is open while no steer carries its id.
  "questions",
  "steers",
  "createdAt",
  "updatedAt",
  "startedAt",
  "completedAt"
] as const;

/**
 * The ledger's one declaration. Every flow that keeps a conversation's board,
 * or works its tasks, declares this object under {@link CONVERSATION_LEDGER_ID}.
 *
 * A browser may read it: the rows sit at the user's own user scope, so a
 * read through any of their sessions answers their own boards and nobody
 * else's, every conversation's at once, each row keyed under its
 * conversation's partition. That is how an app lists the tasks its user's
 * conversations filed, and what a task screen reads.
 */
/**
 * The settings a conversation's board honours (FIX-2080): a task can run in the
 * delegate's ongoing session for the conversation, and send its result to the
 * conversation. The board's guarded add takes both only from a conversation.
 */
export const CONVERSATION_BOARD_SETTINGS = {
  session: ["new", "ongoing"],
  resultTo: ["filer", "conversation"]
} as const satisfies TaskSettingsSupport;

export const conversationLedger = Object.assign(
  defineTaskCollection({
    id: CONVERSATION_LEDGER_ID,
    scope: "user",
    partitionBy: conversationPartition,
    // Each ending reaches the session that filed it (FIX-2078): orchestration
    // records the notice in the ending's write and delivers it.
    delivery: conversationDelivery(CONVERSATION_LEDGER_ID),
    settings: CONVERSATION_BOARD_SETTINGS,
    // The tasks a task's session filed are cancelled with its failure, retry
    // or cancel (FIX-2080 D2).
    cascadeFiled: filedCascadeOver(conversationLedgerAt)
  }),
  { client: { state: { read: true }, expose: CONVERSATION_BOARD_CLIENT_FIELDS } }
);

/** The flow resources that install the ledger, with the id index a `{ task }` message finds its row by (FIX-2160). */
export const conversationLedgerResources = taskLedgerResources(conversationLedger);

/**
 * The ledger at `partition`, as the running user's scope holds it, or
 * `undefined` when the running flow doesn't declare it.
 */
export async function conversationLedgerAt(
  ctx: BlockContext,
  partition: string
): Promise<TaskCollectionRef | undefined> {
  const collection = resolveResourceCollection(ctx, CONVERSATION_LEDGER_ID);
  if (collection === undefined) return undefined;
  return getOrCreateTaskCollection({
    ctx,
    backing: "resource",
    collectionId: CONVERSATION_LEDGER_ID,
    collection,
    partition,
    immutableAssignee: hasFrozenLedgerAssignee(conversationLedger)
  });
}

/** The running session's own board: the ledger at its own partition. */
export async function ownConversationLedger(ctx: BlockContext): Promise<TaskCollectionRef | undefined> {
  return conversationLedgerAt(ctx, await filingSessionIdOf(ctx.session));
}

/**
 * Metadata a caller hands in, without any marker this board keeps: a filing
 * or a patch can't forge an owed notice or an owed report, or clear one, or
 * make a row a piece of a task, or point a row at a
 * session as its split (FIX-1802 S4) or as the session that filed its work
 * (FIX-2080), or set the hop count its turn starts at (FIX-2106), or the
 * project it was filed in (FIX-2161).
 */
export function callerMetadata(
  metadata: Readonly<Record<string, unknown>> | undefined
): Record<string, unknown> | undefined {
  const unmarked = withoutNoticeMarkers(metadata);
  if (unmarked === undefined) return unmarked;
  const kept = withoutReportMarkers(unmarked);
  const { [SPLIT_MARKER]: _split, [PIECE_OF]: _piece, [FILED_MARKER]: _filed, [FILED_HOP]: _hop, [FILED_PROJECT]: _project, ...rest } = kept;
  return rest;
}
