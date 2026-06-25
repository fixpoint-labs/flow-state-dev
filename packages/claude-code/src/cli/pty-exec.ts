/**
 * PTY-backed `claude` exec for `claude --remote` cloud dispatch.
 *
 * `claude --remote` refuses to dispatch a cloud session unless stdout is a TTY:
 * a bare subprocess (stdout is a pipe) auto-engages local `--print` mode and
 * exits 1 with "--remote requires an interactive terminal". {@link
 * defaultClaudeCliExec} is a bare `spawn`, so it can never dispatch — the
 * `resolveClaudeCli` seam exists precisely so a host supplies a working
 * strategy. This one allocates a pseudo-terminal with `script(1)` so `claude`
 * sees a terminal, and scrubs the inherited environment so the dispatched child
 * starts clean: `CLAUDE_*`/`CLAUDECODE` (parent-session state) and
 * `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` (which would otherwise make
 * `claude --remote` block on a "Detected a custom API key" confirmation dialog,
 * since a cloud dispatch authenticates as the logged-in user, not via a key).
 *
 * Pass {@link resolvePtyClaudeCli} as `resolveClaudeCli` to
 * `claudeRemoteDispatch` / `createClaudeCliCapability`. Requires `script(1)`,
 * present on macOS (BSD) and Linux (util-linux).
 *
 * Output is read from `script(1)`'s forwarded stdout stream (its typescript
 * file is only flushed on exit, so it is just a close-time fallback) with
 * ANSI/VT sequences stripped, so {@link parseRemoteDispatchOutput} reads the
 * banner and resolution fires the instant the session URL streams in.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClaudeCliExec, ResolveClaudeCli } from "./resolve-cli";

/** Env-key prefixes carrying parent Claude-session state we must not inherit. */
const SCRUBBED_ENV_PREFIXES = ["CLAUDE_", "CLAUDECODE"];

/**
 * Local auth credentials that must not reach the dispatched child. A cloud
 * dispatch authenticates as the logged-in user; if `claude --remote` sees a
 * custom `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` (e.g. one a host loaded from
 * `.env` for its own generator calls) it blocks on a "Detected a custom API
 * key" confirmation dialog that hangs the dispatch.
 */
const SCRUBBED_ENV_KEYS = new Set(["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"]);

/** Drop parent Claude-session state and local auth so the child starts clean. */
function scrubClaudeEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (SCRUBBED_ENV_KEYS.has(key)) continue;
    if (SCRUBBED_ENV_PREFIXES.some((p) => key.startsWith(p))) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Strip ANSI/VT control sequences and `script(1)` EOF markers from PTY output
 * so the dispatch banner regexes match cleanly. PTYs emit CRLF and terminal
 * setup sequences around the real content.
 */
export function stripAnsi(s: string): string {
  return s
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "") // OSC … BEL / ST
    .replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g, "") // CSI sequences
    .replace(/\x1b[PX^_][^\x1b]*\x1b\\/g, "") // DCS/SOS/PM/APC
    .replace(/\x1b[\x30-\x7E]/g, "") // 2-byte ESC (incl. ESC 7/8)
    .replace(/\^[A-Z@\[\\\]^_]/g, "") // script(1) caret-letter EOF markers
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
}

/**
 * Build `script(1)` args for the host platform. BSD script (macOS) takes the
 * output file then the command + args directly; util-linux script needs `-c`
 * with a single shell-quoted command string.
 */
function buildScriptArgs(outFile: string, command: string[]): string[] {
  if (process.platform === "linux") {
    const shellCmd = command.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ");
    return ["-q", "-e", "-c", shellCmd, outFile];
  }
  return ["-q", "-e", outFile, ...command];
}

/**
 * True once the output carries the *tail* of `claude --remote`'s dispatch
 * banner — the `View: <url>` or `Resume with: claude --teleport <id>` line. The
 * cloud session exists by the time these print, so the dispatch has succeeded
 * even if the local process has not yet exited. We deliberately do not match the
 * earlier "Created remote session" header alone: resolving on it can capture the
 * banner before the session URL has streamed in, dropping it from the handle.
 */
function hasDispatchBanner(out: string): boolean {
  return /https?:\/\/claude\.ai\/code\/\S/i.test(out) || /claude --teleport\s+\S/i.test(out);
}

/**
 * Turn a spawn failure into a diagnosable error. A raw `ENOENT` from this exec
 * means `script(1)` is missing — `claude` runs *inside* `script`, so a missing
 * `claude` surfaces as a non-zero exit, never a spawn ENOENT. Left raw, the
 * ENOENT would reach `claudeRemoteDispatch`, which maps any exec ENOENT to
 * `ClaudeCliNotFoundError` and wrongly reports the `claude` CLI as missing —
 * sending the host to fix the wrong dependency. Relabeling it here keeps that
 * upstream mapping correct for the binary it actually names.
 */
function describeSpawnError(err: NodeJS.ErrnoException): Error {
  if (err.code === "ENOENT") {
    return new Error(
      "`script(1)` was not found on PATH. The PTY-backed exec needs it to give " +
        "`claude --remote` a terminal; it ships with macOS and most Linux distros (util-linux).",
    );
  }
  return err;
}

/**
 * Run `<bin> <args>` under a PTY via `script(1)`, returning the child's captured
 * (ANSI-stripped) output and exit code. Honors {@link ClaudeCliExecOptions}.
 *
 * Resolution keys off the dispatch banner, not process exit: as soon as the
 * banner appears the session exists in the cloud, so it resolves `code: 0` and
 * detaches (kills the local attach) — a cold start that leaves `claude`
 * lingering does not stall the dispatch. Otherwise it resolves on natural exit
 * (a failed dispatch is a non-zero `code`). It rejects only when the process
 * can't be launched (ENOENT) or the timeout fires with no banner — and that
 * rejection carries the captured output/stderr so the failure is diagnosable.
 */
export const scriptPtyClaudeCliExec: ClaudeCliExec = (bin, args, opts) =>
  new Promise((resolve, reject) => {
    const dir = mkdtempSync(join(tmpdir(), "fsd-claude-remote-"));
    const outFile = join(dir, "typescript");

    const child = spawn("script", buildScriptArgs(outFile, [bin, ...args]), {
      cwd: opts.cwd,
      env: scrubClaudeEnv(opts.env ? { ...process.env, ...opts.env } : process.env),
      stdio: ["ignore", "pipe", "pipe"],
    });

    // script(1) forwards the PTY output to its own stdout in real time, so we
    // watch that for the banner. The typescript file is only flushed on exit,
    // so it can't drive an early resolve — it's just a close-time fallback.
    let rawStdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    /** The best output we have: the live stdout stream, or the file on exit. */
    function captured(): string {
      const live = stripAnsi(rawStdout);
      if (live.trim()) return live;
      try {
        return stripAnsi(readFileSync(outFile, "utf8"));
      } catch {
        return "";
      }
    }

    function cleanup(): void {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }

    /** Detach the local attach; the cloud session keeps running server-side. */
    function detach(): void {
      child.kill("SIGTERM");
      // unref: an early-banner resolve settles the promise immediately, but this
      // fallback would otherwise hold the event loop open ~1.5s (stalling CLI
      // exit and test teardown) just to SIGKILL an already-dying child.
      setTimeout(() => child.kill("SIGKILL"), 1_500).unref();
    }

    function settle(run: () => void): void {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      run();
    }

    child.stdout?.on("data", (chunk) => {
      rawStdout += String(chunk);
      if (!settled && hasDispatchBanner(stripAnsi(rawStdout))) {
        // Banner seen → the cloud session exists; resolve and detach now.
        const stdout = captured();
        detach();
        settle(() => {
          cleanup();
          resolve({ stdout, stderr, code: 0 });
        });
      }
    });
    child.stderr?.on("data", (c) => (stderr += String(c)));

    timer =
      opts.timeoutMs && opts.timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            detach();
          }, opts.timeoutMs)
        : undefined;

    child.on("error", (err) =>
      settle(() => {
        cleanup();
        reject(describeSpawnError(err as NodeJS.ErrnoException));
      }),
    );
    child.on("close", (code) =>
      settle(() => {
        const stdout = captured();
        cleanup();
        if (hasDispatchBanner(stdout)) {
          resolve({ stdout, stderr, code: 0 });
          return;
        }
        if (timedOut) {
          reject(
            new Error(
              `\`${bin}\` (under script) timed out after ${opts.timeoutMs}ms without a dispatch banner. ` +
                `stderr: ${stderr.trim().slice(0, 500) || "(none)"} | ` +
                `output: ${stdout.trim().slice(-500) || "(none)"}`,
            ),
          );
          return;
        }
        resolve({ stdout, stderr, code: code ?? 1 });
      }),
    );
  });

/**
 * Resolver that runs PATH `claude` under a PTY (`script(1)`) so `claude
 * --remote` dispatches instead of being rejected by the no-TTY guard. Pass as
 * `resolveClaudeCli` to `claudeRemoteDispatch` or `createClaudeCliCapability`.
 */
export const resolvePtyClaudeCli: ResolveClaudeCli = () => ({
  bin: "claude",
  exec: scriptPtyClaudeCliExec,
});
