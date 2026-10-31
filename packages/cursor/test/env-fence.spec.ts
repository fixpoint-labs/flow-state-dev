/**
 * `env`: the environment a command Cursor runs starts with.
 *
 * Cursor's SDK copies its process's environment into every shell it starts
 * and takes no environment option, so with `env` set the block runs the
 * runtime in a child process whose environment is exactly `env`. These specs
 * run that real child process. The SDK it loads is a scripted stand-in
 * (`fixtures/fake-cursor-sdk.mjs`) that spawns its shell the way the real one
 * does, with `{ ...process.env }`, so what its command prints is what a
 * Cursor command would see. One spec loads the real installed SDK in the
 * child, to hold the trip across the process boundary against the real thing.
 *
 * A real Cursor run (a model, a key) is not here; that is the canary goal
 * `goals/cursor-harness/keeps-the-servers-environment-from-its-commands/`,
 * which runs only when `CURSOR_API_KEY` is set.
 *
 * None of this is a security boundary: the child runs as the server's OS user,
 * so on Linux a command can still read the server's environment through
 * `/proc`. These specs hold what a command starts with, nothing more.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createTestContext, testBlock } from "@flow-state-dev/testing";
import { harnessEnv, harnessFailureKind } from "@flow-state-dev/core";
import {
  cursorAgent,
  INTERNAL_CHILD_SDK_MODULE,
  INTERNAL_SDK_VERSION_READER,
  type CursorAgentOptions,
} from "../src/agent";
import { CursorAgentAbortedError } from "../src/errors";
import { CURSOR_PASS } from "../src/index";
import { TESTED_SDK_VERSION, type ResolvedCursorClient } from "../src/types";

const FAKE_SDK = pathToFileURL(resolve(import.meta.dirname, "fixtures/fake-cursor-sdk.mjs")).href;
const CANARY = "FIX1917_CANARY";

const GATE_OFF = {
  [INTERNAL_SDK_VERSION_READER]: () => ({ kind: "version", version: TESTED_SDK_VERSION }),
} as CursorAgentOptions;

/** Fenced: the child process, loading the scripted SDK. */
const FENCED_FAKE = { ...GATE_OFF, [INTERNAL_CHILD_SDK_MODULE]: FAKE_SDK } as CursorAgentOptions;

/** The control: the same scripted SDK, in this process, as the default client loads the real one. */
const inProcessFake = async (): Promise<ResolvedCursorClient> => {
  const { Agent } = (await import(FAKE_SDK)) as { Agent: ResolvedCursorClient };
  return { create: (o) => Agent.create(o), resume: (id, o) => Agent.resume(id, o) };
};

/**
 * Variables the OS puts into a child it starts, whatever environment the
 * parent handed it. macOS adds `__CF_USER_TEXT_ENCODING` to every process that
 * links CoreFoundation, which Node does — so on a Mac the fenced child holds
 * it even though nothing passed it. Dropped here rather than asserted around,
 * so the exact-equality below keeps saying what it means (the fence passes
 * exactly `env` and nothing of the SERVER's) on both this repo's CI (Linux)
 * and a developer's Mac.
 */
const OS_INJECTED = new Set(["__CF_USER_TEXT_ENCODING"]);

/**
 * What the scripted run's shell command printed, and the variables its process
 * held — minus {@link OS_INJECTED}, which no caller put there.
 */
function shellReport(items: unknown[]): { stdout: string; envKeys: string[] } {
  const text = JSON.stringify(items);
  const match = /"stdout":"([^"]*)","envKeys":(\[[^\]]*\])/.exec(text.replace(/\\"/g, '"'));
  if (match === null) throw new Error(`no shell report in the run's items: ${text.slice(0, 500)}`);
  const envKeys = (JSON.parse(match[2]!) as string[]).filter((name) => !OS_INJECTED.has(name));
  return { stdout: match[1]!, envKeys };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("cursorAgent — env set: the runtime's own process (V8, CI half)", () => {
  it("a command the run starts does not see a variable planted in the server", async () => {
    vi.stubEnv(CANARY, "server-secret");
    const block = cursorAgent({ ...FENCED_FAKE, env: harnessEnv({ pass: ["PATH"] }) });

    const { error, items } = await testBlock(block, { input: { prompt: "echo" } });

    expect(error).toBeNull();
    expect(shellReport(items).stdout).toBe("");
  }, 30_000);

  it("the runtime's process holds exactly env, and a named variable reaches the command", async () => {
    vi.stubEnv(CANARY, "passed-on-purpose");
    vi.stubEnv("FIX1917_SERVER_ONLY", "server-secret");
    const env = harnessEnv({ pass: ["PATH", CANARY] });
    const block = cursorAgent({ ...FENCED_FAKE, env });

    const { error, items } = await testBlock(block, { input: { prompt: "echo" } });

    expect(error).toBeNull();
    const report = shellReport(items);
    expect(report.stdout).toBe("passed-on-purpose");
    expect(report.envKeys).toEqual([CANARY, "PATH"]);
  }, 30_000);

  it("control: with env unset the same command sees the planted variable", async () => {
    vi.stubEnv(CANARY, "server-secret");
    const block = cursorAgent({ ...GATE_OFF, resolveCursorClient: inProcessFake });

    const { error, items } = await testBlock(block, { input: { prompt: "echo" } });

    expect(error).toBeNull();
    expect(shellReport(items).stdout).toBe("server-secret");
  }, 30_000);
});

describe("cursorAgent — env from CURSOR_PASS", () => {
  it("hands a command the key, home and proxy a run needs, and no server secret it does not name", async () => {
    // Every host that fences Cursor builds its env from this one list, so a
    // name missing from it is a run that cannot sign in, find its stored
    // agents or reach the network through a proxy, on every host at once.
    vi.stubEnv(CANARY, "server-secret");
    vi.stubEnv("CURSOR_API_KEY", "key-for-the-run");
    vi.stubEnv("HOME", "/home/cursor-pass-spec");
    vi.stubEnv("HTTPS_PROXY", "http://proxy.invalid:3128");
    vi.stubEnv("https_proxy", "http://proxy.invalid:3128");
    const block = cursorAgent({ ...FENCED_FAKE, env: harnessEnv({ pass: CURSOR_PASS }) });

    const { error, items } = await testBlock(block, { input: { prompt: "echo" } });

    expect(error).toBeNull();
    const report = shellReport(items);
    expect(report.stdout).toBe("");
    expect(report.envKeys).toEqual(expect.arrayContaining(["CURSOR_API_KEY", "HOME", "HTTPS_PROXY", "https_proxy", "PATH"]));
    expect(report.envKeys).not.toContain(CANARY);
  }, 30_000);
});

describe("cursorAgent — env set: when the runtime's process fails", () => {
  it("a process that dies mid-run fails the run with why, and nothing runs in this process", async () => {
    const block = cursorAgent({ ...FENCED_FAKE, env: harnessEnv({ pass: ["PATH"] }) });

    const { error } = await testBlock(block, { input: { prompt: "die" } });

    expect(String(error?.message)).toMatch(/runtime process exited \(code 3\)/);
  }, 30_000);

  it("an SDK the process cannot load fails the run, never falling back to this process", async () => {
    const block = cursorAgent({
      ...GATE_OFF,
      [INTERNAL_CHILD_SDK_MODULE]: pathToFileURL(resolve(import.meta.dirname, "fixtures/no-such-sdk.mjs")).href,
      env: harnessEnv({ pass: ["PATH"] }),
    } as CursorAgentOptions);

    const { error } = await testBlock(block, { input: { prompt: "echo" } });

    expect(String(error?.message)).toMatch(/no-such-sdk/);
  }, 30_000);

  it("a stop reaches the runtime's process as a cancel, and the run reads as aborted", async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "cursor-env-fence-")));
    const mark = join(dir, "cancelled");
    vi.stubEnv("FIX1917_CANCEL_MARK", mark);
    const block = cursorAgent({
      ...FENCED_FAKE,
      env: harnessEnv({ pass: ["PATH", "FIX1917_CANCEL_MARK"] }),
    });
    const runtime = await createTestContext({});
    const ac = new AbortController();
    (runtime.ctx as { signal?: AbortSignal }).signal = ac.signal;
    setTimeout(() => ac.abort(), 1_000);

    await expect(block.config.execute?.({ prompt: "hang" }, runtime.ctx as never)).rejects.toBeInstanceOf(
      CursorAgentAbortedError,
    );
    await vi.waitFor(() => expect(existsSync(mark)).toBe(true), { timeout: 5_000 });
    expect(readFileSync(mark, "utf8")).toBe("cancelled");
  }, 30_000);

  it("a stop still ends the run when the runtime's process never answers the cancel", async () => {
    // Without a bound on the cancel, the block waits on the child's answer
    // forever and never reaches the close that arms the kill.
    const block = cursorAgent({ ...FENCED_FAKE, env: harnessEnv({ pass: ["PATH"] }) });
    const runtime = await createTestContext({});
    const ac = new AbortController();
    (runtime.ctx as { signal?: AbortSignal }).signal = ac.signal;
    setTimeout(() => ac.abort(), 500);

    const started = Date.now();
    await expect(block.config.execute?.({ prompt: "wedged" }, runtime.ctx as never)).rejects.toBeInstanceOf(
      CursorAgentAbortedError,
    );
    expect(Date.now() - started).toBeLessThan(15_000);
  }, 20_000);
});

describe("cursorAgent — env set, the installed SDK across the process boundary", () => {
  it("a resume Cursor refuses is still classified as an unknown conversation", async () => {
    // The real `@cursor/sdk` in the child, its store under a fresh HOME: an
    // agent id it has never seen. No key and no network are needed; the
    // refusal comes from the local store before any of that.
    const home = realpathSync(mkdtempSync(join(tmpdir(), "cursor-env-fence-home-")));
    const block = cursorAgent({
      env: { ...harnessEnv({ pass: ["PATH"] }), HOME: home },
      cwd: () => home,
      resume: () => "agent-fix1917-unknown",
      agent: { model: { id: "composer-2.5" } },
    });

    const { error } = await testBlock(block, { input: { prompt: "continue" } });

    expect(harnessFailureKind(error)).toBe("unknown-conversation");
    expect(String(error?.message)).toContain("agent-fix1917-unknown");
  }, 60_000);
});

describe("cursorAgent — env set: steering the turn in flight", () => {
  it.each([
    ["steer", "delivered", "took: add a README"],
    ["steer-refuse", "refused", "took: (refused)"],
  ])("a %s run answers the line across the process boundary", async (prompt, expected, said) => {
    let answer: string | undefined;
    const block = cursorAgent({
      ...FENCED_FAKE,
      env: harnessEnv({ pass: ["PATH"] }),
      onSteerable: (steer) => {
        if (steer !== null) void steer("add a README").then((a) => (answer = a));
      },
    });

    const { error, items } = await testBlock(block, { input: { prompt } });

    expect(error).toBeNull();
    expect(answer).toBe(expected);
    expect(JSON.stringify(items)).toContain(said);
  }, 30_000);
});
