/**
 * Which harness this tree puts in the `coder` worker flow's slot when it is served
 * as a team profile: DevTeam (`fsdev.config.mts`) or `fsd` (`fsd.fsdev.config.mts`).
 *
 *     DEVFORCE_LAB_HARNESS=stub pnpm --filter @flow-state-dev/shift-manager start
 *
 * Four choices. Each profile names its default ({@link startHarness}); DevTeam's
 * is `stub`, `fsd`'s is `claude-code`. {@link HARNESS_ENV} overrides it:
 *
 * - **`stub`**: the lab's scripted run, no model. It says what it
 *   is doing in the run's session, then writes one file in its checkout and
 *   commits it, so the implement phase's done-condition (a commit the base ref
 *   does not have) is met and an approved row settles `completed`. It ends
 *   with a one-line answer, which is what a conversation's task needs. The bare
 *   `harnessStub()` the config used before did neither: every attempt finished
 *   with no step and no commit, and the row went back to pending with nothing
 *   left to run it.
 * - **`claude-code`**: a real coding agent, Claude Code through its Agent SDK,
 *   set up exactly as the honesty check (`it-commits-from-the-workers-own-file`)
 *   sets it up. Needs a signed-in SDK or an Anthropic key. Nothing falls back
 *   to the stub when it is not there: a run that quietly used the stub would be
 *   reported as a model's. At start, {@link startHarness} asks Claude Code for
 *   an account (`probeClaudeAccount`) and refuses to start without one.
 * - **`codex`** / **`cursor`**: Codex or Cursor through its SDK, each handed
 *   only its own environment pass-list (`CODEX_PASS`, `CURSOR_PASS`). Neither
 *   is asked for a sign-in at start: a run with none fails, and says why, in
 *   the run itself. Neither takes the project's MCP servers the Lab relays,
 *   nor reports usage windows.
 *
 * One harness serves the whole process; a choice per task is a later change.
 * Every real run may take {@link RUN_MINUTES_ENV} minutes,
 * {@link DEFAULT_RUN_MINUTES} by default.
 *
 * An unknown value is refused at startup rather than read as the default.
 * Either way, a start that goes ahead prints one line naming the coder.
 */

import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLAUDE_CODE_PASS, claudeCodeAgent, probeClaudeAccount, type ClaudeAccountProbe } from "@flow-state-dev/claude-code/sdk";
import { CODEX_PASS, codexAgent } from "@flow-state-dev/codex";
import { CURSOR_PASS, cursorAgent } from "@flow-state-dev/cursor";
import { harnessEnv } from "@flow-state-dev/core";
import {
  mcpCredentialsCapability,
  projectWorkspaceCapability,
  type ErrorReporterHarnessFeeds,
  type ProjectMcpToolsResolver,
} from "@flow-state-dev/workforce";
import type { HarnessBlock } from "@flow-state-dev/core/types";
import type { HarnessFeeds as ManagerHarnessFeeds } from "@flow-state-dev/harness-manager";
import { harnessStub, type StubRun } from "@flow-state-dev/harness-manager";
import { commitAll, hasChanges } from "./scratch-repo.mts";

/** The environment variable that picks the harness. */
export const HARNESS_ENV = "DEVFORCE_LAB_HARNESS";

/** The harnesses a served Lab can run. */
export const HARNESS_CHOICES = ["stub", "claude-code", "codex", "cursor"] as const;
export type HarnessChoice = (typeof HARNESS_CHOICES)[number];

/**
 * The feeds the harness manager hands a slot, and the Lab's own: the run's
 * MCP servers, relayed through the Lab's own connection, when the Lab offers
 * any (`openLab({ mcpServers })`). A harness that takes relayed tools hands
 * them to its run; one that doesn't says so in the run's session. Claude Code
 * hands `onUsage` the usage windows its runs report; the stub reports none.
 */
export interface HarnessFeeds extends ManagerHarnessFeeds {
  mcpTools?: ProjectMcpToolsResolver;
}

/** A chosen harness: its name, the slot, and how long one run may take. */
export interface SelectedHarness {
  name: HarnessChoice;
  slot: (feeds: HarnessFeeds) => HarnessBlock;
  runTimeoutMs: number;
}

/**
 * The environment a Claude Code run on the Lab coding path gets, and the one
 * its account is probed with: only the variables the Claude Code package's
 * {@link CLAUDE_CODE_PASS} names. Without a list the run inherits all of the
 * server's — the store path, any repository or tracker token it was started
 * with — and its model has a shell.
 */
export function claudeCodeEnv(): Record<string, string> {
  return harnessEnv({ pass: CLAUDE_CODE_PASS });
}

/** The environment a Codex run gets: only {@link CODEX_PASS}. */
export function codexEnv(): Record<string, string> {
  return harnessEnv({ pass: CODEX_PASS });
}

/** The environment a Cursor run gets: only {@link CURSOR_PASS}. */
export function cursorEnv(): Record<string, string> {
  return harnessEnv({ pass: CURSOR_PASS });
}

/**
 * Codex in the slot. It works where the manager places it and continues the
 * session the manager names, on {@link codexEnv} only. The Lab's relayed MCP
 * servers are not handed to it: Codex takes no relayed tools. Its sandbox is
 * `workspace-write`: Codex's own default is read-only, and a coder that can't
 * write can't make the commit the phase waits for.
 */
export function codexHarness({ cwd, resume, onSession, onActivity }: HarnessFeeds): HarnessBlock {
  return codexAgent({
    cwd,
    resume,
    onSession,
    onActivity,
    client: { env: codexEnv() },
    thread: { sandboxMode: "workspace-write" },
    name: "codex",
  } as never) as unknown as HarnessBlock;
}

/** The model a Cursor run uses: Cursor's own pick ("Auto"), which every account's catalog has. */
const CURSOR_MODEL = "default";

/**
 * Cursor in the slot, as {@link codexHarness} is, on {@link cursorEnv} only,
 * which also runs Cursor's runtime in a process of its own. Cursor's SDK
 * refuses a local agent with no model, so it names Cursor's own pick.
 */
export function cursorHarness({ cwd, resume, onSession, onActivity }: HarnessFeeds): HarnessBlock {
  return cursorAgent({ cwd, resume, onSession, onActivity, env: cursorEnv(), model: CURSOR_MODEL, name: "cursor" } as never) as unknown as HarnessBlock;
}

/**
 * Claude Code in the slot, as the honesty check runs it.
 *
 * `detached: true` because the harness is a child block of the flow's gated
 * task entry, and the claim gate refuses an entry that authors session state
 * beneath it. `recordWork: true` keys the index of what the run touched to the
 * run's own checkout, which is what the task inspector's plan and files read.
 * `env` passes only {@link CLAUDE_CODE_PASS}: a server's `seedEnv` is never on
 * it, since the key reaches the run's tools through the Lab's connection, not
 * the run.
 *
 * No `maxTurns`: the SDK's default is no cap, and a real coding run takes
 * many turns, so a small cap ends it mid-task as `error_max_turns`. The run is
 * bounded by the harness manager's run timeout instead.
 *
 * With `mcpTools`, the run is handed its project's MCP servers and nothing
 * else, and the block holds the project and key collections the resolver
 * reads. Without, the options are exactly what they were.
 */
export function claudeCodeHarness({ mcpTools, ...feeds }: HarnessFeeds): HarnessBlock {
  return claudeCodeAgent({
    ...feeds,
    ...(mcpTools === undefined ? {} : { mcpTools, uses: [projectWorkspaceCapability, mcpCredentialsCapability] }),
    env: claudeCodeEnv(),
    detached: true,
    recordWork: true,
    allowedTools: ["Read", "Write", "Edit", "Bash"],
    permissionMode: "acceptEdits",
    systemPrompt:
      "You are a coding agent working in the directory you have been placed in. " +
      "Do what your instructions and your brief say, then commit your work with git. " +
      "Do nothing else.",
  } as never) as unknown as HarnessBlock;
}

/**
 * Claude Code as the Error Reporter's harness (FIX-1983): read and search
 * only. `env` passes only {@link CLAUDE_CODE_PASS}, as the coder's does: the
 * tracker's key reaches the run through the Lab's connection, never the run.
 */
export function errorReporterHarness({ cwd, mcpTools }: ErrorReporterHarnessFeeds): HarnessBlock {
  return claudeCodeAgent({
    cwd,
    ...(mcpTools === undefined ? {} : { mcpTools, uses: [projectWorkspaceCapability, mcpCredentialsCapability] }),
    env: claudeCodeEnv(),
    detached: true,
    allowedTools: ["Read", "Grep", "Glob"],
    disallowedTools: ["Write", "Edit", "MultiEdit", "NotebookEdit", "Bash"],
    permissionMode: "default",
    // Kept: this harness is called straight from the Error Reporter flow, with no manager run timeout above it.
    maxTurns: 40,
    systemPrompt:
      "You investigate failures in the code in your working directory and write bug reports about them. " +
      "Read and search the code; never change a file. Do what the prompt asks, then answer as it says.",
  } as never) as unknown as HarnessBlock;
}

/** The row line the manager's prompt carries, `Row <id>, phase <p>, attempt <n>.` */
function rowLine(prompt: string): string {
  return prompt.split("\n").find((line) => line.startsWith("Row ")) ?? "a row";
}

/**
 * What the scripted run does where it works: one file, committed when that is
 * a checkout. A project with no repository runs in its files (`workspace/`,
 * no git), where the file itself is the work and the manager saves it back.
 *
 * A retry runs in the checkout its first attempt left, where that attempt
 * already committed this same file. With nothing new to commit, `git commit`
 * fails, and that failure would replace why the first attempt was sent back
 * (most often the judge's verdict). The commit is skipped instead: the
 * attempt's work is already on the row's branch.
 *
 * @param run The attempt, as the stub hands it to `duringRun`.
 */
export function commitScriptedWork(run: StubRun): void {
  writeFileSync(join(run.cwd, "SCRIPTED-RUN.md"), `A scripted run, no model.\n\n${rowLine(run.prompt)}\n`);
  if (existsSync(join(run.cwd, ".git")) && hasChanges(run.cwd)) commitAll(run.cwd, "scripted run: note the row");
}

/**
 * The pause before each scripted step. Long enough that a run opened from Tasks
 * is still running and its steps arrive while you watch; short enough that it
 * settles in seconds.
 */
export const SCRIPTED_STEP_MS = 2_000;

/**
 * Overrides {@link SCRIPTED_STEP_MS}, in milliseconds. A test that only needs
 * the run to settle sets it to `0` so it does not wait out the pacing.
 */
export const STEP_MS_ENV = "DEVFORCE_LAB_STEP_MS";

/** How long one scripted run may take: five paced steps and a commit. */
export const SCRIPTED_RUN_TIMEOUT_MS = 60_000;

/** How long one run on a real harness may take, in minutes, when {@link RUN_MINUTES_ENV} names none. */
export const DEFAULT_RUN_MINUTES = 20;

/**
 * Overrides how long one run may take, in whole minutes, for any harness, the
 * scripted run included. A real FSD issue can need more than the default.
 */
export const RUN_MINUTES_ENV = "DEVFORCE_LAB_RUN_MINUTES";

/** How long one Claude Code run may take with no {@link RUN_MINUTES_ENV}: for checks that build a Lab by hand. */
export const CLAUDE_CODE_RUN_TIMEOUT_MS = DEFAULT_RUN_MINUTES * 60_000;

/**
 * The scripted run a served Lab uses by default: narrates a step every
 * `stepEveryMs`, commits, finishes.
 *
 * @param stepEveryMs The pause before each step; {@link SCRIPTED_STEP_MS} by default.
 * @returns The stub, whose `runs` log what each attempt was handed.
 */
export function scriptedHarness(stepEveryMs: number = SCRIPTED_STEP_MS) {
  return harnessStub({
    steps: [
      "Reading the worker's instructions, brief and conventions.",
      "Planning the change for this row.",
      "Writing SCRIPTED-RUN.md in the checkout.",
      "Checking the checkout before committing.",
      "Committing the work on the row's branch.",
    ],
    stepEveryMs,
    duringRun: commitScriptedWork,
    mcpUses: [projectWorkspaceCapability],
    // What a conversation's task reads back: an answer task is done only with one.
    finalMessage: "A scripted run, no model: it wrote SCRIPTED-RUN.md.",
  });
}

/**
 * Pick the harness from the environment.
 *
 * @param value The raw choice, `process.env[HARNESS_ENV]` by default. Empty or
 *   absent means `defaultChoice`.
 * @param stepMs The stub's step pause, `process.env[STEP_MS_ENV]` by default.
 *   Empty or absent means {@link SCRIPTED_STEP_MS}.
 * @param defaultChoice The profile's coder when `value` names none; `stub` by default.
 * @param runMinutes One run's budget in minutes, `process.env[RUN_MINUTES_ENV]`
 *   by default. Empty or absent means {@link DEFAULT_RUN_MINUTES} on a real
 *   harness and {@link SCRIPTED_RUN_TIMEOUT_MS} on the stub.
 * @returns The chosen harness. No credential is checked here: a served Lab
 *   starts through {@link startHarness}, which checks it.
 * @throws When the value names no harness this Lab can run, `stepMs` is not
 *   a whole number of milliseconds, or `runMinutes` is not a positive whole
 *   number of minutes.
 */
export function selectHarness(
  value: string | undefined = process.env[HARNESS_ENV],
  stepMs: string | undefined = process.env[STEP_MS_ENV],
  defaultChoice: HarnessChoice = "stub",
  runMinutes: string | undefined = process.env[RUN_MINUTES_ENV],
): SelectedHarness {
  const choice = value === undefined || value.trim() === "" ? defaultChoice : value.trim();
  const budget = readRunMinutes(runMinutes);
  const real = budget ?? DEFAULT_RUN_MINUTES * 60_000;
  switch (choice) {
    case "stub":
      return { name: "stub", slot: scriptedHarness(readStepMs(stepMs)).slot, runTimeoutMs: budget ?? SCRIPTED_RUN_TIMEOUT_MS };
    case "claude-code":
      return { name: "claude-code", slot: claudeCodeHarness, runTimeoutMs: real };
    case "codex":
      return { name: "codex", slot: codexHarness, runTimeoutMs: real };
    case "cursor":
      return { name: "cursor", slot: cursorHarness, runTimeoutMs: real };
    default:
      throw new Error(
        `${HARNESS_ENV}="${choice}" names no harness this Lab can run; use one of ${HARNESS_CHOICES.join(", ")}.`,
      );
  }
}

/** Options for {@link startHarness}. Each defaults to what a served Lab uses. */
export interface StartHarnessOptions {
  /** The raw choice; `process.env[HARNESS_ENV]` by default. */
  value?: string | undefined;
  /** The stub's step pause; `process.env[STEP_MS_ENV]` by default. */
  stepMs?: string | undefined;
  /** One run's budget in minutes; `process.env[RUN_MINUTES_ENV]` by default. */
  runMinutes?: string | undefined;
  /** Asks Claude Code for an account; `probeClaudeAccount` over the run's own environment by default. */
  probe?: () => Promise<ClaudeAccountProbe>;
  /** Where the start line goes; stderr by default. */
  log?: (line: string) => void;
}

/**
 * Pick a served Lab's coder at start: {@link selectHarness} with the profile's
 * default, then, on Claude Code, ask it for an account before the Lab listens.
 * Codex and Cursor are not asked: their readiness is reported, not refused.
 *
 * On Claude Code, two outcomes, run or refuse. With no account, or no Agent
 * SDK, this throws a message naming what to set, and never hands back the
 * scripted run instead.
 * A start that goes ahead logs one line naming the coder and, on a real
 * harness, its run budget.
 *
 * @param defaultChoice The profile's coder when {@link HARNESS_ENV} names none.
 * @param options Seams for checks; a served Lab passes none.
 * @returns The chosen harness.
 * @throws When the choice or the budget is malformed, or Claude Code was
 *   chosen and has no account or no SDK.
 */
export async function startHarness(defaultChoice: HarnessChoice, options: StartHarnessOptions = {}): Promise<SelectedHarness> {
  const value = "value" in options ? options.value : process.env[HARNESS_ENV];
  const stepMs = "stepMs" in options ? options.stepMs : process.env[STEP_MS_ENV];
  const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  const runMinutes = "runMinutes" in options ? options.runMinutes : process.env[RUN_MINUTES_ENV];
  const harness = selectHarness(value, stepMs, defaultChoice, runMinutes);
  if (harness.name === "stub") {
    log(`Coder: the scripted run, no model (${HARNESS_ENV}=stub).`);
    return harness;
  }
  const budget = `each run may take ${harness.runTimeoutMs / 60_000} minutes (${RUN_MINUTES_ENV})`;
  if (harness.name === "codex" || harness.name === "cursor") {
    log(`Coder: ${harness.name === "codex" ? "Codex" : "Cursor"}, not checked for a sign-in at start; ${budget}.`);
    return harness;
  }
  const account = await (options.probe ?? (() => probeClaudeAccount({ env: claudeCodeEnv() })))();
  if (account.status !== "account") throw new Error(refusalOf(account));
  log(`Coder: Claude Code, on the credential from ${credentialOf(account)}; ${budget}.`);
  return harness;
}


/**
 * Where an account's credential comes from, for the start line: the key or
 * token source the SDK names, else the plan of a subscription sign-in, which
 * names neither.
 */
function credentialOf(account: Extract<ClaudeAccountProbe, { status: "account" }>): string {
  if (account.apiKeySource !== undefined) return account.apiKeySource;
  if (account.tokenSource !== undefined) return account.tokenSource;
  return account.subscriptionType === undefined ? "a Claude sign-in" : `a ${account.subscriptionType} sign-in`;
}

/** Why a Lab on Claude Code won't start, and what to set to start it. */
function refusalOf(account: Exclude<ClaudeAccountProbe, { status: "account" }>): string {
  const stub = `To run the scripted coder instead, which writes one file and needs no credential, set ${HARNESS_ENV}=stub.`;
  if (account.status === "sdk-missing") {
    return `The Claude Code Agent SDK is missing (${account.reason}), so this Lab's coder can't run. Install @anthropic-ai/claude-agent-sdk. ${stub}`;
  }
  return `${account.reason}, so this Lab's coder can't run. Sign in to Claude Code, or set ANTHROPIC_API_KEY, and start again. ${stub}`;
}

/** The budget {@link RUN_MINUTES_ENV} asks for, in milliseconds, or none; refused rather than guessed when malformed. */
function readRunMinutes(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  if (!/^\d+$/.test(raw.trim()) || Number(raw.trim()) === 0) {
    throw new Error(`${RUN_MINUTES_ENV}="${raw}" is not a positive whole number of minutes.`);
  }
  return Number(raw.trim()) * 60_000;
}

/** The step pause {@link STEP_MS_ENV} asks for, refused rather than guessed when malformed. */
function readStepMs(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return SCRIPTED_STEP_MS;
  if (!/^\d+$/.test(raw.trim())) {
    throw new Error(`${STEP_MS_ENV}="${raw}" is not a whole number of milliseconds.`);
  }
  return Number(raw.trim());
}
