/**
 * The internal entries a session's board runs on, by name: a leaf module, so
 * the board, the ledger and the filing kit share one spelling without
 * importing each other.
 */

/** The internal entry a filing dispatches to run its session's board: the board's one pass. */
export const RUN_BOARD_ENTRY = "runTaskBoard";

/**
 * The internal entry that checks a task session's waiting task, and does
 * nothing else (FIX-2077): what the upgrade's backfill wakes for a split an
 * older host parked, which may have no notice left to wake it. **Pinned**:
 * a wake stores it by name.
 */
export const CHECK_TASK_ENTRY = "checkWaitingTask";

/**
 * The internal entry that runs the turn a steer no request took is owed, in
 * the task's own session (FIX-2086 D2): what the claim gate's check starts,
 * and what its wake runs. **Pinned**: a wake stores it by name.
 */
export const STEER_TURN_ENTRY = "onTaskSteered";

/**
 * The internal entry a task's notice arrives on in the session that filed it.
 * **Pinned** (FIX-1780): a goal check reads notices by it. Orchestration's
 * `onTaskSettled` (FIX-2078).
 */
export const TASK_SETTLED_ENTRY = "onTaskSettled";

/**
 * The metadata key a split row parked on its pieces carried (FIX-1802 S4).
 * Retired by FIX-2077, which no longer parks a split: a row stored with it
 * reads as running (orchestration's retired-shape map), and a caller's filing
 * or patch still never writes it, so no row can be made to look like one.
 */
export const SPLIT_MARKER = "splitInto";

/**
 * The metadata key a piece carries: the task it is a piece of, on the board
 * above (FIX-1802 S4). A task session can run more than one task, one at a
 * time (a task and its follow-ups), so a piece names its own. Only the board
 * writes it; a caller's filing or patch never reaches it.
 */
export const PIECE_OF = "pieceOf";

/**
 * The metadata key a retried piece carried (FIX-1802 D3). Retired by FIX-2077:
 * the turn a piece's failure wakes decides what it means, so nothing writes
 * it. A caller's filing or patch still never reaches it.
 */
export const RETRY_OF = "retryOf";

/**
 * The metadata key on a task's row naming the session that filed work for it
 * and that session's flow (FIX-2080): where the filed half of its cascade is
 * sent. Server-written by the first piece's filing (`./cascade`).
 */
export const FILED_MARKER = "filedFrom";

/**
 * The metadata key on a task's row holding the worker-message hop count and
 * chain of the turn that filed it (FIX-2106): the task's turn starts there,
 * so a message from it counts on in its filer's exchange whichever session
 * it runs in. Server-written by the filing, and cleared (`null`) by the claim
 * once a user's line has ended its chain; a caller's filing or patch never
 * reaches it. **Absent** on a row filed before rows carried it, whose turn
 * reads its session's count, as before (BP-030).
 */
export const FILED_HOP = "filedAtHop";
