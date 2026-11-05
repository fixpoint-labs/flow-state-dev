/**
 * The board-notice seam (FIX-2429): how a task board's change reaches the
 * change bus, so every open view of the board reads again.
 *
 * Orchestration calls {@link publishBoardChange} where every board change
 * already passes (the task collection's `onChange`), naming the session that
 * filed the row and the board. The engine attaches the seam to every block
 * context under {@link BOARD_NOTICE_SEAM}: it fills the tenant from the
 * running request, names that request as the notice's origin, and publishes a
 * `board` notice on that run's bus, on the session's topic narrowed to the
 * board. The notice carries no rows: a view reads the board through its own
 * checked read.
 *
 * Framework-facing, like the dispatch seam: a symbol key, not a public
 * `ctx.publish`, so app code can't invent a topic.
 */

/** What the engine's seam publishes: a board change, on a session's topic. */
export interface BoardChange {
  /** The bare session id whose board changed: the row's filer. */
  readonly sessionId: string;
  /** The board's id (the ledger's `collectionId`), which narrows the topic. */
  readonly board: string;
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
export function publishBoardChange(ctx: { readonly [BOARD_NOTICE_SEAM]?: BoardNoticeSeam }, change: BoardChange): boolean {
  const seam = ctx[BOARD_NOTICE_SEAM];
  if (seam == null) return false;
  seam.publish(change);
  return true;
}
