/**
 * `env`: what a stopped run leaves running.
 *
 * With `env` set the runtime is a child process, and the commands Cursor runs
 * (a dev server, a watcher, a test run) are its children. A stop has to end
 * them too, or each stop leaves them holding memory. These specs run the real
 * child process with the scripted SDK (`fixtures/fake-cursor-sdk.mjs`), whose
 * run starts a command that survives SIGTERM.
 */
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createTestContext, testBlock } from "@flow-state-dev/testing";
import { harnessEnv } from "@flow-state-dev/core/harness";
import {
  cursorAgent,
  INTERNAL_CHILD_SDK_MODULE,
  INTERNAL_CURSOR_SDK_VERSION_READER,
  type CursorAgentOptions,
} from "../src/agent";
import { CursorAgentAbortedError } from "../src/errors";
import { TESTED_CURSOR_SDK } from "../src/types";

const FENCED_FAKE = {
  [INTERNAL_CURSOR_SDK_VERSION_READER]: () => ({ kind: "version", version: TESTED_CURSOR_SDK.range }),
  [INTERNAL_CHILD_SDK_MODULE]: pathToFileURL(resolve(import.meta.dirname, "fixtures/fake-cursor-sdk.mjs")).href,
} as CursorAgentOptions;

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

/** A block whose runtime's commands write into a fresh directory. */
function setup() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "cursor-group-")));
  const env = { ...harnessEnv({ pass: ["PATH"] }), COMMAND_DIR: dir };
  return { dir, block: cursorAgent({ ...FENCED_FAKE, env }) };
}

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

/** The pid of the command the run started, once it has started. */
async function commandPid(dir: string): Promise<number> {
  await expect.poll(() => existsSync(join(dir, "pid")), { timeout: 10_000 }).toBe(true);
  const pid = Number(readFileSync(join(dir, "pid"), "utf8"));
  leaked.push(pid);
  return pid;
}

// FIX-2671.
describe.skipIf(process.platform === "win32")("cursorAgent — env set: the commands a run started", () => {
  it("a stop asks them to stop, then kills what is still running once the close grace runs out", async () => {
    const { dir, block } = setup();
    const runtime = await createTestContext({});
    const ac = new AbortController();
    (runtime.ctx as { signal?: AbortSignal }).signal = ac.signal;

    const run = block.config.execute?.({ prompt: "command-hang" }, runtime.ctx as never);
    const pid = await commandPid(dir);
    ac.abort();

    await expect(run).rejects.toBeInstanceOf(CursorAgentAbortedError);
    await expect.poll(() => existsSync(join(dir, "sigterm")), { timeout: 5_000 }).toBe(true);
    await expect.poll(() => isAlive(pid), { timeout: 15_000, interval: 100 }).toBe(false);
  }, 30_000);

  it("a run that finishes leaves them alone", async () => {
    const { dir, block } = setup();

    const { error } = await testBlock(block, { input: { prompt: "command-finish" } });
    const pid = await commandPid(dir);
    await new Promise((r) => setTimeout(r, 500));

    expect(error).toBeNull();
    expect(isAlive(pid)).toBe(true);
    expect(existsSync(join(dir, "sigterm"))).toBe(false);
  }, 30_000);
});
