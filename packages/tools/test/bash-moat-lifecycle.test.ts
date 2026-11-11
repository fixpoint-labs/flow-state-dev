/**
 * What the MOAT bash provider leaves running, tested against a fake `moat`
 * CLI (a shell script standing in for the real binary).
 *
 * Why these matter: a MOAT container persists between requests so commands
 * skip the cold boot, but a container nobody uses still costs memory, and
 * so does anything the agent left running inside it. A container idle for
 * 30 minutes is stopped; the next command starts a fresh one. A command that
 * times out (or floods its output) is stopped inside the container too, not
 * only the host `moat` process that was waiting on it.
 *
 * The fake runs `moat exec`'s command on the host as a child of the fake
 * process — so killing the host `moat` process leaves that command running,
 * exactly as killing the real CLI leaves it running in the container.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runForTest } from "@flow-state-dev/testing";
import { resolveMoatSandbox } from "../src/bash/adapters/moat";
import {
  createBashBlocks,
  releaseBashSandbox,
  SANDBOX_IDLE_RELEASE_MS,
} from "../src/bash/blocks";
import type { SandboxProvider } from "../src/bash/types";

const FAKE_MOAT = `#!/usr/bin/env bash
# Fake moat CLI. State lives in $FAKE_MOAT_DIR: one file per running run.
echo "$*" >> "$FAKE_MOAT_DIR/calls.log"
case "$1" in
  version) echo '{"version":"0.6.0"}' ;;
  grant) echo '[]' ;;
  list)
    sep=""; printf '['
    for f in "$FAKE_MOAT_DIR"/run-*; do
      [ -e "$f" ] || continue
      printf '%s{"Name":"%s","State":"running"}' "$sep" "\${f##*/run-}"; sep=","
    done
    echo ']' ;;
  run) touch "$FAKE_MOAT_DIR/run-$3"; exec sleep 30 ;;
  exec) shift 3; "$@"; rc=$?; exit $rc ;;
  stop) rm -f "$FAKE_MOAT_DIR/run-$2" ;;
  destroy) ;;
esac
`;

let dir: string;
let bin: string;
let workspace: string;
let spawnedPids: number[] = [];

/** True while `pid` runs; a zombie (`Z` in /proc) counts as dead. */
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
    return true;
  }
}

async function waitForExit(pid: number, withinMs: number): Promise<boolean> {
  const deadline = Date.now() + withinMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return !isAlive(pid);
}

async function calls(): Promise<string[]> {
  try {
    return (await readFile(join(dir, "calls.log"), "utf-8")).split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "fake-moat-"));
  workspace = await mkdtemp(join(tmpdir(), "fake-moat-ws-"));
  bin = join(dir, "moat");
  await writeFile(bin, FAKE_MOAT, "utf-8");
  await chmod(bin, 0o755);
  process.env.FAKE_MOAT_DIR = dir;
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
  delete process.env.FAKE_MOAT_DIR;
  await rm(dir, { recursive: true, force: true });
  await rm(workspace, { recursive: true, force: true });
});

async function startSandbox(execTimeoutMs: number) {
  const { sandbox } = await resolveMoatSandbox({
    bin,
    workspace,
    mountTarget: "/workspace",
    runName: "fsdev-lifecycle",
    execTimeoutMs,
    readiness: { intervalMs: 20 },
  });
  return sandbox;
}

// The in-container stop walks `/proc`, as a MOAT container (always Linux)
// has; the fake runs the command on this host, so it needs one too.
const onLinux = it.skipIf(process.platform !== "linux");

describe("MOAT exec: stopping the command inside the container", () => {
  onLinux("stops the in-container command when an exec times out", { timeout: 20_000 }, async () => {
    const sandbox = await startSandbox(500);
    const pidFile = join(dir, "cmd.pid");

    const result = await sandbox.executeCommand(`echo $$ > ${pidFile}; exec sleep 300`);

    expect(result.exitCode).toBe(124);
    const pid = Number((await readFile(pidFile, "utf-8")).trim());
    spawnedPids.push(pid);
    expect(await waitForExit(pid, 3_000)).toBe(true);
  });

  onLinux("caps exec output per stream and stops the command that overran it", { timeout: 20_000 }, async () => {
    const sandbox = await startSandbox(10_000);
    const pidFile = join(dir, "cmd.pid");

    // Floods past the cap, then would sit there until the exec timeout.
    const result = await sandbox.executeCommand(
      `echo $$ > ${pidFile}; head -c 11534336 /dev/zero; exec sleep 300`,
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("output exceeded");
    expect(result.stdout.length).toBeLessThanOrEqual(10 * 1024 * 1024);
    const pid = Number((await readFile(pidFile, "utf-8")).trim());
    spawnedPids.push(pid);
    expect(await waitForExit(pid, 3_000)).toBe(true);
  });

  it("still returns a normal command's output and exit code", async () => {
    const sandbox = await startSandbox(10_000);

    const result = await sandbox.executeCommand(`echo hi; echo err >&2; exit 3`);

    expect(result).toEqual({ stdout: "hi\n", stderr: "err\n", exitCode: 3 });
  });
});

describe("MOAT: idle containers", () => {
  function ctxFor(id: string): any {
    // A stand-in request pool for the cold-path purge sidechain.
    const pool = {
      addTask: () => {},
      hasPendingForScope: () => false,
      drainScope: async () => ({ completed: [], failed: [] }),
      drainAll: async () => ({ completed: [], failed: [] }),
      drainToQuiescence: async () => ({ completed: [], failed: [] }),
      pendingCount: () => 0,
      failures: () => [],
    };
    return {
      request: { identity: { id: `req-${id}` } },
      session: { identity: { id, userId: "u1" } },
      user: { identity: { id: "u1" } },
      org: { identity: { id: "p1" } },
      resources: {},
      emit: { status: () => {} },
      _requestSideChainPool: pool,
    };
  }

  it("keeps a persisting container across requests, then stops it once idle for 30 minutes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // No runName: the container is named per session, so the idle stop owns it.
    const provider: SandboxProvider = { type: "moat", bin, workspace };
    const { bashCommand } = createBashBlocks({ provider, destination: "/workspace" });
    const ctx = ctxFor("moat-idle");

    await runForTest(bashCommand, { command: "true" }, ctx);
    // Request end: the capability's cleanup releases the sandbox. The
    // container persists for the next request.
    await releaseBashSandbox(provider, ctx);
    expect((await calls()).filter((c) => c.startsWith("stop"))).toEqual([]);

    await vi.advanceTimersByTimeAsync(SANDBOX_IDLE_RELEASE_MS);
    vi.useRealTimers();
    // The idle stop runs in the background.
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline && !(await calls()).some((c) => c.startsWith("destroy"))) {
      await new Promise((r) => setTimeout(r, 25));
    }

    const log = await calls();
    expect(log.some((c) => c.startsWith("stop fsdev-moat-idle-"))).toBe(true);
    expect(log.some((c) => c.startsWith("destroy fsdev-moat-idle-"))).toBe(true);

    // The next command in the session starts a fresh container.
    const runsBefore = log.filter((c) => c.startsWith("run ")).length;
    await runForTest(bashCommand, { command: "true" }, ctx);
    expect((await calls()).filter((c) => c.startsWith("run ")).length).toBe(runsBefore + 1);
    await releaseBashSandbox({ ...provider, persist: false }, ctx);
  });

  it("does not stop a persisting container that is still in use", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const provider: SandboxProvider = { type: "moat", bin, workspace };
    const { bashCommand } = createBashBlocks({ provider, destination: "/workspace" });
    const ctx = ctxFor("moat-busy");

    await runForTest(bashCommand, { command: "true" }, ctx);
    await releaseBashSandbox(provider, ctx);
    await vi.advanceTimersByTimeAsync(SANDBOX_IDLE_RELEASE_MS - 60_000);
    await runForTest(bashCommand, { command: "true" }, ctx);
    await releaseBashSandbox(provider, ctx);
    // Just past 30 minutes after the FIRST command: when a clock that the
    // second command failed to reset would fire. Stopping here (rather than
    // running fake time on) lets that stop's own subprocesses actually run.
    await vi.advanceTimersByTimeAsync(61_000);
    vi.useRealTimers();
    // An idle stop would run in the background; give it time to show up.
    await new Promise((r) => setTimeout(r, 1_500));

    expect((await calls()).filter((c) => c.startsWith("stop"))).toEqual([]);
  });
  it("leaves a container shared under an explicit runName to its operator", async () => {
    // Every session resolves an explicit runName to the same container, so
    // one session going idle must not stop it under another.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const provider: SandboxProvider = { type: "moat", bin, workspace, runName: "fsdev-shared" };
    const { bashCommand } = createBashBlocks({ provider, destination: "/workspace" });
    const idle = ctxFor("moat-shared-a");

    await runForTest(bashCommand, { command: "true" }, idle);
    await releaseBashSandbox(provider, idle);
    await vi.advanceTimersByTimeAsync(SANDBOX_IDLE_RELEASE_MS + 1_000);
    vi.useRealTimers();
    await new Promise((r) => setTimeout(r, 1_500));

    expect((await calls()).filter((c) => c.startsWith("stop fsdev-shared"))).toEqual([]);
    await releaseBashSandbox({ ...provider, persist: false }, idle);
  });
});
