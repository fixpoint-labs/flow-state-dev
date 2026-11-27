/**
 * A spawn hook for the Agent SDK that keeps hold of the Claude Code process, so
 * an aborted run can wait for that process to actually exit.
 *
 * It can also kill that process ({@link TrackedProcess.kill}), which an
 * aborted run does once its grace for the exit runs out.
 *
 * Off Windows the process leads its own process group, so a stop reaches what
 * the agent started too (a `tsc`, a test worker, a dev server): the forwarded
 * abort sends the group `SIGTERM`, and {@link TrackedProcess.kill} sends it
 * `SIGKILL`. A process that exits on its own signals nothing. On Windows there
 * is no group to signal; both reach the one process, as before.
 *
 * The SDK's own stream is not a reliable exit signal: on abort it gives the
 * process ~2s and then ends its stream (and resolves `return()`) whether or not
 * the process has gone. The process writes the session's transcript until it
 * exits, so a run resumed in that window is told its conversation does not
 * exist. The SDK's documented `spawnClaudeCodeProcess` hook is the one place a
 * caller can see the real process, so this module supplies it.
 *
 * It spawns as the SDK's default local spawn does (same command, args, cwd,
 * env, piped stdio, and on abort `SIGTERM` plus the `error` node emits), except
 * that the abort reaches the process group rather than the one pid. What the
 * default adds and a custom spawn loses is the stderr tail in the SDK's exit
 * errors; this module keeps its own bounded tail so a failed run can still say
 * why.
 *
 * A process in its own group no longer receives a terminal's Ctrl-C aimed at
 * the server. It ends when the server does because its stdin closes.
 */
import { spawn, type ChildProcess } from "node:child_process";

/** What the SDK hands `spawnClaudeCodeProcess`. Declared here so the SDK stays an optional peer. */
export interface ClaudeCodeSpawnOptions {
  command: string;
  args: string[];
  cwd?: string;
  env: Record<string, string | undefined>;
  signal: AbortSignal;
}

/** The most stderr kept for error messages — the end of it, where a crash says why. */
const STDERR_TAIL_CHARS = 4_000;

/** One run's spawned process, observed. */
export interface TrackedProcess {
  /** The hook to pass as the SDK's `spawnClaudeCodeProcess`. */
  spawn: (options: ClaudeCodeSpawnOptions) => ChildProcess;
  /**
   * Resolves once the spawned process has exited. `null` when nothing was
   * spawned through {@link TrackedProcess.spawn} — a scripted `query`, or an
   * SDK that never reached its spawn.
   */
  exited: () => Promise<void> | null;
  // FIX-2312.
  /**
   * Send the spawned process's group `SIGKILL` (off Windows; the process
   * alone on Windows), and resolve once the process has exited. The group is
   * signalled even when the process has already exited, since what it started
   * can outlive it. Resolves at once when nothing was spawned or the process
   * never started.
   */
  kill: () => Promise<void>;
  /** The end of what the process wrote to stderr, trimmed; `""` when nothing. */
  stderrTail: () => string;
}

/** Whether the process gets its own group (`detached`), which is every platform but Windows. */
const OWN_GROUP = process.platform !== "win32";

/** Send `signal` to process group `pid`. Quiet when the group has already gone. */
function signalGroup(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    return false;
  }
}

/**
 * What node's `signal` spawn option does, aimed at the group: on abort, send
 * the group `SIGTERM` and emit the `AbortError` node would, so the SDK sees
 * the abort it expects. Node's option would signal only the one pid.
 */
function forwardAbortToGroup(child: ChildProcess, signal: AbortSignal): void {
  const onAbort = () => {
    if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
    if (!signalGroup(child.pid, "SIGTERM")) return;
    const error = new Error("The operation was aborted", { cause: signal.reason });
    error.name = "AbortError";
    child.emit("error", Object.assign(error, { code: "ABORT_ERR" }));
  };
  if (signal.aborted) {
    process.nextTick(onAbort);
    return;
  }
  signal.addEventListener("abort", onAbort, { once: true });
  child.once("exit", () => signal.removeEventListener("abort", onAbort));
}

/** Create a {@link TrackedProcess} for one run. */
export function trackProcess(): TrackedProcess {
  let exited: Promise<void> | null = null;
  let child: ChildProcess | null = null;
  let gone = false;
  let tail = "";
  return {
    spawn: (options) => {
      const spawned = spawn(options.command, options.args, {
        cwd: options.cwd,
        env: options.env,
        // Windows has no process group to signal: node's own abort handling.
        ...(OWN_GROUP ? { detached: true } : { signal: options.signal }),
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      child = spawned;
      if (OWN_GROUP) forwardAbortToGroup(spawned, options.signal);
      // Read, so a chatty process can never block on a full pipe.
      spawned.stderr?.setEncoding("utf8");
      spawned.stderr?.on("data", (chunk: string) => {
        tail = (tail + chunk).slice(-STDERR_TAIL_CHARS);
      });
      // `close` would also wait for grandchildren holding the pipes open;
      // `exit` is the process itself, which is what owns the transcript.
      //
      // `error` stands in only when the process never started (a missing
      // executable has no `pid` and never exits). It is NOT an exit otherwise:
      // node also emits `error` the moment the forwarded `signal` aborts, which
      // is before the process it is killing has gone.
      exited = new Promise<void>((resolve) => {
        spawned.once("exit", () => {
          gone = true;
          resolve();
        });
        spawned.on("error", () => {
          if (spawned.pid === undefined) {
            gone = true;
            resolve();
          }
        });
      });
      return spawned;
    },
    exited: () => exited,
    kill: async () => {
      if (child === null || exited === null || child.pid === undefined) return;
      if (OWN_GROUP) signalGroup(child.pid, "SIGKILL");
      else if (!gone) child.kill("SIGKILL");
      await exited;
    },
    stderrTail: () => tail.trim(),
  };
}
