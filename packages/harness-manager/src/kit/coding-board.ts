// FIX-2725 D2.
/**
 * A conversation's coding board as a user view on the harness kit's own
 * `harnesses` flow: the board's task-list rows, each with its title and the
 * state the user sees it in (orchestration's `taskView`, read with its asks),
 * what holds it for the user and where each answer goes, the harness it runs through, how its
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
 * from the row, read on the server and cut to those fields. With a `taskId`
 * in the input, the row it names also carries its answer (`detail`), cut as
 * `getTask` cuts output: the read an open task's popup makes. No other row,
 * and no read without one, carries an answer, so the board stays bounded.
 */
import { defineView, handler } from "@flow-state-dev/core";
import { requireRequestHost } from "@flow-state-dev/core/internal";
import { inboxItems, taskView, type InboxHold, type TaskViewStatus } from "@flow-state-dev/orchestration/inbox";
import { listedTaskSchema, readable, taskListEntriesFor } from "@flow-state-dev/orchestration/internal";
import { isTerminalStatus, type Task } from "@flow-state-dev/orchestration/tasks";
import { answerTextOf, type WorkerInstallation } from "@flow-state-dev/workforce";
import {
  conversationLedgerAt,
  conversationLedgerResources,
  filingSessionIdOf,
  readRosterEntries,
  rosterResources,
} from "@flow-state-dev/workforce/internal";
import { z } from "zod";
import { CODER_FLOW } from "../coder-flow-name";
import { landedOf, landedWorkSchema } from "../landed-work";
import { pullRequestWait, type PullRequestWaitInput } from "../pull-request-wait";

/** The conversation board's ledger id and its `updateTask` action, where a task's own questions are answered. */
const BOARD = "tasks";
const UPDATE_TASK_ACTION = "updateTask_tasks";

/**
 * Every `TaskViewStatus`. `satisfies` holds this list to orchestration's; the
 * handler's return holds orchestration's to this list, since it writes a
 * `taskView` state into the row.
 */
const TASK_VIEW_STATES = ["queued", "held", "running", "waiting", "failed", "done", "cancelled"] as const satisfies readonly TaskViewStatus[];

/** One task as the coding board answers it. */
const codingTaskSchema = listedTaskSchema.extend({
  /** What a screen shows for it: orchestration's `taskView` title, its title, else its goal, else its id. */
  title: z.string(),
  /** What the user sees it as: orchestration's `taskView` state of the row, read with its `asks`. */
  state: z.enum(TASK_VIEW_STATES),
  /** What holds it for the user, each with where its answer goes (the Inbox's hold). */
  asks: z.array(z.custom<InboxHold>((value) => typeof value === "object" && value !== null)),
  /** The harness it runs through: its run's, else its worker's `harness:` setting. `null` for a plain worker's task. */
  harness: z.string().nullable(),
  /** How a coding run's review ended: `accepted`, `deadline` (nobody answered); `null` when none was asked or it isn't done. */
  review: z.enum(["accepted", "deadline"]).nullable(),
  /** Where an accepted run's work went, once it landed. */
  landed: landedWorkSchema.nullable(),
  /** Why its last attempt failed, or the reason it was cancelled with; `null` otherwise. */
  error: z.string().nullable(),
  /** The numbers of the pull requests it waits on to merge or close; their links are the recorded work view's. */
  pullRequests: z.array(z.number().nullable()),
  /** The flow its run's session runs on, where that run's own stream is read; `null` with no run, or once its session is gone. */
  runFlow: z.string().nullable(),
  /**
   * Only on the row the input's `taskId` names, `null` on every other: what it
   * came back with (a teammate's text, a coding run's `answer`), cut as
   * `getTask` cuts output, with `answerCut` set when it was.
   */
  detail: z.object({ answer: z.string().nullable(), answerCut: z.boolean() }).nullable(),
});

const codingBoardSchema = z.array(codingTaskSchema);
/** With `taskId`, every row still comes back, with `detail` filled only on the one it names: an open task's read. */
const codingBoardInputSchema = z.object({ sessionId: z.string().min(1), taskId: z.string().min(1).optional() });

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
        // Not the caller's, or gone: the read is heard on the caller's own user
        // topic, where a session made again under this id publishes.
        if (conversation === undefined) return [];
        const partition = await filingSessionIdOf({ identity: { id: input.sessionId }, lineageId: conversation.lineageId });
        const ledger = await conversationLedgerAt(ctx, partition, { readFor: input.sessionId });
        const listed = taskListEntriesFor(BOARD, ledger, {}, ctx.view);
        const full = new Map((ledger?.list() ?? []).map((task: Task) => [task.id, task]));
        // Where an answer goes: the conversation's flow, and each run session's, read by identity alone.
        const flows = new Map<string, string | null>([[input.sessionId, conversation.flowId ?? conversation.flowKind]]);
        const runSessions = [...new Set([...full.values()].flatMap((task) => (task.run?.sessionId === undefined ? [] : [task.run.sessionId])))].filter((id) => !flows.has(id));
        const reads = await Promise.all(runSessions.map((id) => sessions.read(id)));
        runSessions.forEach((id, at) => flows.set(id, reads[at] === undefined ? null : (reads[at]!.flowId ?? reads[at]!.flowKind)));
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
        // The harness its runs reported, as the list folds the stored spend into the entry's view of it;
        // only a task no run reported on takes its worker's setting today.
        const harnessOf = (entry: (typeof listed)[number], task: Task): string | null => {
          const reported = entry.spend?.harness;
          if (typeof reported === "string") return reported;
          const worker = roster.find((entry) => entry.id === task.assignee && !entry.standard) ?? roster.find((entry) => entry.id === task.assignee);
          if (worker === undefined || worker.flow !== CODER_FLOW) return null;
          const setting = worker.settings.harness;
          return typeof setting === "string" ? setting : (defaultHarness ?? null);
        };
        return listed.map((entry) => {
          const task = full.get(entry.id);
          const harness = task === undefined ? null : harnessOf(entry, task);
          const output = (task?.output ?? {}) as Record<string, unknown>;
          const review = harness !== null && entry.status === "completed" && (output.review === "accepted" || output.review === "deadline") ? output.review : null;
          const wait = task === undefined ? null : pullRequestWait({ status: task.status, holds: task.holds as unknown as PullRequestWaitInput["holds"], steers: task.steers ?? [] });
          const held = asks.get(entry.id) ?? [];
          // One `taskView` of the row with its asks gives both its title and its state: neither rule is copied here.
          const seen = taskView({ ...entry, board: input.sessionId }, held);
          return {
            ...entry,
            title: seen.title,
            state: seen.state,
            asks: held,
            harness,
            review,
            landed: landedOf(output.landed) ?? null,
            error: (entry.status === "errored" || entry.status === "cancelled") && typeof task?.error === "string" ? task.error : null,
            pullRequests: wait === null ? [] : wait.pullRequests.map((pullRequest) => pullRequest.number),
            runFlow: task?.run?.sessionId === undefined ? null : (flows.get(task.run.sessionId) ?? null),
            detail: entry.id === input.taskId ? detailOf(task) : null,
          };
        });
      },
    }),
  });
}

/** An open task's answer once it ended, cut by `getTask`'s own cut so the two never differ. */
function detailOf(task: Task | undefined): { answer: string | null; answerCut: boolean } {
  // Only an ended task's output is its answer: a retried one keeps its last attempt's output while it runs again.
  const answer = task !== undefined && isTerminalStatus(task.status) ? answerTextOf(task.output) : undefined;
  if (answer === undefined) return { answer: null, answerCut: false };
  const { value, cut } = readable(answer);
  return { answer: value as string, answerCut: cut };
}

/** The coding board view, as {@link codingBoardView} builds it. Import as a type in client code. */
export type CodingBoardView = ReturnType<typeof codingBoardView>;
