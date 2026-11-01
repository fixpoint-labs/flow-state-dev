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

/** The most of a by-line run's standard error kept for its failure. */
const STDERR_KEPT = 64 * 1024;

/**
 * `run`, with standard output handed to `onLine` as it arrives. A failure
 * rejects the way `execFile`'s does: `code` is the exit code, `signal` the
 * signal that ended it, `killed` set when the wall clock did, and `stderr`
 * what it wrote there.
 */
async function runByLine(
  file: string,
  args: string[],
  options: RunOptions,
  onLine: (line: string) => void,
): Promise<{ stdout: string; stderr: string }> {
  const child = spawn(file, args, {
    cwd: options.cwd,
    timeout: options.timeoutMs,
    env: options.env === undefined ? process.env : { ...process.env, ...options.env },
    stdio: ["pipe", "pipe", "pipe"],
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  });
  child.stdin.end(options.input);
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    if (stderr.length < STDERR_KEPT) stderr += chunk.slice(0, STDERR_KEPT - stderr.length);
  });
  let failed: unknown;
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  lines.on("line", (line) => {
    if (failed !== undefined) return;
    try {
      onLine(line);
    } catch (error) {
      failed = error;
      child.kill();
    }
  });
  const [code, signal] = await new Promise<[number | null, NodeJS.Signals | null]>((resolve, reject) => {
    child.once("error", reject);
    // `close`, not `exit`: every line has been handed over by then.
    child.once("close", (exitCode, exitSignal) => resolve([exitCode, exitSignal]));
  });
  if (failed !== undefined) throw failed;
  if (code !== 0) {
    throw Object.assign(new Error(`Command failed: ${file} ${args.join(" ")}\n${stderr}`), {
      code,
      signal,
      killed: child.killed || signal !== null,
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

/** How a {@link runToEnd} process ended. */
export interface RunToEndResult {
  /** The exit code, or `null` when a signal ended it. */
  exitCode: number | null;
  /** The wall clock ran out and the process group was stopped. */
  timedOut: boolean;
  /** Standard output and standard error together, in arrival order: the last `keepChars` of it. */
  output: string;
}

/**
 * Run `file` with `args` to its end, whatever its exit code, keeping the end
 * of what it wrote.
 *
 * Unlike {@link run}, a non-zero exit resolves: the caller's question is what
 * happened, not whether it worked. The process gets a group of its own, so
 * the wall clock stops what it started too (a test runner's workers), not
 * only the process named. A file that cannot be started at all resolves as
 * exit code 127, with the reason as its output. An aborted `signal` stops
 * the group as the wall clock does, and reports it as timed out.
 */
export async function runToEnd(
  file: string,
  args: string[],
  options: { cwd: string; timeoutMs: number; keepChars: number; env?: Record<string, string>; signal?: AbortSignal },
): Promise<RunToEndResult> {
  let output = "";
  const keep = (chunk: string) => {
    output = (output + chunk).slice(-options.keepChars);
  };
  return await new Promise<RunToEndResult>((resolve) => {
    let timedOut = false;
    let settled = false;
    const child = spawn(file, args, {
      cwd: options.cwd,
      env: options.env === undefined ? process.env : { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    const stopGroup = () => {
      if (child.pid === undefined) return;
      try {
        if (process.platform === "win32") child.kill("SIGKILL");
        else process.kill(-child.pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    };
    const stop = () => {
      timedOut = true;
      stopGroup();
    };
    const timer = setTimeout(stop, options.timeoutMs);
    options.signal?.addEventListener("abort", stop, { once: true });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const finish = (result: RunToEndResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", stop);
      resolve(result);
    };
    child.once("error", (error) => finish({ exitCode: 127, timedOut: false, output: `${output}${error.message}`.slice(-options.keepChars) }));
    // The group, once the leader exits: anything it left running goes with
    // it, on a clean exit too, so nothing it started outlives the call (the
    // caller may let the checkout go next). On `exit`, not `close`: a child
    // still holding the pipes would hold `close` back until the clock ran out.
    let exited: number | null | undefined;
    child.once("exit", (exitCode) => {
      exited = exitCode;
      clearTimeout(timer);
      stopGroup();
    });
    // `close` only collects the last of the output.
    child.once("close", (exitCode) => finish({ exitCode: exited !== undefined ? exited : exitCode, timedOut, output }));
  });
}
