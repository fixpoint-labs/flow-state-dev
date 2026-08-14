/**
 * `runClaudeHeadless` — one blocking, local `claude -p` run.
 *
 * The package's other CLI surface (`./dispatch`) hands work to a *cloud* session
 * via `claude --remote` and returns immediately. This is the other invocation
 * mode of the same binary: `claude -p "<prompt>" --output-format json` runs the
 * agent locally in a directory, waits for it to finish, and reports what it did
 * and what it cost.
 *
 * Unlike the rest of `./cli` this is a plain async function, not an FSD block —
 * no `BlockContext`, no session state, no emitted items. It is the piece a
 * non-flow caller (an orchestrator, a script, a test harness) needs, and it is
 * the only place in the repo that knows `claude`'s headless flags and JSON
 * envelope. `claudeRemoteDispatch` wraps its own path in a block; a caller that
 * wants this one inside a flow wraps it themselves.
 *
 * **It settles; it does not throw.** A missing binary, a timeout, a crash, and a
 * non-zero exit all come back as `ok: false` with a reason. Callers whose
 * bookkeeping runs off the returned value (a ledger, a retry budget) would lose
 * the record to a thrown error, so there is nothing to catch.
 */
import {
  defaultClaudeCliExec,
  type ClaudeCliExec,
} from "./resolve-cli";

/** The fields this module reads out of `claude -p --output-format json`. */
export interface ClaudeJsonEnvelope {
  readonly is_error?: boolean;
  readonly result?: string;
  readonly session_id?: string;
  readonly total_cost_usd?: number;
}

/**
 * Parse the headless JSON envelope, tolerating leading noise on stdout.
 *
 * Returns `null` when nothing parses. The output shape belongs to the vendor, so
 * a parser that hard-failed on it would turn a cosmetic CLI change into a broken
 * run; an unreadable envelope on a zero exit is reported as a successful run
 * with no cost and no session id, never as a failure.
 */
export function parseClaudeJson(stdout: string): ClaudeJsonEnvelope | null {
  const candidates = [stdout, ...stdout.split("\n").reverse()];
  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object") return parsed as ClaudeJsonEnvelope;
    } catch {
      // Not this line. Keep looking.
    }
  }
  return null;
}

/** What one headless run settled to. */
export interface ClaudeHeadlessResult {
  /** `true` only for a zero exit the CLI did not itself mark as an error. */
  readonly ok: boolean;
  /** Why it failed, in plain terms. `null` when `ok`. */
  readonly error: string | null;
  /** The agent's final answer (the envelope's `result`), or `null` when unreported. */
  readonly finalMessage: string | null;
  /** The CLI's session id, for a human to resume or open. `null` when unreported. */
  readonly sessionId: string | null;
  /**
   * Vendor-reported cost in USD, `null` when unreported. Populated on a failed
   * run too — the tokens were still spent.
   */
  readonly costUsd: number | null;
}

/** How to run one headless invocation. */
export interface RunClaudeHeadlessOptions {
  /** The instruction passed to `-p`. */
  readonly prompt: string;
  /** Directory the agent runs in. The CLI edits whatever it is pointed at. */
  readonly cwd?: string;
  /** Path to the binary. Default `"claude"` (resolved on `PATH`). */
  readonly bin?: string;
  /** Model alias or id for `--model`. Omitted when unset, so the CLI's default applies. */
  readonly model?: string;
  /**
   * `--permission-mode`. Omitted when unset. An unattended caller should pass a
   * non-prompting mode — with no terminal, a mode that asks will never be
   * answered — but which one is the caller's policy, not this module's.
   */
  readonly permissionMode?: string;
  /** Hard ceiling on the run. No ceiling when unset. */
  readonly timeoutMs?: number;
  /** Extra environment for the child process. */
  readonly env?: Record<string, string>;
  /** How to run the binary. Default {@link defaultClaudeCliExec}; injected in tests. */
  readonly exec?: ClaudeCliExec;
}

/**
 * Run `claude -p` to completion and reduce it to a {@link ClaudeHeadlessResult}.
 *
 * Never throws: an exec that rejects (binary missing, timeout) settles as a
 * failure naming the binary, and a non-zero exit settles with the CLI's stderr —
 * falling back to the envelope's `result`, then to the exit code — as the reason.
 */
export async function runClaudeHeadless(
  options: RunClaudeHeadlessOptions,
): Promise<ClaudeHeadlessResult> {
  const {
    prompt,
    cwd,
    bin = "claude",
    model,
    permissionMode,
    timeoutMs,
    env,
    exec = defaultClaudeCliExec,
  } = options;

  const args = [
    "-p",
    prompt,
    "--output-format",
    "json",
    ...(permissionMode ? ["--permission-mode", permissionMode] : []),
    ...(model ? ["--model", model] : []),
  ];

  let stdout: string;
  let stderr: string;
  let code: number;
  try {
    ({ stdout, stderr, code } = await exec(bin, args, { cwd, env, timeoutMs }));
  } catch (error) {
    return {
      ok: false,
      error: `Could not run \`${bin}\`: ${(error as Error).message}`,
      finalMessage: null,
      sessionId: null,
      costUsd: null,
    };
  }

  const envelope = parseClaudeJson(stdout);
  const finalMessage = envelope?.result ?? null;
  const sessionId = envelope?.session_id ?? null;
  const costUsd = typeof envelope?.total_cost_usd === "number" ? envelope.total_cost_usd : null;

  if (code !== 0 || envelope?.is_error === true) {
    return {
      ok: false,
      error: stderr.trim() || finalMessage || `\`${bin}\` exited with code ${code}.`,
      finalMessage,
      sessionId,
      costUsd,
    };
  }

  return { ok: true, error: null, finalMessage, sessionId, costUsd };
}
