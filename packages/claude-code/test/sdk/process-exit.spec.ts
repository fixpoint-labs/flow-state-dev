import { afterEach, describe, it, expect } from "vitest";
import type { ChildProcess } from "node:child_process";
import { createTestContext } from "@flow-state-dev/testing";
import { abortExitGrace, claudeCodeAgent } from "../../src/sdk/agent";
import { trackProcess } from "../../src/sdk/process-exit";
import type { ResolveClaudeAgent, SdkMessageLike } from "../../src/sdk/types";

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
    const resolveClaudeAgent: ResolveClaudeAgent = () => ({
      query: async function* (args) {
        const opts = args.options!;
        const signal = opts.abortController!.signal;
        child = opts.spawnClaudeCodeProcess!({ ...node(IGNORES_SIGTERM), signal }) as ChildProcess;
        child.on("error", () => {});
        yield { type: "system", subtype: "init", session_id: "sess_kill" } as SdkMessageLike;
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
