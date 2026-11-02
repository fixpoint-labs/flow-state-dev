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
import { execFile, spawn } from "node:child_process";
import { createInterface } from "node:readline";
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
  /** Written to the process's standard input, which is then closed. */
  input?: string | Uint8Array;
  /**
   * Each line of standard output, as it arrives, without its `\n`. Given,
   * the output is handed over line by line and never buffered, so
   * `maxBuffer` does not apply and the result's `stdout` is empty.
   */
  onLine?: (line: string) => void;
}

/** Run `file` with `args`, resolving with its output or rejecting on a non-zero exit. */
export async function run(
  file: string,
  args: string[],
  options: RunOptions,
): Promise<{ stdout: string; stderr: string }> {
  if (options.onLine !== undefined) return await runByLine(file, args, options, options.onLine);
  const pending = execFileAsync(file, args, {
    cwd: options.cwd,
    timeout: options.timeoutMs,
    maxBuffer: options.maxBuffer ?? 8 * 1024 * 1024,
    env: options.env === undefined ? process.env : { ...process.env, ...options.env },
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  });
  if (options.input !== undefined) pending.child.stdin?.end(options.input);
  const result = await pending;
  return { stdout: String(result.stdout), stderr: String(result.stderr) };
}

/** The most of a by-line run's standard error kept for its failure: the end of it, where the error is. */
const STDERR_KEPT = 64 * 1024;

/**
 * `run`, with standard output handed to `onLine` as it arrives. A failure
 * rejects the way `execFile`'s does: `code` is the exit code, `signal` the
 * signal that ended it, `killed` set when the wall clock did, and `stderr`
 * the last of what it wrote there.
 *
 * The command runs in a process group of its own (outside Windows), and the
 * wall clock kills that whole group: a command that starts children (a shell
 * script, a package manager's lifecycle scripts) can't outlive its budget
 * through them, or keep the run from settling by holding its output open.
 */
async function runByLine(
  file: string,
  args: string[],
  options: RunOptions,
  onLine: (line: string) => void,
): Promise<{ stdout: string; stderr: string }> {
  const ownGroup = process.platform !== "win32";
  const child = spawn(file, args, {
    cwd: options.cwd,
    env: options.env === undefined ? process.env : { ...process.env, ...options.env },
    stdio: ["pipe", "pipe", "pipe"],
    detached: ownGroup,
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  });
  let timedOut = false;
  const stop = (): void => {
    try {
      if (ownGroup && child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
      else child.kill("SIGKILL");
    } catch {
      // Already gone.
    }
    // A descendant that left the group can still hold the pipes; let go of them.
    child.stdout.destroy();
    child.stderr.destroy();
  };
  const clock = setTimeout(() => {
    timedOut = true;
    stop();
  }, options.timeoutMs);
  child.stdin.end(options.input);
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-STDERR_KEPT);
  });
  let failed: unknown;
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  lines.on("line", (line) => {
    if (failed !== undefined) return;
    try {
      onLine(line);
    } catch (error) {
      failed = error;
      stop();
    }
  });
  const [code, signal] = await new Promise<[number | null, NodeJS.Signals | null]>((resolve, reject) => {
    child.once("error", reject);
    // `close`, not `exit`: every line has been handed over by then.
    child.once("close", (exitCode, exitSignal) => resolve([exitCode, exitSignal]));
  }).finally(() => clearTimeout(clock));
  if (failed !== undefined) throw failed;
  if (code !== 0 || timedOut) {
    throw Object.assign(new Error(`Command failed: ${file} ${args.join(" ")}\n${stderr}`), {
      code,
      signal,
      killed: timedOut || signal !== null,
      stderr,
    });
  }
  return { stdout: "", stderr };
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
