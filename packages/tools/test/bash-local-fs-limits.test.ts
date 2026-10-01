/**
 * Process limits for the local-fs bash adapter: what the child process
 * inherits, how long it may run, and what `exitCode` it reports.
 *
 * Why these matter: the local adapter runs model-written shell commands on
 * the host. Inheriting the server's full environment hands every API key the
 * server holds to whatever the model types (`env`, `printenv`); a command
 * with no deadline hangs the turn forever; and an `exitCode` that is a string
 * or a silent `0` tells the model a killed command succeeded.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalFsSandbox } from "../src/bash/adapters/local-fs";

const SECRET_KEY = "FSD_LOCAL_BASH_TEST_SECRET";

let cwd: string;
/** Pids a test started; killed after each test so a failure can't leak them. */
let spawnedPids: number[] = [];

/**
 * True while `pid` names a running process. Signal 0 probes without sending,
 * but it also succeeds on a zombie — a killed orphan whose new parent hasn't
 * reaped it, which happens in containers whose PID 1 doesn't reap — so on
 * Linux a `Z` state in `/proc` counts as dead.
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
    // `pid (comm) S ...` — the state letter follows the last `)`.
    const state = stat.charAt(stat.lastIndexOf(")") + 2);
    return state !== "Z";
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

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "bash-local-limits-"));
});

afterEach(async () => {
  for (const pid of spawnedPids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
  spawnedPids = [];
  delete process.env[SECRET_KEY];
  await rm(cwd, { recursive: true, force: true });
});

describe("local-fs bash: environment", () => {
  it("does not leak the server's environment into the child process", async () => {
    process.env[SECRET_KEY] = "sk-live-should-never-reach-the-model";
    const sandbox = createLocalFsSandbox({ cwd });

    const result = await sandbox.executeCommand(`printenv ${SECRET_KEY}`);

    expect(result.stdout).not.toContain("sk-live");
    expect(result.exitCode).toBe(1); // printenv: variable not set
  });

  it("still gives the child a PATH, so ordinary commands resolve", async () => {
    const sandbox = createLocalFsSandbox({ cwd });

    const result = await sandbox.executeCommand("echo ok");

    expect(result).toEqual({ stdout: "ok\n", stderr: "", exitCode: 0 });
  });

  it("passes variables the caller names explicitly via `env`", async () => {
    process.env[SECRET_KEY] = "from-server";
    const sandbox = createLocalFsSandbox({
      cwd,
      env: { FSD_EXPLICIT: "granted" },
    });

    const granted = await sandbox.executeCommand("printenv FSD_EXPLICIT");
    const notGranted = await sandbox.executeCommand(`printenv ${SECRET_KEY}`);

    expect(granted.stdout).toBe("granted\n");
    expect(notGranted.stdout).toBe("");
  });

  it("lets a caller's `env` override a base variable, not just add new ones", async () => {
    // The JSDoc promises `env` is layered *over* the base; a caller pointing
    // PATH at their own toolchain must win over the server's PATH.
    const sandbox = createLocalFsSandbox({ cwd, env: { PATH: "/x" } });

    const result = await sandbox.executeCommand('echo "$PATH"');

    expect(result.stdout).toBe("/x\n");
  });
});

describe("local-fs bash: timeout", () => {
  it(
    "kills a hung command and everything it started at the deadline, reporting exit code 124",
    async () => {
      // A pipeline: killing only the shell would leave `sleep` and `cat`
      // holding stdout open. The result arriving on time is not enough —
      // the adapter resolves without waiting for `close` — so record a pid
      // inside the pipeline and prove it is dead afterwards, not orphaned.
      const sandbox = createLocalFsSandbox({ cwd, execTimeoutMs: 500 });
      const started = Date.now();

      const result = await sandbox.executeCommand(
        `sh -c 'echo $$ > pid; exec sleep 30' | cat`,
      );

      expect(Date.now() - started).toBeLessThan(5_000);
      expect(result.exitCode).toBe(124);
      expect(result.stderr).toContain("timed out after 500ms");

      const sleepPid = Number((await readFile(join(cwd, "pid"), "utf-8")).trim());
      expect(sleepPid).toBeGreaterThan(0);
      spawnedPids.push(sleepPid);
      expect(await waitForExit(sleepPid, 2_000)).toBe(true);
    },
    10_000,
  );

  it("lets a command that finishes in time complete normally", async () => {
    const sandbox = createLocalFsSandbox({ cwd, execTimeoutMs: 5_000 });

    const result = await sandbox.executeCommand("exit 3");

    expect(result.exitCode).toBe(3);
  });

  it(
    "leaves a backgrounded job running after the command exits normally",
    async () => {
      // `server > log 2>&1 &` must keep working: the group is killed only on
      // timeout or overrun, never on a normal exit.
      const sandbox = createLocalFsSandbox({ cwd, execTimeoutMs: 5_000 });
      const started = Date.now();

      const result = await sandbox.executeCommand("sleep 30 > /dev/null 2>&1 & echo $!");

      expect(Date.now() - started).toBeLessThan(3_000);
      expect(result.exitCode).toBe(0);
      const bgPid = Number(result.stdout.trim());
      expect(bgPid).toBeGreaterThan(0);
      spawnedPids.push(bgPid);
      // Give a would-be group kill time to land before checking.
      await new Promise((r) => setTimeout(r, 200));
      expect(isAlive(bgPid)).toBe(true);
    },
    10_000,
  );
});

describe("local-fs bash: exit code is always a number", () => {
  it("reports a signal-killed command as 128 + signal, not success", async () => {
    // `$$` is the shell's own pid, so the shell SIGKILLs itself.
    const sandbox = createLocalFsSandbox({ cwd });

    const result = await sandbox.executeCommand("kill -KILL $$");

    expect(result.exitCode).toBe(137);
  });

  it(
    "reports an output overrun as a numeric failure, not Node's string error code",
    async () => {
      const sandbox = createLocalFsSandbox({ cwd });

      // 11 MB on stdout, over the adapter's 10 MB output cap.
      const result = await sandbox.executeCommand("yes | head -c 11000000");

      expect(typeof result.exitCode).toBe("number");
      expect(result.exitCode).not.toBe(0);
    },
    10_000,
  );
});
