/**
 * The one place this package spawns a child process.
 *
 * Every call bounds itself with a wall clock, which is required rather than
 * defaulted: a `git ls-remote` that has not answered in a minute is broken,
 * while a first fetch of a large repository legitimately takes many, and one
 * number cannot be right for both. Making it required forces the caller to say
 * which kind of wait it is.
 *
 * Kept as a module of its own so a test can watch every process this package
 * starts — which is how "refused before any git process" is checked rather
 * than asserted.
 *
 * Exported from the package too: harness-manager re-exports it, and hosts
 * that run their own `gh` or `git` calls beside a run use it rather than a
 * copy of their own.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface RunOptions {
  cwd: string;
  /**
   * The wall clock, in milliseconds. `execFile` sends `SIGTERM` when it
   * elapses and the promise rejects, so the caller sees a failure rather than
   * a hang.
   */
  timeoutMs: number;
  /** Extra environment, laid over the process's own. */
  env?: Record<string, string>;
  /**
   * Cancellation, where interrupting is safe. Never passed on a call that
   * makes a worktree: a `worktree add` killed halfway leaves a tree the next
   * provision has to disentangle. A listing that writes nothing has no such
   * problem.
   */
  signal?: AbortSignal;
  maxBuffer?: number;
}

/** Run `file` with `args`, resolving with its output or rejecting on a non-zero exit. */
export async function run(
  file: string,
  args: string[],
  options: RunOptions,
): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync(file, args, {
    cwd: options.cwd,
    timeout: options.timeoutMs,
    maxBuffer: options.maxBuffer ?? 8 * 1024 * 1024,
    env: options.env === undefined ? process.env : { ...process.env, ...options.env },
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  });
  return { stdout: String(result.stdout), stderr: String(result.stderr) };
}

/**
 * Git that talks to a remote. Minutes rather than seconds, because a first
 * fetch of a large repository is genuinely slow.
 */
export const GIT_TIMEOUT_MS = 600_000;

/**
 * Undoing a checkout a provision just made and is refusing: `worktree prune`
 * and `branch -D`, local bookkeeping that takes milliseconds.
 *
 * Its own budget rather than the provision's, because the case it exists for
 * is that budget running out. A caller holding a lock across provisioning has
 * to count it in the longest it can hold that lock.
 */
export const CHECKOUT_CLEANUP_TIMEOUT_MS = 60_000;
