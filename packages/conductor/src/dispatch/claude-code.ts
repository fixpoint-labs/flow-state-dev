/**
 * `claudeCodeDispatcher` — the first {@link Dispatcher}, shelling out to the
 * local `claude` CLI in headless mode.
 *
 * One invocation per phase: `claude -p "<brief>" --output-format json`, run in
 * the worktree conductor provisioned, waited on to completion, and reduced to a
 * {@link DispatchResult}. Everything Claude-specific is confined to this file —
 * the flag names, the JSON envelope, the cost field. The seam in `./types` knows
 * none of it.
 *
 * **Why this does not reuse `@flow-state-dev/claude-code`.** That package's
 * `/cli` entry dispatches `claude --remote`: a fire-and-forget *cloud* task with
 * no headless way to await a result or read a cost, wrapped as an FSD handler
 * block that needs a `BlockContext`. Conductor needs the opposite — a local,
 * blocking, cwd-scoped run that reports what it cost. The only genuinely shared
 * piece is the spawn-and-capture exec, which is reproduced here as
 * {@link defaultCliExec} because conductor does not depend on that package.
 */

import { spawn } from "node:child_process";
import { renderBrief } from "./brief";
import type { DispatchResult, Dispatcher, PhaseBrief } from "./types";

/** Captured streams and exit code from one CLI invocation. */
export interface CliExecResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

/** Options forwarded to a single CLI invocation. */
export interface CliExecOptions {
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly timeoutMs?: number;
}

/**
 * Runs the CLI and resolves with its output and exit code. Rejects **only** when
 * the binary cannot be launched or the run timed out — a non-zero exit is a
 * resolved result, so the caller can tell "the agent failed" from "there is no
 * agent". Injected so tests never spawn anything.
 */
export type CliExec = (
  bin: string,
  args: readonly string[],
  options: CliExecOptions,
) => Promise<CliExecResult>;

/** Default exec: spawn, capture both streams, enforce the timeout by killing the child. */
export const defaultCliExec: CliExec = (bin, args, options) =>
  new Promise<CliExecResult>((resolve, reject) => {
    const child = spawn(bin, [...args], {
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : process.env,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer =
      options.timeoutMs && options.timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
          }, options.timeoutMs)
        : undefined;

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      if (timer) clearTimeout(timer);
      // A null code means a signal killed it. Only call that a timeout when our
      // own timer is what fired; otherwise report it as a non-zero exit rather
      // than building a success out of partial output.
      if (code === null) {
        if (timedOut) {
          reject(new Error(`\`${bin}\` timed out after ${options.timeoutMs}ms`));
          return;
        }
        resolve({
          stdout,
          stderr: stderr || `\`${bin}\` was terminated by signal ${signal ?? "unknown"}`,
          code: 1,
        });
        return;
      }
      resolve({ stdout, stderr, code });
    });
  });

/** The fields conductor reads out of `--output-format json`. */
interface ClaudeJsonEnvelope {
  readonly is_error?: boolean;
  readonly result?: string;
  readonly session_id?: string;
  readonly total_cost_usd?: number;
}

/**
 * Parse the CLI's JSON envelope, tolerating leading noise on stdout.
 *
 * Returns `null` when nothing parses — an exit-0 run whose output we cannot read
 * is reported as a completion with no cost and no run id, never as a failure.
 * The output shape is the vendor's, and a parser that hard-fails on it would
 * turn a cosmetic CLI change into a stalled process.
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

export interface ClaudeCodeDispatcherOptions {
  /** Path to the binary. Default `"claude"` (resolved on `PATH`). */
  readonly bin?: string;
  /** Model alias or id for `--model`. Omitted when unset, so the CLI's default applies. */
  readonly model?: string;
  /**
   * `--permission-mode`. Default `"acceptEdits"`: a dispatched phase edits files
   * unattended, and a mode that prompts would hang forever with no terminal.
   */
  readonly permissionMode?: string;
  /** Hard ceiling on one dispatch. Default 30 minutes. */
  readonly timeoutMs?: number;
  /** Extra environment for the child process. */
  readonly env?: Record<string, string>;
  /** How to run the binary. Default {@link defaultCliExec}. */
  readonly exec?: CliExec;
  /** Turns the brief into the prompt. Default {@link renderBrief}. */
  readonly renderPrompt?: (brief: PhaseBrief) => string;
  /** Clock, injected so timestamps are assertable. */
  readonly now?: () => Date;
}

/**
 * Create a dispatcher backed by the local `claude` CLI.
 *
 * Declares `isolation: "worktree"` — the CLI edits whatever directory it runs
 * in, so two concurrent phases sharing one need a dedicated tree each.
 *
 * The result reports the branch as what it produced and nothing else. Whether a
 * PR was opened is a structural fact conductor reads from GitHub; parsing it out
 * of an agent's prose would make the agent a second authority on it.
 */
export function claudeCodeDispatcher(
  options: ClaudeCodeDispatcherOptions = {},
): Dispatcher {
  const {
    bin = "claude",
    model,
    permissionMode = "acceptEdits",
    timeoutMs = 30 * 60 * 1000,
    env,
    exec = defaultCliExec,
    renderPrompt = renderBrief,
    now = () => new Date(),
  } = options;

  return {
    vendor: "claude-code",
    isolation: "worktree",

    async run(brief: PhaseBrief): Promise<DispatchResult> {
      const startedAt = now().toISOString();
      const settle = (
        outcome: "completed" | "failed",
        extra: Partial<DispatchResult> = {},
      ): DispatchResult => ({
        dispatchId: brief.dispatchId,
        outcome,
        produced: brief.branch ? { branch: brief.branch } : {},
        costUsd: null,
        vendorRunId: null,
        error: null,
        startedAt,
        settledAt: now().toISOString(),
        ...extra,
      });

      if (!brief.workspacePath) {
        return settle("failed", {
          produced: {},
          error:
            "claudeCodeDispatcher declares isolation \"worktree\" but the brief carries no workspace path.",
        });
      }

      const args = [
        "-p",
        renderPrompt(brief),
        "--output-format",
        "json",
        "--permission-mode",
        permissionMode,
        ...(model ? ["--model", model] : []),
      ];

      let result: CliExecResult;
      try {
        result = await exec(bin, args, { cwd: brief.workspacePath, env, timeoutMs });
      } catch (error) {
        // Could not launch, or timed out. A failed result keeps the transition
        // in the ledger; a thrown error would bypass it.
        return settle("failed", {
          error: `Could not run \`${bin}\`: ${(error as Error).message}`,
        });
      }

      const envelope = parseClaudeJson(result.stdout);
      const costUsd = typeof envelope?.total_cost_usd === "number" ? envelope.total_cost_usd : null;
      const vendorRunId = envelope?.session_id ?? null;

      if (result.code !== 0 || envelope?.is_error === true) {
        return settle("failed", {
          costUsd,
          vendorRunId,
          error:
            result.stderr.trim() ||
            envelope?.result ||
            `\`${bin}\` exited with code ${result.code}.`,
        });
      }

      return settle("completed", { costUsd, vendorRunId });
    },
  };
}
