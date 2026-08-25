/**
 * The one place this lab spawns a child process.
 *
 * There were two copies of a bare `promisify(execFile)`, one per file, and
 * neither bounded anything. That is how a settled run stays in progress: `gh`
 * waiting on a network call with no server-side timeout outlives the paid agent
 * it was supposed to report on, the worker never returns, and the board row
 * sits `in_progress` until the lease expires — a claimed row, an attempt
 * charged, and nothing to show for either.
 *
 * **Every call bounds itself with a wall clock, and passes the attempt's signal
 * where cancelling is safe.** The wall clock is not optional and has no default:
 * a `gh` listing that has not answered in a minute is broken, while a `git
 * worktree add` on a large repository legitimately takes minutes, and one
 * number cannot be right for both. Making it required forces the caller to say
 * which kind of wait it is.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface RunOptions {
  cwd: string;
  /**
   * The wall clock, in milliseconds. Required — see the note above.
   *
   * `execFile` sends `SIGTERM` when it elapses and the promise rejects, so the
   * caller sees a failure rather than a hang.
   */
  timeoutMs: number;
  /**
   * The attempt's cancellation, where interrupting is safe.
   *
   * Deliberately absent on the git calls that provision a checkout: those hold
   * the tree's lock, and a `worktree add` killed halfway leaves a directory
   * that neither exists nor doesn't — which the next attempt then has to
   * disentangle while believing it inherited real work. A slow provision is
   * bounded by the clock; an interrupted one is a mess. The listing has no such
   * problem: it writes nothing.
   */
  signal?: AbortSignal;
  maxBuffer?: number;
}

export async function run(
  file: string,
  args: string[],
  options: RunOptions,
): Promise<{ stdout: string; stderr: string }> {
  const { timeoutMs, maxBuffer, ...rest } = options;
  const result = await execFileAsync(file, args, {
    ...rest,
    timeout: timeoutMs,
    maxBuffer: maxBuffer ?? 4 * 1024 * 1024,
  });
  return { stdout: String(result.stdout), stderr: String(result.stderr) };
}

/**
 * A listing that answers over the network. Generous for a slow API, far short
 * of a coding run's own deadline, so the verdict is never the thing that hangs.
 */
export const NETWORK_CALL_TIMEOUT_MS = 60_000;

/**
 * Local git. Minutes rather than seconds because a first `worktree add` on a
 * large repository is genuinely slow, and killing a real one costs the attempt.
 */
export const GIT_TIMEOUT_MS = 600_000;
