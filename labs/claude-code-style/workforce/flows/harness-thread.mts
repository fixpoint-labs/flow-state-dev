/**
 * The `harness-thread` worker flow: the lab's one coding worker flow (epic
 * ER-9). A task handed to a worker on it becomes a supervised coding run in
 * the project its session works in, through the coding harness that
 * worker's own `WORKER.md` names in its `harness:` line.
 *
 * It builds one `harnessManager` per harness, since a manager's harness slot
 * is fixed when it is built, and routes each task by the worker its session
 * runs. So a second coding worker on Codex is one more `WORKER.md`, never a
 * second flow.
 *
 * **Where a run works** is `projectWorkspace()`: the task inherits its
 * session's project through `filingProjectId`, and a run with no project is
 * refused `no-project` before anything is cloned (spec D3). The host clones
 * the project's repository under `root` and allows only `file://` remotes,
 * so a run never works in the lab's own checkout.
 */
import { defineFlow, router, sequencer } from "@flow-state-dev/core";
import type { BlockDefinition, HarnessBlock } from "@flow-state-dev/core/types";
import { claudeCodeAgent } from "@flow-state-dev/claude-code/sdk";
import { codexAgent } from "@flow-state-dev/codex";
import { harnessManager, harnessSessionDoor, harnessTalkTurn, taskIssueSegment, type HarnessFeeds, type PhaseSpec } from "@flow-state-dev/harness-manager";
import { taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import {
  conversationLedgers,
  filingConversationBoard,
  MESSAGE_RECEIVED_ENTRY,
  messageReceivedEntry,
  messageReceivedSchema,
  projectWorkspace,
  projectWorkspaceCapability,
  startOwedSteerTurn,
  STEER_TURN_ENTRY,
  steerTurnEntry,
  WORKER_TASK_ENTRY,
  workerConfigSchema,
  workerMessagesResources,
  workerTaskEntry,
  type MessageReceived,
  type WorkerInstallation,
} from "@flow-state-dev/workforce";
import { localWorkspaceHost } from "@flow-state-dev/workspace";
import { z } from "zod";

/** The flow name a coding worker's `WORKER.md` names. */
export const HARNESS_THREAD_FLOW = "harness-thread";

/** One coding run's wall-clock budget. */
const RUN_TIMEOUT_MS = 20 * 60_000;

/** The harnesses a worker's `harness:` line may name, each built from the manager's feeds. */
const HARNESSES: Record<string, (feeds: HarnessFeeds) => HarnessBlock> = {
  "claude-code": (feeds) =>
    claudeCodeAgent({
      ...feeds,
      detached: true,
      recordWork: true,
      allowedTools: ["Read", "Write", "Edit", "Bash"],
      permissionMode: "acceptEdits",
    } as never) as unknown as HarnessBlock,
  codex: (feeds) =>
    codexAgent({ cwd: feeds.cwd, resume: feeds.resume, onSession: feeds.onSession, name: "codex" }) as unknown as HarnessBlock,
};

/** The one phase: the task as the main session wrote it, a question or a change, done when the harness says it finished. */
const phase: PhaseSpec = {
  phase: "code",
  buildPrompt: ({ task, answers }) =>
    [
      task.title === undefined ? task.goal : `${task.title}\n\n${task.goal}`,
      ...answers.map((answered) => `You asked: ${answered.question}\nThe answer: ${answered.answer}`),
      "Work in this directory only. If the task asks a question, read what you need, answer it in full, and change nothing. " +
        "If it asks for a change, commit what you change with git, then say in one line what you did.",
    ].join("\n\n"),
  isDone: ({ stopReport }) => stopReport === "finished",
};

export interface HarnessThreadFlowOptions {
  installation: WorkerInstallation;
  /** Where each run's clone of its project's repository is made. */
  root: string;
}

/** Build the flow `hireWorkforce` registers one copy of, which every coding worker runs on. */
export function defineHarnessThreadFlow({ installation, root }: HarnessThreadFlowOptions) {
  const workspace = localWorkspaceHost({ root, remotes: { allow: ["file"] }, source: projectWorkspace() });
  // The board a run's session reads its task on: the conversation's that filed it. The run is
  // keyed the way the manager wrote it, so a routed id still finds its run.
  const board = async (ctx: Parameters<typeof filingConversationBoard>[0]) => {
    const filed = await filingConversationBoard(ctx);
    return filed === undefined ? undefined : { tasks: filed.tasks, runOf: (row: Task) => ({ issue: taskIssueSegment(row.id), phase: phase.phase }) };
  };
  // Per harness: the manager that runs a task, and the door a line typed in its run's session takes.
  const built = Object.fromEntries(
    Object.entries(HARNESSES).map(([name, harness]) => [
      name,
      {
        manager: harnessManager({
          name: `harness-thread-${name}`,
          ledgers: conversationLedgers,
          tenant: undefined,
          phase,
          workspace,
          runTimeoutMs: RUN_TIMEOUT_MS,
          harness,
          uses: [projectWorkspaceCapability],
        } as never) as unknown as BlockDefinition<any, any>,
        door: harnessSessionDoor({ name: `harness-thread-${name}`, harness, board, onSteered: startOwedSteerTurn }),
        talk: harnessTalkTurn({ name: `harness-thread-${name}-message`, harness, board }),
      },
    ]),
  );

  /**
   * What the session's worker names in its `harness:` line, read from the worker as this turn
   * resolves it (a standard worker or the user's own copy on the roster); the config schema
   * refused any other name at hire.
   */
  const harnessOf = async (ctx: Parameters<WorkerInstallation["resolveWorker"]>[0]) => {
    const worker = await installation.resolveWorker(ctx, HARNESS_THREAD_FLOW);
    const found = built[String(worker.config.harness)];
    if (found === undefined) throw new Error(`worker "${worker.id}" names no \`harness:\` in its WORKER.md`);
    return found;
  };
  const byHarness = (name: string, inputSchema: unknown, pick: (b: (typeof built)[string]) => unknown) =>
    router({
      name,
      inputSchema,
      routes: Object.values(built).map(pick),
      // resolveWorker reads the user's roster, so the router declares the installation's resources.
      resources: installation.resources,
      execute: async (_input: unknown, ctx: never) => pick(await harnessOf(ctx)),
    } as never) as BlockDefinition<any, any>;
  const anyDoor = Object.values(built)[0]!.door;

  return defineFlow({
    kind: HARNESS_THREAD_FLOW,
    cardinality: "collection",
    // A worker names its harness in its `WORKER.md`; one this flow builds no manager for is refused at
    // hire. Optional only because the flow's own copy is built with no worker's settings.
    configSchema: workerConfigSchema().extend({ harness: z.enum(Object.keys(HARNESSES) as [string, ...string[]]).optional() }),
    session: installation.session(),
    resources: { ...installation.resources, ...workerMessagesResources },
    actions: {
      // A line typed in a run's session: a steer while its task is open, talk once it has finished.
      respond: { ...anyDoor, block: byHarness("harness-thread-door", anyDoor.inputSchema, (b) => b.door.block) },
    },
    internal: {
      actions: {
        // Another worker's message lands in a task's session only, and a finished task's coding session answers it.
        [MESSAGE_RECEIVED_ENTRY]: messageReceivedEntry({
          installation,
          flowKind: HARNESS_THREAD_FLOW,
          hears: "task-sessions",
          turn: sequencer({ name: "harness-thread-message-turn", inputSchema: messageReceivedSchema }).step(
            (received: MessageReceived) => ({ message: `Message from ${received.from}, another worker: ${received.text}` }),
            byHarness("harness-thread-message", z.object({ message: z.string() }), (b) => b.talk),
          ),
        }),
        [STEER_TURN_ENTRY]: steerTurnEntry({
          name: `${HARNESS_THREAD_FLOW}-steer-turn`,
          block: byHarness("harness-thread-steer", taskWorkerInputSchema.passthrough(), (b) => b.manager),
        }),
      },
    },
    task: {
      actions: {
        [WORKER_TASK_ENTRY]: workerTaskEntry({
          name: `${HARNESS_THREAD_FLOW}-${WORKER_TASK_ENTRY}`,
          block: byHarness("harness-thread-by-harness", taskWorkerInputSchema.passthrough(), (b) => b.manager),
        }),
      },
    },
  } as never);
}
