import { afterEach, describe, it, expect } from "vitest";
import type { ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestContext } from "@flow-state-dev/testing";
import { abortExitGrace, claudeCodeAgent } from "../../src/sdk/agent";
import { trackProcess } from "../../src/sdk/process-exit";
import type { ResolveClaudeCodeAgent, ClaudeCodeSdkMessage } from "../../src/sdk/types";

const node = (script: string, signal = new AbortController().signal) => ({
  command: process.execPath,
  args: ["-e", script],
  env: { ...process.env },
  signal,
});

describe("trackProcess", () => {
  it("has nothing to wait on until something is spawned through it", () => {
    expect(trackProcess().exited()).toBeNull();
  });

  it("resolves exited() when the process exits, and keeps the end of its stderr", async () => {
    const tracked = trackProcess();
    tracked.spawn(node("process.stderr.write('auth failed: no key'); process.exit(1)"));
    await tracked.exited();
    expect(tracked.stderrTail()).toBe("auth failed: no key");
  });

  it("does not count the abort-time `error` as an exit — only the process going does", async () => {
    // Node emits `error` the moment the forwarded signal aborts, before the
    // child it is killing has exited. Treating that as the exit is the window
    // this module exists to close.
    const controller = new AbortController();
    const tracked = trackProcess();
    const child = tracked.spawn(
      node("process.on('SIGTERM', () => setTimeout(() => process.exit(0), 150)); setInterval(() => {}, 1000)", controller.signal),
    );
    child.on("error", () => {});
    await new Promise((resolve) => setTimeout(resolve, 100)); // let it install its handler
    let exited = false;
    void tracked.exited()!.then(() => {
      exited = true;
    });
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(exited).toBe(false);
    await tracked.exited();
    expect(child.exitCode ?? child.signalCode).not.toBeNull();
  });

  it("resolves exited() for a process that never started, so nothing waits on it", async () => {
    const tracked = trackProcess();
    const child = tracked.spawn({
      command: "/nonexistent/claude-binary",
      args: [],
      env: { ...process.env },
      signal: new AbortController().signal,
    });
    child.on("error", () => {});
    await tracked.exited();
    expect(child.pid).toBeUndefined();
  });

  it("kills a process that ignores SIGTERM, and resolves once it has exited", async () => {
    const tracked = trackProcess();
    const child = tracked.spawn(node(IGNORES_SIGTERM));
    await ready(child);
    child.kill("SIGTERM");
    await tracked.kill();
    expect(child.signalCode).toBe("SIGKILL");
  });

  it("has nothing to kill when nothing was spawned", async () => {
    await expect(trackProcess().kill()).resolves.toBeUndefined();
  });
});

/** A process that stays up through `SIGTERM`, the signal the SDK stops it with. */
const IGNORES_SIGTERM = "process.on('SIGTERM', () => {}); process.stdout.write('ready'); setInterval(() => {}, 1000)";

/** Resolves once the process has its SIGTERM handler installed. */
const ready = (child: ChildProcess) => new Promise<void>((resolve) => child.stdout!.once('data', () => resolve()));

describe("an aborted claudeCodeAgent run (FIX-2312)", () => {
  const shippedGraceMs = abortExitGrace.ms;
  afterEach(() => {
    abortExitGrace.ms = shippedGraceMs;
  });

  it("returns only after its process has exited, killing one that ignores SIGTERM once the grace runs out", async () => {
    abortExitGrace.ms = 300;
    let child: ChildProcess | undefined;
    let running: () => void = () => {};
    const started = new Promise<void>((resolve) => (running = resolve));
    // Like the SDK on abort: it signals the process it spawned through the
    // block's hook, and ends its stream whether or not the process has gone.
    const resolveClaudeAgent: ResolveClaudeCodeAgent = () => ({
      query: async function* (args) {
        const opts = args.options!;
        const signal = opts.abortController!.signal;
        child = opts.spawnClaudeCodeProcess!({ ...node(IGNORES_SIGTERM), signal }) as ChildProcess;
        child.on("error", () => {});
        yield { type: "system", subtype: "init", session_id: "sess_kill" } as ClaudeCodeSdkMessage;
        await ready(child);
        running();
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
        throw new DOMException("Claude Code process aborted by user", "AbortError");
      },
    });
    const block = claudeCodeAgent({ resolveClaudeAgent });
    const runtime = await createTestContext({ declaredResources: block.declaredResources });
    const controller = new AbortController();
    (runtime.ctx as unknown as { signal: AbortSignal }).signal = controller.signal;

    const run = Promise.resolve(block.config.execute?.({ prompt: "go" }, runtime.ctx as never)).catch((error: unknown) => error);
    await started;
    controller.abort();
    await run;

    // Dead when the block hands control back: a host may start the next run in its checkout.
    expect(child!.exitCode ?? child!.signalCode).not.toBeNull();
    expect(child!.signalCode).toBe("SIGKILL");
  });
});

/**
 * True while `pid` names a running process. Signal 0 also succeeds on a zombie
 * (a killed orphan nobody has reaped, as in a container whose PID 1 does not
 * reap), so on Linux a `Z` state in `/proc` counts as dead.
 */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf-8");
    return stat.charAt(stat.lastIndexOf(")") + 2) !== "Z";
  } catch {
    return true; // No /proc (macOS): signal 0 is the best probe there is.
  }
}

/** Poll until `pid` is gone or `withinMs` passes; returns whether it died. */
async function waitForExit(pid: number, withinMs: number): Promise<boolean> {
  const deadline = Date.now() + withinMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return !isAlive(pid);
}

/**
 * A stand-in for the agent CLI that starts a long-lived command of its own (a
 * `tsc --watch`, a dev server), prints that command's pid, and keeps running.
 * The command writes `sigterm` into `dir` when it is sent SIGTERM and then
 * stays up, so a spec can tell "asked to stop" from "killed". The pid is
 * printed only once the command reports its SIGTERM handler installed: a stop
 * sent earlier would kill it by default and leave no marker to assert on.
 */
function startsACommand(dir: string, cliIgnoresSigterm: boolean): string {
  const grandchild = `process.on('SIGTERM',()=>require('fs').writeFileSync(${JSON.stringify(join(dir, "sigterm"))},'1'));process.stdout.write('ready');setInterval(()=>{},1000)`;
  return [
    "const { spawn } = require('child_process');",
    `const c = spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: ['ignore', 'pipe', 'ignore'] });`,
    cliIgnoresSigterm ? "process.on('SIGTERM', () => {});" : "",
    "c.stdout.once('data', () => process.stdout.write(String(c.pid) + '\\n'));",
    "setInterval(() => {}, 1000);",
  ].join("\n");
}

/** The pid the stand-in printed. */
const commandPid = (child: ChildProcess) =>
  new Promise<number>((resolve) => child.stdout!.once("data", (chunk: Buffer) => resolve(Number(String(chunk).trim()))));

// FIX-2671.
describe.skipIf(process.platform === "win32")("trackProcess — the commands the agent started", () => {
  const leaked: number[] = [];
  afterEach(() => {
    for (const pid of leaked.splice(0)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
  });

  it("an abort asks the agent's commands to stop too, not only the agent", async () => {
    const dir = mkdtempSync(join(tmpdir(), "claude-code-group-"));
    const controller = new AbortController();
    const tracked = trackProcess();
    const child = tracked.spawn(node(startsACommand(dir, false), controller.signal));
    child.on("error", () => {});
    const pid = await commandPid(child);
    leaked.push(pid);

    controller.abort();
    await tracked.exited();

    // SIGTERM, the graceful stop, reached the command and not just the CLI.
    await expect.poll(() => existsSync(join(dir, "sigterm")), { timeout: 2_000 }).toBe(true);
  });

  it("the force kill after the grace ends the agent's commands, even once the agent itself has gone", async () => {
    const dir = mkdtempSync(join(tmpdir(), "claude-code-group-"));
    const controller = new AbortController();
    const tracked = trackProcess();
    const child = tracked.spawn(node(startsACommand(dir, false), controller.signal));
    child.on("error", () => {});
    const pid = await commandPid(child);
    leaked.push(pid);

    controller.abort();
    await tracked.exited();
    await tracked.kill();

    expect(await waitForExit(pid, 2_000)).toBe(true);
  });

  it("a process that exits on its own leaves what it started alone", async () => {
    const dir = mkdtempSync(join(tmpdir(), "claude-code-group-"));
    const tracked = trackProcess();
    const script = startsACommand(dir, false).replace("setInterval(() => {}, 1000);", "setTimeout(() => process.exit(0), 200);");
    const child = tracked.spawn(node(script));
    const pid = await commandPid(child);
    leaked.push(pid);

    await tracked.exited();
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Normal completion is not a stop: nothing new is signalled.
    expect(isAlive(pid)).toBe(true);
    expect(existsSync(join(dir, "sigterm"))).toBe(false);
  });
});

// FIX-2671.
describe.skipIf(process.platform === "win32")("an aborted claudeCodeAgent run — the commands the agent started", () => {
  const shippedGraceMs = abortExitGrace.ms;
  const leaked: number[] = [];
  afterEach(() => {
    abortExitGrace.ms = shippedGraceMs;
    for (const pid of leaked.splice(0)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
  });

  it("returns with the agent's commands gone: asked to stop first, then killed", async () => {
    abortExitGrace.ms = 300;
    const dir = mkdtempSync(join(tmpdir(), "claude-code-group-"));
    let child: ChildProcess | undefined;
    let pid = 0;
    let running: () => void = () => {};
    const started = new Promise<void>((resolve) => (running = resolve));
    // Like the SDK on abort: it aborts the signal it handed the spawn hook, and
    // ends its stream whether or not the process has gone.
    const resolveClaudeAgent: ResolveClaudeCodeAgent = () => ({
      query: async function* (args) {
        const opts = args.options!;
        const signal = opts.abortController!.signal;
        child = opts.spawnClaudeCodeProcess!({ ...node(startsACommand(dir, true)), signal }) as ChildProcess;
        child.on("error", () => {});
        yield { type: "system", subtype: "init", session_id: "sess_group" } as ClaudeCodeSdkMessage;
        pid = await commandPid(child);
        leaked.push(pid);
        running();
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
        throw new DOMException("Claude Code process aborted by user", "AbortError");
      },
    });
    const block = claudeCodeAgent({ resolveClaudeAgent });
    const runtime = await createTestContext({ declaredResources: block.declaredResources });
    const controller = new AbortController();
    (runtime.ctx as unknown as { signal: AbortSignal }).signal = controller.signal;

    const run = Promise.resolve(block.config.execute?.({ prompt: "go" }, runtime.ctx as never)).catch((error: unknown) => error);
    await started;
    controller.abort();
    await run;

    expect(existsSync(join(dir, "sigterm"))).toBe(true);
    expect(await waitForExit(pid, 1_000)).toBe(true);
  });
});
