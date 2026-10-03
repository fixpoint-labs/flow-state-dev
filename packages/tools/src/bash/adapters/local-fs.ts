/**
 * Local filesystem sandbox adapter.
 *
 * Uses the real filesystem via `node:fs` and `node:child_process` for bash
 * commands. Best for development, local agents, and environments where you
 * control the machine.
 *
 * When `strictPaths` is enabled (the default), all operations are validated
 * against the workspace root before execution. See `workspace-guards.ts`
 * for the guard implementation.
 *
 * Each command runs with a minimal environment (not the server's full
 * `process.env`), a deadline, and a numeric exit code — see
 * `executeCommand` below. Command execution assumes a Unix process-group
 * model (Linux/macOS): a timeout kills the command's process group.
 *
 * None of this is an isolation boundary. Commands run as the server's own
 * user, so one can still read the server's environment on purpose
 * (`/proc/$PPID/environ`, `ps eww`) and can start processes that outlive
 * the timeout. Run untrusted commands with the moat adapter or in a
 * container.
 */

import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { constants as osConstants } from "node:os";
import path from "node:path";
import type { Sandbox, CommandResult } from "../types";
import {
  assertCommandWithinWorkspace,
  resolveWithinWorkspace,
} from "./workspace-guards";

export interface LocalFsSandboxOptions {
  /** Working directory on the real filesystem. */
  cwd?: string;
  /** Virtual workspace prefix (e.g. `/workspace`) stripped from file paths. */
  destination?: string;
  /**
   * Enforce workspace path restrictions. Default: `true`.
   * When `false`, a warning is logged and all guards are skipped.
   */
  strictPaths?: boolean;
  /**
   * Extra environment variables for each command, layered over the minimal
   * base (`BASE_ENV_KEYS`, copied from the server when set), so a key named
   * here wins. Nothing else from the server's environment is inherited, so
   * commands don't see it by accident. This is not an isolation boundary:
   * the command runs as the same user and can still read the server's
   * environment deliberately (e.g. `/proc/$PPID/environ`). Use the moat
   * adapter or a container for untrusted commands.
   */
  env?: Record<string, string>;
  /**
   * Per-command deadline in milliseconds. Default: 60 000. On overrun the
   * command's process group is killed and the result carries
   * `exitCode: 124`. A process that detaches into its own session
   * (`setsid`, a daemon) leaves that group and can survive.
   */
  execTimeoutMs?: number;
}

/** Server variables a shell needs to behave normally; nothing secret. */
const BASE_ENV_KEYS = ["PATH", "HOME", "USER", "LANG", "LC_ALL", "TERM", "TMPDIR", "TZ"];
const DEFAULT_EXEC_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
/** Exit code for a deadline overrun — the `timeout(1)` convention, as in the MOAT adapter. */
const TIMEOUT_EXIT_CODE = 124;

/**
 * Creates a sandbox backed by the local filesystem.
 *
 * Commands run via `/bin/bash` in the specified working directory.
 * File reads/writes go through `node:fs`. Parent directories are
 * created automatically on write.
 *
 * The optional `destination` parameter specifies the virtual workspace prefix
 * (e.g. `/workspace`) that callers prepend to file paths. When set, the adapter
 * strips this prefix before resolving against `cwd`, so `/workspace/src/index.ts`
 * maps to `<cwd>/src/index.ts` on the real filesystem.
 */
export function createLocalFsSandbox(
  options: LocalFsSandboxOptions = {},
): Sandbox {
  const cwd = options.cwd ?? path.join(process.cwd(), ".bash-workspace");
  const destination = options.destination;
  const strictPaths = options.strictPaths ?? true;
  const execTimeoutMs = options.execTimeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;
  const childEnv: Record<string, string> = {};
  for (const key of BASE_ENV_KEYS) {
    const value = process.env[key];
    if (value != null) childEnv[key] = value;
  }
  Object.assign(childEnv, options.env);

  if (!strictPaths) {
    console.warn(
      `[LocalFs] strictPaths is disabled for workspace "${cwd}".` +
        ` Commands and file operations will not be restricted to the workspace root.`,
    );
  }

  /**
   * Translate a virtual sandbox path to a real filesystem path.
   *
   * Strips the virtual destination prefix (e.g. `/workspace/`) so that
   * absolute sandbox paths resolve correctly against the local `cwd`.
   * When `strictPaths` is enabled, validates the resolved path stays
   * within the workspace root.
   */
  function toLocalPath(filePath: string): string {
    let rel = filePath;

    if (destination) {
      if (filePath === destination || filePath === destination + "/") {
        return cwd;
      }
      const prefix = destination.endsWith("/") ? destination : destination + "/";
      if (filePath.startsWith(prefix)) {
        rel = filePath.slice(prefix.length);
      }
    }

    if (strictPaths) {
      return resolveWithinWorkspace(cwd, rel);
    }

    return path.resolve(cwd, rel);
  }

  /**
   * Translate every `<destination>` or `<destination>/...` occurrence in a raw
   * bash command to the real `cwd` so absolute virtual paths like
   * `/workspace/skills/foo.py` resolve on disk. File I/O is already translated
   * via `toLocalPath`; this closes the gap for direct shell execution.
   *
   * Matches `destination` only when followed by `/`, end-of-string, or a
   * shell token boundary (whitespace or `;|&<>"'\``), so the prefix isn't
   * substituted when it appears inside a longer unrelated identifier.
   */
  function translateCommand(command: string): string {
    if (!destination) return command;
    const escaped = destination.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`${escaped}(?=\\/|$|[\\s;|&<>"'\`])`, "g");
    return command.replace(re, cwd);
  }

  return {
    async executeCommand(command: string): Promise<CommandResult> {
      // Validate the command as written (model-facing paths) before we rewrite.
      if (strictPaths) {
        assertCommandWithinWorkspace(cwd, command, destination);
      }

      // Ensure cwd exists before running commands
      await mkdir(cwd, { recursive: true });

      // Rewrite /workspace-style virtual paths to real absolute paths so
      // `find /workspace`, `python3 /workspace/skills/...`, etc. actually run.
      const runnable = translateCommand(command);

      return runBash(runnable, cwd, childEnv, execTimeoutMs);
    },

    async readFile(filePath: string): Promise<string> {
      const resolved = toLocalPath(filePath);
      return readFile(resolved, "utf-8");
    },

    async writeFile(filePath: string, content: string): Promise<void> {
      const resolved = toLocalPath(filePath);
      await mkdir(path.dirname(resolved), { recursive: true });
      await writeFile(resolved, content, "utf-8");
    },
  };
}

/**
 * Run one command under `/bin/bash -c` with the given env and deadline.
 *
 * The shell is spawned as its own process group so a timeout or output
 * overrun kills the whole group, not just the shell — killing only the
 * shell would leave a pipeline's children holding stdout open, and the
 * result would never arrive. Only the group is killed: a descendant that
 * starts its own session (`setsid`, a daemon) has left it and survives.
 * After a normal exit nothing is killed, so a background job whose output
 * is redirected (`server > log 2>&1 &`) keeps running as before.
 *
 * Output is capped at `MAX_OUTPUT_BYTES` per stream (stdout and stderr
 * counted separately, as Node's `maxBuffer` did); an overrun kills the group.
 *
 * Because the child is its own process group, it does not receive the
 * terminal's SIGINT/SIGTERM aimed at the server; the deadline is the only
 * backstop that stops it.
 *
 * `exitCode` is always a number: the shell's own code, `124` on timeout,
 * `128 + n` when killed by signal `n`, and `1` for an output overrun or a
 * spawn failure.
 */
function runBash(
  command: string,
  cwd: string,
  env: Record<string, string>,
  timeoutMs: number,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn("/bin/bash", ["-c", command], {
      cwd,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let failure: { exitCode: number; message: string } | null = null;

    let settled = false;
    // Declared before `finish`, which clears it, so no call order can hit the TDZ.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (exitCode: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      let err = Buffer.concat(stderr).toString("utf-8");
      if (failure) {
        err = (err ? err + "\n" : "") + failure.message;
        exitCode = failure.exitCode;
      }
      resolve({ stdout: Buffer.concat(stdout).toString("utf-8"), stderr: err, exitCode });
    };

    // Kill the whole group and resolve now, with the output so far — not on
    // `close`, which a descendant that escaped the group could hold off.
    const fail = (exitCode: number, message: string) => {
      if (settled || failure) return;
      failure = { exitCode, message };
      try {
        if (child.pid != null) process.kill(-child.pid, "SIGKILL");
      } catch {
        // Group already gone.
      }
      child.stdout.destroy();
      child.stderr.destroy();
      finish(exitCode);
    };

    // One counter per stream, as Node's `maxBuffer` did: the cap applies to
    // stdout and stderr separately, not to their sum.
    const collect = (sink: Buffer[]) => {
      let streamBytes = 0;
      return (chunk: Buffer) => {
        // After a kill or settle, late chunks are dropped rather than buffered.
        if (settled || failure) return;
        streamBytes += chunk.length;
        if (streamBytes > MAX_OUTPUT_BYTES) {
          fail(1, `output exceeded ${MAX_OUTPUT_BYTES} bytes on one stream; command killed`);
          return;
        }
        sink.push(chunk);
      };
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));

    timer = setTimeout(
      () => fail(TIMEOUT_EXIT_CODE, `exec timed out after ${timeoutMs}ms`),
      timeoutMs,
    );

    child.on("error", (error) => fail(1, `failed to run command: ${error.message}`));
    child.on("close", (code, signal) => {
      if (typeof code === "number") return finish(code);
      const signo = signal ? osConstants.signals[signal] : undefined;
      finish(signo != null ? 128 + signo : 1);
    });
  });
}
