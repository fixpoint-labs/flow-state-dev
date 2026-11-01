/**
 * The `harness-thread` worker flow: the lab's one coding worker flow (epic
 * ER-9). A task handed to a worker on it becomes a supervised coding run in
 * the project its session works in, through the coding harness that
 * worker's own `WORKER.md` names in its `harness:` line.
 *
 * It builds one `harnessManager` per harness (Claude Code, Codex, Cursor),
 * and per permission mode for Claude Code, since a manager's harness slot is
 * fixed when it is built, and routes each task by the worker its session
 * runs. So a second coding worker on Codex is one more `WORKER.md`, never a
 * second flow, and so is a Claude Code worker that only plans
 * (`permissionMode: plan`). A worker's `review: true` line picks the manager built with
 * `reviewChanges`, so a run that committed waits for your review (threads
 * mode's coder); one without it completes on the run's own check. Either
 * way `goalJudge` first reads a run that passed against its task's goal.
 *
 * **Where a run works** is the host's `workspace`, over `projectWorkspace()`:
 * the task inherits its session's project through `filingProjectId`, and a
 * run with no project is refused `no-project` before any checkout (spec D3).
 * `fsdev.config.mts` builds it: a worktree of the project's repository.
 */
import { defineFlow, handler, router, sequencer } from "@flow-state-dev/core";
import type { BlockDefinition, HarnessBlock } from "@flow-state-dev/core/types";
import { claudeCodeAgent } from "@flow-state-dev/claude-code/sdk";
import { codexAgent } from "@flow-state-dev/codex";
import { cursorAgent } from "@flow-state-dev/cursor";
import { goalJudge, harnessManager, harnessSessionDoor, harnessTalkTurn, taskIssueSegment, type HarnessFeeds, type PhaseSpec } from "@flow-state-dev/harness-manager";
import { taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import {
  conversationLedgers,
  filingConversationBoard,
  MESSAGE_RECEIVED_ENTRY,
  messageReceivedEntry,
  messageReceivedSchema,
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
import type { WorkspaceHost } from "@flow-state-dev/workspace";
import { z } from "zod";

/** The flow name a coding worker's `WORKER.md` names. */
export const HARNESS_THREAD_FLOW = "harness-thread";

/** One coding run's wall-clock budget. */
const RUN_TIMEOUT_MS = 20 * 60_000;

/**
 * The Claude Code permission modes a worker's `permissionMode:` line may name: the ones a run can
 * work in with nobody to approve a tool call. `default` is left out, since the manager turns no
 * approval into a wait on you, so a run in it would only be refused its tools. So is
 * `bypassPermissions`: a worker's line, which a user's own roster copy can set, must not lift every
 * check; that belongs to an operator, on a run inside an isolation boundary.
 */
const PERMISSION_MODES = ["acceptEdits", "plan"] as const;

/**
 * Claude Code for one permission mode. `acceptEdits` is keyed `claude-code`, so its manager names
 * stay the ones runs were recorded under.
 */
const claudeCode = (permissionMode: (typeof PERMISSION_MODES)[number]) => (feeds: HarnessFeeds) =>
  claudeCodeAgent({
    ...feeds,
    detached: true,
    recordWork: true,
    allowedTools: ["Read", "Write", "Edit", "Bash"],
    permissionMode,
  } as never) as unknown as HarnessBlock;

/** The model a Cursor run uses: Cursor's own pick ("Auto"), as Kitchen Sink's Cursor mode offers it. */
const CURSOR_MODEL = "default";

/**
 * One builder per manager the flow builds. `claude-code-plan` is Claude Code in `plan` mode; it is
 * not a name a worker's `harness:` line may use.
 */
const HARNESSES: Record<string, (feeds: HarnessFeeds) => HarnessBlock> = {
  "claude-code": claudeCode("acceptEdits"),
  "claude-code-plan": claudeCode("plan"),
  codex: (feeds) =>
    codexAgent({
      cwd: feeds.cwd,
      resume: feeds.resume,
      onSession: feeds.onSession,
      onActivity: feeds.onActivity,
      // Codex's own default sandbox is read-only; a coder has to edit and commit.
      thread: { sandboxMode: "workspace-write" },
      name: "codex",
    }) as unknown as HarnessBlock,
  cursor: (feeds) =>
    cursorAgent({
      cwd: feeds.cwd,
      resume: feeds.resume,
      onSession: feeds.onSession,
      onActivity: feeds.onActivity,
      // Cursor's SDK refuses a local agent with no model. "default" is Cursor's own pick, which every account's catalog has.
      model: CURSOR_MODEL,
      name: "cursor",
    } as never) as unknown as HarnessBlock,
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
  /** Where each run gets its checkout of its project, from `projectWorkspace()`. */
  workspace: WorkspaceHost;
}

/** Build the flow `hireWorkforce` registers one copy of, which every coding worker runs on. */
export function defineHarnessThreadFlow({ installation, workspace }: HarnessThreadFlowOptions) {
  // The board a run's session reads its task on: the conversation's that filed it. The run is
  // keyed the way the manager wrote it, so a routed id still finds its run.
  const board = async (ctx: Parameters<typeof filingConversationBoard>[0]) => {
    const filed = await filingConversationBoard(ctx);
    return filed === undefined ? undefined : { tasks: filed.tasks, runOf: (row: Task) => ({ issue: taskIssueSegment(row.id), phase: phase.phase }) };
  };
  /** A manager for one harness; `reviewChanges` makes a run that committed wait for your review before its task completes. */
  const manager = (name: string, harness: (feeds: HarnessFeeds) => HarnessBlock, reviewChanges: boolean) =>
    harnessManager({
      name: `harness-thread-${name}${reviewChanges ? "-reviewed" : ""}`,
      ledgers: conversationLedgers,
      tenant: undefined,
      phase,
      workspace,
      runTimeoutMs: RUN_TIMEOUT_MS,
      harness,
      reviewChanges,
      judge: goalJudge({ name: `harness-thread-${name}${reviewChanges ? "-reviewed" : ""}-judge` }),
      uses: [projectWorkspaceCapability],
    } as never) as unknown as BlockDefinition<any, any>;
  // Per builder: the managers that run a task, and the door a line typed in its run's session takes.
  const built = Object.fromEntries(
    Object.entries(HARNESSES).map(([name, harness]) => [
      name,
      {
        manager: manager(name, harness, false),
        reviewed: manager(name, harness, true),
        door: harnessSessionDoor({ name: `harness-thread-${name}`, harness, board, onSteered: startOwedSteerTurn }),
        talk: harnessTalkTurn({ name: `harness-thread-${name}-message`, harness, board }),
      },
    ]),
  );

  /**
   * What the session's worker names in its `harness:` and `permissionMode:` lines, read from the
   * worker as this turn resolves it (a standard worker or the user's own copy on the roster); the
   * config schema refused any other name at hire. Its `review: true` line picks the manager that
   * waits for your review.
   */
  const harnessOf = async (ctx: Parameters<WorkerInstallation["resolveWorker"]>[0]) => {
    const worker = await installation.resolveWorker(ctx, HARNESS_THREAD_FLOW);
    const name = String(worker.config.harness);
    const named = worker.config.permissionMode;
    if (named !== undefined && name !== "claude-code") {
      throw new Error(`worker "${worker.id}" names \`permissionMode:\`, which only a \`harness: claude-code\` worker takes`);
    }
    const found = built[name === "claude-code" && named === "plan" ? "claude-code-plan" : name];
    if (found === undefined) throw new Error(`worker "${worker.id}" names no \`harness:\` in its WORKER.md`);
    return { ...found, name, manager: worker.config.review === true ? found.reviewed : found.manager };
  };
  type Built = (typeof built)[string];
  const byHarness = (name: string, inputSchema: unknown, pick: (b: Built) => unknown) =>
    router({
      name,
      inputSchema,
      routes: [...new Set(Object.values(built).flatMap((b) => [pick(b), pick({ ...b, manager: b.reviewed })]))],
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
    configSchema: workerConfigSchema().extend({
      harness: z.enum(["claude-code", "codex", "cursor"]).optional(),
      permissionMode: z.enum(PERMISSION_MODES).optional(),
      review: z.boolean().optional(),
    }),
    session: installation.session(),
    resources: { ...installation.resources, ...workerMessagesResources },
    actions: {
      // A line typed in a run's session: a steer while its task is open, talk once it has finished.
      respond: { ...anyDoor, block: byHarness("harness-thread-door", anyDoor.inputSchema, (b) => b.door.block) },
      // Which harness the session's worker runs through: the tag a coding thread's card and row show.
      harness: {
        inputSchema: z.object({}),
        block: handler({
          name: "harness-thread-harness",
          inputSchema: z.object({}),
          outputSchema: z.object({ harness: z.string() }),
          resources: installation.resources,
          execute: async (_input: unknown, ctx: never) => ({ harness: (await harnessOf(ctx)).name }),
        } as never),
      },
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
