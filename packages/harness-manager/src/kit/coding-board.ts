// FIX-2725 D2.
/**
 * A conversation's coding board as a user view on the harness kit's own
 * `harnesses` flow: the board's task-list rows, each with what holds it for
 * the user and where each answer goes, the harness it runs through, how its
 * review ended, where its work landed, why it failed, and the numbers of the
 * pull requests it waits on.
 *
 * It runs at user scope, so it reaches a conversation on any flow, an app's
 * own agent flow included: the conversation ledger is user-scoped, and the
 * session reads are the request host's, which answer only the caller's own
 * sessions. The input names the conversation; it selects among what the
 * caller may read and never admits. The board is read through the
 * conversation ledger at the conversation's partition, the conversation named
 * where a running session would be (`readFor`), so its board notices are
 * heard, on an empty board too.
 *
 * No action runs here. A task's harness is what its run reported, else its
 * worker's `harness:` setting from the roster. Review, landing and error come
 * from the row, read on the server and cut to those fields.
 */
import { defineView, handler } from "@flow-state-dev/core";
import { requireRequestHost } from "@flow-state-dev/core/internal";
import type { BlockContext } from "@flow-state-dev/core/types";
import { inboxItems, type InboxHold } from "@flow-state-dev/orchestration/inbox";
import { listedTaskSchema, taskListEntriesFor } from "@flow-state-dev/orchestration/internal";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import type { WorkerInstallation } from "@flow-state-dev/workforce";
import {
  conversationLedgerAt,
  conversationLedgerResources,
  filingSessionIdOf,
  readRosterEntries,
  rosterResources,
} from "@flow-state-dev/workforce/internal";
import { z } from "zod";
import { CODER_FLOW } from "../coder-flow-name";
import { landedOf } from "../landed-work";
import { pullRequestWait, type PullRequestWaitInput } from "../pull-request-wait";

/** The conversation board's ledger id and its `updateTask` action, where a task's own questions are answered. */
const BOARD = "tasks";
const UPDATE_TASK_ACTION = "updateTask_tasks";

/** One task as the coding board answers it. */
const codingTaskSchema = listedTaskSchema.extend({
  /** What holds it for the user, each with where its answer goes (the Inbox's hold). */
  asks: z.array(z.custom<InboxHold>((value) => typeof value === "object" && value !== null)),
  /** The harness it runs through: its run's, else its worker's `harness:` setting. `null` for a plain worker's task. */
  harness: z.string().nullable(),
  /** How a coding run's review ended: `accepted`, `deadline` (nobody answered); `null` when none was asked or it isn't done. */
  review: z.enum(["accepted", "deadline"]).nullable(),
  /** Where an accepted run's work went, once it landed. */
  landed: z
    .union([
      z.object({ kind: z.literal("pull-request"), url: z.string(), number: z.number(), branch: z.string(), base: z.string() }),
      z.object({ kind: z.literal("merge"), branch: z.string(), commit: z.string(), checkout: z.string(), from: z.string() }),
    ])
    .nullable(),
  /** Why its last attempt failed; only on a failed task. */
  error: z.string().nullable(),
  /** The numbers of the pull requests it waits on to merge or close; their links are the recorded work view's. */
  pullRequests: z.array(z.number().nullable()),
});

const codingBoardSchema = z.array(codingTaskSchema);
const codingBoardInputSchema = z.object({ sessionId: z.string().min(1) });

/** One task of the coding board. */
export type CodingBoardTask = z.infer<typeof codingTaskSchema>;

/**
 * The coding board view over `installation`'s roster and the conversation
 * ledger. `defaultHarness` is what a coding worker with no `harness:` setting
 * runs through. Install it in the `harnesses` flow's `views` as `codingBoard`.
 */
export function codingBoardView(installation: WorkerInstallation, defaultHarness?: string) {
  return defineView({
    scope: "user",
    key: (task) => task.id,
    block: handler({
      name: "harness-manager-coding-board",
      inputSchema: codingBoardInputSchema,
      outputSchema: codingBoardSchema,
      resources: { ...rosterResources(installation), ...conversationLedgerResources },
      execute: async (input, ctx) => {
        const sessions = requireRequestHost(ctx).sessions;
        if (sessions === undefined) throw new Error("This host can't read your sessions, so the coding board can't answer here.");
        const conversation = await sessions.read(input.sessionId);
        if (conversation === undefined) {
          // Not the caller's, or gone. Heard on the caller's own session list,
          // where a session made under this id again publishes: never on the
          // named session's topic, which answered nothing.
          await sessions.list({ limit: 1 });
          return [];
        }
        const partition = await filingSessionIdOf({ identity: { id: input.sessionId }, lineageId: conversation.lineageId });
        const ledger = await conversationLedgerAt(ctx as BlockContext, partition, { readFor: input.sessionId });
        const listed = taskListEntriesFor(BOARD, ledger, {}, ctx.view);
        const full = new Map((ledger?.list() ?? []).map((task: Task) => [task.id, task]));
        // Where an answer goes: the conversation's flow, and each run session's, read by identity alone.
        const flows = new Map<string, string | null>([[input.sessionId, conversation.flowId ?? conversation.flowKind]]);
        for (const task of full.values()) {
          const run = task.run?.sessionId;
          if (run === undefined || flows.has(run)) continue;
          const read = await sessions.read(run);
          flows.set(run, read === undefined ? null : (read.flowId ?? read.flowKind));
        }
        const asks = new Map(
          inboxItems({
            rows: [...full.values()].map((task) => ({
              board: input.sessionId,
              id: task.id,
              title: task.title ?? null,
              assignee: task.assignee ?? null,
              status: task.status,
              run: task.run ?? null,
              holds: task.holds ?? [],
              steers: task.steers ?? [],
              holder: { sessionId: input.sessionId, action: UPDATE_TASK_ACTION },
            })),
            suspensions: [],
            flowOf: (id) => flows.get(id),
          }).flatMap((item) => (item.task === null ? [] : [[item.task.taskId, [...item.holds]] as const])),
        );
        const roster = await readRosterEntries(ctx, installation);
        const harnessOf = (task: Task): string | null => {
          const reported = (task as { spend?: { harness?: unknown } | null }).spend?.harness;
          if (typeof reported === "string") return reported;
          const worker = roster.find((entry) => entry.id === task.assignee && !entry.standard) ?? roster.find((entry) => entry.id === task.assignee);
          if (worker === undefined || worker.flow !== CODER_FLOW) return null;
          const setting = worker.settings.harness;
          return typeof setting === "string" ? setting : (defaultHarness ?? null);
        };
        return listed.map((entry) => {
          const task = full.get(entry.id);
          const harness = task === undefined ? null : harnessOf(task);
          const output = (task?.output ?? {}) as Record<string, unknown>;
          const review = harness !== null && entry.status === "completed" && (output.review === "accepted" || output.review === "deadline") ? output.review : null;
          const wait = task === undefined ? null : pullRequestWait({ status: task.status, holds: task.holds as unknown as PullRequestWaitInput["holds"], steers: task.steers ?? [] });
          return {
            ...entry,
            asks: asks.get(entry.id) ?? [],
            harness,
            review,
            landed: landedOf(output.landed) ?? null,
            error: entry.status === "errored" && typeof task?.error === "string" ? task.error : null,
            pullRequests: wait === null ? [] : wait.pullRequests.map((pullRequest) => pullRequest.number),
          };
        });
      },
    }),
  });
}

/** The coding board view, as {@link codingBoardView} builds it. Import as a type in client code. */
export type CodingBoardView = ReturnType<typeof codingBoardView>;
