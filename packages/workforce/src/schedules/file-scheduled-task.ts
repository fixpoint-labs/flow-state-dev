/**
 * The internal entry a scheduled fire files its task through (FIX-2085 D1):
 * on a worker flow, in the user's conversation with that flow's worker, as the
 * user.
 *
 * It runs the board's own filing, the one a screen uses: the block behind the
 * `createTask_tasks` action, which files the row ready and wakes the board,
 * so the task starts now. No filing code is this entry's own.
 *
 * A filing the board refuses (no delegate takes a task, an assignee not among
 * the filer's delegates, a full chain) fails the entry's request, naming why:
 * the fire is dropped like any failed filing, and nothing is retried. So does
 * a fire that names no assignee where the filer has no one delegate to give it
 * to: the board would keep it unassigned, and every later fire would add
 * another row nothing runs.
 */
import { handler, sequencer } from "@flow-state-dev/core";
import type { ActionConfig, BlockContext, InternalEntry } from "@flow-state-dev/core/types";
import { z } from "zod";

/**
 * The internal entry over `filing`, the board's `createTask_tasks` action.
 *
 * @param filing The action a screen files a task through on this board.
 * @param soleDelegate The running session's one task-taking delegate, which
 *   a task naming no assignee goes to; `undefined` with none or several.
 */
export function fileScheduledTaskEntry(
  filing: ActionConfig,
  soleDelegate: (ctx: BlockContext) => Promise<string | undefined>
): InternalEntry {
  const file = filing.block;
  const inputSchema = (filing.inputSchema ?? file.inputSchema ?? z.unknown()) as z.ZodTypeAny;
  const owned = handler({
    name: "scheduled-task-has-an-owner",
    inputSchema: z.unknown(),
    outputSchema: z.void(),
    execute: async (input, ctx) => {
      const assignee = (input as { assignee?: unknown } | undefined)?.assignee;
      if (typeof assignee === "string") return;
      if ((await soleDelegate(ctx as never)) !== undefined) return;
      throw new Error(
        "The scheduled task wasn't filed: it names no assignee, and its filer has no one delegate that takes tasks to give it to. Name one in the schedule's `assignee`."
      );
    }
  });
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
    block: sequencer({ name: "file-scheduled-task", inputSchema }).tap(owned).step(file).tap(filed)
  };
}
