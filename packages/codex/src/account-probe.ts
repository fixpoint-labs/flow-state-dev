/**
 * Ask Codex, before anything is started on it, whether it has a credential to
 * run on: `probeCodexAccount()`.
 *
 * A host that runs Codex calls it once at start, so a person with no
 * credential is told then rather than at their first run. A `CODEX_API_KEY` in
 * the environment answers on its own: a run given one uses it whatever login
 * Codex has saved. Otherwise this runs the Codex CLI's own `codex login
 * status`, the program the SDK starts, so the check and the run read one
 * sign-in. No model turn starts.
 *
 * The shape follows `probeClaudeAccount` in `@flow-state-dev/claude-code`: a
 * discriminated result, a timeout, and no throw. It checks where a credential
 * would come from, not that it works: a key that is set but rejected reads as
 * `account`.
 *
 * `checkCodexReadiness()` gives the same answer as core's neutral
 * `HarnessReadiness`, with the remedy the user follows.
 */
import { execFile } from "node:child_process";
import { delimiter } from "node:path";
import type { HarnessReadiness } from "@flow-state-dev/core/types";
import { findCodexProgram, type CodexProgram } from "./usage";

/** What {@link probeCodexAccount} found. */
export type CodexAccountProbe =
  /** A credential: `CODEX_API_KEY` in the environment, or a login `codex login status` accepts. */
  | { status: "account"; source: "api-key" | "login" }
  /**
   * No credential, or no answer. `reason` says which, for a message to a
   * person; `unanswered` is set when Codex timed out, was stopped, or could
   * not be started, so nothing is known about the credential.
   */
  | { status: "none"; reason: string; unanswered?: true }
  /** The Codex SDK could not be loaded, so there is no program to ask. `reason` carries why. */
  | { status: "sdk-missing"; reason: string };

/** Options for {@link probeCodexAccount}. */
export interface ProbeCodexAccountOptions {
  /**
   * The environment Codex is started with. Pass the one the run gets (for
   * example `harnessEnv({ pass })`), so a credential the run can't see isn't
   * counted.
   */
  env: Record<string, string>;
  /** How long to wait for Codex's answer before reading it as `none`. Default 10 000 ms. */
  timeoutMs?: number;
  /** Stops waiting and ends Codex when it aborts; the answer is then `none`, as on a timeout. */
  signal?: AbortSignal;
  /**
   * The program to run as `<path> login status`. A seam for tests and
   * scripted checks; the default is {@link findCodexProgram}'s answer.
   */
  program?: CodexProgram;
}

/** {@link ProbeCodexAccountOptions.timeoutMs}'s default. */
const DEFAULT_TIMEOUT_MS = 10_000;

/** Ask Codex whether it has a credential, without a model turn (see the file header). Never throws. */
export async function probeCodexAccount(options: ProbeCodexAccountOptions): Promise<CodexAccountProbe> {
  if ((options.env.CODEX_API_KEY ?? "") !== "") return { status: "account", source: "api-key" };
  let program: CodexProgram;
  try {
    program = options.program ?? (await findCodexProgram(options.env));
  } catch (error) {
    return { status: "sdk-missing", reason: error instanceof Error ? error.message : String(error) };
  }
  if (options.signal?.aborted === true) {
    return { status: "none", reason: "The check was stopped before Codex answered", unanswered: true };
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const PATH = [...program.pathDirs, options.env.PATH ?? ""].filter((dir) => dir !== "").join(delimiter);
  return new Promise((resolve) => {
    execFile(
      program.path,
      ["login", "status"],
      {
        // Cast because a host's types (Next's) may make `NODE_ENV` required; this child gets `env` alone.
        env: { ...options.env, PATH } as Record<string, string> as NodeJS.ProcessEnv,
        encoding: "utf8",
        timeout: timeoutMs,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
      (error, stdout, stderr) => {
        if (error === null) return resolve({ status: "account", source: "login" });
        // A numeric code is Codex's own answer; anything else means it never gave one.
        if (typeof error.code === "number") {
          return resolve({ status: "none", reason: lastLine(stdout, stderr) ?? `\`codex login status\` exited with code ${error.code}` });
        }
        const reason =
          error.name === "AbortError"
            ? "The check was stopped before Codex answered"
            : error.killed === true
              ? `Codex did not answer within ${timeoutMs / 1000} s`
              : typeof error.signal === "string"
                ? `Codex was ended by ${error.signal} before it answered`
                : `The Codex CLI could not be started: ${error.message}`;
        resolve({ status: "none", reason, unanswered: true });
      },
    );
  });
}

/** The last line Codex said, its warnings left out, or `null` when it said nothing. */
function lastLine(stdout: string, stderr: string): string | null {
  const said = `${stderr}\n${stdout}`
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("WARNING:"));
  return said.at(-1) ?? null;
}

/** What the user does when Codex has no credential. */
export const CODEX_SIGN_IN_REMEDY = "Run `codex login`, or set CODEX_API_KEY";

/**
 * Whether Codex can run on this machine, as core's neutral readiness: the
 * answer of {@link probeCodexAccount}, with what to do when there is no
 * credential. A key counts only when the SDK also loads, since a run needs
 * both. A host hands it to whatever keeps readiness (harness-manager's
 * `harnessReadiness`). Never throws.
 */
export async function checkCodexReadiness(options: ProbeCodexAccountOptions): Promise<HarnessReadiness> {
  let account = await probeCodexAccount(options);
  if (account.status === "account" && account.source === "api-key" && options.program === undefined) {
    // A key answers the probe without loading the SDK, and a run still needs the SDK.
    account = await findCodexProgram(options.env).then(
      (): CodexAccountProbe => account,
      (error: unknown): CodexAccountProbe => ({ status: "sdk-missing", reason: error instanceof Error ? error.message : String(error) }),
    );
  }
  if (account.status === "account") return { ready: true };
  if (account.status === "sdk-missing") {
    return { ready: false, reason: `The Codex SDK could not be loaded: ${account.reason}`, remedy: "Install @openai/codex-sdk" };
  }
  return account.unanswered === true
    ? { ready: false, reason: `${account.reason}, so Codex's sign-in is unknown`, unanswered: true }
    : { ready: false, reason: `Codex has no credential: ${account.reason}`, remedy: CODEX_SIGN_IN_REMEDY };
}
