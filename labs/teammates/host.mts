// fallow-ignore-file duplicate-export -- each starter is its own app, and its host exposes the same checkCommands as the others on purpose.
/** The lab's server, from package pieces: the README's "The host" says what each piece is for and what each option sets. */
import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { claudeCode } from "@flow-state-dev/claude-code";
import { codexHarness } from "@flow-state-dev/codex";
import type { ModelResolver, PrincipalResolutionContext } from "@flow-state-dev/core/types";
import { cursorHarness } from "@flow-state-dev/cursor";
import { createFlowState } from "@flow-state-dev/engine";
import { ASK_MARKER_IGNORED, assertPositiveInt, GOAL_JUDGE_MODEL, scriptedHarness, type Harness } from "@flow-state-dev/harness-manager";
import { codingDrainBudgetMs, harnesses } from "@flow-state-dev/harness-manager/kit";
import { system } from "@flow-state-dev/memory";
import { sqliteScheduleIndex, sqliteStores } from "@flow-state-dev/store-sqlite";
import { fetch, search } from "@flow-state-dev/tools";
import { githubTrustedReviewers, operatorGitHub, projectSourceTools } from "@flow-state-dev/workforce";
import { workforce } from "@flow-state-dev/workforce/kit";
import { readWorkforceFolder } from "@flow-state-dev/workforce/loader";
import { checkCommandsFrom, localWorkspaceHost, setupCommandFrom, type WorkspaceSetup } from "@flow-state-dev/workspace";
import { z } from "zod";
import { appContextFlow } from "./flows/lab-context.mts";

/** What {@link openTeammates} builds the host from; the README's "The host" says what each sets. */
export interface TeammatesOptions {
  store: string;
  model: string;
  models?: readonly string[];
  userId: string; user?: (context: PrincipalResolutionContext) => string | undefined;
  workdir: string | undefined;
  runsRoot: string;
  tree?: string;
  runTimeoutMs?: number;
  harness?: string;
  setup?: WorkspaceSetup;
  checks?: readonly string[];
  scriptedHarnessStepMs?: number;
  staleThresholdMs?: number;
  modelResolver?: ModelResolver;
  githubToken?: string;
  githubApiUrl?: string;
}

/** The working folder: an existing git checkout, as an absolute path, never a fallback. @throws When unset, missing or not a checkout. */
export function workingFolder(workdir: string | undefined): string {
  if (workdir === undefined || workdir.trim() === "") throw new Error("teammates: TEAMMATES_WORKDIR is not set. Set it to the git checkout the team works in.");
  const folder = resolve(workdir);
  if (!existsSync(folder) || !statSync(folder).isDirectory()) throw new Error(`teammates: TEAMMATES_WORKDIR names ${folder}, which is not a folder on this machine.`);
  if (!existsSync(join(folder, ".git"))) throw new Error(`teammates: TEAMMATES_WORKDIR names ${folder}, which is not a git checkout.`);
  return folder;
}

/** `TEAMMATES_RUN_TIMEOUT_MS`, checked at start; `undefined` when unset. */
export const runTimeout = (value: string | undefined) => (value === undefined || value.trim() === "" ? undefined : assertPositiveInt("TEAMMATES_RUN_TIMEOUT_MS", Number(value)));
/** `TEAMMATES_SETUP`: one command, split into words, run with no shell; `undefined` when blank. @throws On a shell operator or a split that fails. */
export const setupCommand = (value: string | undefined) => setupCommandFrom(value, "TEAMMATES_SETUP");
/** `TEAMMATES_CHECKS`: `;`-separated commands, each split into words, run with no shell; `undefined` when blank. @throws On a shell operator or a split that fails. */
export const checkCommands = (value: string | undefined) => checkCommandsFrom(value, "TEAMMATES_CHECKS");
/** Where a lab run keeps its store by default: `.fsdev/` beside this file. */
export const defaultStore = () => fileURLToPath(new URL("./.fsdev/teammates.sqlite", import.meta.url));

/** The lab's host. @throws When the working folder is unset, missing or not a checkout, or the workers' tree doesn't load. */
export async function openTeammates(options: TeammatesOptions) {
  const workdir = workingFolder(options.workdir);
  const tree = options.tree ?? fileURLToPath(new URL("./workforce", import.meta.url));
  // Who each worker hands work to, and who picks the reviewers' tool: a read of the tree the kit installs, claiming nothing.
  const declared = (await readWorkforceFolder({ path: tree, claim: () => undefined })).workers.map((w) => [w.id, w.declared.delegates, w.declared.capabilities] as const);
  const delegates = Object.fromEntries(declared.filter(([, d]) => d === "all" || Array.isArray(d)).map(([id, d]) => [id, d])) as Record<string, "all" | string[]>;
  const mem = system({ model: options.model, working: { capacity: 7 }, episodic: true, semantic: true });
  const workspace = localWorkspaceHost({ root: options.runsRoot, remotes: { allow: [] }, localRepositories: [workdir], source: () => ({ kind: "repo", repo: workdir }), ...(options.setup === undefined ? {} : { setup: options.setup }) });
  const runTimeoutMs = options.runTimeoutMs ?? 20 * 60_000;
  const checks = { commands: options.checks ?? [], timeoutMs: 10 * 60_000 };
  const harness = options.harness ?? "cursor";
  const models = [...new Set([options.model, ...(options.models ?? [])])];
  const folderProblem = workspace.checkRepository!(workdir, { ignored: ASK_MARKER_IGNORED }).then(
    (answer) => (answer.usable ? null : answer.problem),
    (error: unknown) => `couldn't check the folder: ${error instanceof Error ? error.message : String(error)}`,
  );
  void folderProblem.then((problem) => problem !== null && console.warn(`teammates: ${problem}`));
  const scripted = options.scriptedHarnessStepMs;
  const stub = (id: string, label: string): Harness => ({ id, label, agent: scriptedHarness({ stepEveryMs: scripted! }).slot, readiness: async () => ({ ready: true }), pass: [] });
  const beside = (index: string) => options.store.replace(/(\.[^./\\]+)?$/, `-${index}$1`);
  const reviewers = githubTrustedReviewers({ operator: options.userId, judgeModel: GOAL_JUDGE_MODEL, holders: declared.filter(([, , c]) => Object.hasOwn((c ?? {}) as object, "githubReviewers")).map(([id]) => id) });
  const github = operatorGitHub({ operator: options.userId, token: options.githubToken, reviewers, ...(options.githubApiUrl === undefined ? {} : { apiUrl: options.githubApiUrl }) });
  return createFlowState({
    kits: [
      workforce({
        directory: tree,
        agent: {
          settings: { icon: z.string().optional(), color: z.string().optional() },
          showSettings: ["icon", "color", "model"],
          retiredSettings: ["harness"],
          model: options.model,
          catalog: { ...projectSourceTools(workspace), search: search(), fetch: fetch() },
          uses: [mem.capability.presets({ recall: false, connect: false, semantic: true, episodic: true }), reviewers.capability],
          afterAnswer: mem.captureFromItems,
          maxSteps: 100,
        },
        routines: { index: sqliteScheduleIndex({ filename: beside("clock") }), providers: [github], poll: { index: sqliteScheduleIndex({ filename: beside("poll") }) } },
        hire: { models },
        github: { provider: github, poll: true },
      }),
      harnesses({ workspace, defaultHarness: harness, review: true, checks, runTimeoutMs, branchPrefix: "teammates/", logReadiness: true, onPullRequestRecorded: reviewers.follow(github) }),
      scripted === undefined ? claudeCode() : claudeCode().without(harnesses.slots.harnesses, "claude-code"),
    ],
    fill: { [harnesses.slots.harnesses]: scripted === undefined ? [codexHarness(), cursorHarness({ model: "composer-2.5" })] : [stub("claude-code", "Claude Code"), stub("codex", "Codex"), stub("cursor", "Cursor")] },
    flows: [appContextFlow(async () => ({ folder: workdir, folderProblem: await folderProblem, setup: options.setup?.command.join(" ") ?? null, checks: [...checks.commands], model: options.model, models, harness, delegates }))],
    stores: { default: { primary: sqliteStores({ filename: options.store }) } },
    durable: true,
    dispatchDrainTimeoutMs: codingDrainBudgetMs({ runTimeoutMs, checks }),
    ...(options.staleThresholdMs === undefined ? {} : { staleSweepThresholdMs: options.staleThresholdMs }),
    resolvePrincipal: (context) => ({ userId: options.user?.(context) ?? options.userId, orgId: "teammates-lab" }),
    devtool: { userId: options.userId },
    models: { default: options.model, intents: { utility: ["openai/gpt-6-luna"] } },
    ...(options.modelResolver === undefined ? {} : { modelResolver: options.modelResolver }),
  });
}
