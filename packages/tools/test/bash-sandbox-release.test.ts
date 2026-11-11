/**
 * What releasing a bash sandbox stops, and when a sandbox is released on its
 * own.
 *
 * Why these matter: a background job the model starts (`npm run dev &`, a
 * watcher) is meant to outlive the command that started it, so the agent can
 * start a server and then curl it. But nothing else ever stops it, so on a
 * long-lived server those jobs pile up for good. Releasing the sandbox is the
 * point where the session is done with them; a sandbox nobody has used for
 * 30 minutes is released anyway, so a flow that never wired cleanup is still
 * reaped.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runForTest } from "@flow-state-dev/testing";
import { createLocalFsSandbox } from "../src/bash/adapters/local-fs";
import {
  createBashBlocks,
  releaseBashSandbox,
  SANDBOX_IDLE_RELEASE_MS,
} from "../src/bash/blocks";
import type { Sandbox, SandboxProvider } from "../src/bash/types";

let cwd: string;
/** Pids a test started; killed after each test so a failure can't leak them. */
let spawnedPids: number[] = [];

/**
 * True while `pid` names a running process. Signal 0 also succeeds on a
 * zombie (a killed orphan whose new parent hasn't reaped it, as in containers
 * whose PID 1 doesn't reap), so on Linux a `Z` state in `/proc` counts as dead.
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
    return true; // No /proc (macOS): signal 0 is the best probe available.
  }
}

/** Poll until `pid` is gone or `withinMs` passes; returns whether it died. */
async function waitForExit(pid: number, withinMs: number): Promise<boolean> {
  const deadline = Date.now() + withinMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return !isAlive(pid);
}

/** Start a background job through `sandbox` and return its pid. */
async function startBackgroundJob(sandbox: Sandbox, job = "sleep 300"): Promise<number> {
  // Output redirected, as a real server start would be — otherwise the job
  // holds the command's stdout open and the command never returns.
  const result = await sandbox.executeCommand(`${job} > /dev/null 2>&1 & echo $!`);
  expect(result.exitCode).toBe(0);
  const pid = Number(result.stdout.trim());
  expect(pid).toBeGreaterThan(0);
  spawnedPids.push(pid);
  return pid;
}

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "bash-release-"));
});

afterEach(async () => {
  vi.useRealTimers();
  for (const pid of spawnedPids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
  spawnedPids = [];
  await rm(cwd, { recursive: true, force: true });
});

describe("local bash sandbox: background jobs", () => {
  it("lets a background job outlive the command that started it", async () => {
    const sandbox = createLocalFsSandbox({ cwd });

    const pid = await startBackgroundJob(sandbox);

    // The agent starts a server, then uses it in a later command.
    expect(isAlive(pid)).toBe(true);
    const later = await sandbox.executeCommand("echo still here");
    expect(later.exitCode).toBe(0);
    expect(isAlive(pid)).toBe(true);
  });

  it("stops every background job its commands started when the sandbox stops", async () => {
    const sandbox = createLocalFsSandbox({ cwd });
    const first = await startBackgroundJob(sandbox);
    const second = await startBackgroundJob(sandbox);

    await sandbox.stop?.();

    expect(await waitForExit(first, 1_000)).toBe(true);
    expect(await waitForExit(second, 1_000)).toBe(true);
  });

  it("kills a job that ignores SIGTERM once the grace period is over", async () => {
    const sandbox = createLocalFsSandbox({ cwd });
    // `trap '' TERM` makes the shell (and the sleep it runs) ignore SIGTERM.
    const pid = await startBackgroundJob(sandbox, `sh -c "trap '' TERM; sleep 300"`);

    await sandbox.stop?.();

    expect(await waitForExit(pid, 1_000)).toBe(true);
  });

  it("stops the jobs when the session's sandbox is released", async () => {
    const provider: SandboxProvider = { type: "local", cwd };
    const { bashCommand } = createBashBlocks({ provider, destination: "/workspace" });
    const ctx = sessionCtx("release-local");

    const output = await runForTest(
      bashCommand,
      // The block prefixes `cd <workspace> && `; the leading `true;` keeps the
      // `&` on the sleep alone rather than on that whole list.
      { command: "true; sleep 300 > /dev/null 2>&1 & echo $!" },
      ctx,
    );
    const pid = Number(output.stdout.trim());
    expect(pid).toBeGreaterThan(0);
    spawnedPids.push(pid);
    expect(isAlive(pid)).toBe(true);

    await releaseBashSandbox(provider, ctx);

    expect(await waitForExit(pid, 1_000)).toBe(true);
  });
});

describe("bash sandbox registry: idle release", () => {
  const LONG_COMMAND_MS = 20 * 60 * 1000;

  /** A custom provider that hands out a fresh, stop-counting sandbox per resolve. */
  function countingProvider() {
    const made: Array<{ stop: ReturnType<typeof vi.fn> }> = [];
    const provider: SandboxProvider = {
      type: "custom",
      get sandbox() {
        const stop = vi.fn(async () => {});
        made.push({ stop });
        return {
          // Non-zero `find` makes the flush walk bail out early.
          executeCommand: async (command: string) => {
            if (command.includes("slow-build")) {
              await new Promise((r) => setTimeout(r, LONG_COMMAND_MS));
            }
            return { stdout: "", stderr: "", exitCode: 1 };
          },
          readFile: async () => "",
          writeFile: async () => {},
          stop,
        } satisfies Sandbox;
      },
    };
    return { provider, made };
  }

  it("releases a sandbox no command has used for the idle window, and starts fresh after", async () => {
    vi.useFakeTimers();
    const { provider, made } = countingProvider();
    const { bashCommand } = createBashBlocks({ provider, destination: "/workspace" });
    const ctx = sessionCtx("idle-release");

    await runForTest(bashCommand, { command: "true" }, ctx);
    expect(made).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(SANDBOX_IDLE_RELEASE_MS - 1);
    expect(made[0]!.stop).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(made[0]!.stop).toHaveBeenCalledTimes(1);

    // The next command in the session gets a new sandbox.
    await runForTest(bashCommand, { command: "true" }, ctx);
    expect(made).toHaveLength(2);
    await releaseBashSandbox(provider, ctx);
  });

  it("measures idle from the last command, so a sandbox in use is never released", async () => {
    vi.useFakeTimers();
    const { provider, made } = countingProvider();
    const { bashCommand } = createBashBlocks({ provider, destination: "/workspace" });
    const ctx = sessionCtx("idle-reset");

    await runForTest(bashCommand, { command: "true" }, ctx);
    await vi.advanceTimersByTimeAsync(SANDBOX_IDLE_RELEASE_MS - 1_000);
    await runForTest(bashCommand, { command: "true" }, ctx);
    await vi.advanceTimersByTimeAsync(SANDBOX_IDLE_RELEASE_MS - 1_000);

    expect(made).toHaveLength(1);
    expect(made[0]!.stop).not.toHaveBeenCalled();
    await releaseBashSandbox(provider, ctx);
  });

  it("counts idle from when a long command finished, not when it started", async () => {
    vi.useFakeTimers();
    const { provider, made } = countingProvider();
    const { bashCommand } = createBashBlocks({ provider, destination: "/workspace" });
    const ctx = sessionCtx("idle-long-command");

    const running = runForTest(bashCommand, { command: "slow-build" }, ctx);
    await vi.advanceTimersByTimeAsync(LONG_COMMAND_MS);
    await running;
    await vi.advanceTimersByTimeAsync(SANDBOX_IDLE_RELEASE_MS - 1_000);

    expect(made[0]!.stop).not.toHaveBeenCalled();
    await releaseBashSandbox(provider, ctx);
  });

  it("drops the idle timer on an explicit release, so it never fires on a released sandbox", async () => {
    vi.useFakeTimers();
    const { provider, made } = countingProvider();
    const { bashCommand } = createBashBlocks({ provider, destination: "/workspace" });
    const ctx = sessionCtx("idle-explicit");

    await runForTest(bashCommand, { command: "true" }, ctx);
    await releaseBashSandbox(provider, ctx);
    expect(made[0]!.stop).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(SANDBOX_IDLE_RELEASE_MS);
    expect(made[0]!.stop).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never holds the process open while it waits", async () => {
    const { provider } = countingProvider();
    const { bashCommand } = createBashBlocks({ provider, destination: "/workspace" });
    const ctx = sessionCtx("idle-unref");
    // Only ref'd timers are listed as active resources.
    const refTimers = () =>
      process.getActiveResourcesInfo().filter((r) => r === "Timeout").length;
    const before = refTimers();

    await runForTest(bashCommand, { command: "true" }, ctx);

    expect(refTimers()).toBe(before);
    await releaseBashSandbox(provider, ctx);
  });

  it("stops a local sandbox's background jobs when it goes idle, with no cleanup wired", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const provider: SandboxProvider = { type: "local", cwd };
    const { bashCommand } = createBashBlocks({ provider, destination: "/workspace" });
    const ctx = sessionCtx("idle-local");

    const output = await runForTest(
      bashCommand,
      { command: "true; sleep 300 > /dev/null 2>&1 & echo $!" },
      ctx,
    );
    const pid = Number(output.stdout.trim());
    spawnedPids.push(pid);
    expect(isAlive(pid)).toBe(true);

    // The idle window, then the SIGTERM grace.
    await vi.advanceTimersByTimeAsync(SANDBOX_IDLE_RELEASE_MS);
    await vi.advanceTimersByTimeAsync(5_000);
    vi.useRealTimers();

    // The idle release runs in the background; give the signal time to land.
    expect(await waitForExit(pid, 3_000)).toBe(true);
  });
});

function sessionCtx(id: string): any {
  return {
    request: { identity: { id: `req-${id}` } },
    session: { identity: { id, userId: "u1" } },
    resources: {},
  };
}
