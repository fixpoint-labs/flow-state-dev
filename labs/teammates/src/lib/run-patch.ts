/**
 * One changed file's diff, read from a coding task's run: what the review's
 * Files list opens a file with. Read in the run's own session through
 * harness-manager's run changes view, which answers only for the task that
 * session ran and refuses a path the run didn't change.
 */
import type { Client } from "@flow-state-dev/client";
import { CODER_FLOW, runChangesViewRef, type CodingBoardTask } from "@flow-state-dev/harness-manager/browser";
import type { RunChangesPatch } from "../components/flow-state/run-changes";

/**
 * The reader of `task`'s file diffs, or `undefined` for a task with no run
 * session, or one not run on the coding worker flow (whose view this is).
 */
export function runPatchReader(client: Pick<Client, "view">, task: CodingBoardTask | undefined): ((path: string) => Promise<RunChangesPatch>) | undefined {
  const taskId = task?.id;
  const sessionId = task?.run?.sessionId;
  if (taskId === undefined || sessionId === undefined || task?.runFlow !== CODER_FLOW) return undefined;
  return async (path) => {
    const { patch } = (await client.view(runChangesViewRef(), { taskId, path }, { sessionId })).value;
    if (patch === null) throw new Error("The run's changes view answered no patch.");
    return patch;
  };
}
