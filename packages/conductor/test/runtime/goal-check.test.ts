/**
 * What running the goal command costs and leaves behind — and what an operator
 * is told a run was.
 *
 * `tick.test.ts` covers the verdicts and what they release. What is left, and
 * what lives here, is everything the ledger cannot see: the processes a killed
 * run leaves alive, the memory a chatty run takes from conductor itself, and the
 * `not-run` reason, which is prose — prose that names a command nobody could
 * have run sends whoever reads it to reproduce something other than the failure.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runGoalCheckCommand } from "../../src/runtime/goal-check";
import { stopped } from "../process";
import { shellWords } from "../shell";

/** Temp directories this file made, removed however each test ended. */
const made: string[] = [];

/**
 * Processes a test started that conductor was supposed to kill.
 *
 * The test asserting they are gone is the test that leaks them when it fails,
 * and a suite whose failure mode is an orphan per run is the thing this file is
 * about. Cleared here whatever the assertion said.
 */
const spawned: number[] = [];

afterEach(async () => {
  for (const pid of spawned.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone, which is the outcome the test wanted.
    }
  }
  await Promise.all(made.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

/**
 * A real goal runner on disk, built from the lines it should execute.
 *
 * A program rather than a stub, for the reason `tick.test.ts` gives: the
 * behaviour under test is what an operating system does with a process
 * conductor spawned, and nothing injectable reproduces that.
 *
 * @param lines The body of the runner, one statement per line.
 * @returns Its path and the directory it lives in.
 */
async function goalRunner(lines: readonly string[]): Promise<{ script: string; dir: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "conductor-goal-check-"));
  made.push(dir);
  const script = path.join(dir, "run.mjs");
  await fs.writeFile(script, lines.join("\n"));
  return { script, dir };
}

/**
 * The rendered command out of a `not-run` reason.
 *
 * Every reason wraps it in backticks, which is the only structure the string
 * has and enough to pull it back out.
 */
function quotedCommand(reason: string): string {
  const match = /`([^`]+)`/.exec(reason);
  expect(match).not.toBeNull();
  return match![1]!;
}

describe("a goal command that never ran", () => {
  /**
   * **The command in the reason must be the command that was spawned.**
   *
   * Conductor spawns the declared argv with `shell: false`, so no element of it
   * is ever parsed — but the reason is read by a person, who will paste it into
   * a shell to reproduce the failure. Joined on spaces, a command like
   * `["bash", "-lc", "pnpm tsx goals/run-for-issue.mts"]` reads back as `bash
   * -lc pnpm`, and the operator debugs a program conductor never started.
   */
  it("names a command a shell splits back into the argv that was spawned", async () => {
    const command = [
      "/nonexistent/goal-runner",
      "-lc",
      "pnpm tsx goals/run-for-issue.mts --report 'all cases'",
    ];

    const outcome = await runGoalCheckCommand({
      goalCheck: { command, timeoutMs: 10_000 },
      cwd: process.cwd(),
      entityId: "FIX-1",
    });

    expect(outcome.kind).toBe("not-run");
    const reason = outcome.kind === "not-run" ? outcome.reason : "";
    await expect(shellWords(quotedCommand(reason))).resolves.toEqual(command);
  });

  /**
   * **A ceiling of zero is not a ceiling, and must not become no ceiling.**
   *
   * `timeoutMs` reaches here from a hand-built config with nothing between, so
   * a computed or mistyped zero arrives intact. Read as a duration it kills
   * instantly; read as "unset" it never kills at all, and a goal check with no
   * ceiling is a tick that never ends and a gate no restart can move. Neither
   * reading is what anyone meant, which is what makes it a machinery failure.
   */
  it("refuses a ceiling that cannot bound anything instead of running without one", async () => {
    const { script, dir } = await goalRunner([`setInterval(() => {}, 1000);`]);

    const outcome = await runGoalCheckCommand({
      goalCheck: { command: [process.execPath, script], timeoutMs: 0 },
      cwd: dir,
      entityId: "FIX-1",
    });

    expect(outcome).toMatchObject({ kind: "not-run" });
  });
});

describe("what a goal command leaves running", () => {
  /**
   * **A timeout must take the process tree, not the process.**
   *
   * The configured command is realistically a wrapper — `pnpm test`, a build
   * script — and the work happens in what it spawns. Signalling only the direct
   * child leaves those descendants alive after conductor has settled the check
   * and moved on: they keep burning the machine, and they keep writing to a
   * checkout conductor has already decided it is finished with, which is the
   * clean-workspace precondition the whole proof stands on.
   */
  it("kills the processes the goal command started, not only the one conductor spawned", async () => {
    const { script, dir } = await goalRunner([
      `import fs from "node:fs";`,
      `import { spawn } from "node:child_process";`,
      // Not detached: a test runner's workers are ordinary children, and a
      // descendant that makes its own process group is out of anyone's reach.
      `const worker = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {`,
      `  stdio: "ignore",`,
      `});`,
      // Into the workspace the check was given, which is where the runner is.
      `fs.writeFileSync("worker.pid", String(worker.pid));`,
      `setInterval(() => {}, 1000);`,
    ]);
    const pidFile = path.join(dir, "worker.pid");

    const outcome = await runGoalCheckCommand({
      goalCheck: { command: [process.execPath, script], timeoutMs: 500 },
      cwd: dir,
      entityId: "FIX-1",
    });

    expect(outcome).toMatchObject({ kind: "not-run" });
    const worker = Number(await fs.readFile(pidFile, "utf8"));
    expect(Number.isInteger(worker)).toBe(true);
    spawned.push(worker);
    expect(await stopped(worker)).toBe(true);
  });
});

describe("what a goal command costs conductor", () => {
  /**
   * **Output conductor keeps has to have a ceiling.**
   *
   * A goal runner's stderr is retained for one purpose — the tail that decorates
   * a `not-run` reason — and kept without a limit it is conductor's own heap
   * that fills first. A runaway command then takes the process that was
   * supposed to be measuring it, before the timeout it was given ever fires.
   *
   * Stopping the command is the honest end of that: it yields no verdict, and
   * `not-run` is what "no verdict" is called here.
   */
  it("stops a goal command flooding stderr rather than buffering all of it", async () => {
    // No `process.exit`: it drops whatever is still queued on the pipe, and a
    // runner that only appears to flood proves nothing about the ceiling.
    const { script, dir } = await goalRunner([
      `process.stderr.write("x".repeat(9 * 1024 * 1024));`,
    ]);

    const outcome = await runGoalCheckCommand({
      goalCheck: { command: [process.execPath, script], timeoutMs: 30_000 },
      cwd: dir,
      entityId: "FIX-1",
    });

    expect(outcome).toMatchObject({ kind: "not-run" });
    const reason = outcome.kind === "not-run" ? outcome.reason : "";
    expect(reason).toContain("output");
  }, 30_000);

  /**
   * **And the stream nobody keeps has no ceiling to hit.**
   *
   * stdout is where a test runner writes, so it is the loud one; conductor reads
   * nothing from it, so retaining it buys nothing and capping it would end a run
   * that was about to report a perfectly good status. Drained and dropped, a
   * torrent on stdout is not conductor's problem — and this is the test that
   * fails if the ceiling above is ever widened to cover it.
   */
  it("lets a goal command write as much to stdout as it likes and still reports its status", async () => {
    const { script, dir } = await goalRunner([
      `for (let i = 0; i < 16; i += 1) process.stdout.write("x".repeat(1024 * 1024));`,
    ]);

    const outcome = await runGoalCheckCommand({
      goalCheck: { command: [process.execPath, script], timeoutMs: 30_000 },
      cwd: dir,
      entityId: "FIX-1",
    });

    expect(outcome).toEqual({ kind: "verdict", verdict: "passed", exitCode: 0 });
  }, 30_000);
});
