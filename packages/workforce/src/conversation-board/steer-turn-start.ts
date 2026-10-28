/**
 * Starting the turn a steer is owed (FIX-2086 D2), in the session its task's
 * run link names.
 *
 * A leaf, so the board (`./board`), which starts the turn after a steer that
 * leaves its task waiting on it, reads it without importing the session's
 * door (`./steer`), which reads the board.
 */
import { dispatchThroughSeam, type BlockContext } from "@flow-state-dev/core/types";
import { STEER_TURN_DUE_MS } from "@flow-state-dev/orchestration/task-board";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import { STEER_TURN_ENTRY } from "./board-entries";

/**
 * Start the turn owed to `row`'s untaken steer (D2), in the session its run
 * link names: the wake first, so a lost start is still paid, then the entry at
 * once. A row with no run in a session yet has no turn to start: its next
 * attempt's brief carries the steer.
 *
 * @param flowKind The flow that session runs on, when it isn't the running one.
 */
export async function startOwedSteerTurn(ctx: BlockContext, row: Task, flowKind?: string): Promise<void> {
  const sessionId = row.run?.sessionId;
  if (sessionId === undefined) return;
  const wakes = ctx.requestHost?.wakes;
  try {
    await wakes?.owe({ entry: STEER_TURN_ENTRY, dueAt: Date.now() + STEER_TURN_DUE_MS, sessionId });
  } catch (error) {
    console.warn(`[workforce] the wake for task "${row.id}"'s steer turn couldn't be written; its start runs now only`, {
      error: (error as Error).message
    });
  }
  try {
    await dispatchThroughSeam(ctx, {
      type: "internal",
      action: STEER_TURN_ENTRY,
      ...(flowKind !== undefined ? { flowKind } : {}),
      session: { id: sessionId },
      payload: {},
      from: "workforce-steer-turn"
    });
  } catch {
    // Not definitive: the wake starts it.
  }
}
