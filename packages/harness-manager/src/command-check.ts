/**
 * `commandCheck`: a phase is done only when the project's own checks pass.
 *
 * A wrapper over a {@link PhaseSpec}, not a stage beside it. The phase's own
 * `isDone` runs first; only when it says done do the commands run, in the
 * run's checkout (`@flow-state-dev/workspace`'s `runCheckoutCommands`). Any red
 * command makes the run *not done*, and the verdict's `reason` names each
 * failure with the end of its output, which the manager adds to the not-done
 * message the board hands the next attempt as `feedback`. Every result goes on
 * the run record; on a done run, on the review's `data` too.
 *
 * The check is evidence for a person, not a grader the agent can't reach: it
 * runs the repository's own scripts, which the agent may have edited.
 *
 * ```ts
 * const phase = commandCheck(
 *   { phase: "code", buildPrompt, isDone: ({ stopReport }) => stopReport === "finished" },
 *   { commands: ["pnpm typecheck", "pnpm --filter web test"], timeoutMs: 10 * 60_000 },
 * );
 * ```
 *
 * `harnessSessionFlow`'s `verify` takes the same options and records the
 * results on the turn, without failing it.
 */
import {
  checkoutCommandPassed,
  runCheckoutCommands,
  type CheckoutCommandResult,
} from "@flow-state-dev/workspace";
import { z } from "zod";
import { NETWORK_CALL_TIMEOUT_MS } from "./timeouts";
import type { CompletionRunContext, PhaseDoneVerdict, PhaseSpec } from "./manager";

/** One check's result, as it is recorded: the command, how it ended, and the end of its output. */
export const commandCheckResultSchema = z.object({
  command: z.string(),
  exitCode: z.number().nullable(),
  timedOut: z.boolean(),
  skipped: z.boolean(),
  durationMs: z.number(),
  tail: z.string(),
});
export type CommandCheckResult = CheckoutCommandResult;

/** The commands to run: a list, or a resolver the run's context is handed (`projectChecks()`). */
export type CommandCheckCommands<TContext> =
  | readonly string[]
  | ((context: TContext) => readonly string[] | Promise<readonly string[]>);

/** The reason a check gives when its time was up before its commands could start. */
const CHECK_TIME_UP = "The completion check ran out of time before its commands could run.";

/** Options for {@link commandCheck} and `harnessSessionFlow`'s `verify`. */
export interface CommandCheckOptions<TContext = CompletionRunContext> {
  /** The commands, in order. An empty list runs nothing and passes. */
  commands: CommandCheckCommands<TContext>;
  /** The wall clock for all of them together, in milliseconds. */
  timeoutMs: number;
  /** Extra environment for the commands, laid over the host process's own. */
  env?: Record<string, string>;
}

/** Whether every check passed. An empty list passes. */
export function commandChecksPassed(results: readonly CommandCheckResult[]): boolean {
  return results.every(checkoutCommandPassed);
}

/** "Checks 2/3 passed": how many of `results` passed. */
export function commandChecksSummary(results: readonly CommandCheckResult[]): string {
  return `Checks ${results.filter(checkoutCommandPassed).length}/${results.length} passed`;
}

/** Why a result is red, in a few words. */
function failureOf(result: CommandCheckResult): string {
  if (result.skipped) return "was skipped: the checks ran out of time before it";
  if (result.timedOut) return `ran out of time after ${result.durationMs}ms and was stopped`;
  if (result.exitCode === null) return "was not run";
  return `exited ${result.exitCode}`;
}

/**
 * The next attempt's words for the red checks: each command, why it is red,
 * and the end of its output. `undefined` when all passed.
 */
export function commandChecksFailure(results: readonly CommandCheckResult[]): string | undefined {
  const red = results.filter((result) => !checkoutCommandPassed(result));
  if (red.length === 0) return undefined;
  const lines = [`${commandChecksSummary(results)}.`];
  for (const result of red) {
    lines.push("", `\`${result.command}\` ${failureOf(result)}.`);
    if (result.tail.trim() !== "") lines.push("```", result.tail.trimEnd(), "```");
  }
  return lines.join("\n");
}

/** Check the options once, at construction, so a typo fails the host and not a task. @internal */
export function assertCommandCheckOptions(options: CommandCheckOptions<unknown>, who: string): void {
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error(`[harness-manager] ${who}'s timeoutMs must be a positive whole number of milliseconds; got ${options.timeoutMs}.`);
  }
  if (typeof options.commands !== "function" && !Array.isArray(options.commands)) {
    throw new Error(`[harness-manager] ${who}'s commands must be a list of commands or a function that answers one.`);
  }
}

/**
 * Run the checks `options` names in `cwd`, resolving the commands from `context`.
 *
 * Shared by {@link commandCheck} and `harnessSessionFlow`'s `verify`, so the
 * two run commands one way.
 */
export async function runCommandChecks<TContext>(
  options: CommandCheckOptions<TContext>,
  cwd: string,
  context: TContext,
  signal?: AbortSignal,
): Promise<CommandCheckResult[]> {
  const commands = typeof options.commands === "function" ? await options.commands(context) : options.commands;
  if (commands.length === 0) return [];
  return runCheckoutCommands({
    cwd,
    commands,
    timeoutMs: options.timeoutMs,
    ...(options.env !== undefined ? { env: options.env } : {}),
    ...(signal !== undefined ? { signal } : {}),
  });
}

/**
 * The phase, done only when its own check and then `options.commands` pass.
 *
 * Sets the phase's `doneTimeoutMs` to its own bound plus `timeoutMs`, so the
 * manager waits long enough. Pass the same number to
 * `harnessDrainBudgetMs({ doneTimeoutMs })` so a shutdown waits for it too.
 *
 * @throws At construction, on a `timeoutMs` that isn't a positive whole number.
 */
export function commandCheck(phase: PhaseSpec, options: CommandCheckOptions): PhaseSpec {
  assertCommandCheckOptions(options as CommandCheckOptions<unknown>, "commandCheck");
  const own = phase.doneTimeoutMs ?? NETWORK_CALL_TIMEOUT_MS;
  return {
    ...phase,
    doneTimeoutMs: own + options.timeoutMs,
    isDone: async (run: CompletionRunContext): Promise<PhaseDoneVerdict> => {
      const before = readVerdict(await phase.isDone(run));
      if (!before.done) return before;
      // The manager aborts the signal when the check's time is up, then lets
      // the checkout go: a check that is late starts nothing, and a running
      // command is stopped (skipped / timed out, so the run is not done).
      if (run.signal?.aborted === true) return { done: false, reason: CHECK_TIME_UP };
      const results = await runCommandChecks(options, run.workspacePath, run, run.signal);
      const checks = [...(before.checks ?? []), ...results];
      const failure = commandChecksFailure(results);
      return failure === undefined
        ? { ...before, checks }
        : { done: false, reason: before.reason === undefined ? failure : `${before.reason}\n\n${failure}`, checks };
    },
  };
}

/** A phase check's answer, as the manager reads it: a boolean is a verdict with no reason. */
export function readVerdict(answer: boolean | PhaseDoneVerdict): PhaseDoneVerdict {
  return typeof answer === "boolean" ? { done: answer } : answer;
}
