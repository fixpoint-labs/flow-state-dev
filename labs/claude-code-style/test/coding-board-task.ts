/**
 * One coding board row for a component's test, as harness-manager's coding
 * board view answers it: every field the view sends, `null` where it sends
 * `null`, so a test meets the same absent values the screen does. Its `title`
 * and `state` are the view's own (`taskView` of the row with its `asks`)
 * unless the test names them.
 */
import { taskView, type InboxHold } from "@flow-state-dev/orchestration/inbox";
import type { CodingBoardTask } from "@flow-state-dev/harness-manager/browser";

/** An open hold of the board's, answered through the board: what a row's `asks` lists. */
export const ask = (kind: InboxHold["ask"]["kind"], prompt: string, id = `hold-${kind}`): InboxHold => ({
  id,
  source: { kind: "task", flowId: "f", sessionId: "s1", action: "updateTask_tasks", taskId: "t1" },
  ask: { kind, prompt },
  openedAt: 1,
  answerable: true,
  unanswerable: null,
});

/** A coding board row: `patch` over a plain worker's running task with nothing set. */
export function codingBoardTask(patch: Partial<CodingBoardTask> = {}): CodingBoardTask {
  const row = {
    id: "t1",
    goal: "Fix the typo",
    status: "in_progress",
    attempts: 1,
    asks: [],
    harness: null,
    review: null,
    landed: null,
    error: null,
    pullRequests: [],
    runFlow: null,
    detail: null,
    ...patch,
  };
  const seen = taskView({ ...row, board: "s1" }, row.asks);
  return { ...row, title: patch.title ?? seen.title, state: patch.state ?? seen.state };
}
