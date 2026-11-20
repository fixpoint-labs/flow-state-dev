// FIX-2086 D2.
/**
 * Starting the turn a steer is owed, in the session its task's
 * run link names.
 *
 * A leaf, so the board (`./board`), which starts the turn after a steer that
 * leaves its task waiting on it, reads it without importing the session's
 * door (`./steer`), which reads the board.
 */
import { type BlockContext } from "@flow-state-dev/core/types";
import { requestHostOf, dispatchThroughSeam } from "@flow-state-dev/core/internal";
import { STEER_TURN_DUE_MS } from "@flow-state-dev/orchestration/internal";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import { STEER_TURN_ENTRY } from "./board-entries";

/**
 * What a steer's sender is told when the steer was kept but no turn could
 * start for it: the task has no run in a session to wake, so nothing acts on
 * the message until the task runs again.
 */
export const STEER_TURN_NOT_STARTED =
  "The message was recorded on the task, but no turn could be started for it: the task has no run in a session to wake. " +
  "Nothing acts on it until the task runs again; don't say it is being worked on.";

/**
 * Start the turn owed to `row`'s untaken steer (D2), in the session its run
 * link names: the wake first, so a lost start is still paid, then the entry at
 * once. A row with no run in a session yet has no turn to start: its next
 * attempt's brief carries the steer.
 *
 * @param flowKind The flow that session runs on, when it isn't the running one.
 * @returns Whether the turn was started or owed: `false` when the task names no
 *   session, or neither the wake nor the start could be written.
 */
export async function startOwedSteerTurn(ctx: BlockContext, row: Task, flowKind?: string): Promise<boolean> {
  const sessionId = row.run?.sessionId;
  if (sessionId === undefined) return false;
  const wakes = requestHostOf(ctx)?.wakes;
  let owed = false;
  try {
    if (wakes !== undefined) {
      await wakes.owe({ entry: STEER_TURN_ENTRY, dueAt: Date.now() + STEER_TURN_DUE_MS, sessionId });
      owed = true;
    }
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
    return true;
  } catch {
    // Not definitive: the wake starts it.
    return owed;
  }
}
