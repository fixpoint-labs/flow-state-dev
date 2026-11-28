/**
 * One run at a time per agent: what the block does when Cursor's local store
 * still records a run on the agent it is about to send to.
 *
 * Cursor's local store lets an agent hold one active run. `agent.send` on an
 * agent whose recorded run is not terminal throws "Agent <id> already has
 * active run" (measured against `@cursor/sdk` 1.0.40). A server that
 * restarts mid-run leaves that record behind with no runtime working it, and
 * every later turn on the agent was refused the same way: the Teammates lab
 * showed four identical failures, one per turn the board and the follow-up
 * task started.
 *
 * The fake here models that store: a run is active from `send` until it ends,
 * is cancelled, or is released through `releaseActiveRun`.
 */
import { describe, expect, it, vi } from "vitest";
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
import { createChildProcessResolveCursorClient } from "../src/child-runtime";
import { releaseActiveRuns } from "../src/cursor-client";
import { CursorAgentAbortedError } from "../src/errors";
import {
  TESTED_CURSOR_SDK,
  type CursorAgentLike,
  type CursorRunLike,
  type CursorSdkMessage,
  type ResolvedCursorClient,
} from "../src/types";

const GATE_OFF = {
  [INTERNAL_CURSOR_SDK_VERSION_READER]: () => ({ kind: "version", version: TESTED_CURSOR_SDK.range }),
} as CursorAgentOptions;

const DONE: CursorSdkMessage[] = [
  { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "done" }] } },
];

/** The SDK's refusal, as 1.0.40 throws it from `send`: no code, a plain message. */
function activeRunRefusal(agentId: string): Error {
  return Object.assign(new Error(`Agent ${agentId} already has active run`), { name: "UnknownAgentError" });
}

interface StoreOpts {
  /** A run left recorded as active by a runtime that is gone. */
  orphaned?: boolean;
  /** Whether the agent can release a recorded run (the SDK's listRuns + cancelRun). */
  canRelease?: boolean;
  /** A release that fails. */
  releaseFails?: boolean;
  /** Each run's stream; defaults to one finished message. */
  stream?: () => AsyncIterable<CursorSdkMessage>;
}

/** A Cursor client over one agent whose local store holds at most one active run. */
function cursorStore(opts: StoreOpts = {}) {
  const state = {
    active: opts.orphaned === true ? "run_orphan" : (null as string | null),
    sends: 0,
    refusals: 0,
    released: [] as string[],
    cancelled: [] as string[],
  };
  let next = 0;

  const makeRun = (id: string): CursorRunLike => ({
    id,
    stream: () =>
      opts.stream?.() ??
      (async function* () {
        for (const m of DONE) yield m;
      })(),
    async wait() {
      if (state.active === id) state.active = null;
      return { status: "finished", result: "done" };
    },
    async cancel() {
      state.cancelled.push(id);
      if (state.active === id) state.active = null;
    },
  });

  const agent = (agentId: string): CursorAgentLike => ({
    agentId,
    async send() {
      state.sends += 1;
      if (state.active !== null) {
        state.refusals += 1;
        throw activeRunRefusal(agentId);
      }
      const id = `run_${++next}`;
      state.active = id;
      return makeRun(id);
    },
    close() {},
    ...(opts.canRelease === false
      ? {}
      : {
          async releaseActiveRun() {
            if (opts.releaseFails === true) throw new Error("store is locked");
            if (state.active === null) return 0;
            state.released.push(state.active);
            state.active = null;
            return 1;
          },
        }),
  });

  const resolve = (): ResolvedCursorClient => ({
    create: async () => agent("agent_1"),
    resume: async (id) => agent(id),
  });
  return { resolve, state };
}

const block = (resolve: () => ResolvedCursorClient) =>
  cursorAgent({ ...GATE_OFF, resolveCursorClient: resolve, resume: () => "agent_1" });

describe("cursorAgent — a run Cursor still records from a runtime that is gone", () => {
  it("releases it and sends once more, so the turn runs instead of failing at the start", async () => {
    const { resolve, state } = cursorStore({ orphaned: true });
    const { error, output, items } = await testBlock(block(resolve), { input: { prompt: "double check the review" } });

    expect(error).toBeNull();
    expect(output?.status).toBe("completed");
    expect(state.released).toEqual(["run_orphan"]);
    expect(state.sends).toBe(2);
    // The owner sees why the turn sent twice.
    expect(JSON.stringify(items)).toContain("still recorded a run in progress");
  });

  it("does not repeat the refusal turn after turn: each later turn on the agent runs", async () => {
    // The lab's sequence: the turn the restart cut, the board's owed steer
    // turn, then a follow-up task's two turns, all on the same agent.
    const { resolve, state } = cursorStore({ orphaned: true });
    const outcomes: Array<string | null> = [];
    for (let turn = 0; turn < 4; turn += 1) {
      const { error } = await testBlock(block(resolve), { input: { prompt: `turn ${turn}` } });
      outcomes.push(error === null ? null : String(error.message));
    }

    expect(outcomes).toEqual([null, null, null, null]);
    expect(state.released).toHaveLength(1);
    expect(state.refusals).toBe(1);
  });

  it("fails once, saying the agent is busy, when the run can't be released, and sends no more than twice", async () => {
    const { resolve, state } = cursorStore({ orphaned: true, releaseFails: true });
    const { error } = await testBlock(block(resolve), { input: { prompt: "go" } });

    expect(error).not.toBeNull();
    expect(String(error?.message)).toContain("still has a run in progress");
    expect(String(error?.message)).toContain("store is locked");
    expect(state.sends).toBe(1);
  });

  it("fails with the same busy message when the client has no way to release a run", async () => {
    const { resolve, state } = cursorStore({ orphaned: true, canRelease: false });
    const { error } = await testBlock(block(resolve), { input: { prompt: "go" } });

    expect(String(error?.message)).toContain("still has a run in progress");
    expect(state.sends).toBe(1);
  });
});

describe("cursorAgent — a turn arriving while this process's run on the agent is live", () => {
  it("waits for that run to end, then sends, and never cancels it", async () => {
    let finishFirst: () => void = () => {};
    const firstHeld = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    let streams = 0;
    const { resolve, state } = cursorStore({
      stream: () =>
        (async function* () {
          streams += 1;
          if (streams === 1) await firstHeld;
          for (const m of DONE) yield m;
        })(),
    });

    const first = testBlock(block(resolve), { input: { prompt: "first" } });
    // The first run is sent and streaming before the second turn arrives.
    await expect.poll(() => state.active).toBe("run_1");
    const second = testBlock(block(resolve), { input: { prompt: "second" } });
    // Give the second turn every chance to send while the first still runs.
    await new Promise((r) => setTimeout(r, 30));
    expect(state.sends).toBe(1);

    finishFirst();
    const [a, b] = await Promise.all([first, second]);

    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    expect(state.refusals).toBe(0);
    expect(state.released).toEqual([]);
    expect(state.cancelled).toEqual([]);
    expect(state.sends).toBe(2);
  });

  it("stops waiting when its own signal fires, and leaves the live run alone", async () => {
    let finishFirst: () => void = () => {};
    const firstHeld = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const { resolve, state } = cursorStore({
      stream: () =>
        (async function* () {
          await firstHeld;
          for (const m of DONE) yield m;
        })(),
    });

    const first = testBlock(block(resolve), { input: { prompt: "first" } });
    await expect.poll(() => state.active).toBe("run_1");
    const runtime = await createTestContext({});
    const stop = new AbortController();
    (runtime.ctx as { signal?: AbortSignal }).signal = stop.signal;
    const second = Promise.resolve(block(resolve).config.execute?.({ prompt: "second" }, runtime.ctx as never)).catch(
      (e: unknown) => e,
    );
    await new Promise((r) => setTimeout(r, 10));
    stop.abort(new Error("deadline"));

    expect(await second).toBeInstanceOf(CursorAgentAbortedError);
    expect(state.sends).toBe(1);
    expect(state.cancelled).toEqual([]);
    finishFirst();
    expect((await first).error).toBeNull();
  });
});

describe("releaseActiveRuns — the in-process client's release, over the SDK's run calls", () => {
  it("cancels only the runs still running, across every page, in the agent's own directory", async () => {
    const cancelled: Array<{ runId: string; options: unknown }> = [];
    const listed: unknown[] = [];
    const pages: Record<string, { items: Array<{ id: string; status: string }>; nextCursor?: string }> = {
      first: { items: [{ id: "run_1", status: "finished" }, { id: "run_2", status: "running" }], nextCursor: "p2" },
      p2: { items: [{ id: "run_3", status: "cancelled" }, { id: "run_4", status: "running" }] },
    };
    const count = await releaseActiveRuns(
      {
        listRuns: async (_agentId, options) => {
          listed.push(options);
          return pages[options.cursor ?? "first"]!;
        },
        cancelRun: async (runId, options) => {
          cancelled.push({ runId, options });
        },
      },
      "agent_1",
      "/work/tree",
    );

    expect(count).toBe(2);
    expect(cancelled).toEqual([
      { runId: "run_2", options: { runtime: "local", cwd: "/work/tree" } },
      { runId: "run_4", options: { runtime: "local", cwd: "/work/tree" } },
    ]);
    expect(listed).toEqual([
      { runtime: "local", cwd: "/work/tree" },
      { runtime: "local", cwd: "/work/tree", cursor: "p2" },
    ]);
  });

  it("releases nothing on an SDK without the run calls", async () => {
    expect(await releaseActiveRuns({}, "agent_1", undefined)).toBe(0);
  });
});

/** The scripted SDK, loaded by the child process the block starts when `env` is set. */
const FAKE_SDK = pathToFileURL(resolve(import.meta.dirname, "fixtures/fake-cursor-sdk.mjs")).href;
const CHILD_FAKE = { ...GATE_OFF, [INTERNAL_CHILD_SDK_MODULE]: FAKE_SDK } as CursorAgentOptions;

describe.skipIf(process.platform === "win32")("cursorAgent — env set: the run in the child process", () => {
  it("releases a run the agent's store still records, in the child, and the turn runs", async () => {
    const block = cursorAgent({ ...CHILD_FAKE, env: harnessEnv({ pass: ["PATH"] }), resume: () => "agent_orphan" });
    const { error, output } = await testBlock(block, { input: { prompt: "echo" } });

    expect(error).toBeNull();
    expect(output?.sessionId).toBe("agent_orphan");
  }, 30_000);

  it("cancels a run still going when the server lets go of the child without stopping it", async () => {
    // A server that dies mid-run closes the channel and sends no cancel. The
    // child must cancel the run itself, or Cursor's store keeps it running.
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "cursor-orphan-")));
    const mark = join(dir, "cancelled");
    const client = await createChildProcessResolveCursorClient({
      env: { ...harnessEnv({ pass: ["PATH"] }), FIX1917_CANCEL_MARK: mark },
      sdkModule: FAKE_SDK,
    })({} as never);
    const agent = await client.create({ model: { id: "composer-2.5" } });
    const run = await agent.send("hang");
    await run.stream()[Symbol.asyncIterator]().next();

    agent.close?.();

    await vi.waitFor(() => expect(existsSync(mark)).toBe(true), { timeout: 5_000 });
    expect(readFileSync(mark, "utf8")).toBe("cancelled");
  }, 30_000);
});
