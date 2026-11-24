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
 *   reported as a model's.
 * - **`codex`** / **`cursor`**: Codex or Cursor through its SDK, each handed
 *   only its own environment pass-list (`CODEX_PASS`, `CURSOR_PASS`). Neither
 *   takes the project's MCP servers the Lab relays, nor reports usage windows.
 *
 * That one is the default coder, for every worker naming no harness.
 * Every run may take {@link RUN_MINUTES_ENV} minutes,
 * {@link DEFAULT_RUN_MINUTES} by default.
 *
 * An unknown value is refused at startup rather than read as the default.
 * Either way, a start that goes ahead prints one line naming the coder.
 *
 * **One list.** {@link startHarness} hands the Lab all four as harness
 * values: the harness kit's coder runs on them and its readiness view lists
 * the same ones. A `coder` worker that names one in its `harness` setting
 * runs on that one instead of the default. Whether a harness can run here
 * never stops a start: the kit logs its readiness, with what to do when it
 * can't, and refuses a task on it at once, saying why.
 */

import { CLAUDE_CODE_PASS, checkClaudeCodeReadiness, claudeCodeAgent } from "@flow-state-dev/claude-code";
import { checkCodexReadiness, CODEX_PASS, codexAgent } from "@flow-state-dev/codex";
import { harnessEnv } from "@flow-state-dev/core/harness";
import { checkCursorReadiness, CURSOR_PASS, cursorAgent } from "@flow-state-dev/cursor";
import {
  mcpCredentialsCapability,
  projectWorkspaceCapability,
  type ErrorReporterHarnessFeeds,
  type ProjectMcpToolsResolver,
} from "@flow-state-dev/workforce";
import type { HarnessBlock, HarnessReadinessCheck } from "@flow-state-dev/core/harness";
import type { Harness, HarnessFeeds as ManagerHarnessFeeds } from "@flow-state-dev/harness-manager";
import { scriptedHarness as sharedScriptedHarness } from "@flow-state-dev/harness-manager";

/** What the scripted run does where it works; harness-manager's, re-exported for this tree's checks. */
export { commitScriptedWork } from "@flow-state-dev/harness-manager";

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

/** A chosen harness: its name, the coder as a harness value, how long one run may take, and what a user calls it. */
export interface SelectedHarness {
  name: HarnessChoice;
  /** The coder, as a harness value for `openLab({ harnesses })`. */
  value: Harness;
  runTimeoutMs: number;
  /** What a user calls it ("Claude Code"), for `openLab`'s `coderHarness`. */
  label: string;
}

/**
 * The environment a Claude Code run on the Lab coding path gets, and the one
 * its readiness is checked over: only the variables the Claude Code package's
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
export function codexHarness({ cwd, resume, onSession, onActivity, onEvent }: HarnessFeeds): HarnessBlock {
  return codexAgent({
    cwd,
    resume,
    onSession,
    onActivity,
    // Every event the run sends keeps it from being stopped for silence.
    onEvent,
    client: { env: codexEnv() },
    // A project with no repository runs in its files, outside git, which Codex refuses without `skipGitRepoCheck`.
    thread: { sandboxMode: "workspace-write", skipGitRepoCheck: true },
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
export function cursorHarness({ cwd, resume, onSession, onActivity, onSteerable, onEvent }: HarnessFeeds): HarnessBlock {
  // `onSteerable`: a user's steer reaches the running turn, since Cursor's stop doesn't wait for its process.
  return cursorAgent({ cwd, resume, onSession, onActivity, onSteerable, onEvent, env: cursorEnv(), model: CURSOR_MODEL, name: "cursor" } as never) as unknown as HarnessBlock;
}

/**
 * What a Claude Code run on the Lab coding path loads from its checkout: the
 * repository's project settings, `CLAUDE.md` and skills, with a settings layer
 * above them that turns every hook off, and never the operator's own user
 * settings. A hook runs by itself, in no transcript, and a turn can write one
 * into `.claude/settings.json` for the next turn. The run works only in a
 * checkout its operator named, so the conventions load with no setting.
 */
const CLAUDE_CODE_REPO_OPTIONS = {
  settingSources: ["project"],
  settings: { disableAllHooks: true },
} as const;

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
    ...CLAUDE_CODE_REPO_OPTIONS,
    detached: true,
    recordWork: true,
    allowedTools: ["Read", "Write", "Edit", "Bash", "Grep", "Glob"],
    permissionMode: "acceptEdits",
    // A string replaces Claude Code's preset (goals/claude-code-harness/it-keeps-its-own-plan). The run's
    // terms and the report it owes are in its brief (harness-manager's `codingBrief`), which every harness reads.
    systemPrompt: { type: "preset", preset: "claude_code" },
  } as never) as unknown as HarnessBlock;
}

/**
 * Claude Code as the Error Reporter's harness (FIX-1983): read and search
 * only. `env` passes only {@link CLAUDE_CODE_PASS}, as the coder's does: the
 * tracker's key reaches the run through the Lab's connection, never the run.
 * It loads what the coder loads ({@link CLAUDE_CODE_REPO_OPTIONS}).
 */
export function errorReporterHarness({ cwd, mcpTools }: ErrorReporterHarnessFeeds): HarnessBlock {
  return claudeCodeAgent({
    cwd,
    ...(mcpTools === undefined ? {} : { mcpTools, uses: [projectWorkspaceCapability, mcpCredentialsCapability] }),
    env: claudeCodeEnv(),
    ...CLAUDE_CODE_REPO_OPTIONS,
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
 * The scripted run a served Lab uses by default: harness-manager's
 * `scriptedHarness`, holding the project workspace for relayed MCP tools.
 *
 * @param stepEveryMs The pause before each step; {@link SCRIPTED_STEP_MS} by default.
 * @returns The stub, whose `runs` log what each attempt was handed.
 */
export function scriptedHarness(stepEveryMs: number = SCRIPTED_STEP_MS) {
  return sharedScriptedHarness({ stepEveryMs, mcpUses: [projectWorkspaceCapability] });
}

/**
 * A harness value this machine always runs: a check's scripted stub under an
 * id, which the readiness view lists as ready.
 *
 * @param agent The block a run runs, from the feeds its manager hands it.
 * @param id What a worker's `harness:` names it by. Default `stub`.
 * @param label What a person sees. Default the id.
 */
export function readyHarness(agent: (feeds: HarnessFeeds) => HarnessBlock, id = "stub", label?: string): Harness {
  return { id, ...(label === undefined ? {} : { label }), agent: agent as Harness["agent"], readiness: async () => ({ ready: true }), pass: [] };
}

/** How long the Codex readiness check waits for its account to answer, as the Codex package's own harness value waits. */
const CODEX_READINESS_TIMEOUT_MS = 30_000;

/**
 * Every harness a served Lab can run, as harness values: the one list the
 * coder runs on and the readiness view reports (the harness kit's
 * `harnesses` slot). The scripted run is always ready; each other one is
 * checked over the environment its runs get.
 *
 * @param stepEveryMs The scripted run's pause before each step.
 * @param check Whether Claude Code can run here. Default the Claude Code package's check over {@link claudeCodeEnv}.
 */
function labHarnesses(stepEveryMs: number, check?: HarnessReadinessCheck): Record<HarnessChoice, Harness> {
  const signalOf = (o?: { signal?: AbortSignal }) => (o?.signal === undefined ? {} : { signal: o.signal });
  return {
    stub: readyHarness(scriptedHarness(stepEveryMs).slot, "stub", "the scripted coder (no model)"),
    "claude-code": {
      id: "claude-code",
      label: "Claude Code",
      agent: claudeCodeHarness as Harness["agent"],
      readiness: check ?? ((o) => checkClaudeCodeReadiness({ env: claudeCodeEnv(), ...signalOf(o) })),
      pass: CLAUDE_CODE_PASS,
    },
    codex: {
      id: "codex",
      label: "Codex",
      agent: codexHarness as Harness["agent"],
      readiness: (o) => checkCodexReadiness({ env: codexEnv(), timeoutMs: CODEX_READINESS_TIMEOUT_MS, ...signalOf(o) }),
      pass: CODEX_PASS,
    },
    cursor: { id: "cursor", label: "Cursor", agent: cursorHarness as Harness["agent"], readiness: () => checkCursorReadiness(cursorEnv()), pass: CURSOR_PASS },
  };
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
 *   starts through {@link startHarness}, whose harness kit reports it.
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
  return selectFrom(value, defaultChoice, runMinutes, labHarnesses(readStepMs(stepMs)));
}

/** {@link selectHarness} over a given set of harness values. */
function selectFrom(
  value: string | undefined,
  defaultChoice: HarnessChoice,
  runMinutes: string | undefined,
  values: Record<HarnessChoice, Harness>,
): SelectedHarness {
  const choice = value === undefined || value.trim() === "" ? defaultChoice : value.trim();
  const budget = readRunMinutes(runMinutes);
  if (!(HARNESS_CHOICES as readonly string[]).includes(choice)) {
    throw new Error(`${HARNESS_ENV}="${choice}" names no harness this Lab can run; use one of ${HARNESS_CHOICES.join(", ")}.`);
  }
  const name = choice as HarnessChoice;
  const harness = values[name];
  return {
    name,
    value: harness,
    runTimeoutMs: budget ?? (name === "stub" ? SCRIPTED_RUN_TIMEOUT_MS : DEFAULT_RUN_MINUTES * 60_000),
    label: harness.label ?? harness.id,
  };
}

/** Options for {@link startHarness}. Each defaults to what a served Lab uses. */
export interface StartHarnessOptions {
  /** The raw choice; `process.env[HARNESS_ENV]` by default. */
  value?: string | undefined;
  /** The stub's step pause; `process.env[STEP_MS_ENV]` by default. */
  stepMs?: string | undefined;
  /** Whether Claude Code can run here; the Claude Code package's `checkClaudeCodeReadiness` over the run's own environment by default. */
  check?: HarnessReadinessCheck;
  /** One run's budget in minutes; `process.env[RUN_MINUTES_ENV]` by default. */
  runMinutes?: string | undefined;
  /** Where the start line goes; stderr by default. */
  log?: (line: string) => void;
}

/** A served Lab's default coder, and every harness its coder runs on. */
export interface StartedHarness extends SelectedHarness {
  /**
   * Every harness a `coder` worker may run on, the default among them, as
   * harness values (`openLab({ harnesses })`): the one list the coder runs on
   * and the harness kit checks, logs and serves as its readiness view.
   */
  harnesses: readonly Harness[];
}

/**
 * Pick a served Lab's default coder at start: {@link selectHarness} with the
 * profile's default, beside every harness the Lab runs.
 *
 * One run's budget is the same whichever harness runs it ({@link RUN_MINUTES_ENV},
 * else {@link DEFAULT_RUN_MINUTES}): a worker may name a real harness whatever
 * the default is.
 *
 * Whether a harness can run here never stops the start: the harness kit logs
 * the table of what can run, with what to run for what can't, when the checks
 * answer, and refuses a task on one that can't at once, saying why. Nothing
 * ever falls back to the scripted run.
 *
 * @param defaultChoice The profile's coder when {@link HARNESS_ENV} names none.
 * @param options Seams for checks; a served Lab passes none.
 * @returns The chosen harness and every harness value.
 * @throws When the choice or the budget is malformed.
 */
export async function startHarness(defaultChoice: HarnessChoice, options: StartHarnessOptions = {}): Promise<StartedHarness> {
  const value = "value" in options ? options.value : process.env[HARNESS_ENV];
  const stepMs = "stepMs" in options ? options.stepMs : process.env[STEP_MS_ENV];
  const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  const runMinutes = "runMinutes" in options ? options.runMinutes : process.env[RUN_MINUTES_ENV];
  const values = labHarnesses(readStepMs(stepMs), options.check);
  const harness = selectFrom(value, defaultChoice, runMinutes, values);
  const runTimeoutMs = readRunMinutes(runMinutes) ?? DEFAULT_RUN_MINUTES * 60_000;
  log(
    harness.name === "stub"
      ? `Coder: the scripted run, no model (${HARNESS_ENV}=stub).`
      : `Coder: ${harness.label}; each run may take ${runTimeoutMs / 60_000} minutes (${RUN_MINUTES_ENV}).`,
  );
  return { ...harness, runTimeoutMs, harnesses: HARNESS_CHOICES.map((choice) => values[choice]) };
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
