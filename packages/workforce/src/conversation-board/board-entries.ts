/**
 * The internal entries a session's board runs on, by name: a leaf module, so
 * the board, the ledger and the filing factory share one spelling without
 * importing each other.
 */

/**
 * The internal entry a filing dispatches to run its session's board: the
 * board's one pass, one at a time per session. A manager's entry (its role
 * table, `../worker-roles`). **Pinned**: a wake stores it by name.
 */
export const DISPATCH_ENTRY = "dispatch";

// FIX-2077.
/**
 * The internal entry that checks a task session's waiting task, and does
 * nothing else: what the upgrade's backfill wakes for a row an
 * older host held open, which may have no notice left to wake it. **Pinned**:
 * a wake stores it by name.
 */
export const CHECK_TASK_ENTRY = "checkWaitingTask";

// FIX-2086 D2.
/**
 * The internal entry that runs the turn a steer no request took is owed, in
 * the task's own session: what the claim gate's check starts,
 * and what its wake runs. **Pinned**: a wake stores it by name.
 */
export const STEER_TURN_ENTRY = "onTaskSteered";

// FIX-1780; FIX-2078.
/**
 * The internal entry a task's notice arrives on in the session that filed it.
 * **Pinned**: a goal check reads notices by it. Orchestration's
 * `onTaskSettled`.
 */
export const TASK_SETTLED_ENTRY = "onTaskSettled";

// FIX-2077; FIX-1802 S4.
/**
 * The metadata key a split row parked on its pieces carried.
 * Retired: nothing parks a split now. A caller's filing or
 * patch still never writes it, so no row can be made to look like one.
 */
export const SPLIT_MARKER = "splitInto";

// FIX-1802 S4.
/**
 * The metadata key a piece carries: the task it is a piece of, on the board
 * above. A task session can run more than one task, one at a
 * time (a task and its follow-ups), so a piece names its own. Only the board
 * writes it; a caller's filing or patch never reaches it.
 */
export const PIECE_OF = "pieceOf";

// FIX-2080.
/**
 * The metadata key on a task's row naming the session that filed work for it
 * and that session's flow: where the filed half of its cascade is
 * sent. Server-written by the first piece's filing (`./cascade`).
 */
export const FILED_MARKER = "filedFrom";

// FIX-2106; BP-030.
/**
 * The metadata key on a task's row holding the worker-message hop count and
 * chain of the turn that filed it: the task's turn starts there,
 * so a message from it counts on in its filer's exchange whichever session
 * it runs in, beside how many user's lines the filer's session had taken.
 * Server-written by the filing, and cleared (`null`) by the claim once the
 * user has written in the filer's conversation since; a caller's filing or
 * patch never reaches it. **Absent** on a row filed before rows carried it, whose turn
 * reads its session's count, as before.
 */
export const FILED_HOP = "filedAtHop";

// FIX-2161; BP-030.
/**
 * The metadata key on a task's row naming the project it was filed in,
 * in `projectRef` form: the filing session's project
 * (`filingProjectOf`), or, in a delegate's ongoing session, the stamp on the
 * task that session holds. The hand-over copies it onto the task session as
 * `filingProjectId`, and a held row's run reads it, so a task keeps its
 * project when its conversation's project changes. Server-written by the
 * filing; a caller's filing or patch never reaches it. `null` on a row filed
 * with no project. **Absent** on a row filed before rows carried it, whose
 * hand-over reads its conversation's project, as before.
 */
export const FILED_PROJECT = "filedInProject";
