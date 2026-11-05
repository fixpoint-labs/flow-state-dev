/**
 * The lab's one small flow: the coding worker flow the coding workers run on.
 *
 * Coding is a background task, not a teammate: Claude Code, Codex and Cursor
 * are hidden workers coding tasks go to, off the screen's list, one per
 * harness. A coding task a teammate starts becomes a supervised coding run,
 * through the harness the worker's own `WORKER.md` names in `harness:`, or
 * the host's default when it names none. The flow builds one
 * `harnessManager` per harness the host offers and routes each task by the
 * worker's setting (the epic's ER-9), so another harness is one more
 * `WORKER.md` and one more entry in the host's harnesses, with no new flow.
 * A harness this machine isn't set up for fails the task at once, saying
 * why; it never moves to another. A run's brief opens with that worker's
 * `WORKER.md` body, so editing it changes what the harness is told.
 *
 * A run that committed waits for your review before its task completes
 * (harness-manager's `reviewChanges`): the task's popup shows its commits and
 * the judge's verdict (`goalJudge`, which reads the run against the task's
 * goal first), with **Ask for changes** and two ways to accept: **Open a PR**
 * and **Merge locally** (harness-manager's `land`, through the host's
 * `WorkspaceHost.land`). Your words go to the same coding session for one
 * more run, which you review again.
 *
 * Where a run works comes from the host's workspace, whose source is the
 * lab's one working folder: every run gets a worktree of it. With `checks`,
 * a run is done only when those commands pass in its worktree too; a red one
 * sends the run back, its brief naming the command and the end of its output.
 *
 * It hears worker messages only in its tasks' sessions, so nobody messages it
 * by name. The screen opens no conversation with it, so its door is not
 * reachable from the page; it stays because a worker flow answers `respond`,
 * and it says where to go instead: you steer a coding task through the
 * teammate that started it.
 */
import { z } from "zod";
import { defineFlow, handler, router } from "@flow-state-dev/core";
import type { BlockDefinition, HarnessBlock } from "@flow-state-dev/core/types";
import { commandCheck, goalJudge, harnessManager, type HarnessFeeds, type PhaseSpec } from "@flow-state-dev/harness-manager";
import { taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import type { TaskWorker } from "@flow-state-dev/orchestration/tasks";
import {
  conversationLedgers,
  MESSAGE_RECEIVED_ENTRY,
  messageReceivedEntry,
  WORKER_TASK_ENTRY,
  workerConfigSchema,
  workerFlow,
  workerConfigOf,
  workerMessagesResources,
  workerTaskEntry,
  type WorkerInstallation,
} from "@flow-state-dev/workforce";
import type { WorkspaceHost } from "@flow-state-dev/workspace";

import { CODER_FLOW } from "../lib/coder-flow";

/** The flow name each coding worker's `WORKER.md` names in its `flow:` line. */
export { CODER_FLOW };

/** One coding harness, as the manager's slot takes it. */
export type Harness = (feeds: HarnessFeeds) => HarnessBlock;

export interface CoderFlowOptions {
  /** The harnesses a worker may name in `harness:`, by that name. */
  harnesses: Readonly<Record<string, Harness>>;
  /** The harness a worker that names none runs on: one of {@link harnesses}. */
  defaultHarness: string;
  /**
   * Why a harness can't run on this machine, asked before each task starts:
   * a plain sentence that names it, or `undefined` when it can (harness-manager's
   * `readiness.refusal`). A task on a harness that can't run fails with that
   * sentence and never moves to another.
   */
  ready?: (harness: string) => Promise<string | undefined>;
  /** Where a run works: the host over the lab's working folder. */
  workspace: WorkspaceHost;
  /** Wall-clock budget for one run. */
  runTimeoutMs: number;
  /**
   * The working folder's checks: commands a run's worktree must pass before
   * its task is done, and how long they may take together. Absent, or no
   * commands: a run is done when its harness says it finished.
   */
  checks?: { commands: readonly string[]; timeoutMs: number };
}

/**
 * A task's run: the worker's instructions, then the task's goal and brief,
 * done when the harness says it finished.
 */
const PHASE: PhaseSpec = {
  phase: "change",
  buildPrompt: (run) =>
    [
      workerConfigOf(run.ctx).instructions,
      run.task.title === undefined ? undefined : `Task: ${run.task.title}`,
      run.task.goal,
      run.task.context,
      `Work in ${run.workspacePath}. Make the change, commit it with git, and say in one line what changed.`,
      run.feedback === undefined ? undefined : `Why the last attempt stopped:\n\n${run.feedback}`,
    ]
      .filter((line): line is string => typeof line === "string" && line !== "")
      .join("\n\n"),
  isDone: (run) => run.stopReport === "finished",
} as PhaseSpec;

/**
 * The phase a coding run runs, with the working folder's checks when the host names any.
 *
 * @throws When `checks.timeoutMs` isn't a positive whole number.
 */
export function codingPhase(checks?: CoderFlowOptions["checks"]): PhaseSpec {
  return checks === undefined || checks.commands.length === 0 ? PHASE : commandCheck(PHASE, checks);
}

/** What a user's line in one of a coding worker's sessions is answered with. */
const DOOR_REPLY =
  "This is where coding tasks run, not a teammate. To change a coding task, tell the teammate who started it, and they start the next one.";

/**
 * The coding worker flow, as a builder `createWorkerInstallation` takes under
 * {@link CODER_FLOW}.
 *
 * @throws At the hire, when a worker names a harness the host doesn't offer.
 * @throws When the default harness is not one the host offers.
 */
export function coderFlow(options: CoderFlowOptions) {
  const phase = codingPhase(options.checks);
  const names = Object.keys(options.harnesses);
  if (names.length === 0) throw new Error(`${CODER_FLOW}: the host offers no harness.`);
  if (!names.includes(options.defaultHarness)) {
    throw new Error(`${CODER_FLOW}: the default harness "${options.defaultHarness}" is not one of ${names.join(", ")}.`);
  }
  return workerFlow(
    (installation: WorkerInstallation) => {
      const managers: Record<string, TaskWorker> = {};
      for (const [name, harness] of Object.entries(options.harnesses)) {
        managers[name] = harnessManager({
          name: `${CODER_FLOW}-${name}`,
          ledgers: conversationLedgers,
          tenant: undefined,
          phase,
          workspace: options.workspace,
          runTimeoutMs: options.runTimeoutMs,
          harness,
          // A run that committed waits for your review; the judge's verdict is shown on it as information.
          reviewChanges: true,
          judge: goalJudge({ name: `${CODER_FLOW}-${name}-judge` }),
        } as never) as TaskWorker;
      }

      // Each task goes to the harness the worker it was filed for names.
      const byHarness = router({
        name: `${CODER_FLOW}-by-harness`,
        inputSchema: taskWorkerInputSchema.passthrough(),
        routes: Object.values(managers) as never,
        execute: async (_task: unknown, ctx: unknown) => {
          const { config } = await installation.resolveWorker(ctx as never, CODER_FLOW);
          const harness = (config as { harness?: string }).harness ?? options.defaultHarness;
          const missing = await options.ready?.(harness);
          if (missing !== undefined) throw new Error(missing);
          return managers[harness]!;
        },
      } as never) as BlockDefinition<any, any>;

      const door = handler({
        name: `${CODER_FLOW}-door`,
        inputSchema: z.object({ message: z.string() }),
        outputSchema: z.object({ reply: z.string() }),
        execute: (_input, ctx) => {
          ctx.emit.message(DOOR_REPLY, { agentName: "coder" });
          return { reply: DOOR_REPLY };
        },
      });

      return defineFlow({
        kind: CODER_FLOW,
        cardinality: "collection",
        // Optional only so the shared copy, which carries no worker's settings, can be built.
        configSchema: workerConfigSchema().extend({ harness: z.enum(names as [string, ...string[]]).optional() }),
        session: installation.session(),
        resources: { ...installation.resources, ...workerMessagesResources },
        actions: {
          respond: { block: door, userMessage: (input: { message: string }) => input.message },
        },
        internal: {
          actions: {
            [MESSAGE_RECEIVED_ENTRY]: messageReceivedEntry({ installation, flowKind: CODER_FLOW, hears: "task-sessions" }),
          },
        },
        task: {
          actions: {
            [WORKER_TASK_ENTRY]: workerTaskEntry({ name: `${CODER_FLOW}-${WORKER_TASK_ENTRY}`, block: byHarness }),
          },
        },
      } as never);
    },
    // Each coding worker's `harness:` rides on its roster row, so a task line can name it.
    { roles: ["contributor"], showSettings: ["harness"] },
  );
}
