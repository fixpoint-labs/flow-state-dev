/**
 * The value of the `task-board-meta` data item a task board writes at the
 * top and the end of each pass: its board, where the pass stands, and, at
 * the end, its rows counted by status. Typed here, beside the `task-change`
 * item's kinds, so a reader of the items a board writes takes both shapes
 * from the package that writes them.
 *
 * A type only: `task-board/blocks/board-meta.ts` writes it.
 */

/** A board's rows by status, as the end of a pass counts them, and the failure retries it granted. */
export type TaskBoardCounts = {
  total: number;
  pending: number;
  in_progress: number;
  held: number;
  completed: number;
  errored: number;
  cancelled: number;
  retries?: number;
};

/**
 * One `task-board-meta` item's value. `status` is `"active"` while a pass
 * runs and `"completed"` once it ends; a pattern over the board may write
 * its own words (`"planning"`). `counts`, `terminationReason` and
 * `maxTotalRetries` come with the end of a pass.
 */
export type TaskBoardMeta = {
  collectionId: string;
  status: string;
  counts?: TaskBoardCounts;
  terminationReason?: string;
  maxTotalRetries?: number | null;
};
