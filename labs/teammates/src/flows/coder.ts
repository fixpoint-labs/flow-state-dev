/**
 * The lab's one small flow: the coding worker flow `coder` runs on.
 *
 * coder takes tasks only. A task another worker files for it becomes a
 * supervised coding run, through the harness its own `WORKER.md` names in
 * `harness:`, in the project its task was filed in. The flow builds one
 * `harnessManager` per harness the host offers and routes each task by the
 * worker's setting (the epic's ER-9), so a Codex coder is one more
 * `WORKER.md`, with no new flow.
 *
 * Where a run works comes from the host's workspace, whose source is
 * `projectWorkspace()`: the project of the conversation that filed the task.
 * A task filed from a conversation with no project is refused `no-project`
 * before any file exists, and the task ends with that reason.
 *
 * It hears worker messages only in its tasks' sessions, so nobody messages it
 * by name, and its door answers a person's line with where to go instead: in
 * this lab you steer a coding job through the worker that filed it.
 */
import { z } from "zod";
import { defineFlow, handler, router } from "@flow-state-dev/core";
import type { BlockDefinition, HarnessBlock } from "@flow-state-dev/core/types";
import { harnessManager, type HarnessFeeds, type PhaseSpec } from "@flow-state-dev/harness-manager";
import { taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import type { TaskWorker } from "@flow-state-dev/orchestration/tasks";
import {
  conversationLedgers,
  MESSAGE_RECEIVED_ENTRY,
  messageReceivedEntry,
  projectWorkspaceCapability,
  WORKER_TASK_ENTRY,
  workerConfigSchema,
  workerFlow,
  workerMessagesResources,
  workerTaskEntry,
  type WorkerInstallation,
} from "@flow-state-dev/workforce";
import type { WorkspaceHost } from "@flow-state-dev/workspace";

import { CODER_FLOW } from "../lib/coder-flow";

/** The flow name coder's `WORKER.md` names in its `flow:` line. */
export { CODER_FLOW };

/** One coding harness, as the manager's slot takes it. */
export type Harness = (feeds: HarnessFeeds) => HarnessBlock;

export interface CoderFlowOptions {
  /** The harnesses a worker may name in `harness:`, by that name. */
  harnesses: Readonly<Record<string, Harness>>;
  /** Where a run works: a host whose source is `projectWorkspace()`. */
  workspace: WorkspaceHost;
  /** Wall-clock budget for one run. */
  runTimeoutMs: number;
}

/** A task's run: its goal and brief, done when the harness says it finished. */
const PHASE: PhaseSpec = {
  phase: "change",
  buildPrompt: (run) =>
    [
      run.task.title === undefined ? undefined : `Task: ${run.task.title}`,
      run.task.goal,
      run.task.context,
      `Work in ${run.workspacePath}. Make the change, commit it with git, and say in one line what changed.`,
    ]
      .filter((line): line is string => typeof line === "string" && line !== "")
      .join("\n\n"),
  isDone: (run) => run.stopReport === "finished",
} as PhaseSpec;

/** What a person's line in one of coder's sessions is answered with. */
const DOOR_REPLY =
  "coder takes tasks only. To change what it is doing, tell the worker that filed the task, and that worker files the next one.";

/**
 * The coding worker flow, as a builder `createWorkerInstallation` takes under
 * {@link CODER_FLOW}.
 *
 * @throws At the hire, when a worker names a harness the host doesn't offer.
 */
export function coderFlow(options: CoderFlowOptions) {
  const names = Object.keys(options.harnesses);
  if (names.length === 0) throw new Error(`${CODER_FLOW}: the host offers no harness.`);
  return workerFlow(
    (installation: WorkerInstallation) => {
      const managers: Record<string, TaskWorker> = {};
      for (const [name, harness] of Object.entries(options.harnesses)) {
        managers[name] = harnessManager({
          name: `${CODER_FLOW}-${name}`,
          ledgers: conversationLedgers,
          tenant: undefined,
          phase: PHASE,
          workspace: options.workspace,
          runTimeoutMs: options.runTimeoutMs,
          harness,
          uses: [projectWorkspaceCapability],
        } as never) as TaskWorker;
      }

      // Each task goes to the harness the worker it was filed for names.
      const byHarness = router({
        name: `${CODER_FLOW}-by-harness`,
        inputSchema: taskWorkerInputSchema.passthrough(),
        routes: Object.values(managers) as never,
        execute: async (_task: unknown, ctx: unknown) => {
          const { id, config } = await installation.resolveWorker(ctx as never, CODER_FLOW);
          const harness = (config as { harness?: string }).harness;
          if (harness === undefined) throw new Error(`${id} names no harness: add \`harness:\` to its WORKER.md.`);
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
    { roles: ["contributor"] },
  );
}
