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
 *   keeps the threads you pinned, and `harness-readiness` serves which coding
 *   harnesses can run on this machine.
 */
import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkClaudeCodeReadiness, CLAUDE_CODE_PASS } from "@flow-state-dev/claude-code/sdk";
import { checkCodexReadiness, CODEX_PASS } from "@flow-state-dev/codex";
import { defineFlow, harnessEnv } from "@flow-state-dev/core";
import type { ModelResolver } from "@flow-state-dev/core/types";
import { checkCursorReadiness, CURSOR_PASS } from "@flow-state-dev/cursor";
import { createFlowState } from "@flow-state-dev/engine";
import { harnessReadiness, harnessReadinessAction, type HarnessReadinessRead } from "@flow-state-dev/harness-manager";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { consultSessionsCapability, createWorkerInstallation, defineAgentWorkerFlow, defineCoordinatorFlow, hireWorkforce, projectSourceCapability, projectWorkspace } from "@flow-state-dev/workforce";
import { readWorkforce } from "@flow-state-dev/workforce/loader";
import { localWorkspaceHost, type WorkspaceSetup } from "@flow-state-dev/workspace";
import { defineHarnessThreadFlow, HARNESS_THREAD_DRAIN_MS, HARNESS_THREAD_FLOW } from "./workforce/flows/harness-thread.mts";
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
  /** The smaller model a consult of another conversation reads on. */
  utilityModel: string;
  /** False leaves `answerAgain` off the main worker's flow: the goal check's control. Default true. */
  answerAgain?: boolean;
  /** Every coding task runs on harness-manager's scripted coder, one step this far apart. Absent: the real harnesses. */
  scriptedStepMs?: number;
  /** The repositories a run works in a worktree of, by their real paths; any other runs in a clone. */
  repositories: readonly string[];
  /** A command each fresh worktree runs before its run starts. Absent: none. */
  setup?: WorkspaceSetup;
  /** Resolves every model the host calls, in place of the gateway: tests pass a scripted one. Absent: the gateway. */
  modelResolver?: ModelResolver;
}

/** The lab's host, and its readiness reader so the caller can log it at start. */
export async function openLab(options: LabOptions): Promise<{ flowState: ReturnType<typeof createFlowState>; readiness: HarnessReadinessRead }> {
  const { data, model } = options;
  const answerAgain = options.answerAgain === false ? {} : { answerAgain: true as const };
  const scripted = options.scriptedStepMs === undefined ? {} : { scriptedStepMs: options.scriptedStepMs };
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

  let flows = {};
  const installation = createWorkerInstallation({ standardWorkers: tree.workers, workerFlows: () => flows });
  flows = {
    agent: defineAgentWorkerFlow({ installation, model, ...answerAgain, uses: [projectSourceCapability({ workspace }), consultSessionsCapability(installation)] }),
    coordinator: defineCoordinatorFlow({ installation, routeModel: model, agent: { model } }),
    // Its runs work in the session's project: a task filed with none is refused at filing (FIX-2333).
    [HARNESS_THREAD_FLOW]: { flow: defineHarnessThreadFlow({ installation, workspace, ...scripted }), roles: ["contributor"], needsProject: true },
  };
  const workers = hireWorkforce(installation) as { id: string }[];
  const projects = defineProjectsFlow()({ id: PROJECTS_FLOW }) as { id: string };
  const pins = definePinsFlow()({ id: PINS_FLOW }) as { id: string };

  /** Which harnesses a coding thread can run on here, over the environment each run gets. */
  const readiness = harnessReadiness({
    "claude-code": { label: "Claude Code", check: (o) => checkClaudeCodeReadiness({ env: harnessEnv({ pass: CLAUDE_CODE_PASS }), signal: o?.signal }) },
    codex: { label: "Codex", check: (o) => checkCodexReadiness({ env: harnessEnv({ pass: CODEX_PASS }), timeoutMs: 30_000, signal: o?.signal }) },
    cursor: { label: "Cursor", check: () => checkCursorReadiness(harnessEnv({ pass: CURSOR_PASS })) },
  });
  const readinessFlow = defineFlow({ kind: "harness-readiness", actions: { read: harnessReadinessAction(readiness) } } as never)({
    id: "harness-readiness",
  } as never) as { id: string };

  const flowState = createFlowState({
    flows: Object.fromEntries([...workers, projects, pins, readinessFlow].map((copy) => [copy.id, copy])),
    stores: { default: { primary: sqliteStores({ filename: join(data, "lab.db") }) } },
    // A coding run's review and a thread's question wait on you across a restart.
    durable: true,
    // A shutdown waits for a coding run still going, its checks and judge too (FIX-2484).
    dispatchDrainTimeoutMs: HARNESS_THREAD_DRAIN_MS,
    devtool: { userId: options.userId },
    // A consult of another conversation reads on `intent/utility`, a smaller model.
    models: { default: model, intents: { utility: [options.utilityModel] } },
    ...(options.modelResolver === undefined ? {} : { modelResolver: options.modelResolver }),
  } as never);
  return { flowState, readiness };
}
