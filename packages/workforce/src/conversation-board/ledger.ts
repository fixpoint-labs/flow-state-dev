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
 * - **A notice** is a marker the ending's own write puts on the row: every
 *   ending written here goes through `recordEnding` (`./task-notice`), so the
 *   ending and the debt to tell the conversation land together or not at all.
 *   Only the notice's delivery clears it.
 * - **A start** is no marker at all: it is the row's own state. A row that is
 *   pending, assigned and claimable is owed a board run, so whatever wrote it
 *   that way (an add, an assign, a retry, an answered park) wrote the debt in
 *   that same write. The run that claims it pays it. Nothing can strand a
 *   start between two writes, because there is no second write.
 *
 * Both are sent on the board's next touch when the dispatch that should have
 * sent them was lost (`./board`).
 */
import type { BlockContext } from "@flow-state-dev/core/types";
import {
  defineTaskCollection,
  getOrCreateTaskCollection,
  hasFrozenLedgerAssignee,
  resolveResourceCollection,
  type TaskCollectionRef,
  type TaskPartitionContext
} from "@flow-state-dev/orchestration/tasks";
import { filingSessionIdOf } from "./filing-session";
import { recordEnding, withoutNoticeMarkers } from "./task-notice";

/**
 * The ledger's id: its resource key, and the board id its tasks are handed
 * over under. **Pinned**: the task actions are named for it (`addTask_tasks`).
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
 * The ledger's one declaration. Every flow that keeps a conversation's board,
 * or works its tasks, declares this object under {@link CONVERSATION_LEDGER_ID}.
 */
export const conversationLedger = defineTaskCollection({
  id: CONVERSATION_LEDGER_ID,
  scope: "user",
  partitionBy: conversationPartition,
  recordEnding
});

/** The flow resources that install the ledger. */
export const conversationLedgerResources = { [CONVERSATION_LEDGER_ID]: conversationLedger } as const;

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
 * or a patch can't forge an owed notice, or clear one.
 */
export function callerMetadata(
  metadata: Readonly<Record<string, unknown>> | undefined
): Record<string, unknown> | undefined {
  return withoutNoticeMarkers(metadata);
}
