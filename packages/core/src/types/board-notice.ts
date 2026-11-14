/**
 * The board-notice seam: how a task board's change reaches the
 * change bus, so every open view of the board reads again.
 *
 * Orchestration calls {@link publishBoardChange} where every board change
 * already passes (the task collection's `onChange`), naming the session that
 * filed the row and the board. The engine attaches the seam to every block
 * context under {@link BOARD_NOTICE_SEAM}: it fills the tenant from the
 * running request, names that request as the notice's origin, and publishes a
 * `board` notice on that run's bus, on the session's topic narrowed to the
 * board. The notice carries no rows, only the changed task's id: a view reads
 * the board through its own checked read.
 *
 * Its read half: where the task collection is built, in a view's run, it
 * calls {@link recordBoardRead}, and the engine's seam under
 * {@link BOARD_READ_SEAM} records the board as what the view heard, in place
 * of its ledger. The same place wires every write to the notice, so a
 * watcher of the board misses no change by hearing only the board.
 *
 * Framework-facing, like the dispatch seam: a symbol key, not a public
 * `ctx.publish`, so app code can't invent a topic.
 */
import type { InternalBlockContext } from "./block";

/** What the engine's seam publishes: a board change, on a session's topic. */
export interface BoardChange {
  /** The bare session id whose board changed: the row's filer. */
  readonly sessionId: string;
  /** The board's id (the ledger's `collectionId`), which narrows the topic. */
  readonly board: string;
  // FIX-2625.
  /** The task whose row changed: the notice's id. */
  readonly taskId: string;
}

/** The seam the engine attaches under {@link BOARD_NOTICE_SEAM}. */
export interface BoardNoticeSeam {
  /** Publish a `board` notice for `change`. Never throws; a failed publish costs a view its wake. */
  publish(change: BoardChange): void;
}

/** The context slot the engine attaches its board-notice seam under. */
export const BOARD_NOTICE_SEAM: unique symbol = Symbol.for("@flow-state-dev/board-notice-seam");

/**
 * Tell the open views of `change.board` on `change.sessionId` that it changed.
 *
 * @returns `false` when the context carries no seam (a hand-built test
 *   context): nothing is published.
 */
export function publishBoardChange(ctx: object, change: BoardChange): boolean {
  const seam = (ctx as Pick<InternalBlockContext, typeof BOARD_NOTICE_SEAM>)[BOARD_NOTICE_SEAM];
  if (seam == null) return false;
  seam.publish(change);
  return true;
}

// FIX-2625.
/**
 * A task board read through its task collection, as a view's run records it:
 * the board, the sessions whose topic its board notices go to, and the ledger
 * handle the entries were read through. A watcher of the view then hears the
 * board's notices on those sessions, which name the tasks that changed, and
 * not the ledger's own resource notices, which can't.
 */
export interface BoardRead {
  /** The board's id (the ledger's `collectionId`), as its notices narrow their topic. */
  readonly board: string;
  /** The bare session ids its board notices go to: each entry's filer, and the running session. */
  readonly sessionIds: readonly string[];
  /** The ledger's resource collection handle, as `ctx.resources` handed it out. */
  readonly ledger: object;
}

/** The seam a view's run attaches under {@link BOARD_READ_SEAM}. */
export interface BoardReadSeam {
  /** Record `read` as a dependency of the view's run. */
  record(read: BoardRead): void;
}

/** The context slot a view's run attaches its board-read seam under. Absent outside a view. */
export const BOARD_READ_SEAM: unique symbol = Symbol.for("@flow-state-dev/board-read-seam");

/**
 * Record that a view's run read `read.board` through its task collection.
 * Called only where every write to the ledger publishes its board notice, so
 * the board's notices are all a watcher needs to hear.
 *
 * @returns `false` outside a view's run: nothing is recorded.
 */
export function recordBoardRead(ctx: object, read: BoardRead): boolean {
  const seam = (ctx as Pick<InternalBlockContext, typeof BOARD_READ_SEAM>)[BOARD_READ_SEAM];
  if (seam == null) return false;
  seam.record(read);
  return true;
}
