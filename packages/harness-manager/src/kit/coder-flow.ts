/**
 * The coding worker flow, `coder`: the one flow every coding worker runs on,
 * whatever app it is in. The harness kit contributes it to workforce's
 * `workerFlows` slot, built over every harness the app filled.
 *
 * A task handed to a worker on it becomes a supervised coding run through the
 * harness the worker's own `WORKER.md` names in `harness:` (the kit's
 * `defaultHarness` when it names none). It builds one `harnessManager` per
 * harness, and one more that waits for your review, and routes each task by
 * the worker its session runs, so another coding worker is one more
 * `WORKER.md`, never another flow. A harness this machine isn't set up for
 * fails the task at once, saying why; it never moves to another.
 *
 * Its policy is the kit's config, not code an app copies:
 *
 * - **Review.** A run that committed waits for your review before its task
 *   completes when the worker's `review:` line says so, else when the kit's
 *   `review` does. Either way `goalJudge` reads a run first (`judge`).
 * - **Pull requests.** A task whose run opened a pull request is done when it
 *   merges, cancelled when it closes unmerged (`pullRequests`, on by default).
 * - **Checks.** A run that changed files is done only when the kit's `checks`
 *   pass in its worktree (or, with `project`, its project's checks); a red one
 *   sends it back, its brief naming the command. A run that changed nothing
 *   (a question) skips them.
 * - **Projects.** Off unless `project` is set: then a task needs its session's
 *   project, the run works in its checkout, and its checks are the project's.
 *
 * A line typed in a task's session talks to that run's coding session (the
 * door), and a delivered message wakes it the same way.
 */
import { defineFlow, handler, router, sequencer } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import {
  conversationLedgers,
  filingConversationBoard,
  messageReceivedEntry,
  messageReceivedSchema,
  projectChecks,
  projectWorkspaceCapability,
  startOwedSteerTurn,
  steerTurnEntry,
  workerConfigOf,
  workerConfigSchema,
  workerFlow,
  workerMessagesResources,
  workerTaskEntry,
  type MessageReceived,
  type WorkerInstallation,
} from "@flow-state-dev/workforce";
import { GIT_TIMEOUT_MS, run as exec, type WorkspaceHost } from "@flow-state-dev/workspace";
import { z } from "zod";
import { commandCheck, type CommandCheckCommands } from "../command-check";
import { goalJudge } from "../goal-judge";
import type { Harness } from "../harness";
import { harnessDrainBudgetMs, harnessManager, resolveOwnership, type CompletionRunContext, type PhaseSpec } from "../manager";
import { harnessSessionDoor, harnessTalkTurn } from "../session-door";
import { taskIssueSegment } from "../workspace";

/** The flow every coding worker's `WORKER.md` names in its `flow:` line. */
export const CODER_FLOW = "coder";

/** One run's wall-clock budget when the kit names none. */
export const DEFAULT_RUN_TIMEOUT_MS = 20 * 60_000;

/** How long a run's checks may take together when the kit names no bound. */
const CHECKS_TIMEOUT_MS = 10 * 60_000;

/** The coding worker flow's policy: the harness kit's config. */
export interface CoderFlowOptions {
  /** Where each run works. */
  workspace: WorkspaceHost;
  /** The harness a worker whose file names none runs on. Absent: such a worker's task is refused. */
  defaultHarness?: string;
  /** A run that committed waits for your review before its task completes, unless the worker's `review:` line says otherwise. Default false. */
  review?: boolean;
  /** A task whose run opened a pull request waits for it to merge or close. Default true. */
  pullRequests?: boolean;
  /** `goalJudge` reads each run against its task's goal. Default true. */
  judge?: boolean;
  /** The commands a run that changed files must pass in its worktree, and how long they may take together. */
  checks?: { readonly commands: readonly string[]; readonly timeoutMs?: number };
  /** A task works in its session's project: it needs one, runs in its checkout, and runs the project's checks. Default false. */
  project?: boolean;
  /** One run's wall-clock budget. Default 20 minutes. */
  runTimeoutMs?: number;
}

async function git(cwd: string, args: string[]): Promise<string> {
  return (await exec("git", args, { cwd, timeoutMs: GIT_TIMEOUT_MS })).stdout;
}

/**
 * Whether the run changed its worktree: files left uncommitted, or a tree that
 * differs from the commit its branch was cut at. Trees are compared, not
 * commits counted, so a run that moved its branch back still counts. No base,
 * or anything git can't answer, counts as changed, so the checks run.
 */
async function runChangedFiles(run: CompletionRunContext): Promise<boolean> {
  if (run.baseCommit == null) return true;
  try {
    if ((await git(run.workspacePath, ["status", "--porcelain"])).trim() !== "") return true;
    const [base, head] = await Promise.all([
      git(run.workspacePath, ["rev-parse", `${run.baseCommit}^{tree}`]),
      git(run.workspacePath, ["rev-parse", "HEAD^{tree}"]),
    ]);
    return base.trim() !== head.trim();
  } catch {
    return true;
  }
}

/** A run's brief: the worker's instructions, the task, what was answered, and why the last attempt stopped. */
const PHASE: PhaseSpec = {
  phase: "code",
  buildPrompt: (run) =>
    [
      workerConfigOf(run.ctx).instructions,
      run.task.title === undefined ? undefined : run.task.title,
      run.task.goal,
      run.task.context,
      ...run.answers.map((answered) => `You asked: ${answered.question}\nThe answer: ${answered.answer}`),
      "Work in this directory only. If the task asks a question, read what you need, answer it in full, and change nothing. " +
        "If it asks for a change, commit what you change with git, then say in one line what you did.",
      run.feedback === undefined ? undefined : `Why the last attempt stopped:\n\n${run.feedback}`,
    ]
      .filter((line): line is string => typeof line === "string" && line !== "")
      .join("\n\n"),
  isDone: (run) => run.stopReport === "finished",
} as PhaseSpec;

/**
 * The phase a coding run runs: done when the harness says it finished and, on
 * a run that changed files, the checks pass.
 *
 * @throws When `checks.timeoutMs` isn't a positive whole number.
 */
export function codingPhase(options: Pick<CoderFlowOptions, "checks" | "project">): PhaseSpec {
  const commands: CommandCheckCommands<CompletionRunContext> | undefined =
    options.project === true ? projectChecks() : options.checks?.commands.length ? [...options.checks.commands] : undefined;
  if (commands === undefined) return PHASE;
  const onChange: CommandCheckCommands<CompletionRunContext> = async (run) =>
    !(await runChangedFiles(run)) ? [] : typeof commands === "function" ? commands(run) : commands;
  return commandCheck(PHASE, { commands: onChange, timeoutMs: options.checks?.timeoutMs ?? CHECKS_TIMEOUT_MS });
}

/**
 * How long a shutdown waits for a coding run still going: its run, the
 * ownership wait, the judge and the checks. A host hands it to
 * `createFlowState` as `dispatchDrainTimeoutMs`, in place of the engine's
 * 30 s default, which would cancel the run.
 */
export function codingDrainBudgetMs(options: Pick<CoderFlowOptions, "checks" | "project" | "judge" | "runTimeoutMs">): number {
  const runTimeoutMs = options.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
  const { doneTimeoutMs } = codingPhase(options);
  return harnessDrainBudgetMs({
    runTimeoutMs,
    ownershipWaitMs: resolveOwnership({ runTimeoutMs, doneTimeoutMs }).ownership.waitMs,
    judge: options.judge !== false,
    doneTimeoutMs,
  });
}

/**
 * The coding worker flow over `harnesses`, as a `workerFlow(…)` entry for
 * workforce's `workerFlows` slot.
 *
 * @param harnesses Every harness the app filled, by id.
 * @param refusal Why a harness can't run on this machine, asked before each task starts; `undefined` when it can.
 * @throws When no harness is filled, or `defaultHarness` names one that isn't.
 */
export function coderWorkerFlow(
  options: CoderFlowOptions,
  harnesses: Readonly<Record<string, Harness>>,
  refusal: (harness: string) => Promise<string | undefined>,
) {
  const ids = Object.keys(harnesses);
  if (ids.length === 0) throw new Error(`${CODER_FLOW}: no harness is filled; fill the harness kit's \`harnesses\` slot.`);
  if (options.defaultHarness !== undefined && !ids.includes(options.defaultHarness)) {
    throw new Error(`${CODER_FLOW}: the default harness "${options.defaultHarness}" is not one of ${ids.join(", ")}.`);
  }
  const phase = codingPhase(options);
  const runTimeoutMs = options.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;

  return workerFlow(
    (installation: WorkerInstallation) => {
      const board = async (ctx: Parameters<typeof filingConversationBoard>[0]) => {
        const filed = await filingConversationBoard(ctx);
        return filed === undefined
          ? undefined
          : { tasks: filed.tasks, runOf: (task: Task) => ({ issue: taskIssueSegment(task.id), phase: phase.phase }) };
      };
      /** A manager for one harness; `reviewChanges` makes a run that committed wait for your review. */
      const manager = (id: string, harness: Harness, reviewChanges: boolean) => {
        const name = `${CODER_FLOW}-${id}${reviewChanges ? "-reviewed" : ""}`;
        return harnessManager({
          name,
          ledgers: conversationLedgers,
          tenant: undefined,
          phase,
          workspace: options.workspace,
          runTimeoutMs,
          harness: harness.agent,
          reviewChanges,
          ...(options.judge === false ? {} : { judge: goalJudge({ name: `${name}-judge` }) }),
          awaitPullRequests: options.pullRequests !== false,
          ...(options.project === true ? { uses: [projectWorkspaceCapability] } : {}),
        } as never) as unknown as BlockDefinition<any, any>;
      };
      const built = Object.fromEntries(
        Object.entries(harnesses).map(([id, harness]) => [
          id,
          {
            manager: manager(id, harness, false),
            reviewed: manager(id, harness, true),
            door: harnessSessionDoor({ name: `${CODER_FLOW}-${id}`, harness: harness.agent, board, onSteered: startOwedSteerTurn }),
            talk: harnessTalkTurn({ name: `${CODER_FLOW}-${id}-message`, harness: harness.agent, board }),
          },
        ]),
      );
      type Built = (typeof built)[string];

      /** The harness the session's worker names, read from the worker as this turn resolves it, and its manager. */
      const harnessOf = async (ctx: Parameters<WorkerInstallation["resolveWorker"]>[0]) => {
        const worker = await installation.resolveWorker(ctx, CODER_FLOW);
        const id = (worker.config.harness as string | undefined) ?? options.defaultHarness;
        const found = id === undefined ? undefined : built[id];
        if (id === undefined || found === undefined) {
          throw new Error(`worker "${worker.id}" names no \`harness:\` in its WORKER.md, and the harness kit sets no \`defaultHarness\`.`);
        }
        const review = (worker.config.review as boolean | undefined) ?? options.review === true;
        return { ...found, id, manager: review ? found.reviewed : found.manager };
      };
      /** Route by the session's worker; a run that starts work first asks whether its harness can run here. */
      const byHarness = (name: string, inputSchema: unknown, pick: (b: Built) => unknown, ready: boolean) =>
        router({
          name,
          inputSchema,
          routes: [...new Set(Object.values(built).flatMap((b) => [pick(b), pick({ ...b, manager: b.reviewed })]))],
          resources: installation.resources,
          execute: async (_input: unknown, ctx: never) => {
            const chosen = await harnessOf(ctx);
            if (ready) {
              const missing = await refusal(chosen.id);
              if (missing !== undefined) throw new Error(missing);
            }
            return pick(chosen);
          },
        } as never) as BlockDefinition<any, any>;
      const anyDoor = Object.values(built)[0]!.door;

      return defineFlow({
        kind: CODER_FLOW,
        cardinality: "collection",
        // Optional only so the shared copy, which carries no worker's settings, can be built.
        configSchema: workerConfigSchema().extend({
          harness: z.enum(ids as [string, ...string[]]).optional(),
          review: z.boolean().optional(),
        }),
        session: installation.session(),
        resources: { ...installation.resources, ...workerMessagesResources },
        actions: {
          respond: { ...anyDoor, block: byHarness(`${CODER_FLOW}-door`, anyDoor.inputSchema, (b) => b.door.block, false) },
          harness: {
            inputSchema: z.object({}),
            block: handler({
              name: `${CODER_FLOW}-harness`,
              inputSchema: z.object({}),
              outputSchema: z.object({ harness: z.string() }),
              resources: installation.resources,
              execute: async (_input: unknown, ctx: never) => ({ harness: (await harnessOf(ctx)).id }),
            } as never),
          },
        },
        internal: {
          actions: {
            onMessageReceived: messageReceivedEntry({
              installation,
              flowKind: CODER_FLOW,
              hears: "task-sessions",
              turn: sequencer({ name: `${CODER_FLOW}-message-turn`, inputSchema: messageReceivedSchema }).step(
                (received: MessageReceived) => ({ message: `Message from ${received.from}, another worker: ${received.text}` }),
                byHarness(`${CODER_FLOW}-message`, z.object({ message: z.string() }), (b) => b.talk, false),
              ),
            }),
            // The turn a steer or a delivered message owes a task it woke from its pull-request wait.
            onTaskSteered: steerTurnEntry({
              name: `${CODER_FLOW}-steer-turn`,
              block: byHarness(`${CODER_FLOW}-steer`, taskWorkerInputSchema.passthrough(), (b) => b.manager, true),
            }),
          },
        },
        task: {
          actions: {
            work: workerTaskEntry({
              name: `${CODER_FLOW}-work`,
              block: byHarness(`${CODER_FLOW}-by-harness`, taskWorkerInputSchema.passthrough(), (b) => b.manager, true),
            }),
          },
        },
      } as never);
    },
    // Each coding worker's `harness:` rides on its roster row, so a task line can name it.
    { roles: ["contributor"], showSettings: ["harness"], needsProject: options.project === true },
  );
}
