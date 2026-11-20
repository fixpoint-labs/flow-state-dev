// fallow-ignore-file duplicate-export -- each starter is its own app, and its host exposes the same checkCommands as the others on purpose.
/** The lab's server, from package pieces: the README's "The host" says what each piece is for and what each option sets. */
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { claudeCode } from "@flow-state-dev/claude-code";
import { codexHarness } from "@flow-state-dev/codex";
import { utility } from "@flow-state-dev/core";
import type { FlowInstance, ModelResolver } from "@flow-state-dev/core/types";
import { cursorHarness } from "@flow-state-dev/cursor";
import { createFlowState } from "@flow-state-dev/engine";
import { ASK_MARKER_IGNORED, scriptedHarness, type Harness } from "@flow-state-dev/harness-manager";
import { codingDrainBudgetMs, harnesses } from "@flow-state-dev/harness-manager/kit";
import { sqliteScheduleIndex, sqliteStores } from "@flow-state-dev/store-sqlite";
import { operatorGitHub, projectSourceCapability } from "@flow-state-dev/workforce";
import { workforce } from "@flow-state-dev/workforce/kit";
import { checkCommandsFrom, listedRepository, localWorkspaceHost, sessionRepositorySource, type RunSource, type WorkspaceSetup } from "@flow-state-dev/workspace";
import { defineProjectsFlow, PROJECTS_FLOW } from "./flows/projects.mts";
import { REPOSITORY_FIELD, sessionFields } from "./flows/session-repository.mts";

/** What {@link openClaudeCodeStyle} builds the host from; the README's "The host" says what each sets. */
export interface ClaudeCodeStyleOptions {
  data: string;
  userId: string;
  model: string;
  utilityModel: string;
  answerAgain?: boolean;
  scriptedStepMs?: number;
  repositories: readonly string[];
  setup?: WorkspaceSetup;
  checks?: readonly string[];
  staleThresholdMs?: number;
  checkRepository?: boolean;
  ignoreSessionRepository?: boolean;
  goalFlows?: string;
  modelResolver?: ModelResolver;
  githubToken?: string;
  githubApiUrl?: string;
}

/** The checks `CLAUDE_CODE_STYLE_CHECKS` names, `;`-separated, each one command with no shell. */
export const checkCommands = (value: string | undefined): string[] | undefined => checkCommandsFrom(value, "CLAUDE_CODE_STYLE_CHECKS");

/** The lab's host. */
export async function openClaudeCodeStyle(options: ClaudeCodeStyleOptions): Promise<{ flowState: ReturnType<typeof createFlowState> }> {
  const { data, model, repositories, scriptedStepMs: scripted } = options;
  // The host and its run source need each other: the source checks a repository through the host, so the
  // host is made first and asks the source, built just below, once a run starts.
  const workspace = localWorkspaceHost({
    root: join(data, "runs"),
    remotes: { allow: ["file"] },
    localRepositories: [...repositories],
    source: (ctx) => runSource(ctx),
    ...(options.setup === undefined ? {} : { setup: options.setup }),
  });
  // The workspace host's check of a repository a run could use: a project's create asks it, and a run in an unlisted one.
  const checkRepository =
    options.checkRepository === false ? undefined : (repository: string) => workspace.checkRepository!(listedRepository(repository, repositories) ?? repository, { ignored: ASK_MARKER_IGNORED });
  // A run works in its session's repository, from the session's server-written field; the control answers the first listed.
  const runSource: RunSource =
    options.ignoreSessionRepository === true && repositories[0] !== undefined
      ? () => ({ kind: "repo", repo: repositories[0]! })
      : sessionRepositorySource({ field: REPOSITORY_FIELD, repositories, ...(checkRepository === undefined ? {} : { check: checkRepository }) });
  const titler = () => utility.sessionTitleGenerator({ name: "auto-title", model: options.utilityModel });
  const github = operatorGitHub({ operator: options.userId, token: options.githubToken, ...(options.githubApiUrl === undefined ? {} : { apiUrl: options.githubApiUrl }) });
  const checks = { commands: [...(options.checks ?? [])], timeoutMs: 10 * 60_000 };
  const goalFlows = options.goalFlows === undefined ? [] : ((await import(pathToFileURL(options.goalFlows).href)).default as FlowInstance[]);
  // Set, every harness a worker names is harness-manager's scripted coder under its own id.
  const stub = (id: string, label: string): Harness => ({ id, label, agent: scriptedHarness({ stepEveryMs: scripted! }).slot, readiness: async () => ({ ready: true }), pass: [] });
  const claude = claudeCode({ plan: true });

  const flowState = createFlowState({
    kits: [
      workforce({
        // Read off this file's own path: a bundler rewrites `new URL(…, import.meta.url)` as a page asset.
        directory: join(dirname(fileURLToPath(import.meta.url)), "workforce"),
        agent: { model, ...(options.answerAgain === false ? {} : { answerAgain: true as const }), afterAnswer: titler(), uses: [projectSourceCapability({ workspace })] },
        coordinator: { routeModel: model, agent: { model, afterAnswer: titler() } },
        routines: { index: sqliteScheduleIndex({ filename: join(data, "clock.db") }), providers: [github], poll: { index: sqliteScheduleIndex({ filename: join(data, "poll.db") }) } },
        github: { provider: github, poll: true },
        sessionFields,
      }),
      harnesses({ workspace, checks, branchPrefix: "claude-code-style/", logReadiness: true }),
      scripted === undefined ? claude : claude.without(harnesses.slots.harnesses, "claude-code").without(harnesses.slots.harnesses, "claude-code-plan"),
    ],
    fill: {
      [harnesses.slots.harnesses]:
        scripted === undefined
          ? [codexHarness(), cursorHarness()]
          : [stub("claude-code", "Claude Code"), stub("claude-code-plan", "Claude Code (plan)"), stub("codex", "Codex"), stub("cursor", "Cursor")],
    },
    flows: [defineProjectsFlow({ checkRepository })({ id: PROJECTS_FLOW }), ...goalFlows],
    stores: { default: { primary: sqliteStores({ filename: join(data, "lab.db") }) } },
    durable: true,
    // A shutdown waits for a coding run still going, its checks and judge included.
    dispatchDrainTimeoutMs: codingDrainBudgetMs({ checks }),
    ...(scripted !== undefined && options.staleThresholdMs !== undefined ? { staleSweepThresholdMs: options.staleThresholdMs } : {}),
    resolvePrincipal: () => ({ userId: options.userId, orgId: "claude-code-style-lab" }),
    devtool: { userId: options.userId },
    models: { default: model, intents: { utility: [options.utilityModel] } },
    ...(options.modelResolver === undefined ? {} : { modelResolver: options.modelResolver }),
  });
  return { flowState };
}
