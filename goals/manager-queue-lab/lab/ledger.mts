/**
 * Resolve the channel's ledger from inside a running block.
 *
 * One helper, used by both kinds, because the alternative is the same four
 * lines in two files drifting apart. It is deliberately thin: the framework
 * already owns resolution, and this only names the failure when a flow holds
 * the board's handlers and not the board.
 *
 * **Every request reaching this carries an organization.** A channel board is
 * org-scoped storage, and organization identity is unconditional, so the org
 * resource registry is always built and the board always resolves. Nothing
 * needs declaring; the older `requireOrg` opt-in that this depended on is
 * gone.
 */

import type { BlockContext } from "@flow-state-dev/core/types";
import {
  getOrCreateTaskCollection,
  resolveResourceCollection,
  taskSchema,
  type Task,
  type TaskCollectionRef,
} from "@flow-state-dev/orchestration/tasks";

/**
 * The live ledger behind one minted board id.
 *
 * @param ctx     The running block's context.
 * @param boardId The minted `<channelId>.<boardName>` id.
 * @returns The substrate's collection ref — the same rows the channel's own
 *   actions and every seat's drain reach.
 * @throws When this flow does not declare the board, naming what it does hold.
 */
export async function ledgerOf(ctx: BlockContext, boardId: string): Promise<TaskCollectionRef> {
  const collection = resolveResourceCollection(ctx, boardId);
  if (collection === undefined) {
    throw new Error(
      `the "${boardId}" ledger is not registered on this flow. Installed: ` +
        `${Object.keys(ctx.resources).join(", ") || "(none)"}`,
    );
  }
  return getOrCreateTaskCollection({
    ctx,
    backing: "resource",
    collectionId: boardId,
    collection,
  });
}

/**
 * Every row on that ledger, whole — `claimedBy` and the lease included.
 *
 * Parsed through `taskSchema` rather than handed back raw, for the same reason
 * the channel's own `readBoard` parses: `list()` returns live **handles**, and
 * a handle carries an `items()` method that cannot cross an action's output
 * boundary. Parsing strips the method and leaves the row.
 *
 * `taskSchema`, not the channel's `channelBoardRowSchema`: that one is a
 * publication allowlist and deliberately drops `claimedBy` and `leaseUntil` —
 * the two fields the queue's running/queued split is computed from. This is a
 * lab's internal read, not a public projection.
 */
export async function rowsOf(ctx: BlockContext, boardId: string): Promise<Task[]> {
  const ledger = await ledgerOf(ctx, boardId);
  return ledger.list().map((task) => taskSchema.parse(task) as Task);
}
