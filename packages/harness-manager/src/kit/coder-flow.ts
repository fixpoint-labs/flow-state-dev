/**
 * The coding worker flow, `coder`: the one flow every coding worker runs on,
 * whatever app it is in. The harness kit contributes it to workforce's
 * `workerFlows` slot, built over every harness the app filled.
 *
 * A task handed to a worker on it becomes a supervised coding run through the
 * harness the worker's own `WORKER.md` names in `harness:` (the kit's
 * `defaultHarness` when it names none). What a task takes is declared on the
 * flow's `work` entry (`./coding-task-input`): the mode it runs in and the
 * issue it works on, which the filer writes and the filing check checks, and
 * the run settings, which only the server writes. A worker's `lock:` refuses a
 * task that differs on a locked field. It builds one `harnessManager` per
 * harness, and one more that waits for your review, and routes each task by
 * the worker its session runs, so another coding worker is one more
 * `WORKER.md`, never another flow. A harness this machine isn't set up for
 * fails the task at once, saying why; it never moves to another.
 *
 * Its policy is the kit's config, not code an app copies:
 *
 * - **Review.** A run that committed waits for your review before its task
 *   completes when the kit's `review` says so, or the worker's `review:` line
 *   does; a worker can turn review on, never off. Either way `goalJudge`
 *   reads a run first (`judge`).
 * - **Pull requests.** A task whose run opened a pull request is done when it
 *   merges, cancelled when it closes unmerged (`pullRequests`, on by default).
 * - **Checks.** A run that changed files is done only when the kit's `checks`
 *   pass in its worktree (or, with `project`, its project's checks); a red one
 *   sends it back, its brief naming the command. A run that changed nothing
 *   (a question) skips them.
 * - **Projects.** Off unless `project` is set: then a task needs its session's
 *   project, the run works in its checkout, and its checks are the project's.
 * - **Modes.** How a run is told what to do, when it is done and where it
 *   works, by name (`modes`, `defaultMode`): the kit's one `default` mode
 *   unless the app registers its own (`./coder-modes`). A task runs the mode
 *   its checked input names. The checks wrap whichever mode runs.
 * - **Tool approval.** A run asks the user before its tool calls when
 *   `approveTools` is on.
 * - **The app's own worker extension** (`worker`): settings a worker's file
 *   may set, documents and actions, which the flow carries and never reads.
 *
 * A line typed in a task's session talks to that run's coding session (the
 * door), and a delivered message wakes it the same way.
 */
import { defineFlow, FlowConfigRefusalError, handler, router, sequencer, type DeclaredResources } from "@flow-state-dev/core";
import { OBSERVED_PULL_REQUESTS, observedPullRequestsCollection, type PullRequestFollower } from "@flow-state-dev/core/harness";
import { mergeDeclaredResources } from "@flow-state-dev/core/internal";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { assertDispatchEntrySupported } from "@flow-state-dev/orchestration/internal";
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
import { stampMatches } from "@flow-state-dev/workforce/internal";
import { GIT_TIMEOUT_MS, run as exec, type WorkspaceHost } from "@flow-state-dev/workspace";
import { z } from "zod";
import { codingBrief } from "../coding-brief";
import { commandCheck, type CommandCheckCommands } from "../command-check";
import { goalJudge } from "../goal-judge";
import type { Harness } from "@flow-state-dev/core/harness";
import { harnessDrainBudgetMs, harnessManager, resolveOwnership, type CompletionRunContext, type ModeSpec } from "../manager";
import { DEFAULT_IDLE_TIMEOUT_MS } from "../run-stops";
import { NETWORK_CALL_TIMEOUT_MS } from "../timeouts";
import { harnessSessionDoor, harnessTalkTurn } from "../session-door";
import { runIssueSegment } from "../workspace";
import { KIT_MODE, modeOfTask, resolveCoderModes, runModeOfTask, type CoderMode, type ResolvedModes } from "./coder-modes";
import { codingTaskInput, modeProblem, noteRunSettings, taskLockProblem, trustedCodingInput, workerLockSchema } from "./coding-task-input";
import { isTrackerIssue } from "../issue-spec";

import { CODER_FLOW, REFRESH_PULL_REQUESTS } from "../coder-flow-name";
import { refreshRecordedPullRequests } from "../await-pull-requests";
import { RECORDED_WORK_VIEW, RUN_CHANGES_VIEW } from "../coding-board-ref";
import { harnessRunChangesView } from "../run-changes";
import { recordedWorkView } from "../recorded-work-view";

export { CODER_FLOW };

// FIX-2794.
/**
 * How long a shutdown waits for a run's harness when the kit names no cap on
 * run time, or turns it off (`0`). The default cap (4 hours) is a stop for a
 * looping run, not a wait a shutdown should hold a host for, and no cap has
 * no length to wait out; either way a shutdown gives the run this long and
 * then cancels it, as it would at any cap. Equal to `DEFAULT_IDLE_TIMEOUT_MS`
 * by policy, not derived from it: a host's own silence window does not move it.
 */
const SHUTDOWN_RUN_WAIT_MS = 20 * 60_000;

/** How long a run's checks may take together when the kit names no bound. */
const CHECKS_TIMEOUT_MS = 10 * 60_000;

/** The coding worker flow's policy: the harness kit's config. */
export interface CoderFlowOptions {
  /** Where each run works. */
  workspace: WorkspaceHost;
  /**
   * The harness a worker whose file names none runs on, and the one a coding
   * task filed from outside any coding run carries. Absent: such a worker's
   * task is refused, and such a filing carries none.
   */
  defaultHarness?: string;
  /** A run that committed waits for your review before its task completes, whatever the worker's `review:` line says; a worker's `review: true` turns it on alone. Default false. */
  review?: boolean;
  /** A task whose run opened a pull request waits for it to merge or close. Default true. */
  pullRequests?: boolean;
  /** `goalJudge` reads each run against its task's goal. Default true. */
  judge?: boolean;
  /** The commands a run that changed files must pass in its worktree, and how long they may take together. */
  checks?: { readonly commands: readonly string[]; readonly timeoutMs?: number };
  /** A task works in its session's project: it needs one, runs in its checkout, and runs the project's checks. Default false. A mode's own `project` overrides the last two for its runs. */
  project?: boolean;
  /** How long a run's harness may send nothing before the run is stopped and fails. Default 20 minutes. */
  idleTimeoutMs?: number;
  /** A cap on one run's wall-clock time, however busy its harness is. Default 4 hours; `0` turns it off. */
  runTimeoutMs?: number;
  /** What each run's branch starts with: the app's own name, such as `teammates/`. Default `fsd/`. */
  branchPrefix?: string;
  /**
   * Builds the follower each pull request a run records is handed to, on the
   * installation the coding flow is built on (workforce's
   * `(installation) => followPullRequest({ providers, installation })`), so the
   * run's session hears that pull request's reviews, comments and CI. Absent:
   * nothing follows a pull request a run opens.
   */
  onPullRequestRecorded?: (installation: WorkerInstallation) => PullRequestFollower;
  /**
   * The ways a run can work, by name. Absent: the kit's one mode, `default`
   * (the coding brief; done when the harness finished). A `default` entry is
   * completed from the kit's, so an app can replace part of it; any other
   * entry names its `instructions` and `doneWhen`. A mode's `workspace` is
   * absent for the kit's.
   */
  modes?: Readonly<Record<string, Partial<CoderMode>>>;
  /** The mode a task that names none runs. Default `default`; refused when it isn't registered. */
  defaultMode?: string;
  /** A run asks the user before its tool calls (harness-manager's `approveTools`). Default false. */
  approveTools?: boolean;
  /**
   * The app's own extension of the flow: settings a worker's file may set
   * beside the flow's (a schema shape by key), documents installed on the
   * flow, and actions built on the installation. The flow never reads them.
   * A setting or action the flow already declares is refused.
   */
  worker?: CoderWorkerExtension;
}

/** The app's own part of the coding worker flow, which the flow carries and never reads. */
export interface CoderWorkerExtension {
  /** Settings a worker's file may set, beside `harness` and `review`. */
  settings?: z.ZodRawShape;
  /** Documents installed at flow level, beside the installation's (`resourcesFromDocs`). */
  resources?: DeclaredResources;
  /** Actions served beside `respond` and `harness`, built once on the installation. */
  actions?: (installation: WorkerInstallation) => Readonly<Record<string, unknown>>;
}

/**
 * The flow's settings: workforce's, `harness` naming a filled harness, `review`,
 * and the app's own. An app setting the flow already declares is refused.
 *
 * An app setting a worker must set is optional here, so the shared copy,
 * which carries no worker's settings, can be built; {@link requireAppSettings}
 * refuses a worker's copy that leaves it out. A setting that already takes
 * `undefined` (optional, or with a default) is kept as declared.
 */
function coderSettingsSchema(ids: readonly string[], modes: readonly string[], own: z.ZodRawShape | undefined) {
  const builtIn = workerConfigSchema().extend({
    harness: z.enum(ids as [string, ...string[]]).optional(),
    review: z.boolean().optional(),
    // FIX-2878 D3: values a task for this worker must run with, refused by name when it differs.
    lock: workerLockSchema(ids, modes).optional(),
  });
  if (own === undefined) return builtIn;
  const taken = Object.keys(own).filter((key) => key in builtIn.shape);
  if (taken.length > 0) {
    throw new Error(`${CODER_FLOW}: the app's \`worker.settings\` declares ${taken.map((key) => `"${key}"`).join(", ")}, which the flow already declares.`);
  }
  const buildable = Object.fromEntries(
    Object.entries(own).map(([key, setting]) => [key, setting.safeParse(undefined).success ? setting : setting.optional()]),
  );
  return builtIn.extend(buildable);
}

/**
 * The flow's factory, refusing a worker's copy (one minted with a config bag)
 * that leaves out an app setting it must set, as `defineFlow` refuses any
 * other bad setting, with the setting named. The shared copy, minted with no
 * bag, is not checked.
 */
function requireAppSettings<F extends (options?: { id?: string; config?: Record<string, unknown> }) => unknown>(
  flow: F,
  own: z.ZodRawShape | undefined,
): F {
  if (own === undefined) return flow;
  const required = z.object(own);
  const mint = (options?: { id?: string; config?: Record<string, unknown> }) => {
    const copy = flow(options);
    if (options?.config === undefined) return copy;
    const parsed = required.safeParse(options.config);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => ({ path: issue.path, code: issue.code, message: issue.message }));
      throw new FlowConfigRefusalError(
        `Flow "${CODER_FLOW}" instance "${options.id ?? CODER_FLOW}" has an invalid config bag: ` +
          issues.map((issue) => `"${issue.path.join(".")}": ${issue.message}`).join("; ") + ".",
        issues,
      );
    }
    return copy;
  };
  return Object.assign(mint, flow);
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

// BP-030.
/**
 * The kit's one mode, `default`: harness-manager's coding brief with the
 * worker's own instructions, and a question answered or a change committed.
 * Its runs were keyed `code` before modes had names, so a run stored there is
 * still found there.
 */
const DEFAULT_MODE: ModeSpec = {
  name: "default",
  formerName: "code",
  instructions: (run) =>
    codingBrief(run, {
      instructions: workerConfigOf(run.ctx).instructions as string | undefined,
      terms: [
        "Work in this directory only. If the task asks a question, read what you need, answer it in full, and change nothing. " +
          "If it asks for a change, commit what you change with git.",
      ],
    }),
  doneWhen: { check: (run) => run.stopReport === "finished" },
};

/** `mode` with the kit's checks: on a run that changed files, they must pass too, and the brief names them. */
function withChecks(mode: ModeSpec, options: Pick<CoderFlowOptions, "checks" | "project">): ModeSpec {
  const commands: CommandCheckCommands<CompletionRunContext> | undefined =
    options.project === true ? projectChecks() : options.checks?.commands.length ? [...options.checks.commands] : undefined;
  if (commands === undefined) return mode;
  const onChange: CommandCheckCommands<CompletionRunContext> = async (run) =>
    !(await runChangedFiles(run)) ? [] : typeof commands === "function" ? commands(run) : commands;
  return commandCheck(mode, { commands: onChange, timeoutMs: options.checks?.timeoutMs ?? CHECKS_TIMEOUT_MS, inBrief: true });
}

/**
 * The kit's own mode as a coding run runs it: done when the harness says it
 * finished and, on a run that changed files, the checks pass. The brief names
 * the checks too, from the same list: before the run there is no base to
 * compare, so a question's brief names them as a change's does.
 *
 * @throws When `checks.timeoutMs` isn't a positive whole number.
 */
export function codingMode(options: Pick<CoderFlowOptions, "checks" | "project">): ModeSpec {
  return withChecks(DEFAULT_MODE, options);
}

/**
 * Every mode the flow runs, each wrapped in the kit's checks, and the default.
 *
 * @throws As `resolveCoderModes` does, and as {@link codingMode} does.
 */
export function codingModes(options: Pick<CoderFlowOptions, "checks" | "project" | "modes" | "defaultMode">): ResolvedModes {
  const resolved = resolveCoderModes(options, DEFAULT_MODE, CODER_FLOW);
  return {
    defaultMode: resolved.defaultMode,
    modes: Object.fromEntries(Object.entries(resolved.modes).map(([name, mode]) => [name, { ...mode, spec: withChecks(mode.spec, { ...options, project: mode.project ?? options.project }) }])),
  };
}

/**
 * How long a shutdown waits for a coding run still going: its run, the
 * ownership wait, the judge and the checks. A host hands it to
 * `createFlowState` as `dispatchDrainTimeoutMs`, in place of the engine's
 * 30 s default, which would cancel the run.
 */
export function codingDrainBudgetMs(
  options: Pick<CoderFlowOptions, "checks" | "project" | "judge" | "runTimeoutMs" | "idleTimeoutMs" | "modes" | "defaultMode">,
): number {
  // The longest done check of any mode: a shutdown can't know which one is running.
  const timeouts = Object.values(codingModes(options).modes).map((mode) => mode.spec.doneWhen.timeoutMs);
  const doneTimeoutMs = timeouts.some((ms) => ms !== undefined) ? Math.max(...timeouts.map((ms) => ms ?? NETWORK_CALL_TIMEOUT_MS)) : undefined;
  return harnessDrainBudgetMs({
    // A cap the host named is waited out; the default cap, or none, is not.
    runTimeoutMs: options.runTimeoutMs === undefined || options.runTimeoutMs === 0 ? SHUTDOWN_RUN_WAIT_MS : options.runTimeoutMs,
    // The same term the manager prices its checkout lock with: its silence window.
    ownershipWaitMs: resolveOwnership({ runTimeoutMs: options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS, doneTimeoutMs }).ownership.waitMs,
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
 * @throws When no harness is filled, `defaultHarness` names one that isn't, the
 *   modes don't resolve (`codingModes`), or `worker` declares a setting or
 *   action the flow already has.
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
  const resolved = codingModes(options);
  const settingsSchema = coderSettingsSchema(ids, Object.keys(resolved.modes), options.worker?.settings);
  const declaration = codingTaskInput({
    modes: resolved,
    ...(options.defaultHarness === undefined ? {} : { defaultHarness: options.defaultHarness }),
    harnesses: ids,
    ...(options.project === true ? { project: true } : {}),
  });

  return workerFlow(
    (installation: WorkerInstallation) => {
      const follower = options.onPullRequestRecorded?.(installation);
      const board = async (ctx: Parameters<typeof filingConversationBoard>[0]) => {
        const filed = await filingConversationBoard(ctx);
        return filed === undefined
          ? undefined
          : {
              tasks: filed.tasks,
              runOf: (task: Task) => {
                const mode = runModeOfTask(task.input, resolved, stampMatches(task, CODER_FLOW, declaration));
                // Keyed as the manager keys it: a follow-up by its root.
                return mode === undefined ? undefined : { issue: runIssueSegment(task, (id) => filed.tasks.get(id)), mode };
              },
            };
      };
      /**
       * A manager for one harness and one mode; `reviewChanges` makes a run
       * that committed wait for your review. The kit's own mode keeps the
       * names its runs were always recorded under; another mode's carry its name.
       */
      const manager = (id: string, harness: Harness, modeName: string, reviewChanges: boolean) => {
        const name = `${CODER_FLOW}-${id}${modeName === KIT_MODE ? "" : `-${modeName}`}${reviewChanges ? "-reviewed" : ""}`;
        const mode = resolved.modes[modeName]!;
        const workspace = mode.workspace ?? options.workspace;
        const built = harnessManager({
          name,
          ledgers: conversationLedgers,
          tenant: undefined,
          mode: mode.spec,
          workspace,
          ...(options.idleTimeoutMs === undefined ? {} : { idleTimeoutMs: options.idleTimeoutMs }),
          ...(options.runTimeoutMs === undefined ? {} : { runTimeoutMs: options.runTimeoutMs }),
          harnessLabel: harness.label ?? harness.id,
          ...(options.branchPrefix === undefined ? {} : { branchPrefix: options.branchPrefix }),
          harness: harness.agent,
          reviewChanges,
          // The task's own `issue`, which the filing check validated; a stored row's plain field that isn't
          // a tracker issue is a filer's word, as it was before tasks declared their input (BP-030).
          trackerIssueOf: (input: unknown) => {
            const issue = (input as { issue?: unknown } | null | undefined)?.issue;
            return isTrackerIssue(issue) ? issue : undefined;
          },
          ...(options.judge === false ? {} : { judge: goalJudge({ name: `${name}-judge` }) }),
          awaitPullRequests: options.pullRequests !== false,
          ...(follower === undefined ? {} : { onPullRequestRecorded: follower }),
          ...(options.approveTools === true ? { approveTools: true } : {}),
          // A mode may work in its task's project when the kit doesn't, or not when it does.
          ...((mode.project ?? options.project) === true ? { uses: [projectWorkspaceCapability] } : {}),
        });
        // The claim gate shares a task's child session between tasks, so a harness that authors
        // session state beneath `work` would corrupt another task's: refused here, at start, naming the entry.
        assertDispatchEntrySupported({ name: CODER_FLOW, target: "work", block: built });
        return built;
      };
      const modeNames = Object.keys(resolved.modes);
      /**
       * One harness's managers, by the mode each task runs. With one mode
       * there is nothing to pick, and its manager is used as it is: the block
       * tree stays what it was before an app could register modes.
       */
      const byMode = (id: string, harness: Harness, reviewChanges: boolean) => {
        const managers = Object.fromEntries(modeNames.map((modeName) => [modeName, manager(id, harness, modeName, reviewChanges)]));
        if (modeNames.length === 1) return managers[modeNames[0]!]!;
        return router({
          name: `${CODER_FLOW}-${id}-by-mode${reviewChanges ? "-reviewed" : ""}`,
          inputSchema: taskWorkerInputSchema.passthrough(),
          routes: Object.values(managers),
          execute: (task) => managers[modeOfTask(task.input, resolved)]!,
        });
      };
      const built = Object.fromEntries(
        Object.entries(harnesses).map(([id, harness]) => [
          id,
          {
            manager: byMode(id, harness, false),
            reviewed: byMode(id, harness, true),
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
        // The kit's review is a floor: a worker's `review:` can turn it on, never off, so a worker anyone
        // can hire never settles a change no user saw.
        const review = options.review === true || worker.config.review === true;
        return { ...found, id, manager: review ? found.reviewed : found.manager, worker };
      };
      /**
       * Route by the session's worker; a run that starts work first checks the mode its task's checked
       * input names, then asks whether its harness can run here. The harness chosen is noted for the
       * request, so a task its coding session files carries it.
       */
      const byHarness = (name: string, inputSchema: z.ZodTypeAny, pick: (b: Built) => BlockDefinition<any, any>, ready: boolean) =>
        router({
          name,
          inputSchema,
          routes: [...new Set(Object.values(built).flatMap((b) => [pick(b), pick({ ...b, manager: b.reviewed })]))],
          resources: installation.resources,
          execute: async (input, ctx) => {
            const task = ((input as { input?: unknown }).input ?? {}) as Record<string, unknown>;
            if (ready) {
              // The claim re-checks what the filing did: the app's modes or a mode's `requires` may have changed.
              const problem = modeProblem(task, resolved);
              if (problem !== undefined) throw new Error(`${problem.code}: ${problem.text} Nothing ran.`);
            }
            const chosen = await harnessOf(ctx);
            if (ready) {
              // And the worker's lock, read as this claim resolves the worker: one set after the filing refuses it here.
              const locked = taskLockProblem(chosen.worker, task, { modes: resolved, harnesses: ids, ...(options.defaultHarness === undefined ? {} : { defaultHarness: options.defaultHarness }) });
              if (locked !== undefined) throw new Error(`${locked.code}: ${locked.text} Nothing ran.`);
              const missing = await refusal(chosen.id);
              if (missing !== undefined) throw new Error(missing);
            }
            noteRunSettings((ctx as { session: object }).session, { harness: chosen.id });
            return pick(chosen);
          },
        });
      /**
       * The task as a coding route reads it: its input as stored, trusted as far as the row's stamp
       * says (`trustedCodingInput`). The row is read from the board the claim names, never from the
       * input the route was handed, so a field a filer wrote on a row the check never stamped decides nothing.
       */
      const trusted = (name: string, block: BlockDefinition<any, any>) =>
        sequencer({ name, inputSchema: taskWorkerInputSchema.passthrough() }).step(
          async (task: { taskId: string; input?: unknown; claim?: { collectionId: string; partition?: string } }, ctx: never) => {
            const claim = task.claim;
            const ledger = claim === undefined ? undefined : await conversationLedgers(claim.collectionId, ctx, claim.partition, task.taskId);
            const stored = ledger?.get(task.taskId);
            const stamped = stored !== undefined && stampMatches(stored, CODER_FLOW, declaration);
            return { ...task, input: trustedCodingInput((task.input ?? {}) as Record<string, unknown>, stamped, resolved) };
          },
          block,
        ) as BlockDefinition<any, any>;
      const anyDoor = Object.values(built)[0]!.door;
      // The app's documents meet the installation's by the flow-build rule: a shared accessor must be the same resource.
      const flowResources = mergeDeclaredResources(options.worker?.resources, { ...installation.resources, ...workerMessagesResources });
      const appActions = options.worker?.actions?.(installation) ?? {};
      const taken = Object.keys(appActions).filter((name) => name === "respond" || name === "harness" || name === REFRESH_PULL_REQUESTS);
      if (taken.length > 0) {
        throw new Error(`${CODER_FLOW}: the app's \`worker.actions\` declares ${taken.map((name) => `"${name}"`).join(", ")}, which the flow already serves.`);
      }

      return requireAppSettings(defineFlow({
        kind: CODER_FLOW,
        description: "The coding worker flow: a worker that codes runs each task here, in a coding harness.",
        cardinality: "collection",
        // Optional only so the shared copy, which carries no worker's settings, can be built.
        configSchema: settingsSchema,
        session: installation.session(),
        // FIX-2725: a run's plan and pull requests; FIX-2796: what it changed, a file's patch at a time. Both read in its own session.
        views: { [RECORDED_WORK_VIEW]: recordedWorkView(), [RUN_CHANGES_VIEW]: harnessRunChangesView({ name: CODER_FLOW, board }) },
        resources: flowResources,
        actions: {
          ...appActions,
          respond: { ...anyDoor, block: byHarness(`${CODER_FLOW}-door`, anyDoor.inputSchema, (b) => b.door.block, false) },
          harness: {
            inputSchema: z.object({}),
            block: handler({
              name: `${CODER_FLOW}-harness`,
              inputSchema: z.object({}),
              outputSchema: z.object({ harness: z.string() }),
              resources: installation.resources,
              execute: async (_input, ctx) => ({ harness: (await harnessOf(ctx)).id }),
            }),
          },
          // A screen listing a run's pull requests reads their states again from GitHub through this: the
          // record is otherwise written only by the run and by its task's wait, so one merged after the task
          // ended would read `open` for good. Beside a running turn, never its resume target.
          [REFRESH_PULL_REQUESTS]: {
            inputSchema: z.object({}),
            concurrency: "allow",
            autoResume: false,
            block: handler({
              name: `${CODER_FLOW}-refresh-pull-requests`,
              inputSchema: z.object({}),
              outputSchema: z.object({ read: z.number(), unreadable: z.number() }),
              resources: { [OBSERVED_PULL_REQUESTS]: observedPullRequestsCollection },
              execute: async (_input, ctx) => {
                // Every row names its repository, so `gh` needs no checkout of it.
                const done = await refreshRecordedPullRequests(ctx, { cwd: process.cwd(), timeoutMs: NETWORK_CALL_TIMEOUT_MS });
                return { read: done.read.length, unreadable: done.unreadable.length };
              },
            }),
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
            // The steer hands the row as stored: its input is read as the claim reads it, so it runs in the mode
            // the claim ran it in, never by a field on its raw input (FIX-2878).
            onTaskSteered: steerTurnEntry({
              name: `${CODER_FLOW}-steer-turn`,
              block: trusted(`${CODER_FLOW}-steer-read`, byHarness(`${CODER_FLOW}-steer`, taskWorkerInputSchema.passthrough(), (b) => b.manager, true)),
            }),
          },
        },
        task: {
          actions: {
            work: workerTaskEntry({
              name: `${CODER_FLOW}-work`,
              block: trusted(`${CODER_FLOW}-work-read`, byHarness(`${CODER_FLOW}-by-harness`, taskWorkerInputSchema.passthrough(), (b) => b.manager, true)),
              // What a coding task takes (FIX-2878): its mode and issue, the run settings the server fills, and,
              // with `project`, a project to work in, refused at filing when it has none (FIX-2894).
              inputSchema: declaration,
            }),
          },
        },
      }), options.worker?.settings);
    },
    // Each coding worker's `harness:` rides on its roster row, so a task line can name it.
    { roles: ["contributor"], showSettings: ["harness"] },
  );
}
