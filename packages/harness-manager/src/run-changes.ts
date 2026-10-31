/**
 * What a board run changed, read from the run's session (FIX-2384): the
 * files its commits changed and their lines, or one file's patch.
 *
 * A read, not an action: it is answered in the response and stored nowhere,
 * so a patch a person opens never lands in a request record or a session log
 * (BP-042). It runs no harness and takes no checkout lease: git reads the
 * run's committed history, which a running step only adds to.
 *
 * The task is the one the session ran, found from server state as the door
 * finds it (BP-031). A caller may name one of that session's own tasks, a
 * follow-up's or the task it followed; it can name no other. The checkout and
 * the base come from the task's run record, by the rule `readRunCommits`
 * documents, so the files a review's data lists are the files this reads.
 */
import { defineCapability, handler, type DefinedCapability } from "@flow-state-dev/core";
import type { BlockContext, ReadConfig } from "@flow-state-dev/core/types";
import { rowsInSession } from "@flow-state-dev/orchestration/tasks";
import { z } from "zod";
import { readRunChanges, runChangesSchema, type RunChanges } from "./commits";
import { readRunRow, RUNS, runRecordCollection, runTopic } from "./run-record";
import { sessionRow, type SessionDoorBoard } from "./session-door";
import { runBoardSegment } from "./workspace";

/** What a changes read takes: optionally which of the session's tasks, and optionally one file. */
export const harnessRunChangesInputSchema = z.object({
  /** One of this session's own tasks. Default: the one the session's door would talk to. */
  taskId: z.string().min(1).optional(),
  /** A file the run changed, by its path in the repository: answer its patch instead of the diff. */
  path: z.string().min(1).optional(),
});

/** What a changes read answers: the task it read, and the diff or the one file's patch. */
export const harnessRunChangesOutputSchema = runChangesSchema.extend({ taskId: z.string() });

/** How a host builds the read. */
export interface HarnessRunChangesReadOptions {
  /** Names the read's block. Default `"harness-manager"`. */
  readonly name?: string;
  /** The board the session's run is on, as the session door is given it: resolved from server state, never from the input. */
  readonly board: (ctx: BlockContext) => Promise<SessionDoorBoard | undefined>;
  /** Capabilities the read's block holds, for the board ledgers `board` resolves. */
  readonly uses?: readonly DefinedCapability[];
}

/** Why a changes read found nothing to read. The read fails with this. */
export class HarnessRunChangesRefused extends Error {
  constructor(readonly reason: "not-started" | "not-this-session") {
    super(
      reason === "not-started"
        ? "This session ran no coding task, so there are no changes to read."
        : "That task didn't run in this session, so its changes aren't read here.",
    );
    this.name = "HarnessRunChangesRefused";
  }
}

/**
 * The `changes` read a coding flow declares beside its door:
 * `reads: { changes: harnessRunChangesRead({ board }) }`.
 *
 * Input `{ taskId?, path? }`. Without `path` it answers `{ diff }`: each file
 * the run's commits changed and its lines, the totals, and `verified: false`
 * when git couldn't read them. With `path` it answers `{ patch }`: that file's
 * unified diff, cut at `MAX_PATCH_CHARS`. A run of kept files alone has no
 * branch, and answers a verified empty diff.
 */
export function harnessRunChangesRead(options: HarnessRunChangesReadOptions): ReadConfig {
  const name = options.name ?? "harness-manager";
  const capability = defineCapability({
    name: `harness-manager-changes:${name}`,
    resources: { [RUNS]: runRecordCollection },
  }) as unknown as DefinedCapability;
  const block = handler({
    name: `${name}-changes`,
    inputSchema: harnessRunChangesInputSchema,
    outputSchema: harnessRunChangesOutputSchema,
    uses: [capability, ...(options.uses ?? [])],
    execute: async (input, ctx: BlockContext): Promise<RunChanges & { taskId: string }> => {
      const board = await options.board(ctx);
      if (board === undefined) throw new HarnessRunChangesRefused("not-started");
      const sessionId = ctx.session.identity.id;
      const row =
        input.taskId === undefined
          ? sessionRow(board.tasks, sessionId)
          : rowsInSession(board.tasks, sessionId).find((task) => task.id === input.taskId);
      if (row === undefined) throw new HarnessRunChangesRefused(input.taskId === undefined ? "not-started" : "not-this-session");
      const identity = board.runOf(row);
      const record =
        identity === undefined
          ? undefined
          : await readRunRow(ctx, runTopic(runBoardSegment(board.tasks.collectionId, board.tasks.partition), identity.issue, identity.phase));
      const at = input.path === undefined ? {} : { path: input.path };
      if (record?.filesOnly === true) {
        return input.path === undefined
          ? { taskId: row.id, diff: { files: [], fileCount: 0, added: 0, removed: 0, verified: true }, patch: null }
          : { taskId: row.id, diff: null, patch: { path: input.path, patch: "", truncated: false, verified: true } };
      }
      // No checkout recorded: no base to read against, so the read answers unverified.
      const cwd = record?.workspacePath ?? null;
      const changes = await readRunChanges(cwd ?? "", cwd === null ? null : (record!.baseRef ?? null), record?.baseCommit ?? null, at);
      return { taskId: row.id, ...changes };
    },
  });
  return { block, description: "What this session's coding run changed: its files and lines, or one file's patch." };
}
