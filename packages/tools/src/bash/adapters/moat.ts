/**
 * MOAT sandbox adapter.
 *
 * Runs commands inside a MOAT-managed container on the same host as the
 * agent. MOAT is a CLI ([majorcontext/moat](https://github.com/majorcontext/moat))
 * that bind-mounts a workspace directory into an isolated runtime (Docker
 * with optional gVisor, or native Apple containers on macOS) and intercepts
 * outbound network calls through a credential-injecting proxy.
 *
 * Compared to `LocalFs`:
 *   - Isolation comes from the container boundary, not a string-level path
 *     guard. Adapter does not assert workspace containment on `executeCommand`.
 *   - Secrets the agent needs (API keys, GitHub tokens) are injected into
 *     outbound requests by the proxy, so the agent process never sees the
 *     token in its environment.
 *   - Requires the `moat` CLI v0.4.0+ on PATH (or supplied via `bin`).
 *
 * Lifecycle: a single long-lived `moat run -d` per scope (started lazily by
 * `resolveMoatSandbox`), one `moat exec` per command. Tear down via
 * `sandbox.stop()` — typically wired through the bash capability's
 * `cleanupBlock` into `defineFlow({ request: { onFinished } })`.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Sandbox, CommandResult } from "../types";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class MoatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoatError";
  }
}

export class MoatNotInstalledError extends MoatError {
  constructor(bin: string) {
    super(
      `MOAT binary "${bin}" not found on PATH. Install MOAT (>=0.4.0) — see https://majorcontext.com/moat/`,
    );
    this.name = "MoatNotInstalledError";
  }
}

export class MoatVersionError extends MoatError {
  constructor(actual: string, required: string) {
    super(`MOAT version ${actual} is below the required range ${required}. Upgrade with your installer.`);
    this.name = "MoatVersionError";
  }
}

export class MoatGrantsError extends MoatError {
  constructor(missing: string[]) {
    const lines = missing.map((g) => `  moat grant ${g}`).join("\n");
    super(
      `Missing MOAT credential grants: ${missing.join(", ")}.\nGrant them with:\n${lines}`,
    );
    this.name = "MoatGrantsError";
  }
}

export class MoatRunStartError extends MoatError {
  constructor(stderr: string) {
    super(`Failed to start MOAT run:\n${stderr}`);
    this.name = "MoatRunStartError";
  }
}

export class MoatRunTimeoutError extends MoatError {
  constructor(runName: string, timeoutMs: number) {
    super(`MOAT run "${runName}" did not reach state "running" within ${timeoutMs}ms.`);
    this.name = "MoatRunTimeoutError";
  }
}

export class MoatRunStoppedError extends MoatError {
  constructor(runName: string) {
    super(`MOAT run "${runName}" was stopped; no further commands can be issued.`);
    this.name = "MoatRunStoppedError";
  }
}

export class MoatBinaryReadError extends MoatError {
  constructor(filePath: string, byteLength: number) {
    super(
      `MOAT readFile only supports UTF-8 text; received ${byteLength} bytes from "${filePath}" that did not decode.`,
    );
    this.name = "MoatBinaryReadError";
  }
}

export class FileNotFoundError extends MoatError {
  constructor(filePath: string) {
    super(`File not found: ${filePath}`);
    this.name = "FileNotFoundError";
  }
}

// ---------------------------------------------------------------------------
// Pure builders (testable without spawning)
// ---------------------------------------------------------------------------

/** Lower bound enforced for `moat exec` support. */
export const MOAT_SUPPORTED_RANGE = ">=0.4.0";

export interface BuildRunArgsInput {
  runName: string;
  workspace: string;
  mountTarget: string;
  runtime?: "auto" | "docker" | "apple";
  grants?: string[];
  allowHosts?: string[];
  noSandbox?: boolean;
}

/**
 * Build the argv for `moat run`. Workspace is the trailing positional;
 * `-- sleep infinity` keeps the container alive (MOAT 0.5.x has no
 * detach flag — we spawn detached host-side instead). Workspace
 * bind-mounts at `mountTarget` are declared in the yaml, not via `-m`.
 */
export function buildRunArgs(input: BuildRunArgsInput): string[] {
  const args: string[] = ["run", "-n", input.runName];
  const runtime = input.runtime ?? "auto";
  if (runtime !== "auto") {
    args.push("--runtime", runtime);
  }
  for (const g of input.grants ?? []) {
    args.push("-g", g);
  }
  for (const h of input.allowHosts ?? []) {
    args.push("--allow-host", h);
  }
  if (input.noSandbox) args.push("--no-sandbox");
  args.push(input.workspace, "--", "sleep", "infinity");
  return args;
}

/** Build the argv for `moat exec <run> -- sh -c <command>`. */
export function buildExecArgs(runName: string, command: string): string[] {
  return ["exec", runName, "--", "sh", "-c", command];
}

/**
 * Build the argv for the MOAT-side `writeFile` invocation. The file path is
 * passed as a positional argument so it never enters the shell command — MOAT
 * shell-quotes nothing for us, but `$1` does the right thing inside `sh -c`.
 * Content is piped via stdin separately.
 */
export function buildWriteFileArgs(runName: string, filePath: string): string[] {
  return [
    "exec",
    runName,
    "--",
    "sh",
    "-c",
    'mkdir -p "$(dirname "$1")" && cat > "$1"',
    "--",
    filePath,
  ];
}

export interface GenerateMoatYamlInput {
  name: string;
  grants?: string[];
  allowHosts?: string[];
}

/**
 * Quote a value as a YAML double-quoted scalar. Prevents newlines or other
 * structural characters in caller-supplied strings (grants, hostnames sourced
 * from env vars) from injecting extra YAML keys.
 */
function yamlQuote(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");
  return `"${escaped}"`;
}

/**
 * Marker on the first line of every adapter-generated `moat.yaml`. Lets us
 * distinguish files we created (safe to reuse or delete) from user-authored
 * configs that happen to share the path.
 */
export const FSDEV_MANAGED_MARKER = "# fsdev-managed: do not edit";

/**
 * Generate a transient `moat.yaml` representing the requested grants and
 * outbound network policy. Default-deny when no hosts are listed. All
 * caller-supplied values are quoted to avoid YAML injection. The file
 * starts with `FSDEV_MANAGED_MARKER` so a later run can detect a stale
 * file from a prior persistent session and reuse it instead of refusing.
 */
export function generateMoatYaml(input: GenerateMoatYamlInput): string {
  const lines: string[] = [FSDEV_MANAGED_MARKER, `name: ${yamlQuote(input.name)}`];
  if (input.grants && input.grants.length > 0) {
    lines.push("grants:");
    for (const g of input.grants) lines.push(`  - ${yamlQuote(g)}`);
  }
  lines.push("network:");
  lines.push('  policy: "strict"');
  lines.push("  allow:");
  for (const h of input.allowHosts ?? []) lines.push(`    - ${yamlQuote(h)}`);
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Spawn helper (DI-able for tests)
// ---------------------------------------------------------------------------

/**
 * Result of a spawned process. `signal` is `null` for normal exits.
 */
export interface SpawnResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  /** Raw stdout bytes — preserved so callers can detect non-UTF-8 output. */
  stdoutBytes: Buffer;
  /** True when the timeout fired before the child exited. */
  timedOut: boolean;
}

/** Injectable spawn function used by every adapter method. */
export type SpawnFn = (
  command: string,
  args: string[],
  options: {
    stdin?: string;
    timeoutMs?: number;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  },
) => Promise<SpawnResult>;

const realSpawn: SpawnFn = (command, args, options) => {
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(command, args, {
        stdio: ["pipe", "pipe", "pipe"],
        cwd: options.cwd,
        env: options.env,
      });
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") {
        reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
        return;
      }
      reject(err);
      return;
    }

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;

    child.stdout?.on("data", (c: Buffer) => stdoutChunks.push(c));
    child.stderr?.on("data", (c: Buffer) => stderrChunks.push(c));
    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        reject(Object.assign(err, { code: "ENOENT" }));
        return;
      }
      reject(err);
    });
    child.on("close", (code, signal) => {
      if (timer) clearTimeout(timer);
      const stdoutBytes = Buffer.concat(stdoutChunks);
      resolve({
        exitCode: code,
        signal,
        stdout: stdoutBytes.toString("utf-8"),
        stderr: Buffer.concat(stderrChunks).toString("utf-8"),
        stdoutBytes,
        timedOut,
      });
    });

    if (options.timeoutMs && options.timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill("SIGKILL");
        } catch {
          // Process already exited.
        }
      }, options.timeoutMs);
    }

    if (options.stdin !== undefined && child.stdin) {
      child.stdin.end(options.stdin);
    } else if (child.stdin) {
      child.stdin.end();
    }
  });
};

/**
 * Handle returned by `startDetached`. The readiness loop polls
 * `getExitInfo()` each iteration; when the child has exited *before*
 * the container shows up in `moat list`, the resolver can fail fast
 * with the captured stderr instead of waiting out the readiness
 * timeout. Captures the last ~16KB of stderr so users get a real
 * cause-of-death message (e.g. `target "/workspace" already
 * mounted`) and not a generic "did not reach running" timeout.
 */
interface DetachedChildHandle {
  /**
   * Returns `null` while the child is still alive, or an object with
   * the exit code and the captured stderr tail once it has terminated.
   */
  getExitInfo(): { exitCode: number | null; stderr: string } | null;
}

/**
 * Spawn a long-running child process detached from the parent — used for
 * `moat run` under MOAT 0.5.x, which no longer offers a `-d` flag. The
 * child outlives the resolver call; readiness is observed separately via
 * `moat list`.
 *
 * stdout/stderr are piped (not ignored) and forwarded to the parent's
 * stderr line-by-line with a `[moat:<tag>]` prefix. Cold first-run image
 * builds take 30–60+ seconds and previously surfaced no output at all
 * during the wait; users couldn't tell whether progress was being made,
 * the network was stuck, or the runtime was failing silently. After
 * `unref`, the streams keep flowing as long as the parent is alive,
 * which covers the entire readiness window.
 *
 * The returned handle exposes early-exit info so callers can detect
 * non-zero exits (e.g. mount conflicts) instantly rather than blocking
 * on the readiness timeout.
 *
 * Surfaces `ENOENT` to the caller for the `MoatNotInstalledError` path;
 * any other synchronous spawn error propagates so it becomes a
 * `MoatRunStartError`.
 */
function startDetached(
  command: string,
  args: string[],
  tag: string,
  cwd?: string,
  env?: NodeJS.ProcessEnv,
): DetachedChildHandle {
  const child = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
    cwd,
    env,
  });
  const prefix = `[moat:${tag}]`;
  // Ring-buffered last ~16KB of stderr for early-exit diagnostics. The
  // forwardLines logger still echoes everything live; this is the
  // separate buffer the readiness loop reads on early exit.
  const STDERR_CAP = 16 * 1024;
  let stderrTail = "";
  let exited: { exitCode: number | null; stderr: string } | null = null;

  const forwardLines = (
    stream: NodeJS.ReadableStream | null,
    captureToTail: boolean,
  ): void => {
    if (!stream) return;
    let buffer = "";
    stream.setEncoding("utf-8");
    stream.on("data", (chunk: string) => {
      buffer += chunk;
      if (captureToTail) {
        stderrTail = (stderrTail + chunk).slice(-STDERR_CAP);
      }
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (line.length > 0) console.error(`${prefix} ${line}`);
      }
    });
    stream.on("end", () => {
      if (buffer.length > 0) console.error(`${prefix} ${buffer}`);
    });
  };
  forwardLines(child.stdout, false);
  forwardLines(child.stderr, true);
  child.on("error", (err) => {
    // After unref, an asynchronous spawn failure has nowhere to go —
    // surface it via the prefixed logger AND record it as an exit so
    // the readiness loop can fail fast on it.
    const msg = (err as Error).message;
    console.error(`${prefix} spawn error: ${msg}`);
    if (!exited) exited = { exitCode: null, stderr: msg };
  });
  child.on("exit", (code) => {
    exited = { exitCode: code, stderr: stderrTail };
  });
  child.unref();
  return {
    getExitInfo: () => exited,
  };
}

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------

/**
 * Compare a parsed semver-ish string against `>=major.minor.patch`. Only
 * supports the lower-bound form we use; any other operator throws.
 */
export function satisfiesMinVersion(actual: string, range: string): boolean {
  const m = range.match(/^>=(\d+)\.(\d+)\.(\d+)/);
  if (!m) throw new Error(`Unsupported range format: ${range}`);
  const required = [Number(m[1]), Number(m[2]), Number(m[3])];
  const cleaned = actual.replace(/^v/, "").split(/[-+]/)[0]!;
  const parts = cleaned.split(".").map((s) => Number(s));
  for (let i = 0; i < 3; i++) {
    const a = parts[i] ?? 0;
    const r = required[i]!;
    if (a > r) return true;
    if (a < r) return false;
  }
  return true;
}

/**
 * Cap on every control-plane spawn (`version`, `grant list`, `list`, `run`,
 * `stop`, `destroy`). Without it, a hung MOAT subprocess would deadlock the
 * resolver indefinitely — including making `readiness.timeoutMs` unreachable.
 */
const CONTROL_PLANE_TIMEOUT_MS = 10_000;

async function verifyBinary(spawnFn: SpawnFn, bin: string): Promise<{ version: string }> {
  let res: SpawnResult;
  try {
    res = await spawnFn(bin, ["version", "--json"], { timeoutMs: CONTROL_PLANE_TIMEOUT_MS });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new MoatNotInstalledError(bin);
    }
    throw err;
  }
  if (res.timedOut) {
    throw new MoatError(`\`${bin} version --json\` timed out after ${CONTROL_PLANE_TIMEOUT_MS}ms.`);
  }
  if (res.exitCode !== 0) {
    throw new MoatError(`\`${bin} version --json\` failed: ${res.stderr || res.stdout}`);
  }
  const parsed = (() => {
    try {
      return JSON.parse(res.stdout) as { version?: string };
    } catch {
      // MOAT <= 0.5.x advertises a global `--json` flag but `version` ignores it
      // and prints a human-readable block whose first line is `moat <semver>`.
      const m = res.stdout.match(/^\s*moat\s+v?(\d+\.\d+\.\d+(?:[-+][\w.]+)?)/);
      if (m) return { version: m[1] };
      throw new MoatError(`Could not parse \`${bin} version --json\` output: ${res.stdout}`);
    }
  })();
  const version = parsed.version ?? "";
  if (!satisfiesMinVersion(version, MOAT_SUPPORTED_RANGE)) {
    throw new MoatVersionError(version || "<unknown>", MOAT_SUPPORTED_RANGE);
  }
  return { version };
}

async function verifyGrants(spawnFn: SpawnFn, bin: string, required: string[]): Promise<void> {
  if (required.length === 0) return;
  const res = await spawnFn(bin, ["grant", "list", "--json"], { timeoutMs: CONTROL_PLANE_TIMEOUT_MS });
  if (res.timedOut) {
    throw new MoatError(`\`${bin} grant list --json\` timed out after ${CONTROL_PLANE_TIMEOUT_MS}ms.`);
  }
  if (res.exitCode !== 0) {
    throw new MoatError(`\`${bin} grant list --json\` failed: ${res.stderr || res.stdout}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(res.stdout || "[]");
  } catch {
    throw new MoatError(`Could not parse \`${bin} grant list --json\` output: ${res.stdout}`);
  }
  // MOAT returns an array of records; provider name lives in `provider` or `name`.
  const present = new Set<string>();
  if (Array.isArray(parsed)) {
    for (const e of parsed as Array<Record<string, unknown>>) {
      const name = (e.provider ?? e.name) as string | undefined;
      if (typeof name === "string") present.add(name);
    }
  }
  const missing = required.filter((r) => !present.has(r));
  if (missing.length > 0) throw new MoatGrantsError(missing);
}

interface RunRecord {
  name: string;
  state: string;
}

/**
 * Read the workspace `moat.yaml`'s top-level `runtime:` field, if any, so
 * we can inject `MOAT_RUNTIME` into every MOAT subprocess. Unlike
 * `moat run`, the `moat list` / `stop` / `destroy` commands don't read
 * `moat.yaml` — they pick the runtime from `$MOAT_RUNTIME` or auto-detect
 * (which falls back to docker on macOS hosts even when an `apple`
 * container runtime is configured in the workspace). One-line regex
 * rather than a YAML dep: we only care about the top-level scalar; if
 * the user has done something exotic, fall through to the environment.
 */
function readWorkspaceRuntime(workspace: string): string | undefined {
  try {
    const yaml = readFileSync(path.join(workspace, "moat.yaml"), "utf-8");
    const m = yaml.match(/^runtime:\s*["']?([\w-]+)["']?\s*$/m);
    return m?.[1];
  } catch {
    return undefined;
  }
}

/**
 * Compose the env handed to every MOAT subprocess. Inherits the parent's
 * env (so `MOAT_PROFILE`, `MOAT_RUNTIME`, etc. set in `.env.local` keep
 * working) and overlays an explicit `MOAT_RUNTIME` derived from the
 * workspace `moat.yaml` or the caller's `runtime` option. Explicit caller
 * config wins over both yaml and inherited env so a flow that asks for
 * `runtime: "apple"` doesn't get silently downgraded to docker.
 */
function buildSubprocessEnv(
  workspace: string,
  runtime: "auto" | "docker" | "apple" | undefined,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const explicit = runtime && runtime !== "auto" ? runtime : undefined;
  const fromYaml = readWorkspaceRuntime(workspace);
  const resolved = explicit ?? fromYaml ?? env.MOAT_RUNTIME;
  if (resolved) env.MOAT_RUNTIME = resolved;
  return env;
}

/**
 * Bounded `moat list --json`. Treats timeouts the same as non-zero exits —
 * returns `[]` so the readiness loop's outer deadline check stays authoritative.
 */
async function listRuns(
  spawnFn: SpawnFn,
  bin: string,
  timeoutMs?: number,
  cwd?: string,
  env?: NodeJS.ProcessEnv,
): Promise<RunRecord[]> {
  const res = await spawnFn(bin, ["list", "--json"], {
    timeoutMs: timeoutMs ?? CONTROL_PLANE_TIMEOUT_MS,
    cwd,
    env,
  });
  if (res.timedOut || res.exitCode !== 0) return [];
  try {
    const parsed = JSON.parse(res.stdout || "[]");
    if (!Array.isArray(parsed)) return [];
    // MOAT 0.5.x emits PascalCase keys (`Name`, `State`) from Go's default
    // JSON marshaling; 0.4.x emitted lowercase. Read both so the adapter
    // tolerates either schema. Without this the readiness loop polls a
    // running container forever because `state === "running"` never
    // matches the actual `""` we'd get from a missing key.
    return (parsed as Array<Record<string, unknown>>).map((r) => ({
      name: String(r.Name ?? r.name ?? ""),
      state: String(r.State ?? r.state ?? ""),
    }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Mount-source resolution
// ---------------------------------------------------------------------------

/**
 * Return the host path backing `mountTarget` in the container. Parses
 * `<src>:<dst>[:ro]` entries from the yaml's `mounts:` list; falls
 * back to the workspace dir if no override targets `mountTarget`.
 */
export function resolveMountSource(
  workspace: string,
  mountTarget: string,
  configPath?: string,
): string {
  if (!configPath) return path.resolve(workspace);
  let yaml: string;
  try {
    yaml = readFileSync(configPath, "utf-8");
  } catch {
    return path.resolve(workspace);
  }
  // Match list entries like:
  //   mounts:
  //     - ./.fsdev/moat:/workspace
  //     - "/host/path:/data:ro"
  // The `target === mountTarget` check below makes false positives
  // impossible — no other yaml field uses `src:dst` shape.
  const pattern = /^\s*-\s*["']?([^"'\s:]+):([^"'\s:]+)(?::ro)?["']?\s*$/gm;
  for (const match of yaml.matchAll(pattern)) {
    const source = match[1]!;
    const target = match[2]!;
    if (target === mountTarget) {
      return path.isAbsolute(source) ? source : path.resolve(workspace, source);
    }
  }
  return path.resolve(workspace);
}

/**
 * Strip every existing `mounts:` entry targeting `mountTarget` and
 * inject `<hostMountSource>:<mountTarget>` in its place (apple
 * runtime's implicit workspace mount is unreliable; explicit wins).
 * Non-matching mount entries and other yaml content pass through.
 * `hostMountSource` should be absolute.
 */
export function stripMountsTargeting(
  yaml: string,
  mountTarget: string,
  hostMountSource?: string,
): string {
  const lines: string[] = [];
  // Same `src:dst[:ro]` shape `resolveMountSource` recognizes.
  const linePattern = /^\s*-\s*["']?([^"'\s:]+):([^"'\s:]+)(?::ro)?["']?\s*$/;
  let hadMountsKey = false;
  for (const line of yaml.split("\n")) {
    if (/^\s*mounts:\s*$/.test(line)) {
      hadMountsKey = true;
    }
    const match = linePattern.exec(line);
    if (match && match[2] === mountTarget) continue;
    lines.push(line);
  }
  if (hostMountSource === undefined) return lines.join("\n");

  const injection = `  - ${hostMountSource}:${mountTarget}`;
  if (hadMountsKey) {
    // Splice the new entry immediately after the existing `mounts:` line.
    const out: string[] = [];
    let inserted = false;
    for (const line of lines) {
      out.push(line);
      if (!inserted && /^\s*mounts:\s*$/.test(line)) {
        out.push(injection);
        inserted = true;
      }
    }
    return out.join("\n");
  }
  // No existing block — append one. Trim a trailing empty line first
  // so the result doesn't gain a double-blank.
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") {
    lines.pop();
  }
  return [...lines, "mounts:", injection, ""].join("\n");
}

/**
 * Probe whether a named MOAT run is currently up. Used by
 * `ensureSandbox` to pick a status message before `resolveMoatSandbox`
 * blocks on a cold image build.
 */
export async function probeMoatRun(opts: {
  runName: string;
  bin?: string;
  workspace?: string;
  runtime?: "auto" | "docker" | "apple";
  spawnFn?: SpawnFn;
}): Promise<"running" | "absent"> {
  const bin = opts.bin ?? "moat";
  const spawnFn = opts.spawnFn ?? realSpawn;
  const workspace = opts.workspace ?? process.cwd();
  const env = buildSubprocessEnv(workspace, opts.runtime);
  try {
    const runs = await listRuns(spawnFn, bin, undefined, workspace, env);
    return runs.some((r) => r.name === opts.runName && r.state === "running")
      ? "running"
      : "absent";
  } catch {
    // Treat any unexpected failure as absent so the caller's status
    // emission stays informative even when probe is unreliable.
    return "absent";
  }
}

/** Framework-managed run names use this prefix; we only ever purge these. */
export const FSDEV_RUN_PREFIX = "fsdev-";
/** Default upper bound on framework-managed runs before purge kicks in. */
export const DEFAULT_MAX_CONTAINERS = 50;

/**
 * Destroy stale framework-managed MOAT runs to keep the pool bounded.
 * Lists every run with `FSDEV_RUN_PREFIX`, sorts oldest-first by
 * `StartedAt`, and destroys (`stop` + `destroy`) however many exceed
 * `keep`. Never touches the current run, non-prefixed runs, or runs
 * the lister can't read. Best-effort: spawn failures are swallowed so
 * the caller's main flow isn't disturbed (it's a background sidechain).
 */
export async function purgeOldRuns(opts: {
  /** Current run name — excluded from purge to avoid racing the boot. */
  runName: string;
  bin?: string;
  workspace?: string;
  runtime?: "auto" | "docker" | "apple";
  spawnFn?: SpawnFn;
  /** Max framework-managed runs to keep. Default 50. */
  keep?: number;
}): Promise<{ destroyed: string[] }> {
  const bin = opts.bin ?? "moat";
  const spawnFn = opts.spawnFn ?? realSpawn;
  const workspace = opts.workspace ?? process.cwd();
  const env = buildSubprocessEnv(workspace, opts.runtime);
  const keep = opts.keep ?? DEFAULT_MAX_CONTAINERS;

  const res = await spawnFn(bin, ["list", "--json"], {
    timeoutMs: CONTROL_PLANE_TIMEOUT_MS,
    cwd: workspace,
    env,
  });
  if (res.timedOut || res.exitCode !== 0) return { destroyed: [] };
  let runs: unknown;
  try {
    runs = JSON.parse(res.stdout || "[]");
  } catch {
    return { destroyed: [] };
  }
  if (!Array.isArray(runs)) return { destroyed: [] };

  const ours = (runs as Array<Record<string, unknown>>)
    .map((r) => ({
      name: String(r.Name ?? r.name ?? ""),
      startedAt: String(r.StartedAt ?? r.startedAt ?? ""),
    }))
    .filter((r) => r.name.startsWith(FSDEV_RUN_PREFIX) && r.name !== opts.runName)
    // Lexicographic ISO timestamp sort = chronological. Missing/zero
    // timestamps sort first (treated as oldest), which is the safe
    // default — we'd rather destroy an ambiguous-age run than a known
    // recent one.
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));

  if (ours.length <= keep) return { destroyed: [] };

  const toDestroy = ours.slice(0, ours.length - keep);
  const destroyed: string[] = [];
  for (const r of toDestroy) {
    try {
      await spawnFn(bin, ["stop", r.name], {
        timeoutMs: CONTROL_PLANE_TIMEOUT_MS,
        cwd: workspace,
        env,
      });
      await spawnFn(bin, ["destroy", r.name], {
        timeoutMs: CONTROL_PLANE_TIMEOUT_MS,
        cwd: workspace,
        env,
      });
      destroyed.push(r.name);
    } catch {
      // Best-effort; a failed purge is not a request-blocking error.
    }
  }
  return { destroyed };
}

// ---------------------------------------------------------------------------
// Adapter (Sandbox impl)
// ---------------------------------------------------------------------------

interface MoatRunHandle {
  runName: string;
  bin: string;
  execTimeoutMs: number;
  spawnFn: SpawnFn;
  /** Host CWD for every MOAT subprocess (so `moat.yaml`'s `runtime:` is honored). */
  workspace?: string;
  /** Inherited env + `MOAT_RUNTIME` for commands that don't read `moat.yaml`. */
  env?: NodeJS.ProcessEnv;
  /** Path to a transient temp directory holding generated `moat.yaml`, if any. */
  tempDir?: string;
  /** Workspace-internal `moat.yaml` copied in from `configPath`, if any. */
  copiedConfigPath?: string;
  /** When true, `stop()` skips MOAT teardown so the container survives for reuse. */
  persist: boolean;
  stopped: boolean;
  /**
   * Host directory bind-mounted at `mountTarget` inside the container.
   * When set, readFile/writeFile bypass `moat exec` and operate on the
   * host filesystem directly (the bind mount makes the change visible
   * inside the container instantly). Falls back to `moat exec` for paths
   * outside the bind mount.
   */
  mountSource?: string;
  /** Bind-mount target inside the container (default `/workspace`). */
  mountTarget: string;
}

/**
 * Build a `Sandbox` against a started MOAT run. Visible for tests; production
 * code goes through `resolveMoatSandbox`, which constructs the handle.
 */
export function createMoatAdapter(handle: MoatRunHandle): Sandbox {
  function ensureLive(): void {
    if (handle.stopped) throw new MoatRunStoppedError(handle.runName);
  }

  /**
   * Translate a container-side path under `mountTarget` to its host
   * counterpart, or null if the path is outside the bind mount.
   */
  function toHostPath(containerPath: string): string | null {
    if (!handle.mountSource) return null;
    const target = handle.mountTarget;
    if (containerPath === target) return handle.mountSource;
    const targetWithSlash = target.endsWith("/") ? target : target + "/";
    if (!containerPath.startsWith(targetWithSlash)) return null;
    const rel = containerPath.slice(targetWithSlash.length);
    return path.join(handle.mountSource, rel);
  }

  return {
    hostMountSource: handle.mountSource,

    async executeCommand(command: string): Promise<CommandResult> {
      ensureLive();
      const args = buildExecArgs(handle.runName, command);
      const res = await handle.spawnFn(handle.bin, args, {
        timeoutMs: handle.execTimeoutMs,
        cwd: handle.workspace,
        env: handle.env,
      });
      if (res.timedOut) {
        return {
          stdout: res.stdout,
          stderr: (res.stderr ? res.stderr + "\n" : "") + `exec timed out after ${handle.execTimeoutMs}ms`,
          exitCode: 124,
        };
      }
      return {
        stdout: res.stdout,
        stderr: res.stderr,
        exitCode: res.exitCode ?? 0,
      };
    },

    async readFile(filePath: string): Promise<string> {
      ensureLive();
      const hostPath = toHostPath(filePath);
      if (hostPath !== null) {
        let bytes: Buffer;
        try {
          bytes = await readFile(hostPath);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            throw new FileNotFoundError(filePath);
          }
          throw new MoatError(`readFile(${filePath}) failed: ${(err as Error).message}`);
        }
        try {
          return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        } catch {
          throw new MoatBinaryReadError(filePath, bytes.length);
        }
      }
      // Fallback: path is outside the bind mount. Go through `moat exec cat`.
      const args = ["exec", handle.runName, "--", "cat", filePath];
      const res = await handle.spawnFn(handle.bin, args, {
        timeoutMs: handle.execTimeoutMs,
        cwd: handle.workspace,
        env: handle.env,
      });
      if ((res.exitCode ?? 0) !== 0) {
        // Only stderr pattern reliably identifies a missing file — `cat` also
        // exits 1 for permission denied, I/O errors, etc., which should
        // surface as the generic MoatError so the cause isn't masked.
        if (/No such file/i.test(res.stderr)) {
          throw new FileNotFoundError(filePath);
        }
        throw new MoatError(`readFile(${filePath}) failed: ${res.stderr || res.stdout}`);
      }
      try {
        return new TextDecoder("utf-8", { fatal: true }).decode(res.stdoutBytes);
      } catch {
        throw new MoatBinaryReadError(filePath, res.stdoutBytes.length);
      }
    },

    async writeFile(filePath: string, content: string): Promise<void> {
      ensureLive();
      const hostPath = toHostPath(filePath);
      if (hostPath !== null) {
        await mkdir(path.dirname(hostPath), { recursive: true });
        await writeFile(hostPath, content, "utf-8");
        return;
      }
      // Fallback: path is outside the bind mount. Go through `moat exec`.
      const args = buildWriteFileArgs(handle.runName, filePath);
      const res = await handle.spawnFn(handle.bin, args, {
        timeoutMs: handle.execTimeoutMs,
        stdin: content,
        cwd: handle.workspace,
        env: handle.env,
      });
      if ((res.exitCode ?? 0) !== 0) {
        throw new MoatError(`writeFile(${filePath}) failed: ${res.stderr || res.stdout}`);
      }
    },

    async stop(): Promise<void> {
      if (handle.stopped) return;
      handle.stopped = true;
      // Persistent runs: the whole point is that the container survives for
      // reuse on the next request. Skip MOAT teardown and leave the workspace
      // `moat.yaml` + tempDir in place so the reconnect path on the next
      // resolve finds the live run and accepts the generated config.
      if (handle.persist) return;
      try {
        await handle.spawnFn(handle.bin, ["stop", handle.runName], {
          timeoutMs: CONTROL_PLANE_TIMEOUT_MS,
          cwd: handle.workspace,
          env: handle.env,
        });
      } catch (err) {
        console.warn(`[moat] stop failed for ${handle.runName}:`, (err as Error).message);
      }
      try {
        await handle.spawnFn(handle.bin, ["destroy", handle.runName], {
          timeoutMs: CONTROL_PLANE_TIMEOUT_MS,
          cwd: handle.workspace,
          env: handle.env,
        });
      } catch (err) {
        console.warn(`[moat] destroy failed for ${handle.runName}:`, (err as Error).message);
      }
      if (handle.tempDir) {
        try {
          await rm(handle.tempDir, { recursive: true, force: true });
        } catch {
          // Best-effort cleanup.
        }
      }
      if (handle.copiedConfigPath) {
        try {
          await rm(handle.copiedConfigPath, { force: true });
        } catch {
          // Best-effort cleanup.
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Resolver (preflight + start + readiness)
// ---------------------------------------------------------------------------

export interface ResolveMoatOptions {
  workspace?: string;
  mountTarget: string;
  runName: string;
  grants?: string[];
  allowHosts?: string[];
  runtime?: "auto" | "docker" | "apple";
  noSandbox?: boolean;
  configPath?: string;
  execTimeoutMs?: number;
  bin?: string;
  /**
   * When true, the resolver tolerates an existing `<workspace>/moat.yaml`
   * that carries the `FSDEV_MANAGED_MARKER` (reuse from a prior persistent
   * session) and the produced sandbox skips MOAT teardown on `stop()`.
   */
  persist?: boolean;
  /**
   * When true, the caller asserts the workspace path is framework-derived
   * (e.g. an auto-generated `.fsdev/workspaces/session/<sessionId>` dir)
   * and nothing inside it is user-authored. The resolver skips both
   * marker checks and always overwrites the workspace `moat.yaml` from
   * the source `configPath` (or the generated template).
   *
   * Without this, framework yamls written by a previous version (before
   * the marker existed) look user-authored to the marker check and
   * abort every subsequent boot with "Refusing to overwrite".
   */
  frameworkManaged?: boolean;
  /** Visible for tests: override the spawn implementation. */
  spawnFn?: SpawnFn;
  /**
   * Visible for tests: override the readiness poll cadence. The resolver waits
   * until the run is `running` or the deadline elapses.
   */
  readiness?: { intervalMs?: number; timeoutMs?: number };
}

export interface ResolveMoatResult {
  sandbox: Sandbox;
  sandboxId: string;
}

const DEFAULT_EXEC_TIMEOUT_MS = 60_000;
// First-run image builds on the apple runtime do apt-get installs and can
// take 30–60+ seconds; subsequent runs come up in seconds against the cached
// image. The default has to cover the cold path or every user's first
// kitchen-sink turn fails with `MoatRunTimeoutError`. Callers can override
// via `readiness.timeoutMs` once the image is warm.
const DEFAULT_READY_TIMEOUT_MS = 60_000;
const DEFAULT_READY_INTERVAL_MS = 500;

/**
 * Preflight + start (or reconnect) a MOAT run, returning a `Sandbox`
 * implementation against it.
 */
export async function resolveMoatSandbox(
  opts: ResolveMoatOptions,
): Promise<ResolveMoatResult> {
  const bin = opts.bin ?? "moat";
  const spawnFn = opts.spawnFn ?? realSpawn;
  const workspace = opts.workspace ?? process.cwd();
  const execTimeoutMs = opts.execTimeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;

  // Defer subprocess env until the workspace yaml exists — it sources
  // `MOAT_RUNTIME` from there and we don't write the yaml until below.
  await verifyBinary(spawnFn, bin);
  await verifyGrants(spawnFn, bin, opts.grants ?? []);

  // Resolve config: explicit path wins. If the explicit path lives outside
  // the workspace, copy it into the workspace root since MOAT reads
  // `moat.yaml` from the workspace and has no documented `--config` flag.
  // When no `configPath` is supplied, generate a transient one — but refuse
  // to silently overwrite a hand-authored `<workspace>/moat.yaml` (the
  // teardown step would then delete the user's config). Caller must move
  // their file or pass it explicitly via `configPath`.
  let tempDir: string | undefined;
  let copiedConfigPath: string | undefined;
  if (opts.configPath) {
    const resolved = path.resolve(opts.configPath);
    const inWorkspace = resolved.startsWith(path.resolve(workspace) + path.sep);
    if (!inWorkspace) {
      const target = path.join(workspace, "moat.yaml");
      // Refuse to clobber a user-authored yaml; `frameworkManaged` or
      // the marker on line 1 signals the file is ours to rewrite.
      if (existsSync(target) && !opts.frameworkManaged) {
        let isManaged = false;
        try {
          const head = readFileSync(target, "utf-8").split("\n", 1)[0] ?? "";
          isManaged = head.trim() === FSDEV_MANAGED_MARKER;
        } catch {
          // Treat unreadable as not-managed → throw below.
        }
        if (!isManaged) {
          throw new MoatError(
            `Refusing to overwrite existing ${target} with ${resolved}. Move your existing moat.yaml aside, or place \`configPath\` inside the workspace so it is used directly.`,
          );
        }
      }
      const sourceYaml = readFileSync(resolved, "utf-8");
      const absWorkspace = path.resolve(workspace);
      const cleanedYaml = stripMountsTargeting(
        sourceYaml,
        opts.mountTarget,
        absWorkspace,
      );
      const stamped = `${FSDEV_MANAGED_MARKER}\n${cleanedYaml}`;
      await writeFile(target, stamped, "utf-8");
      copiedConfigPath = target;
    }
  } else {
    const workspaceConfig = path.join(workspace, "moat.yaml");
    if (existsSync(workspaceConfig)) {
      let isManaged = opts.frameworkManaged ?? false;
      if (!isManaged) {
        try {
          const head = readFileSync(workspaceConfig, "utf-8").split("\n", 1)[0] ?? "";
          isManaged = head.trim() === FSDEV_MANAGED_MARKER;
        } catch {
          // Treat as unreadable → not managed.
        }
      }
      if (!isManaged) {
        throw new MoatError(
          `Refusing to overwrite existing ${workspaceConfig}. Pass it explicitly via \`provider.configPath\` (it will be left untouched), or remove it.`,
        );
      }
      if (!opts.persist) {
        // Stale managed yaml from a prior session whose teardown didn't
        // run (process crash, SIGKILL). Without `persist`, regenerate to
        // pick up any config changes; we still own the file via the marker.
        const yaml = generateMoatYaml({
          name: opts.runName,
          grants: opts.grants,
          allowHosts: opts.allowHosts,
        });
        await writeFile(workspaceConfig, yaml, "utf-8");
        tempDir = path.join(os.tmpdir(), "fsdev-moat", opts.runName);
        await mkdir(tempDir, { recursive: true });
        await writeFile(path.join(tempDir, "moat.yaml"), yaml, "utf-8");
      }
      // `persist` path leaves the existing file as-is — the running container
      // (if reconnect succeeds below) was launched against it.
      copiedConfigPath = workspaceConfig;
    } else {
      tempDir = path.join(os.tmpdir(), "fsdev-moat", opts.runName);
      await mkdir(tempDir, { recursive: true });
      const yaml = generateMoatYaml({
        name: opts.runName,
        grants: opts.grants,
        allowHosts: opts.allowHosts,
      });
      await writeFile(path.join(tempDir, "moat.yaml"), yaml, "utf-8");
      // Also drop into the workspace so MOAT picks it up.
      await writeFile(workspaceConfig, yaml, "utf-8");
      copiedConfigPath = workspaceConfig;
    }
  }

  const subprocessEnv = buildSubprocessEnv(workspace, opts.runtime);

  // From here on, any failure must clean up the artifacts we just wrote;
  // otherwise a readiness-timeout (or `moat run` non-zero exit) leaves the
  // generated `moat.yaml` and tempDir behind, since `MoatRunHandle` —
  // and therefore `sandbox.stop()` — never gets constructed.
  async function cleanupTransientArtifacts(): Promise<void> {
    if (tempDir) {
      try {
        await rm(tempDir, { recursive: true, force: true });
      } catch {
        // Best-effort.
      }
    }
    if (copiedConfigPath) {
      try {
        await rm(copiedConfigPath, { force: true });
      } catch {
        // Best-effort.
      }
    }
  }

  try {
    // Reuse a live run with the same name if present.
    const runs = await listRuns(spawnFn, bin, undefined, workspace, subprocessEnv);
    const existing = runs.find((r) => r.name === opts.runName && r.state === "running");
    if (!existing) {
      const args = buildRunArgs({
        runName: opts.runName,
        workspace,
        mountTarget: opts.mountTarget,
        runtime: opts.runtime,
        grants: opts.grants,
        allowHosts: opts.allowHosts,
        noSandbox: opts.noSandbox,
      });
      let childHandle: DetachedChildHandle;
      try {
        childHandle = startDetached(bin, args, opts.runName, workspace, subprocessEnv);
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        if (e.code === "ENOENT") throw new MoatNotInstalledError(bin);
        throw new MoatRunStartError((err as Error).message);
      }
      // Poll for readiness; fail fast if `moat run` exits early.
      const readyTimeoutMs = opts.readiness?.timeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
      const deadline = Date.now() + readyTimeoutMs;
      const interval = opts.readiness?.intervalMs ?? DEFAULT_READY_INTERVAL_MS;
      let ready = false;
      while (Date.now() < deadline) {
        const remaining = deadline - Date.now();
        const list = await listRuns(
          spawnFn,
          bin,
          Math.min(remaining, CONTROL_PLANE_TIMEOUT_MS),
          workspace,
          subprocessEnv,
        );
        if (list.find((r) => r.name === opts.runName && r.state === "running")) {
          ready = true;
          break;
        }
        const exitInfo = childHandle.getExitInfo();
        if (exitInfo !== null) {
          throw new MoatRunStartError(
            exitInfo.stderr.trim() ||
              `moat run exited with code ${exitInfo.exitCode} before the container reached "running".`,
          );
        }
        await new Promise((r) => setTimeout(r, interval));
      }
      if (!ready) {
        // Best-effort stop + destroy so the half-started container doesn't
        // linger on the host. Mirrors `createMoatAdapter.stop()`.
        try {
          await spawnFn(bin, ["stop", opts.runName], {
            timeoutMs: CONTROL_PLANE_TIMEOUT_MS,
            cwd: workspace,
            env: subprocessEnv,
          });
        } catch {
          // Ignore — we are already in an error path.
        }
        try {
          await spawnFn(bin, ["destroy", opts.runName], {
            timeoutMs: CONTROL_PLANE_TIMEOUT_MS,
            cwd: workspace,
            env: subprocessEnv,
          });
        } catch {
          // Ignore — we are already in an error path.
        }
        throw new MoatRunTimeoutError(opts.runName, readyTimeoutMs);
      }
    }
  } catch (err) {
    // Tear down anything we wrote so the next attempt starts clean. The
    // MoatRunHandle (and its `stop()`) was never constructed at this point.
    // Skip when persisting — the artifacts may be from a still-live run we
    // failed to reconnect to (transient `moat list` failure), and removing
    // them would orphan that container without the operator's input.
    if (!opts.persist) {
      await cleanupTransientArtifacts();
    }
    throw err;
  }

  const mountSource = resolveMountSource(workspace, opts.mountTarget, copiedConfigPath);

  const handle: MoatRunHandle = {
    runName: opts.runName,
    bin,
    execTimeoutMs,
    spawnFn,
    workspace,
    env: subprocessEnv,
    tempDir,
    copiedConfigPath,
    stopped: false,
    persist: opts.persist ?? false,
    mountSource,
    mountTarget: opts.mountTarget,
  };

  return { sandbox: createMoatAdapter(handle), sandboxId: opts.runName };
}
