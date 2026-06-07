/**
 * Host-supplied resolution of the `claude` CLI.
 *
 * The dispatch block never hard-codes how to reach `claude`. A resolver
 * supplies the binary path, working directory, environment, and the function
 * that actually runs it. This keeps the package free of process side effects at
 * import time, makes the subprocess trivially mockable in tests, and leaves the
 * door open for non-local transports (SSH, a remote container) without changing
 * the block surface — the resolver is the seam.
 */
import { spawn } from "node:child_process";
import type { BlockContext } from "@flow-state-dev/core/types";

/** Result of running the CLI: captured streams plus the exit code. */
export interface ClaudeCliExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

/** Options forwarded to a single CLI invocation. */
export interface ClaudeCliExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

/**
 * Runs the CLI and resolves with its captured output and exit code. Must
 * resolve (not reject) on a non-zero exit — the caller distinguishes a failed
 * dispatch (non-zero `code`) from an inability to launch the binary (rejection,
 * e.g. ENOENT).
 */
export type ClaudeCliExec = (
  bin: string,
  args: string[],
  opts: ClaudeCliExecOptions,
) => Promise<ClaudeCliExecResult>;

/** What a {@link ResolveClaudeCli} returns. */
export interface ResolvedClaudeCli {
  bin: string;
  cwd?: string;
  env?: Record<string, string>;
  exec: ClaudeCliExec;
}

/**
 * Host hook that resolves how to run `claude` for a given block invocation.
 * Accepts the block context loosely (`BlockContext<any>`) so a fully
 * parameterized `execute` context passes without a cast at the call site.
 */
export type ResolveClaudeCli = (
  ctx: BlockContext<any>,
) => ResolvedClaudeCli | Promise<ResolvedClaudeCli>;

/**
 * Default exec: spawns the binary, captures stdout/stderr, and enforces an
 * optional timeout by killing the child. Resolves with the exit code; rejects
 * only when the process can't be launched (e.g. binary missing → ENOENT) or it
 * timed out.
 */
export const defaultClaudeCliExec: ClaudeCliExec = (bin, args, opts) =>
  new Promise<ClaudeCliExecResult>((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: opts.cwd,
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer =
      opts.timeoutMs && opts.timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
          }, opts.timeoutMs)
        : undefined;

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code, signal) => {
      if (timer) clearTimeout(timer);
      // A null exit code means the child was terminated by a signal. Only treat
      // that as a timeout when our timer is what killed it; if the child exited
      // naturally in the same tick the timer fired (code is a real number),
      // honor the natural exit rather than misreporting a timeout.
      if (timedOut && code === null) {
        reject(new Error(`\`${bin}\` timed out after ${opts.timeoutMs}ms`));
        return;
      }
      if (code === null) {
        // Killed by some other signal — surface it as a non-zero exit so the
        // caller treats it as a failed dispatch, not a success built from
        // partial stdout.
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

/**
 * Default resolver: runs `claude` from PATH via {@link defaultClaudeCliExec},
 * in the current process working directory. Installing the capability (or
 * passing this resolver) is itself the host's opt-in to shelling out.
 */
export const defaultResolveClaudeCli: ResolveClaudeCli = () => ({
  bin: "claude",
  exec: defaultClaudeCliExec,
});
