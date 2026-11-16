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
 * A row added to the board also goes out on the board's own scope topic
 * ({@link publishBoardInsert}): the engine reads the ledger's scope off the
 * handle it handed out, so a view hears a row filed from a session it never
 * named, and no notice names a filer's session to anyone but that session.
 * On a partitioned ledger the insert and the read both name the partition, so
 * a view of one partition skips a row added to another; a browser sees the
 * partition only as an opaque key.
 *
 * Its read half: where the task collection is built, in a view's run, it
 * calls {@link recordBoardRead}, and the engine's seam under
 * {@link BOARD_READ_SEAM} records the board as what the view heard, as the
 * ledger's scope allows: a session or user ledger in place of the ledger, an
 * org ledger beside it, with no filer's session. The same place wires every
 * write to the notice, so a watcher of the board misses no change.
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

// FIX-2625.
/**
 * A row added to a board, as the engine's seam publishes it: on the board's
 * own scope topic (its ledger's session, user or org), so a view of the board
 * hears a row filed from a session it never named. Names no session.
 */
export interface BoardInsert {
  /** The board's id (the ledger's `collectionId`), which narrows the topic. */
  readonly board: string;
  /** The task added: the notice's id where its scope's topic may carry one. */
  readonly taskId: string;
  /** The ledger's resource collection handle, as `ctx.resources` handed it out: the engine reads its scope off it. */
  readonly ledger: object;
  // FIX-2750.
  /**
   * The ledger partition the row was added to, on a partitioned ledger. The
   * notice names it only as an opaque key, so a view of another partition
   * skips it.
   */
  readonly partition?: string;
}

/** The seam the engine attaches under {@link BOARD_NOTICE_SEAM}. */
export interface BoardNoticeSeam {
  /** Publish a `board` notice for `change`. Never throws; a failed publish costs a view its wake. */
  publish(change: BoardChange): void;
  /**
   * Publish a `board` notice for `insert` on its ledger's scope topic. A
   * ledger handle this context didn't hand out publishes nothing. Never throws.
   */
  publishInsert(insert: BoardInsert): void;
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
 * Tell every open view of `insert.board` that a row was added: on the board's
 * scope topic, which every viewer of the board may hear, never a filer's
 * session.
 *
 * @returns `false` when the context carries no seam (a hand-built test
 *   context): nothing is published.
 */
export function publishBoardInsert(ctx: object, insert: BoardInsert): boolean {
  const seam = (ctx as Pick<InternalBlockContext, typeof BOARD_NOTICE_SEAM>)[BOARD_NOTICE_SEAM];
  if (seam == null) return false;
  seam.publishInsert(insert);
  return true;
}

// FIX-2625.
/**
 * A task board read through its task collection, as a view's run records it:
 * the board, the sessions whose topic its board notices go to, and the ledger
 * handle the entries were read through. A watcher of the view then hears the
 * board's notices on its ledger's scope topic and, on a session or user
 * ledger, on those sessions, which name the tasks that changed, and not the
 * ledger's own resource notices, which can't. On an org ledger it hears no
 * session, and the ledger's own notices on the org topic.
 */
export interface BoardRead {
  /** The board's id (the ledger's `collectionId`), as its notices narrow their topic. */
  readonly board: string;
  /**
   * The bare session ids its board notices go to: each entry's filer, and the
   * running session. Heard on a session or user ledger only: on an org
   * ledger a filer is another member's session, so the engine names none.
   */
  readonly sessionIds: readonly string[];
  /** The ledger's resource collection handle, as `ctx.resources` handed it out. */
  readonly ledger: object;
  // FIX-2750.
  /**
   * The partition read, on a partitioned ledger: the view hears the rows
   * added to it ({@link BoardInsert.partition}), and no other partition's.
   * Absent: the ledger was read whole.
   */
  readonly partition?: string;
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
