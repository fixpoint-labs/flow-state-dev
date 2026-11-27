// BR-8; FIX-2009.
/**
 * The run a task's entry names, and which of its session's items the task's
 * Session shows. The run's flow is the one its session records. The items are
 * the ones stamped
 * with this task's id, through the attribution helper the substrate and the
 * UI share, and the lines its composer sent. And the board's claims in the
 * session, read on their own, which teach that attribution which tasks are
 * the board's when the feed holds only the session's newest items.
 */
import { itemsForTask, type OutputItem } from "@flow-state-dev/core/items";
import type { Client } from "@flow-state-dev/client";

/**
 * The flow that owns the run's session `sessionId`: the one its stream and its
 * stop go through, as the session records it. A session that names no owner
 * is refused rather than guessed at.
 */
export async function resolveRunFlow(client: Pick<Client, "sessions">, sessionId: string): Promise<string> {
  const flowId = (await client.sessions.get(sessionId)).flowId ?? null;
  if (flowId === null || flowId.length === 0) throw new Error("The run's session names no owning flow, so there is nothing to open it through.");
  return flowId;
}

/** Items per session-state page. */
const ITEM_PAGE = 200;
/** Pages of data items {@link readTaskClaims} reads at most. */
const CLAIM_PAGES = 50;

/**
 * The board's `task-change` items for `collectionId` in the session, read on
 * their own. Which task ids belong to a board is learned from these, so a
 * feed that holds only the session's newest items (its first item comes after
 * the task was claimed) still attributes the task's newer steps to it.
 */
export async function readTaskClaims(client: Pick<Client, "sessions">, sessionId: string, collectionId: string): Promise<OutputItem[]> {
  const claims: OutputItem[] = [];
  for (let offset = 0, page = 0; page < CLAIM_PAGES; page += 1) {
    const state = await client.sessions.state(sessionId, { includeItems: true, itemTypes: ["data"], offset, limit: ITEM_PAGE });
    for (const item of state.items ?? []) {
      if (item.type === "data" && item.dataType === "task-change" && item.value.collectionId === collectionId) claims.push(item);
    }
    if (state.pagination?.hasMore !== true) break;
    offset = state.pagination.nextOffset ?? offset + ITEM_PAGE;
  }
  return claims;
}

/** An item's identity across reads: its request and its id. */
function itemKey(item: OutputItem): string {
  return `${item.requestId}\u0000${item.id}`;
}

/** No request sent from the screen. */
const NONE_SENT: ReadonlySet<string> = new Set();

/**
 * What the Session shows of a session's items: the items stamped with
 * this task's id, and whether the session also holds another task's work. A
 * request in `sent` shows too: a line the composer sent, whose door may keep
 * no task stamp.
 */
export function taskItems(
  items: readonly OutputItem[],
  boardRef: string,
  taskId: string,
  sent: ReadonlySet<string> = NONE_SENT,
): { items: OutputItem[]; shared: boolean } {
  const own = new Set(itemsForTask(items, boardRef, taskId).map(itemKey));
  return {
    items: items.filter((item) => own.has(itemKey(item)) || sent.has(item.requestId)),
    shared: items.some((item) => item.taskId !== undefined && item.taskId !== taskId),
  };
}
