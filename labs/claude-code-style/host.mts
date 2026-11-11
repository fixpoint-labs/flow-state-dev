// fallow-ignore-file duplicate-export -- each lab is its own app, and its host exposes the same openLab and operatorGitHubToken as the others on purpose.
/**
 * The Claude Code-style lab's server, put together from package pieces:
 * the workers in `workforce/`, their flows, the lab's small flows, and a
 * durable SQLite store. `fsdev.config.mts` reads the environment and calls
 * {@link openLab}; the lab's contract tests call it too, with a scripted
 * model, so the real adapter runs over the same host the page does.
 *
 * - `desk.main`, the session-mode main worker, is on the built-in `agent`
 *   flow with `answerAgain: true`: a background result that settles while its
 *   turn runs is taken into that turn (epic D2). The lab writes no block for it.
 * - `desk.researcher` and `desk.thread` are on `agent` too; `desk.lead` is on
 *   the built-in `coordinator` flow.
 * - The `agent` flow carries `projectSourceCapability` over the same host the
 *   coding runs use, so a worker whose file names its `read` preset reads the
 *   session's project itself, from the host's clone at the default branch.
 * - `desk.coder` and `desk.thread-coder` are on the lab's one coding flow,
 *   `harness-thread`; only `desk.thread-coder` waits for your review.
 * - `projects` lists and creates the projects a session works in, `pins`
 *   keeps the threads you pinned, and `dismissals` the failures you dismissed. A project's repository is checked when it is
 *   made, by the workspace host's `checkRepository`: one no coding run could
 *   use here (no such folder, not a git repository, `.fsdev/` not ignored) is
 *   refused, and the picker asks the same check before Create.
 * - `harness-readiness` serves which coding harnesses can run on this machine.
 * - **Routines**: every worker on `agent`, and `desk.lead`'s turn on
 *   `coordinator`, holds the routine tools, so a session can follow a GitHub
 *   pull request or run something on a clock, and list, pause or delete what
 *   it follows. A pull request's events are polled (no public URL) on the
 *   operator's own GitHub token, for the operator alone; `fsdev dev` ticks the
 *   polls and the clock routines, each from a SQLite file of its own in `data`.
 */
import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkClaudeCodeReadiness, CLAUDE_CODE_PASS } from "@flow-state-dev/claude-code";
import { checkCodexReadiness, CODEX_PASS } from "@flow-state-dev/codex";
import { defineFlow, utility } from "@flow-state-dev/core";
import { harnessEnv } from "@flow-state-dev/core/harness";
import type { BlockContext, ModelResolver } from "@flow-state-dev/core/types";
import { checkCursorReadiness, CURSOR_PASS } from "@flow-state-dev/cursor";
import { createFlowState } from "@flow-state-dev/engine";
import { ASK_MARKER_IGNORED, harnessReadiness, harnessReadinessAction, type HarnessReadinessRead } from "@flow-state-dev/harness-manager";
import { createScheduledTransportAdapter } from "@flow-state-dev/scheduled";
import { createSQLiteScheduleIndex, sqliteStores } from "@flow-state-dev/store-sqlite";
import { initializeSchema } from "@flow-state-dev/store-sqlite/host";
import {
  consultSessionsCapability,
  createRoutinesCapability,
  createWorkerInstallation,
  defineAgentWorkerFlow,
  defineCoordinatorFlow,
  githubServiceFlow,
  githubSubscriptionProvider,
  hireWorkforce,
  projectSourceCapability,
  projectWorkspace,
} from "@flow-state-dev/workforce";
import Database from "better-sqlite3";
import { readWorkforce } from "@flow-state-dev/workforce/loader";
import { localWorkspaceHost, type WorkspaceSetup } from "@flow-state-dev/workspace";
import { defineHarnessThreadFlow, HARNESS_THREAD_DRAIN_MS, HARNESS_THREAD_FLOW } from "./workforce/flows/harness-thread.mts";
import { defineDismissalsFlow, DISMISSALS_FLOW } from "./workforce/flows/dismissals.mts";
import { definePinsFlow, PINS_FLOW } from "./workforce/flows/pins.mts";
import { defineProjectsFlow, PROJECTS_FLOW } from "./workforce/flows/projects.mts";

/** What {@link openLab} builds the host from. */
export interface LabOptions {
  /** The folder the SQLite file and each coding run's worktree or clone go in. */
  data: string;
  /** The user the page acts as. */
  userId: string;
  /** The model the workers answer on. */
  model: string;
  /** The smaller model for background work: session titles, and a consult of another conversation (`intent/utility`). */
  utilityModel: string;
  /** False leaves `answerAgain` off the main worker's flow: the goal check's control. Default true. */
  answerAgain?: boolean;
  /** Every coding task runs on harness-manager's scripted coder, one step this far apart. Absent: the real harnesses. */
  scriptedStepMs?: number;
  /** The repositories a run works in a worktree of, by their real paths; any other runs in a clone. */
  repositories: readonly string[];
  /** A command each fresh worktree runs before its run starts. Absent: none. */
  setup?: WorkspaceSetup;
  /** With the scripted coder: how long a silent request waits before the server takes it as interrupted. Absent: one minute. */
  staleThresholdMs?: number;
  /** False leaves the project repository check off: the goal check's control. Default true. */
  checkRepository?: boolean;
  /** A goal check's own flows beside the lab's, from the module this names (its default export lists them). */
  goalFlows?: string;
  /** Resolves every model the host calls, in place of the gateway: tests pass a scripted one. Absent: the gateway. */
  modelResolver?: ModelResolver;
  /**
   * The operator's GitHub token ({@link operatorGitHubToken}): a GitHub routine
   * reads GitHub with it, for {@link userId} only. Absent: a GitHub routine is
   * refused, naming `GITHUB_TOKEN`; clock routines still run.
   */
  githubToken?: string;
  /** GitHub's REST API root. Absent: GitHub's own. A goal check names its stub. */
  githubApiUrl?: string;
}

/**
 * The operator's GitHub token: `GITHUB_TOKEN`, else what `gh auth token`
 * answers, read once at start and never from a request. `undefined` when
 * neither has one.
 */
export function operatorGitHubToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const named = env.GITHUB_TOKEN?.trim();
  if (named !== undefined && named !== "") return named;
  try {
    const signedIn = execFileSync("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10_000 }).trim();
    return signedIn === "" ? undefined : signedIn;
  } catch {
    return undefined;
  }
}

/**
 * GitHub for routines, read with the operator's token and for the operator
 * alone: a GitHub routine another user asks for, or one asked for with no
 * token, is refused naming `GITHUB_TOKEN`, and the token is never lent.
 */
function operatorGitHub(operator: string, token: string | undefined, apiUrl: string | undefined) {
  const reads = (ctx: BlockContext) => (ctx.session.identity as { userId?: string }).userId === operator;
  const github = githubSubscriptionProvider({ token: (ctx) => (reads(ctx) ? token : undefined), ...(apiUrl === undefined ? {} : { apiUrl }) });
  return {
    ...github,
    async canRead(key: string, ctx: BlockContext) {
      if (token === undefined) throw new Error("GitHub routines need GITHUB_TOKEN: set it, or sign in with `gh auth login`, and start the lab again. Nothing was saved.");
      if (!reads(ctx)) throw new Error(`GitHub routines read GitHub with this lab's GITHUB_TOKEN, which serves only ${operator}. Nothing was saved.`);
      return github.canRead(key, ctx);
    },
  };
}

/** A schedule index in a SQLite file of its own: the index has one table, and one index ticks one flow. */
function scheduleIndexAt(filename: string) {
  const db = new Database(filename);
  initializeSchema(db);
  return createSQLiteScheduleIndex(db);
}

/** The lab's host, and its readiness reader so the caller can log it at start. */
export async function openLab(options: LabOptions): Promise<{ flowState: ReturnType<typeof createFlowState>; readiness: HarnessReadinessRead }> {
  const { data, model } = options;
  const answerAgain = options.answerAgain === false ? {} : { answerAgain: true as const };
  const scripted = options.scriptedStepMs === undefined ? {} : { scriptedStepMs: options.scriptedStepMs };
  const stale = options.scriptedStepMs !== undefined && options.staleThresholdMs !== undefined ? { staleSweepThresholdMs: options.staleThresholdMs } : {};
  /** A project's repository as one of `repositories`, when it is one: a `file://` remote or a path. */
  const listed = (repository: string) => {
    const path = repository.startsWith("file://") ? fileURLToPath(repository) : repository;
    const real = isAbsolute(path) && existsSync(path) ? realpathSync(path) : undefined;
    return real !== undefined && options.repositories.includes(real) ? real : undefined;
  };
  const source = projectWorkspace();
  const workspace = localWorkspaceHost({
    root: join(data, "runs"),
    remotes: { allow: ["file"] },
    localRepositories: [...options.repositories],
    source: async (ctx) => {
      const answer = await source(ctx);
      const local = answer.kind === "repo" ? listed(answer.repo) : undefined;
      return answer.kind === "repo" && local !== undefined ? { ...answer, repo: local } : answer;
    },
    ...(options.setup === undefined ? {} : { setup: options.setup }),
  });

  const tree = await readWorkforce(fileURLToPath(new URL("./workforce", import.meta.url)));
  if (tree.errors.length > 0) throw new Error(`workforce/ did not load: ${tree.errors.map((e) => e.error.message).join("; ")}`);

  /** Core's session title generator, one per flow that runs it. */
  const titler = () => utility.sessionTitleGenerator({ name: "auto-title", model: options.utilityModel });

  let flows = {};
  const installation = createWorkerInstallation({ standardWorkers: tree.workers, workerFlows: () => flows });
  flows = {
    // Titles each session after its turn (core's sessionTitleGenerator, a background step): the sessions list reads the title it writes.
    agent: defineAgentWorkerFlow({
      installation,
      model,
      ...answerAgain,
      afterAnswer: titler(),
      // The routine tools, offered to a worker whose file picks `routines: [tools]` (each one here).
      uses: [projectSourceCapability({ workspace }), consultSessionsCapability(installation), createRoutinesCapability(installation)],
    }),
    // Threads mode's main session is titled the same way, so its row names what the session is about.
    coordinator: defineCoordinatorFlow({ installation, routeModel: model, agent: { model, afterAnswer: titler(), uses: [createRoutinesCapability(installation)] } }),
    // Its runs work in the session's project: a task filed with none is refused at filing (FIX-2333).
    [HARNESS_THREAD_FLOW]: { flow: defineHarnessThreadFlow({ installation, workspace, ...scripted }), roles: ["contributor"], needsProject: true },
  };
  // Clock routines and GitHub's polls tick from two files beside the store (`fsdev dev` ticks both).
  const clockDb = join(data, "clock.db");
  const pollDb = join(data, "poll.db");
  const github = operatorGitHub(options.userId, options.githubToken, options.githubApiUrl);
  const workers = hireWorkforce(installation, {
    routines: {
      index: scheduleIndexAt(clockDb),
      providers: [github],
      poll: { index: scheduleIndexAt(pollDb) },
    },
  }) as { id: string }[];
  const service = githubServiceFlow({ provider: github, installation, poll: true }) as unknown as { id: string };
  // A project is checked when it's made, by the same rule a run's checkout passes:
  // a repository no run could use here is refused before its first task (FIX-2403).
  // It is asked about the repository a run will get: a listed one by its real path, as
  // `source` hands it over, so the picker says worktree where the run makes one.
  const checkRepository =
    options.checkRepository === false
      ? undefined
      : (repository: string) => workspace.checkRepository!(listed(repository) ?? repository, { ignored: ASK_MARKER_IGNORED });
  const projects = defineProjectsFlow({ checkRepository })({ id: PROJECTS_FLOW }) as { id: string };
  const pins = definePinsFlow()({ id: PINS_FLOW }) as { id: string };
  const dismissals = defineDismissalsFlow()({ id: DISMISSALS_FLOW }) as { id: string };

  /** Which harnesses a coding thread can run on here, over the environment each run gets. */
  const readiness = harnessReadiness({
    "claude-code": { label: "Claude Code", check: (o) => checkClaudeCodeReadiness({ env: harnessEnv({ pass: CLAUDE_CODE_PASS }), signal: o?.signal }) },
    codex: { label: "Codex", check: (o) => checkCodexReadiness({ env: harnessEnv({ pass: CODEX_PASS }), timeoutMs: 30_000, signal: o?.signal }) },
    cursor: { label: "Cursor", check: () => checkCursorReadiness(harnessEnv({ pass: CURSOR_PASS })) },
  });
  const readinessFlow = defineFlow({ kind: "harness-readiness", actions: { read: harnessReadinessAction(readiness) } } as never)({
    id: "harness-readiness",
  } as never) as { id: string };

  // A goal check's own flows beside the lab's, as a stand-in for a service the lab doesn't run.
  const goalFlows = options.goalFlows === undefined ? [] : ((await import(pathToFileURL(options.goalFlows).href)).default as { id: string }[]);

  const flowState = createFlowState({
    flows: [...workers, service, projects, pins, dismissals, readinessFlow, ...goalFlows],
    stores: { default: { primary: sqliteStores({ filename: join(data, "lab.db") }) } },
    // The route `serve()`'s tick dispatches each due clock routine and poll to.
    adapters: [createScheduledTransportAdapter()],
    // A coding run's review and a thread's question wait on you across a restart.
    durable: true,
    // A shutdown waits for a coding run still going, its checks and judge too (FIX-2484).
    dispatchDrainTimeoutMs: HARNESS_THREAD_DRAIN_MS,
    ...stale,
    devtool: { userId: options.userId },
    // A consult of another conversation reads on `intent/utility`, a smaller model.
    models: { default: model, intents: { utility: [options.utilityModel] } },
    ...(options.modelResolver === undefined ? {} : { modelResolver: options.modelResolver }),
  } as never);
  return { flowState, readiness };
}
