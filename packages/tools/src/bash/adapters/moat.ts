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
import { existsSync } from "node:fs";
import { mkdir, writeFile, copyFile, rm } from "node:fs/promises";
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
 * Build the argv for `moat run -d`. The workspace path is the trailing
 * positional. Returns argv excluding the binary itself.
 */
export function buildRunArgs(input: BuildRunArgsInput): string[] {
  const args: string[] = ["run", "-n", input.runName, "-d"];
  const runtime = input.runtime ?? "auto";
  if (runtime !== "auto") {
    args.push("--runtime", runtime);
  }
  args.push("-m", `${input.workspace}:${input.mountTarget}`);
  for (const g of input.grants ?? []) {
    args.push("-g", g);
  }
  for (const h of input.allowHosts ?? []) {
    args.push("--allow-host", h);
  }
  if (input.noSandbox) args.push("--no-sandbox");
  args.push(input.workspace);
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
 * Generate a transient `moat.yaml` representing the requested grants and
 * outbound network policy. Default-deny when no hosts are listed. All
 * caller-supplied values are quoted to avoid YAML injection.
 */
export function generateMoatYaml(input: GenerateMoatYamlInput): string {
  const lines: string[] = [`name: ${yamlQuote(input.name)}`];
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
  options: { stdin?: string; timeoutMs?: number },
) => Promise<SpawnResult>;

const realSpawn: SpawnFn = (command, args, options) => {
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
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

async function verifyBinary(spawnFn: SpawnFn, bin: string): Promise<{ version: string }> {
  let res: SpawnResult;
  try {
    res = await spawnFn(bin, ["version", "--json"], {});
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new MoatNotInstalledError(bin);
    }
    throw err;
  }
  if (res.exitCode !== 0) {
    throw new MoatError(`\`${bin} version --json\` failed: ${res.stderr || res.stdout}`);
  }
  const parsed = (() => {
    try {
      return JSON.parse(res.stdout) as { version?: string };
    } catch {
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
  const res = await spawnFn(bin, ["grant", "list", "--json"], {});
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

async function listRuns(spawnFn: SpawnFn, bin: string): Promise<RunRecord[]> {
  const res = await spawnFn(bin, ["list", "--json"], {});
  if (res.exitCode !== 0) return [];
  try {
    const parsed = JSON.parse(res.stdout || "[]");
    if (!Array.isArray(parsed)) return [];
    return (parsed as Array<Record<string, unknown>>).map((r) => ({
      name: String(r.name ?? ""),
      state: String(r.state ?? ""),
    }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Adapter (Sandbox impl)
// ---------------------------------------------------------------------------

interface MoatRunHandle {
  runName: string;
  bin: string;
  execTimeoutMs: number;
  spawnFn: SpawnFn;
  /** Path to a transient temp directory holding generated `moat.yaml`, if any. */
  tempDir?: string;
  /** Workspace-internal `moat.yaml` copied in from `configPath`, if any. */
  copiedConfigPath?: string;
  stopped: boolean;
}

/**
 * Build a `Sandbox` against a started MOAT run. Visible for tests; production
 * code goes through `resolveMoatSandbox`, which constructs the handle.
 */
export function createMoatAdapter(handle: MoatRunHandle): Sandbox {
  function ensureLive(): void {
    if (handle.stopped) throw new MoatRunStoppedError(handle.runName);
  }

  return {
    async executeCommand(command: string): Promise<CommandResult> {
      ensureLive();
      const args = buildExecArgs(handle.runName, command);
      const res = await handle.spawnFn(handle.bin, args, {
        timeoutMs: handle.execTimeoutMs,
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
      const args = ["exec", handle.runName, "--", "cat", filePath];
      const res = await handle.spawnFn(handle.bin, args, {
        timeoutMs: handle.execTimeoutMs,
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
      // Validate that the raw bytes are real UTF-8. The default `stdout`
      // string would silently replace bad sequences; decoding the raw
      // buffer with `fatal: true` is the only way to detect binary content.
      try {
        return new TextDecoder("utf-8", { fatal: true }).decode(res.stdoutBytes);
      } catch {
        throw new MoatBinaryReadError(filePath, res.stdoutBytes.length);
      }
    },

    async writeFile(filePath: string, content: string): Promise<void> {
      ensureLive();
      const args = buildWriteFileArgs(handle.runName, filePath);
      const res = await handle.spawnFn(handle.bin, args, {
        timeoutMs: handle.execTimeoutMs,
        stdin: content,
      });
      if ((res.exitCode ?? 0) !== 0) {
        throw new MoatError(`writeFile(${filePath}) failed: ${res.stderr || res.stdout}`);
      }
    },

    async stop(): Promise<void> {
      if (handle.stopped) return;
      handle.stopped = true;
      try {
        await handle.spawnFn(handle.bin, ["stop", handle.runName], {});
      } catch (err) {
        console.warn(`[moat] stop failed for ${handle.runName}:`, (err as Error).message);
      }
      try {
        await handle.spawnFn(handle.bin, ["destroy", handle.runName], {});
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
const DEFAULT_READY_TIMEOUT_MS = 10_000;
const DEFAULT_READY_INTERVAL_MS = 200;

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
      if (existsSync(target)) {
        throw new MoatError(
          `Refusing to overwrite existing ${target} with ${resolved}. Move your existing moat.yaml aside, or place \`configPath\` inside the workspace so it is used directly.`,
        );
      }
      await copyFile(resolved, target);
      copiedConfigPath = target;
    }
  } else {
    const workspaceConfig = path.join(workspace, "moat.yaml");
    if (existsSync(workspaceConfig)) {
      throw new MoatError(
        `Refusing to overwrite existing ${workspaceConfig}. Pass it explicitly via \`provider.configPath\` (it will be left untouched), or remove it.`,
      );
    }
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
    const runs = await listRuns(spawnFn, bin);
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
      const res = await spawnFn(bin, args, {});
      if ((res.exitCode ?? 0) !== 0) {
        throw new MoatRunStartError(res.stderr || res.stdout);
      }
      // Poll for readiness.
      const deadline = Date.now() + (opts.readiness?.timeoutMs ?? DEFAULT_READY_TIMEOUT_MS);
      const interval = opts.readiness?.intervalMs ?? DEFAULT_READY_INTERVAL_MS;
      let ready = false;
      while (Date.now() < deadline) {
        const list = await listRuns(spawnFn, bin);
        if (list.find((r) => r.name === opts.runName && r.state === "running")) {
          ready = true;
          break;
        }
        await new Promise((r) => setTimeout(r, interval));
      }
      if (!ready) {
        // Best-effort stop, then surface the timeout.
        try {
          await spawnFn(bin, ["stop", opts.runName], {});
        } catch {
          // Ignore — we are already in an error path.
        }
        throw new MoatRunTimeoutError(opts.runName, opts.readiness?.timeoutMs ?? DEFAULT_READY_TIMEOUT_MS);
      }
    }
  } catch (err) {
    // Tear down anything we wrote so the next attempt starts clean. The
    // MoatRunHandle (and its `stop()`) was never constructed at this point.
    await cleanupTransientArtifacts();
    throw err;
  }

  const handle: MoatRunHandle = {
    runName: opts.runName,
    bin,
    execTimeoutMs,
    spawnFn,
    tempDir,
    copiedConfigPath,
    stopped: false,
  };

  return { sandbox: createMoatAdapter(handle), sandboxId: opts.runName };
}
