// FIX-2384; FIX-2623; BP-042; BP-031.
/**
 * What a board run changed, read from the run's session: the
 * files its commits changed and their lines, or one file's patch.
 *
 * A session view, not an action: it is answered in the response and stored nowhere,
 * so a patch a person opens never lands in a request record or a session log.
 * It runs no harness and takes no checkout lease: git reads the
 * run's committed history, which a running step only adds to.
 *
 * The task is the one the session ran, found from server state as the door
 * finds it. A caller may name one of that session's own tasks, a
 * follow-up's or the task it followed; it can name no other. The checkout and
 * the base come from the task's run record, by the rule `readRunCommits`
 * documents, so the files a review's data lists are the files this reads.
 */
import { defineView, handler, type DefinedCapability } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { tasksInSession } from "@flow-state-dev/orchestration/internal";
import { z } from "zod";
import { effectiveCut, readRunChanges, readRunCommits, runChangesSchema } from "./commits";
import { readModeRunRecord, RUNS, runRecordCollection } from "./run-record";
import { sessionTask, type SessionDoorBoard } from "./session-door";
import { runBoardSegment } from "./workspace";

/** What the changes view takes: optionally which of the session's tasks, and optionally one file. */
export const harnessRunChangesInputSchema = z.object({
  /** One of this session's own tasks. Default: the one the session's door would talk to. */
  taskId: z.string().min(1).optional(),
  /** A file the run changed, by its path in the repository: answer its patch instead of the diff. */
  path: z.string().min(1).optional(),
  /** Read the working tree too, each file only there marked `uncommitted`: for a run still working. Default: what it committed. */
  uncommitted: z.boolean().optional(),
});

/**
 * What the changes view answers: the task it read, and the diff or the one
 * file's patch. Beside the diff, the run's commits (count and subjects, as
 * `readRunCommits` reads them); `null` beside a patch.
 */
export const harnessRunChangesOutputSchema = runChangesSchema.extend({
  taskId: z.string(),
  commits: z.object({ count: z.number().int().nonnegative(), subjects: z.array(z.string()), verified: z.boolean() }).nullable(),
});

/** How a host builds the view. */
export interface HarnessRunChangesViewOptions {
  /** Names the view's block. Default `"harness-manager"`. */
  readonly name?: string;
  /** The board the session's run is on, as the session door is given it: resolved from server state, never from the input. */
  readonly board: (ctx: BlockContext) => Promise<SessionDoorBoard | undefined>;
  /** Capabilities the view's block holds, for the board ledgers `board` resolves. */
  readonly uses?: readonly DefinedCapability[];
}

/** Why the changes view found nothing to read. The view fails with this. */
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
 * The `changes` session view a coding flow declares beside its door:
 * `views: { changes: harnessRunChangesView({ board }) }`.
 *
 * Input `{ taskId?, path?, uncommitted? }`. Without `path` it answers
 * `{ diff, commits }`: each file the run's commits changed and its lines, the
 * totals, the commits' count and subjects, and `verified: false` when git
 * couldn't read them. `uncommitted` adds the working tree's changes, marked.
 * With `path` it answers `{ patch }`: that file's
 * unified diff, cut at `MAX_PATCH_CHARS`, with its whole length in `lines`;
 * a path the run didn't change fails with `RunFileNotChanged`. A run of kept files alone has no
 * branch, and answers a verified empty diff.
 */
export function harnessRunChangesView(options: HarnessRunChangesViewOptions) {
  const name = options.name ?? "harness-manager";
  const block = handler({
    name: `${name}-changes`,
    inputSchema: harnessRunChangesInputSchema,
    outputSchema: harnessRunChangesOutputSchema,
    resources: { [RUNS]: runRecordCollection },
    uses: options.uses,
    execute: async (input, ctx) => {
      const board = await options.board(ctx);
      if (board === undefined) throw new HarnessRunChangesRefused("not-started");
      const sessionId = ctx.session.identity.id;
      const row =
        input.taskId === undefined
          ? sessionTask(board.tasks, sessionId)
          : tasksInSession(board.tasks, sessionId).find((task) => task.id === input.taskId);
      if (row === undefined) throw new HarnessRunChangesRefused(input.taskId === undefined ? "not-started" : "not-this-session");
      const identity = board.runOf(row);
      const record =
        identity === undefined
          ? undefined
          : (await readModeRunRecord(ctx, runBoardSegment(board.tasks.collectionId, board.tasks.partition), identity.issue, identity.mode, row.id)).record;
      const at = { ...(input.path === undefined ? {} : { path: input.path }), ...(input.uncommitted === true ? { uncommitted: true } : {}) };
      if (record?.filesOnly === true || record?.workspacePath == null) {
        // A files-only run has no Git changes. A missing checkout leaves the changes unknown.
        const verified = record?.filesOnly === true;
        return input.path === undefined
          ? { taskId: row.id, diff: { files: [], fileCount: 0, added: 0, removed: 0, verified }, patch: null, commits: { count: 0, subjects: [], verified } }
          : { taskId: row.id, diff: null, patch: { path: input.path, patch: "", truncated: false, lines: 0, verified }, commits: null };
      }
      // The cut the settle read against, re-guarded: never a commit the recorded cut isn't in.
      const cut = await effectiveCut(record.workspacePath, record.baseCommit ?? null, record.effectiveCut ?? null);
      const changes = await readRunChanges(record.workspacePath, record.baseRef ?? null, cut, at);
      const commits = input.path === undefined ? await readRunCommits(record.workspacePath, record.baseRef ?? null, cut) : null;
      return { taskId: row.id, ...changes, commits };
    },
  });
  return defineView({ scope: "session", block, description: "What this session's coding run changed: its files and lines, or one file's patch." });
}

/** The changes view, as {@link harnessRunChangesView} builds it. Import as a type in client code. */
export type HarnessRunChangesView = ReturnType<typeof harnessRunChangesView>;
