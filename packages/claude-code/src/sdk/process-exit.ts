/**
 * A spawn hook for the Agent SDK that keeps hold of the Claude Code process, so
 * an aborted run can wait for that process to actually exit.
 *
 * The SDK's own stream is not a reliable exit signal: on abort it gives the
 * process ~2s and then ends its stream (and resolves `return()`) whether or not
 * the process has gone. The process writes the session's transcript until it
 * exits, so a run resumed in that window is told its conversation does not
 * exist. The SDK's documented `spawnClaudeCodeProcess` hook is the one place a
 * caller can see the real process, so this module supplies it.
 *
 * It spawns exactly as the SDK's default local spawn does (same command, args,
 * cwd, env, forwarded abort `signal`, piped stdio). What the default adds and a
 * custom spawn loses is the stderr tail in the SDK's exit errors; this module
 * keeps its own bounded tail so a failed run can still say why.
 */
import { spawn, type ChildProcess } from "node:child_process";

/** What the SDK hands `spawnClaudeCodeProcess`. Declared here so the SDK stays an optional peer. */
export interface ClaudeAgentSpawnOptions {
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
  spawn: (options: ClaudeAgentSpawnOptions) => ChildProcess;
  /**
   * Resolves once the spawned process has exited. `null` when nothing was
   * spawned through {@link TrackedProcess.spawn} — a scripted `query`, or an
   * SDK that never reached its spawn.
   */
  exited: () => Promise<void> | null;
  /** The end of what the process wrote to stderr, trimmed; `""` when nothing. */
  stderrTail: () => string;
}

/** Create a {@link TrackedProcess} for one run. */
export function trackProcess(): TrackedProcess {
  let exited: Promise<void> | null = null;
  let tail = "";
  return {
    spawn: (options) => {
      const child = spawn(options.command, options.args, {
        cwd: options.cwd,
        env: options.env,
        signal: options.signal,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      // Read, so a chatty process can never block on a full pipe.
      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk: string) => {
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
        child.once("exit", () => resolve());
        child.on("error", () => {
          if (child.pid === undefined) resolve();
        });
      });
      return child;
    },
    exited: () => exited,
    stderrTail: () => tail.trim(),
  };
}
