/**
 * Commands a host runs in a run's checkout: a project's checks (`pnpm
 * typecheck`, `pnpm --filter web test`), each run to its end and reported.
 *
 * Two things live here, so every writer and every runner agrees on them:
 *
 * - **What a command is.** A line of words, split into the program and its
 *   arguments (single and double quotes group words) and started with no
 *   shell. {@link checkoutCommandProblem} refuses a line a shell would read
 *   differently: `&&`, `||`, `|`, `;`, `&`, redirects, `$(…)` and backticks.
 *   Two commands are two entries, never one line.
 * - **How they run.** {@link runCheckoutCommands} runs them in order in the
 *   checkout, inside one wall clock for all of them. A failing command does
 *   not stop the rest, so whoever reads the results hears about every
 *   failure. The command running when the clock runs out is stopped with its
 *   process group and reported as timed out; any after it are skipped.
 *
 * Every process goes through `./exec`, the package's one door for them.
 */
import { runToEnd } from "./exec";

/** The most of a command's output a result keeps: its last characters. */
export const CHECK_OUTPUT_TAIL_CHARS = 4_000;

/** What one command did. */
export interface CheckoutCommandResult {
  /** The command, as it was written. */
  command: string;
  /** Its exit code; `null` when it was stopped or never ran. */
  exitCode: number | null;
  /** The wall clock ran out while it ran, and it was stopped. */
  timedOut: boolean;
  /** The wall clock had run out before its turn, so it never ran. */
  skipped: boolean;
  /** How long it ran, in milliseconds. `0` when skipped. */
  durationMs: number;
  /** The end of its standard output and standard error, together, colour codes removed. */
  tail: string;
}

/** Whether a command passed: it ran, and exited `0`. */
export function checkoutCommandPassed(result: CheckoutCommandResult): boolean {
  return !result.skipped && !result.timedOut && result.exitCode === 0;
}

const SHELL_OPERATOR = /(&&|\|\||[|;&<>`]|\$\()/;

/**
 * Split a command into its words, or answer why it can't be one.
 *
 * @returns The words (the program first), or a sentence naming what was refused.
 */
export function splitCheckoutCommand(command: string): string[] | string {
  const words: string[] = [];
  let word = "";
  let inWord = false;
  let quote: '"' | "'" | null = null;
  for (const char of command) {
    if (quote !== null) {
      if (char === quote) quote = null;
      else word += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      inWord = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (inWord) words.push(word);
      word = "";
      inWord = false;
      continue;
    }
    word += char;
    inWord = true;
  }
  if (quote !== null) return `the command "${command}" has a quote that is never closed`;
  if (inWord) words.push(word);
  if (words.length === 0) return "a command can't be empty";
  return words;
}

/**
 * Why `command` can't be a check, or `undefined` when it can.
 *
 * Refused: an empty line, an unclosed quote, and anything a shell would read
 * as more than one program (`&&`, `||`, `|`, `;`, `&`, `<`, `>`, `$(…)`,
 * backticks), quoted or not. Commands run with no shell, so such a line would
 * not do what it says.
 */
export function checkoutCommandProblem(command: string): string | undefined {
  if (SHELL_OPERATOR.test(command)) {
    return `the command "${command}" uses a shell operator; commands run with no shell, so write each command as its own entry`;
  }
  const split = splitCheckoutCommand(command);
  return typeof split === "string" ? split : undefined;
}

// eslint-disable-next-line no-control-regex
const COLOUR_CODES = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

/** Options for {@link runCheckoutCommands}. */
export interface RunCheckoutCommandsOptions {
  /** The checkout the commands run in. */
  cwd: string;
  /** The commands, in order. */
  commands: readonly string[];
  /** The wall clock for all of them together, in milliseconds. */
  timeoutMs: number;
  /** Extra environment, laid over the process's own. */
  env?: Record<string, string>;
}

/**
 * Run `commands` in `cwd`, in order, and report each.
 *
 * Never throws for a command that fails, can't start or is refused: each is
 * a result. A refused command (see {@link checkoutCommandProblem}) is not
 * started and reports exit code `null` with the reason as its tail.
 */
export async function runCheckoutCommands(options: RunCheckoutCommandsOptions): Promise<CheckoutCommandResult[]> {
  const deadline = Date.now() + options.timeoutMs;
  const results: CheckoutCommandResult[] = [];
  for (const command of options.commands) {
    const left = deadline - Date.now();
    if (left <= 0) {
      results.push({ command, exitCode: null, timedOut: false, skipped: true, durationMs: 0, tail: "" });
      continue;
    }
    const problem = checkoutCommandProblem(command);
    const words = splitCheckoutCommand(command);
    if (problem !== undefined || typeof words === "string") {
      results.push({ command, exitCode: null, timedOut: false, skipped: false, durationMs: 0, tail: problem ?? String(words) });
      continue;
    }
    const started = Date.now();
    const ended = await runToEnd(words[0]!, words.slice(1), {
      cwd: options.cwd,
      timeoutMs: left,
      keepChars: CHECK_OUTPUT_TAIL_CHARS * 2,
      ...(options.env !== undefined ? { env: options.env } : {}),
    });
    results.push({
      command,
      exitCode: ended.timedOut ? null : ended.exitCode,
      timedOut: ended.timedOut,
      skipped: false,
      durationMs: Date.now() - started,
      tail: ended.output.replace(COLOUR_CODES, "").slice(-CHECK_OUTPUT_TAIL_CHARS),
    });
  }
  return results;
}
