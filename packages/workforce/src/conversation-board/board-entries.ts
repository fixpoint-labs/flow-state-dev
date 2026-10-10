/**
 * The internal entries a session's board runs on, by name: a leaf module, so
 * the board, the split and the filing kit share one spelling without
 * importing each other.
 */

/** The internal entry a filing dispatches to run its session's board. */
export const RUN_BOARD_ENTRY = "runTaskBoard";

/**
 * The internal entry a task session settles its parked task on, once none of
 * its pieces is open (FIX-1802 S4). Dispatched by the session into itself,
 * so it waits for any turn the session is running.
 */
export const SETTLE_SPLIT_ENTRY = "settleSplitTask";

/**
 * The internal entry a split task's session cancels its open pieces on, when
 * its task was ended from above (FIX-1802 BR-19).
 */
export const CANCEL_PIECES_ENTRY = "cancelSplitPieces";

/**
 * The metadata key a parked split row carries: the task session that split
 * it, and that session's flow (FIX-1802 S4). Only the split writes it; a
 * caller's filing or patch never reaches it.
 */
export const SPLIT_MARKER = "splitInto";
