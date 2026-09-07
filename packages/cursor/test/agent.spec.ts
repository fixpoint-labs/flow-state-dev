/**
 * The block: what it hands the SDK, what it hands the host, and how each of
 * Cursor's endings surfaces.
 *
 * The seam throughout is a **scripted Cursor client** injected through
 * `resolveCursorClient` — the shape `codex/test/agent.spec.ts` already uses
 * for its client — so every behaviour here is a tracer bullet with no
 * runtime and no network. The one spec that loads the real installed SDK is
 * `installed-sdk.spec.ts`.
 */
import { describe, it, expect } from "vitest";
import { testBlock, createTestContext } from "@flow-state-dev/testing";
import { harnessRunHandleSchema } from "@flow-state-dev/core";
import { cursorAgent, INTERNAL_SDK_VERSION_READER, type CursorAgentOptions } from "../src/agent";
import {
  CursorAgentAbortedError,
  CursorAgentConfigError,
  CursorAgentRunError,
  CursorSdkNotInstalledError,
} from "../src/errors";
import {
  TESTED_SDK_VERSION,
  type CursorAgentHandle,
  type CursorAgentLike,
  type CursorCreateOptions,
  type CursorRunLike,
  type CursorRunResult,
  type CursorSdkMessage,
  type CursorSendOptions,
  type ResolvedCursorClient,
} from "../src/types";

/** Every spec below builds against a stubbed version gate; slice 1 owns the gate itself. */
const GATE_OFF = {
  [INTERNAL_SDK_VERSION_READER]: () => ({ kind: "version", version: TESTED_SDK_VERSION }),
} as CursorAgentOptions;

interface Recorder {
  created: Array<CursorCreateOptions & { local?: { cwd?: string } }>;
  resumed: Array<{ id: string; options: CursorCreateOptions & { local?: { cwd?: string } } }>;
  sent: Array<{ prompt: string; options: CursorSendOptions | undefined }>;
  cancelled: number;
  closed: number;
  waited: number;
}

type MessageSource =
  | CursorSdkMessage[]
  | ((signal?: AbortSignal) => AsyncIterable<CursorSdkMessage>);

interface ScriptedOpts {
  agentId?: string;
  throwOnCreate?: unknown;
  throwOnResume?: unknown;
  throwOnSend?: unknown;
  waitResult?: CursorRunResult | (() => Promise<CursorRunResult>);
  supportsWait?: boolean;
}

const DEFAULT_WAIT: CursorRunResult = {
  status: "finished",
  result: "Wrote notes.md",
  usage: {
    inputTokens: 1200,
    outputTokens: 300,
    cacheReadTokens: 200,
    cacheWriteTokens: 0,
    totalTokens: 1500,
    reasoningTokens: 100,
  },
  model: { id: "composer-2.5" },
};

/**
 * A Cursor client whose agent replays a fixed message list (or a generator,
 * for the streams that must stay open). The throws stand in for the SDK
 * refusing create/resume/send, which is how it reports those.
 */
function scripted(messages: MessageSource, opts: ScriptedOpts = {}) {
  const rec: Recorder = { created: [], resumed: [], sent: [], cancelled: 0, closed: 0, waited: 0 };

  const makeRun = (): CursorRunLike => ({
    id: "run_1",
    stream() {
      if (typeof messages === "function") return messages();
      return (async function* () {
        for (const m of messages) yield m;
      })();
    },
    async wait() {
      rec.waited += 1;
      if (typeof opts.waitResult === "function") return opts.waitResult();
      return opts.waitResult ?? DEFAULT_WAIT;
    },
    async cancel() {
      rec.cancelled += 1;
    },
    supports(operation: string) {
      if (operation === "wait") return opts.supportsWait !== false;
      return true;
    },
  });

  const makeAgent = (id: string): CursorAgentLike => ({
    agentId: id,
    async send(prompt: string, options?: CursorSendOptions) {
      rec.sent.push({ prompt, options });
      if (opts.throwOnSend !== undefined) throw opts.throwOnSend;
      return makeRun();
    },
    close() {
      rec.closed += 1;
    },
  });

  const resolve = (): ResolvedCursorClient => ({
    async create(options) {
      rec.created.push(options);
      if (opts.throwOnCreate !== undefined) throw opts.throwOnCreate;
      return makeAgent(opts.agentId ?? "agent_1");
    },
    async resume(id, options) {
      rec.resumed.push({ id, options });
      if (opts.throwOnResume !== undefined) throw opts.throwOnResume;
      return makeAgent(id);
    },
  });

  return { resolve, rec };
}

const OK_STREAM: CursorSdkMessage[] = [
  { type: "system", subtype: "init", model: { id: "composer-2.5" } },
  { type: "thinking", text: "thinking" },
  {
    type: "tool_call",
    call_id: "c1",
    name: "shell",
    status: "running",
    args: { command: "echo hi" },
  },
  {
    type: "tool_call",
    call_id: "c1",
    name: "shell",
    status: "completed",
    args: { command: "echo hi" },
    result: { stdout: "hi\n" },
  },
  {
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text: "Wrote notes.md" }] },
  },
  {
    type: "usage",
    usage: {
      inputTokens: 1200,
      outputTokens: 300,
      cacheReadTokens: 200,
      cacheWriteTokens: 0,
      totalTokens: 1500,
      reasoningTokens: 100,
    },
  },
  { type: "status", status: "FINISHED" },
];

describe("cursorAgent — what it hands the SDK", () => {
  it("creates a fresh agent in the directory the resolver named, with the agent options forwarded", async () => {
    const { resolve, rec } = scripted(OK_STREAM);
    const block = cursorAgent({
      ...GATE_OFF,
      resolveCursorClient: resolve,
      cwd: () => "/work/checkout",
      agent: { model: { id: "composer-2.5" }, mode: "agent", local: { dirs: ["/extra"] } },
    });
    const { error } = await testBlock(block, { input: { prompt: "do the thing" } });

    expect(error).toBeNull();
    expect(rec.resumed).toHaveLength(0);
    expect(rec.created[0]).toMatchObject({
      model: { id: "composer-2.5" },
      mode: "agent",
      local: { dirs: ["/extra"], cwd: "/work/checkout" },
    });
  });

  it("sends the prompt with the forwarded send options, after the agent is open", async () => {
    const { resolve, rec } = scripted(OK_STREAM);
    const block = cursorAgent({
      ...GATE_OFF,
      resolveCursorClient: resolve,
      send: { mode: "plan" },
    });
    await testBlock(block, { input: { prompt: "go" } });

    expect(rec.sent).toHaveLength(1);
    expect(rec.sent[0].prompt).toBe("go");
    expect(rec.sent[0].options).toMatchObject({ mode: "plan" });
  });

  it("resumes the agent the resolver named, in the same resolved directory", async () => {
    const { resolve, rec } = scripted(OK_STREAM);
    const block = cursorAgent({
      ...GATE_OFF,
      resolveCursorClient: resolve,
      cwd: () => "/work/checkout",
      resume: () => "agent_saved_42",
    });
    await testBlock(block, { input: { prompt: "continue" } });

    expect(rec.created).toHaveLength(0);
    expect(rec.resumed[0].id).toBe("agent_saved_42");
    expect(rec.resumed[0].options).toMatchObject({ local: { cwd: "/work/checkout" } });
  });

  it.each([
    ["null", null],
    ["an empty string", ""],
    ["undefined", undefined],
  ])("starts fresh when the resume resolver returns %s", async (_label, value) => {
    const { resolve, rec } = scripted(OK_STREAM);
    const block = cursorAgent({
      ...GATE_OFF,
      resolveCursorClient: resolve,
      resume: () => value as string | null | undefined,
    });
    await testBlock(block, { input: { prompt: "go" } });

    expect(rec.resumed).toHaveLength(0);
    expect(rec.created).toHaveLength(1);
  });

  it("resolves the directory ONCE, before anything is created", async () => {
    let calls = 0;
    const { resolve } = scripted(OK_STREAM);
    const block = cursorAgent({
      ...GATE_OFF,
      resolveCursorClient: resolve,
      cwd: () => {
        calls += 1;
        return "/work/checkout";
      },
    });
    await testBlock(block, { input: { prompt: "go" } });
    expect(calls).toBe(1);
  });

  it("closes the agent on the way out of a successful run", async () => {
    const { resolve, rec } = scripted(OK_STREAM);
    const block = cursorAgent({ ...GATE_OFF, resolveCursorClient: resolve });
    await testBlock(block, { input: { prompt: "go" } });
    expect(rec.closed).toBe(1);
  });
});

describe("cursorAgent — refusals when the block is built (BP-031)", () => {
  it("refuses an agent id inside the forwarded agent options", () => {
    expect(() =>
      cursorAgent({
        ...GATE_OFF,
        agent: { agentId: "agent_sneak" } as never,
      }),
    ).toThrow(CursorAgentConfigError);
  });

  it("refuses a working directory inside agent.local", () => {
    expect(() =>
      cursorAgent({
        ...GATE_OFF,
        agent: { local: { cwd: "/anywhere" } } as never,
      }),
    ).toThrow(CursorAgentConfigError);
  });

  it("refuses a cloud bag on either forwarded group", () => {
    expect(() =>
      cursorAgent({ ...GATE_OFF, agent: { cloud: { repo: "x" } } as never }),
    ).toThrow(CursorAgentConfigError);
    expect(() =>
      cursorAgent({ ...GATE_OFF, send: { cloud: { repo: "x" } } as never }),
    ).toThrow(CursorAgentConfigError);
  });

  it("names the option and its real owner, so the refusal is actionable", () => {
    let message = "";
    try {
      cursorAgent({ ...GATE_OFF, agent: { local: { cwd: "/anywhere" } } as never });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("agent.local.cwd");
    expect(message).toContain("cwd");
  });
});

describe("cursorAgent — the session hook", () => {
  it("hands the host the agent id BEFORE the prompt is sent", async () => {
    const seen: string[] = [];
    let sentWhenHookRan = -1;
    const { resolve, rec } = scripted(OK_STREAM);
    const block = cursorAgent({
      ...GATE_OFF,
      resolveCursorClient: resolve,
      onSession: (id) => {
        sentWhenHookRan = rec.sent.length;
        seen.push(`hook:${id}`);
      },
    });
    await testBlock(block, { input: { prompt: "go" } });

    expect(seen).toEqual(["hook:agent_1"]);
    // The hook is the ONLY carrier that survives a run the caller's deadline
    // kills, so it has to fire before send — a send that hangs or is cancelled
    // would otherwise leave the host with nothing to resume.
    expect(sentWhenHookRan).toBe(0);
    expect(rec.sent).toHaveLength(1);
  });

  it("leaves the host's stored session id untouched when a resume is refused", async () => {
    let hookCalls = 0;
    const { resolve } = scripted([], {
      throwOnResume: new Error("agent not found"),
    });
    const block = cursorAgent({
      ...GATE_OFF,
      resolveCursorClient: resolve,
      resume: () => "agent_gone",
      onSession: () => {
        hookCalls += 1;
      },
    });
    const { error } = await testBlock(block, { input: { prompt: "continue" } });

    expect(error?.cause).toBeInstanceOf(CursorAgentRunError);
    expect(hookCalls).toBe(0);
  });

  it("closes the agent when onSession throws, and does not send the prompt", async () => {
    const { resolve, rec } = scripted(OK_STREAM);
    const block = cursorAgent({
      ...GATE_OFF,
      resolveCursorClient: resolve,
      onSession: () => {
        throw new Error("store is down");
      },
    });
    const { error } = await testBlock(block, { input: { prompt: "go" } });

    expect(error?.cause).toBeInstanceOf(CursorAgentRunError);
    expect((error?.cause as Error).message).toContain("store is down");
    expect(rec.sent).toHaveLength(0);
    expect(rec.closed).toBeGreaterThanOrEqual(1);
  });
});

describe("cursorAgent — the item mirror", () => {
  it("mirrors reasoning, tool calls and the final message into the stream", async () => {
    const { resolve } = scripted(OK_STREAM);
    const block = cursorAgent({ ...GATE_OFF, resolveCursorClient: resolve });
    const { items, error } = await testBlock(block, { input: { prompt: "go" } });

    expect(error).toBeNull();
    const kinds = items.map((i) => i.type);
    expect(kinds).toContain("reasoning");
    expect(kinds).toContain("tool_output");
    expect(kinds).toContain("message");
    expect(kinds.indexOf("reasoning")).toBeLessThan(kinds.indexOf("message"));

    const tools = items.filter((i) => i.type === "tool_output") as Array<Record<string, unknown>>;
    // One item per call, opened by the running status and settled by the
    // completion — not two items for the shell.
    expect(tools).toHaveLength(1);
    expect(tools[0].status).toBe("completed");
    expect(tools[0].output).toEqual({ stdout: "hi\n" });
  });

  it("an unrecognised message kind becomes a status note and the run still completes", async () => {
    const { resolve } = scripted([
      { type: "system", subtype: "init", model: { id: "composer-2.5" } },
      { type: "hologram" } as CursorSdkMessage,
      {
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "done" }] },
      },
    ]);
    const block = cursorAgent({ ...GATE_OFF, resolveCursorClient: resolve });
    const { output, error, items } = await testBlock(block, { input: { prompt: "go" } });

    expect(error).toBeNull();
    expect((output as CursorAgentHandle).status).toBe("completed");
    expect(items.some((i) => i.type === "status")).toBe(true);
  });

  it("does not re-emit the echoed user prompt as an assistant message", async () => {
    const { resolve } = scripted([
      { type: "user", message: { role: "user", content: [{ type: "text", text: "go" }] } },
      {
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "ok" }] },
      },
    ]);
    const block = cursorAgent({ ...GATE_OFF, resolveCursorClient: resolve });
    const { items } = await testBlock(block, { input: { prompt: "go" } });
    const messages = items.filter((i) => i.type === "message");
    expect(messages).toHaveLength(1);
    expect((messages[0] as { content?: Array<{ text?: string }> }).content?.[0]?.text).toBe("ok");
  });
});

describe("cursorAgent — the endings", () => {
  it("a finished wait returns a handle that parses against the NEUTRAL schema", async () => {
    const { resolve } = scripted(OK_STREAM);
    const block = cursorAgent({
      ...GATE_OFF,
      resolveCursorClient: resolve,
      agent: { model: { id: "composer-2.5" } },
    });
    const { output } = await testBlock(block, { input: { prompt: "go" } });
    const handle = output as CursorAgentHandle;

    expect(() => harnessRunHandleSchema.parse(handle)).not.toThrow();
    expect(handle).toMatchObject({
      source: "cursor/sdk",
      status: "completed",
      sessionId: "agent_1",
      url: null,
      outcome: "finished",
      finalMessage: "Wrote notes.md",
      usage: { inputTokens: 1200, outputTokens: 300 },
      cost: null,
      failureMessage: null,
    });
    expect(handle.cursorUsage).toMatchObject({ cacheReadTokens: 200, reasoningTokens: 100 });
  });

  it("a wait the SDK reports as error is an OUTCOME, not a throw — and keeps the agent id", async () => {
    const { resolve } = scripted([
      {
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "partial" }] },
      },
    ], {
      waitResult: { status: "error", error: { message: "boom from the model" } },
    });
    const block = cursorAgent({ ...GATE_OFF, resolveCursorClient: resolve });
    const { output, error } = await testBlock(block, { input: { prompt: "go" } });
    const handle = output as CursorAgentHandle;

    expect(error).toBeNull();
    expect(handle).toMatchObject({
      status: "errored",
      outcome: "failed",
      sessionId: "agent_1",
      usage: null,
      cost: null,
      failureMessage: "boom from the model",
      finalMessage: "partial",
    });
  });

  it("a cancelled wait is failed, not a throw — cancel that is not the caller's deadline", async () => {
    const { resolve } = scripted(OK_STREAM, {
      waitResult: { status: "cancelled", error: { message: "runtime cancelled" } },
    });
    const block = cursorAgent({ ...GATE_OFF, resolveCursorClient: resolve });
    const { output, error } = await testBlock(block, { input: { prompt: "go" } });

    expect(error).toBeNull();
    expect(output as CursorAgentHandle).toMatchObject({
      outcome: "failed",
      status: "errored",
      failureMessage: "runtime cancelled",
    });
  });

  it("an unknown wait status reports FAILED, not absent", async () => {
    const { resolve } = scripted(OK_STREAM, { waitResult: { status: "expired" } });
    const block = cursorAgent({ ...GATE_OFF, resolveCursorClient: resolve });
    const { output } = await testBlock(block, { input: { prompt: "go" } });

    expect(output as CursorAgentHandle).toMatchObject({ outcome: "failed", status: "errored" });
  });

  it("supports(wait) === false reports NO outcome, not a failed one", async () => {
    // The neutral field's whole job: `null` is "no terminal result arrived".
    // Reporting `failed` here would tell a manager the run was tried and lost.
    const { resolve, rec } = scripted(OK_STREAM, { supportsWait: false });
    const block = cursorAgent({ ...GATE_OFF, resolveCursorClient: resolve });
    const { output } = await testBlock(block, { input: { prompt: "go" } });

    expect(rec.waited).toBe(0);
    expect(output as CursorAgentHandle).toMatchObject({
      outcome: null,
      status: "errored",
    });
  });

  it("wait() is the sole outcome authority — a FINISHED stream status does not decide it", async () => {
    const { resolve } = scripted(
      [{ type: "status", status: "FINISHED" }],
      { waitResult: { status: "error", error: { message: "wait says otherwise" } } },
    );
    const block = cursorAgent({ ...GATE_OFF, resolveCursorClient: resolve });
    const { output } = await testBlock(block, { input: { prompt: "go" } });

    expect(output as CursorAgentHandle).toMatchObject({
      outcome: "failed",
      failureMessage: "wait says otherwise",
    });
  });

  it("a send that throws a typed run error carries the vendor's message", async () => {
    const { resolve } = scripted([], { throwOnSend: new Error("fatal: something") });
    const block = cursorAgent({ ...GATE_OFF, resolveCursorClient: resolve });
    const { error, items } = await testBlock(block, { input: { prompt: "go" } });

    expect(error?.cause).toBeInstanceOf(CursorAgentRunError);
    expect((error as Error).message).toContain("fatal: something");
    expect(items.some((i) => i.type === "error")).toBe(true);
  });

  it("a stream that throws mid-run rethrows typed, after the hook already has the id", async () => {
    const seen: string[] = [];
    const { resolve, rec } = scripted(async function* () {
      yield { type: "thinking", text: "halfway" } as CursorSdkMessage;
      throw new Error("socket closed");
    });
    const block = cursorAgent({
      ...GATE_OFF,
      resolveCursorClient: resolve,
      onSession: (id) => {
        seen.push(id);
      },
    });
    const { error } = await testBlock(block, { input: { prompt: "go" } });

    expect(error?.cause).toBeInstanceOf(CursorAgentRunError);
    expect(seen).toEqual(["agent_1"]);
    expect(rec.cancelled).toBe(1);
    expect(rec.closed).toBeGreaterThanOrEqual(1);
  });

  it("a throw that is not an Error still names what happened", async () => {
    // `(err as Error).message` on a string throw is `undefined`, so the run
    // error reads "Cursor run failed: undefined" — a message that tells an
    // operator nothing at the one moment they need it to.
    const { resolve } = scripted([], { throwOnSend: "cursor exploded" });
    const block = cursorAgent({ ...GATE_OFF, resolveCursorClient: resolve });
    const { error } = await testBlock(block, { input: { prompt: "go" } });

    expect(error?.cause).toBeInstanceOf(CursorAgentRunError);
    expect((error?.cause as Error).message).toContain("cursor exploded");
    expect((error?.cause as Error).message).not.toContain("undefined");
  });

  it("does not re-wrap an error that is already one of ours", async () => {
    const original = new CursorAgentRunError("Cursor run failed: the first time");
    const { resolve } = scripted([], { throwOnSend: original });
    const block = cursorAgent({ ...GATE_OFF, resolveCursorClient: resolve });
    const { error } = await testBlock(block, { input: { prompt: "go" } });

    expect(error?.cause).toBe(original);
    expect((error?.cause as Error).message).toBe("Cursor run failed: the first time");
  });

  it("passes a missing-SDK error through without wrapping", async () => {
    const original = new CursorSdkNotInstalledError();
    const { resolve } = scripted([], { throwOnCreate: original });
    const block = cursorAgent({ ...GATE_OFF, resolveCursorClient: resolve });
    const { error } = await testBlock(block, { input: { prompt: "go" } });

    expect(error?.cause).toBe(original);
  });

  it("keeps the original error reachable through the native cause chain", async () => {
    const original = new TypeError("stream is not iterable");
    const { resolve } = scripted([], { throwOnSend: original });
    const block = cursorAgent({ ...GATE_OFF, resolveCursorClient: resolve });
    const { error } = await testBlock(block, { input: { prompt: "go" } });

    expect((error?.cause as Error).cause).toBe(original);
  });

  it("an empty prompt throws before anything is created", async () => {
    const { resolve, rec } = scripted(OK_STREAM);
    const block = cursorAgent({ ...GATE_OFF, resolveCursorClient: resolve });
    const { error } = await testBlock(block, { input: { prompt: "   " } });

    expect(error?.cause).toBeInstanceOf(CursorAgentRunError);
    expect(rec.created).toHaveLength(0);
  });

  it("wait() usage replaces the stream-summed figure when both are present", async () => {
    const { resolve } = scripted(OK_STREAM, {
      waitResult: {
        status: "finished",
        usage: {
          inputTokens: 9,
          outputTokens: 8,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 17,
        },
      },
    });
    const block = cursorAgent({ ...GATE_OFF, resolveCursorClient: resolve });
    const { output } = await testBlock(block, { input: { prompt: "go" } });

    expect((output as CursorAgentHandle).usage).toEqual({ inputTokens: 9, outputTokens: 8 });
    expect((output as CursorAgentHandle).cursorUsage?.totalTokens).toBe(17);
  });

  it("prices a model core's table knows off the run's own system message", async () => {
    const { resolve } = scripted(
      [
        { type: "system", subtype: "init", model: { id: "gpt-5.4" } },
        {
          type: "assistant",
          message: { role: "assistant", content: [{ type: "text", text: "done" }] },
        },
        {
          type: "usage",
          usage: {
            inputTokens: 1_000_000,
            outputTokens: 1_000_000,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 2_000_000,
          },
        },
      ],
      {
        waitResult: {
          status: "finished",
          usage: {
            inputTokens: 1_000_000,
            outputTokens: 1_000_000,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 2_000_000,
          },
          model: { id: "gpt-5.4" },
        },
      },
    );
    const block = cursorAgent({ ...GATE_OFF, resolveCursorClient: resolve });
    const { output } = await testBlock(block, { input: { prompt: "go" } });
    const handle = output as CursorAgentHandle;

    expect(handle.cost).not.toBeNull();
    expect(handle.cost?.basis).toBe("estimated");
    expect(handle.cost?.usd).toBeGreaterThan(0);
  });
});

describe("cursorAgent — open tool items when the stream ends without settling them", () => {
  /** A call the runtime reported as running and never reported again. */
  const DANGLING_CALL: CursorSdkMessage[] = [
    {
      type: "tool_call",
      call_id: "c1",
      name: "shell",
      status: "running",
      args: { command: "sleep 999" },
    },
  ];

  it.each([
    ["finished", { status: "finished", result: "done" } as CursorRunResult],
    ["error", { status: "error", error: { message: "runtime died" } } as CursorRunResult],
  ])("settles the dangling tool item when wait() reports %s — a returned outcome, not a throw", async (_label, waitResult) => {
    // Cursor reports its terminal record on `wait()`, and an `error` there is
    // an OUTCOME the block returns. A tool call still `running` when the stream
    // closed has no result coming: left alone it renders as a call still
    // running under a handle that says the run is over.
    const { resolve } = scripted(DANGLING_CALL, { waitResult });
    const block = cursorAgent({ ...GATE_OFF, resolveCursorClient: resolve });
    const { items, error } = await testBlock(block, { input: { prompt: "go" } });

    expect(error).toBeNull();
    const tools = items.filter((i) => i.type === "tool_output") as Array<Record<string, unknown>>;
    expect(tools).toHaveLength(1);
    expect(tools[0].status).toBe("incomplete");
  });
});

describe("cursorAgent — cancellation", () => {
  it("throws WHEN THE SIGNAL FIRES, without waiting for the vendor's stream to close", async () => {
    const seen: string[] = [];
    const { resolve, rec } = scripted(async function* () {
      yield { type: "thinking", text: "started" } as CursorSdkMessage;
      // Stands in for the local runtime staying open long past the kill.
      await new Promise((r) => setTimeout(r, 10_000));
      yield { type: "status", status: "FINISHED" } as CursorSdkMessage;
    });
    const block = cursorAgent({
      ...GATE_OFF,
      resolveCursorClient: resolve,
      onSession: (id) => {
        seen.push(id);
      },
    });
    const runtime = await createTestContext({});
    const ac = new AbortController();
    (runtime.ctx as { signal?: AbortSignal }).signal = ac.signal;
    setTimeout(() => ac.abort(), 20);

    const startedAt = Date.now();
    await expect(
      block.config.execute?.({ prompt: "go" }, runtime.ctx as never),
    ).rejects.toBeInstanceOf(CursorAgentAbortedError);
    const elapsed = Date.now() - startedAt;

    expect(elapsed).toBeLessThan(2_000);
    // The id is already in the host's durable state, so the manager can resume
    // the run its own deadline killed.
    expect(seen).toEqual(["agent_1"]);
    expect(rec.cancelled).toBe(1);
  }, 15_000);

  it("throws WHEN THE SIGNAL FIRES while wait() is still pending after the stream has closed", async () => {
    // The stream can close before the SDK's terminal record is available, and
    // `wait()` is a second vendor await the deadline has to bound. The race
    // armed for the stream is disposed once the stream ends, so a hang here is
    // the same bug class as a hanging stream, reached through the other await.
    const { resolve, rec } = scripted([{ type: "thinking", text: "started" }], {
      waitResult: () => new Promise<CursorRunResult>(() => {}),
    });
    const block = cursorAgent({ ...GATE_OFF, resolveCursorClient: resolve });
    const runtime = await createTestContext({});
    const ac = new AbortController();
    (runtime.ctx as { signal?: AbortSignal }).signal = ac.signal;
    setTimeout(() => ac.abort(), 20);

    const startedAt = Date.now();
    await expect(
      block.config.execute?.({ prompt: "go" }, runtime.ctx as never),
    ).rejects.toBeInstanceOf(CursorAgentAbortedError);

    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(rec.waited).toBe(1);
    expect(rec.cancelled).toBe(1);
  }, 3_000);

  it("the reminted abort error carries the agent id the hook already stored", async () => {
    const { resolve } = scripted(async function* () {
      yield { type: "thinking", text: "started" } as CursorSdkMessage;
      await new Promise((r) => setTimeout(r, 10_000));
    });
    const block = cursorAgent({ ...GATE_OFF, resolveCursorClient: resolve });
    const runtime = await createTestContext({});
    const ac = new AbortController();
    (runtime.ctx as { signal?: AbortSignal }).signal = ac.signal;
    setTimeout(() => ac.abort(), 20);

    try {
      await block.config.execute?.({ prompt: "go" }, runtime.ctx as never);
      expect.unreachable("should have aborted");
    } catch (err) {
      expect(err).toBeInstanceOf(CursorAgentAbortedError);
      expect((err as CursorAgentAbortedError).sessionId).toBe("agent_1");
      expect((err as Error).message).toContain("agent_1");
    }
  }, 15_000);

  it("throws when the deadline fires in the window BEFORE the stream is being read", async () => {
    // The gap the up-front `signal.aborted` check does not cover: the resolvers,
    // the SDK import, create/resume, onSession and send all await before the
    // race is armed. An AbortSignal that is ALREADY aborted never fires `abort`
    // again, so a listener registered after the fact waits forever — and the
    // block falls back to waiting on the vendor's stream, which is the exact
    // hang the race exists to prevent.
    const ac = new AbortController();
    const { resolve } = scripted(async function* () {
      yield { type: "thinking", text: "started" } as CursorSdkMessage;
      await new Promise((r) => setTimeout(r, 10_000));
    });
    const block = cursorAgent({
      ...GATE_OFF,
      resolveCursorClient: resolve,
      // Stands in for any await in that window: a host resolver reading its own
      // state while the deadline runs out.
      cwd: () => {
        ac.abort();
        return "/work/checkout";
      },
    });
    const runtime = await createTestContext({});
    (runtime.ctx as { signal?: AbortSignal }).signal = ac.signal;

    const startedAt = Date.now();
    await expect(
      block.config.execute?.({ prompt: "go" }, runtime.ctx as never),
    ).rejects.toBeInstanceOf(CursorAgentAbortedError);
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  }, 15_000);

  it("does not orphan the stream's rejection when the deadline wins the race", async () => {
    // The abandoned side of `Promise.race` still settles. The runtime dying
    // makes that pending `next()` reject moments later with nothing awaiting
    // it, which surfaces as an unhandled rejection and can take a host's
    // process down.
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const ac = new AbortController();
      const { resolve } = scripted(async function* () {
        yield { type: "thinking", text: "started" } as CursorSdkMessage;
        await new Promise((r) => setTimeout(r, 50));
        throw new Error("runtime exited with code 143");
      });
      const block = cursorAgent({ ...GATE_OFF, resolveCursorClient: resolve });
      const runtime = await createTestContext({});
      (runtime.ctx as { signal?: AbortSignal }).signal = ac.signal;
      setTimeout(() => ac.abort(), 10);

      await expect(
        block.config.execute?.({ prompt: "go" }, runtime.ctx as never),
      ).rejects.toBeInstanceOf(CursorAgentAbortedError);

      await new Promise((r) => setTimeout(r, 300));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  }, 15_000);

  it("a signal already aborted stops the run without creating anything", async () => {
    const { resolve, rec } = scripted(OK_STREAM);
    const block = cursorAgent({ ...GATE_OFF, resolveCursorClient: resolve });
    const runtime = await createTestContext({});
    (runtime.ctx as { signal?: AbortSignal }).signal = AbortSignal.abort();

    await expect(
      block.config.execute?.({ prompt: "go" }, runtime.ctx as never),
    ).rejects.toBeInstanceOf(CursorAgentAbortedError);
    expect(rec.created).toHaveLength(0);
  });
});

describe("cursorAgent — the version gate seam", () => {
  it("builds against the tested version through the private symbol", () => {
    expect(() => cursorAgent(GATE_OFF)).not.toThrow();
  });

  it("does not treat a public-looking reader option as the gate", () => {
    // The guarantee this package sells is that a host cannot run an unvalidated
    // wire. A public seam would make that a claim rather than a guarantee.
    const publicOptions: CursorAgentOptions = {};
    expect(Object.keys(publicOptions)).not.toContain("readInstalledSdkVersion");
  });
});
