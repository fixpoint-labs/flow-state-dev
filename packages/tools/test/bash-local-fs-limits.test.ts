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
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalFsSandbox } from "../src/bash/adapters/local-fs";

const SECRET_KEY = "FSD_LOCAL_BASH_TEST_SECRET";

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "bash-local-limits-"));
});

afterEach(async () => {
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
});

describe("local-fs bash: timeout", () => {
  it(
    "kills a hung command at the deadline and reports exit code 124",
    async () => {
      // A pipeline: killing only the shell would leave `sleep` and `cat`
      // holding stdout open, and the result would still never arrive.
      const sandbox = createLocalFsSandbox({ cwd, execTimeoutMs: 300 });
      const started = Date.now();

      const result = await sandbox.executeCommand("sleep 20 | cat");

      expect(Date.now() - started).toBeLessThan(5_000);
      expect(result.exitCode).toBe(124);
      expect(result.stderr).toContain("timed out after 300ms");
    },
    10_000,
  );

  it("lets a command that finishes in time complete normally", async () => {
    const sandbox = createLocalFsSandbox({ cwd, execTimeoutMs: 5_000 });

    const result = await sandbox.executeCommand("exit 3");

    expect(result.exitCode).toBe(3);
  });
});

describe("local-fs bash: exit code is always a number", () => {
  it("reports a signal-killed command as 128 + signal, not success", async () => {
    // `$$` is the shell's own pid; strict path guards are about paths, not
    // this, so turn them off to send the shell SIGKILL directly.
    const sandbox = createLocalFsSandbox({ cwd, strictPaths: false });

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
