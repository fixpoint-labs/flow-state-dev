/**
 * The internal entry a scheduled fire files its task through (FIX-2085 D1):
 * on a worker flow, in the user's conversation with that flow's worker, as the
 * user.
 *
 * It runs the board's own filing, the one a screen uses: the block behind the
 * `dispatchTask_tasks` action, in its goal form, which files the row ready
 * and wakes the board, so the task starts now. No filing code is this entry's
 * own; when the board's filing moves (FIX-2081's `createTask`), the entry moves
 * with it.
 *
 * A filing the board refuses (no delegate takes a task, an assignee not among
 * the filer's delegates, a full chain) fails the entry's request, naming why:
 * the fire is dropped like any failed filing, and nothing is retried.
 */
import { handler, sequencer } from "@flow-state-dev/core";
import type { ActionConfig, InternalEntry } from "@flow-state-dev/core/types";
import { z } from "zod";

/**
 * The internal entry over `filing`, the board's `dispatchTask_tasks` action.
 *
 * @param filing The action a screen files a task through on this board.
 */
export function fileScheduledTaskEntry(filing: ActionConfig): InternalEntry {
  const file = filing.block;
  const inputSchema = (filing.inputSchema ?? file.inputSchema ?? z.unknown()) as z.ZodTypeAny;
  const filed = handler({
    name: "scheduled-task-filed",
    inputSchema: z.unknown(),
    outputSchema: z.void(),
    execute: (output) => {
      const answer = output as { ok?: unknown; error?: unknown } | undefined;
      if (answer?.ok !== true) {
        const why = typeof answer?.error === "string" ? answer.error : "the filing gave no answer";
        throw new Error(`The scheduled task wasn't filed: ${why}`);
      }
    }
  });
  return {
    inputSchema,
    block: sequencer({ name: "file-scheduled-task", inputSchema }).step(file).tap(filed)
  };
}
