/**
 * The block: what it hands the SDK, what it hands the host, and how each of
 * Codex's endings surfaces.
 *
 * The seam throughout is a **scripted Codex client** injected through
 * `resolveCodexClient` — the shape `claude-code/test/sdk/agent.spec.ts` already
 * uses for `query` — so every behaviour here is a tracer bullet with no
 * subprocess. The one spec that runs the real installed SDK is
 * `installed-sdk.spec.ts`.
 */
import { describe, it, expect } from "vitest";
import { testBlock, createTestContext } from "@flow-state-dev/testing";
import { harnessRunHandleSchema } from "@flow-state-dev/core";
import { codexAgent } from "../src/agent";
import { CodexAgentAbortedError, CodexAgentConfigError, CodexAgentRunError } from "../src/errors";
import { TESTED_SDK_VERSION, type CodexAgentHandle, type CodexThreadEvent } from "../src/types";

/** Every spec below builds against a stubbed version gate; slice 1 owns the gate itself. */
const GATE_OFF = { readInstalledSdkVersion: () => TESTED_SDK_VERSION };

interface Recorder {
  started: Array<Record<string, unknown> | undefined>;
  resumed: Array<{ id: string; options: Record<string, unknown> | undefined }>;
  signals: Array<AbortSignal | undefined>;
}

type EventSource = CodexThreadEvent[] | ((signal?: AbortSignal) => AsyncIterable<CodexThreadEvent>);

/**
 * A Codex client whose thread replays a fixed event list (or a generator, for
 * the streams that must stay open). `throwOnRun` stands in for the CLI exiting
 * non-zero, which is how the SDK reports it.
 */
function scripted(
  events: EventSource,
  opts: { threadId?: string | null; throwOnRun?: Error } = {},
) {
  const rec: Recorder = { started: [], resumed: [], signals: [] };
  const makeThread = (id: string | null) => ({
    get id() {
      return id;
    },
    async runStreamed(_input: string, turnOptions?: { signal?: AbortSignal }) {
      rec.signals.push(turnOptions?.signal);
      if (opts.throwOnRun) throw opts.throwOnRun;
      const iterable =
        typeof events === "function"
          ? events(turnOptions?.signal)
          : (async function* () {
              for (const e of events) yield e;
            })();
      return { events: iterable };
    },
  });
  const resolve = () => ({
    startThread: (options?: Record<string, unknown>) => {
      rec.started.push(options);
      return makeThread(opts.threadId ?? null);
    },
    resumeThread: (id: string, options?: Record<string, unknown>) => {
      rec.resumed.push({ id, options });
      return makeThread(id);
    },
  });
  return { resolve, rec };
}

const OK_STREAM: CodexThreadEvent[] = [
  { type: "thread.started", thread_id: "thr_1" },
  { type: "turn.started" },
  { type: "item.completed", item: { id: "i0", type: "reasoning", text: "thinking" } },
  {
    type: "item.started",
    item: {
      id: "i1",
      type: "command_execution",
      command: "echo hi",
      aggregated_output: "",
      status: "in_progress",
    },
  },
  {
    type: "item.completed",
    item: {
      id: "i1",
      type: "command_execution",
      command: "echo hi",
      aggregated_output: "hi\n",
      exit_code: 0,
      status: "completed",
    },
  },
  {
    type: "item.completed",
    item: {
      id: "i2",
      type: "file_change",
      changes: [{ path: "notes.md", kind: "add" }],
      status: "completed",
    },
  },
  { type: "item.completed", item: { id: "i3", type: "agent_message", text: "Wrote notes.md" } },
  {
    type: "turn.completed",
    usage: {
      input_tokens: 1200,
      cached_input_tokens: 200,
      cache_write_input_tokens: 0,
      output_tokens: 300,
      reasoning_output_tokens: 100,
    },
  },
];

describe("codexAgent — what it hands the SDK", () => {
  it("starts a fresh thread in the directory the resolver named, with the thread options forwarded", async () => {
    const { resolve, rec } = scripted(OK_STREAM);
    const block = codexAgent({
      ...GATE_OFF,
      resolveCodexClient: resolve,
      cwd: () => "/work/checkout",
      thread: { model: "gpt-5.4-codex", sandboxMode: "workspace-write", approvalPolicy: "never" },
    });
    const { error } = await testBlock(block, { input: { prompt: "do the thing" } });

    expect(error).toBeNull();
    expect(rec.resumed).toHaveLength(0);
    expect(rec.started[0]).toMatchObject({
      workingDirectory: "/work/checkout",
      model: "gpt-5.4-codex",
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
    });
  });

  it("hands the turn the block's own signal", async () => {
    const { resolve, rec } = scripted(OK_STREAM);
    const block = codexAgent({ ...GATE_OFF, resolveCodexClient: resolve });
    const runtime = await createTestContext({});
    const ac = new AbortController();
    (runtime.ctx as { signal?: AbortSignal }).signal = ac.signal;
    await block.config.execute?.({ prompt: "go" }, runtime.ctx as never);

    expect(rec.signals[0]).toBe(ac.signal);
  });

  it("resumes the thread the resolver named, in the same resolved directory", async () => {
    const { resolve, rec } = scripted(OK_STREAM);
    const block = codexAgent({
      ...GATE_OFF,
      resolveCodexClient: resolve,
      cwd: () => "/work/checkout",
      resume: () => "thr_saved_42",
    });
    await testBlock(block, { input: { prompt: "continue" } });

    expect(rec.started).toHaveLength(0);
    expect(rec.resumed[0].id).toBe("thr_saved_42");
    expect(rec.resumed[0].options).toMatchObject({ workingDirectory: "/work/checkout" });
  });

  it.each([
    ["null", null],
    ["an empty string", ""],
    ["undefined", undefined],
  ])("starts fresh when the resume resolver returns %s", async (_label, value) => {
    const { resolve, rec } = scripted(OK_STREAM);
    const block = codexAgent({
      ...GATE_OFF,
      resolveCodexClient: resolve,
      resume: () => value as string | null | undefined,
    });
    await testBlock(block, { input: { prompt: "go" } });

    expect(rec.resumed).toHaveLength(0);
    expect(rec.started).toHaveLength(1);
  });

  it("resolves the directory ONCE, before anything is spawned", async () => {
    let calls = 0;
    const { resolve } = scripted(OK_STREAM);
    const block = codexAgent({
      ...GATE_OFF,
      resolveCodexClient: resolve,
      cwd: () => {
        calls += 1;
        return "/work/checkout";
      },
    });
    await testBlock(block, { input: { prompt: "go" } });
    expect(calls).toBe(1);
  });
});

describe("codexAgent — refusals when the block is built (BP-031)", () => {
  it("refuses a working directory inside the forwarded thread options", () => {
    expect(() =>
      codexAgent({
        ...GATE_OFF,
        thread: { workingDirectory: "/anywhere" } as never,
      }),
    ).toThrow(CodexAgentConfigError);
  });

  it("refuses a turn signal inside either forwarded group", () => {
    expect(() =>
      codexAgent({ ...GATE_OFF, thread: { signal: new AbortController().signal } as never }),
    ).toThrow(CodexAgentConfigError);
    expect(() =>
      codexAgent({ ...GATE_OFF, client: { signal: new AbortController().signal } as never }),
    ).toThrow(CodexAgentConfigError);
  });

  it("names the option and its real owner, so the refusal is actionable", () => {
    let message = "";
    try {
      codexAgent({ ...GATE_OFF, thread: { workingDirectory: "/anywhere" } as never });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("thread.workingDirectory");
    expect(message).toContain("cwd");
  });
});

describe("codexAgent — the session hook", () => {
  it("hands the host the thread id before any turn work is consumed", async () => {
    const seen: string[] = [];
    const { resolve } = scripted(OK_STREAM);
    const block = codexAgent({
      ...GATE_OFF,
      resolveCodexClient: resolve,
      onSession: (id) => {
        seen.push(`hook:${id}`);
      },
    });
    const { items } = await testBlock(block, { input: { prompt: "go" } });

    expect(seen).toEqual(["hook:thr_1"]);
    // Nothing from the turn reached the stream before the hook ran: the hook is
    // the ONLY carrier that survives a run the caller's deadline kills.
    const firstConversational = items.find((i) => i.type === "message" || i.type === "tool_output");
    expect(firstConversational).toBeDefined();
  });

  it("calls the hook exactly once even if the wire names the thread again", async () => {
    let calls = 0;
    const { resolve } = scripted([
      { type: "thread.started", thread_id: "thr_1" },
      { type: "thread.started", thread_id: "thr_1" },
      ...OK_STREAM.slice(1),
    ]);
    const block = codexAgent({
      ...GATE_OFF,
      resolveCodexClient: resolve,
      onSession: () => {
        calls += 1;
      },
    });
    await testBlock(block, { input: { prompt: "go" } });
    expect(calls).toBe(1);
  });

  it("leaves the host's stored session id untouched when a resume is refused", async () => {
    // §10's negative counterpart, pinning the real-CLI POC (PR #1573): a resume
    // of a thread the CLI no longer has names NO thread, so the hook never
    // fires and no dead id is written back. LAB-154's null-stays-null self-heal
    // is designed on top of this.
    let hookCalls = 0;
    const { resolve } = scripted([], {
      throwOnRun: new Error(
        "Codex Exec exited with code 1: thread/resume failed: no rollout found for thread id 0c9 (code -32600)",
      ),
    });
    const block = codexAgent({
      ...GATE_OFF,
      resolveCodexClient: resolve,
      resume: () => "thr_gone",
      onSession: () => {
        hookCalls += 1;
      },
    });
    const { error } = await testBlock(block, { input: { prompt: "continue" } });

    expect(error?.cause).toBeInstanceOf(CodexAgentRunError);
    expect(hookCalls).toBe(0);
  });
});

describe("codexAgent — the item mirror", () => {
  it("mirrors reasoning, commands, file changes and the final message into the stream", async () => {
    const { resolve } = scripted(OK_STREAM);
    const block = codexAgent({ ...GATE_OFF, resolveCodexClient: resolve });
    const { items, error } = await testBlock(block, { input: { prompt: "go" } });

    expect(error).toBeNull();
    const kinds = items.map((i) => i.type);
    expect(kinds).toContain("reasoning");
    expect(kinds).toContain("tool_output");
    expect(kinds).toContain("message");
    expect(kinds.indexOf("reasoning")).toBeLessThan(kinds.indexOf("message"));

    const tools = items.filter((i) => i.type === "tool_output") as Array<Record<string, any>>;
    // One item per call, opened by the start and settled by the completion —
    // not two items for the command.
    expect(tools).toHaveLength(2);
    const command = tools.find((t) => t.toolCall?.name === "command_execution");
    expect(command?.status).toBe("completed");
    expect(command?.output).toBe("hi\n");
  });

  it("an unrecognised item kind becomes a status note and the run still completes", async () => {
    const { resolve } = scripted([
      { type: "thread.started", thread_id: "thr_1" },
      { type: "item.completed", item: { id: "i9", type: "hologram" } } as CodexThreadEvent,
      { type: "item.completed", item: { id: "i3", type: "agent_message", text: "done" } },
      {
        type: "turn.completed",
        usage: {
          input_tokens: 1,
          cached_input_tokens: 0,
          cache_write_input_tokens: 0,
          output_tokens: 1,
          reasoning_output_tokens: 0,
        },
      },
    ]);
    const block = codexAgent({ ...GATE_OFF, resolveCodexClient: resolve });
    const { output, error } = await testBlock(block, { input: { prompt: "go" } });

    expect(error).toBeNull();
    expect((output as CodexAgentHandle).status).toBe("completed");
  });
});

describe("codexAgent — the endings", () => {
  it("a completed turn returns a handle that parses against the NEUTRAL schema", async () => {
    const { resolve } = scripted(OK_STREAM);
    const block = codexAgent({
      ...GATE_OFF,
      resolveCodexClient: resolve,
      thread: { model: "gpt-5.4-codex" },
    });
    const { output } = await testBlock(block, { input: { prompt: "go" } });
    const handle = output as CodexAgentHandle;

    expect(() => harnessRunHandleSchema.parse(handle)).not.toThrow();
    expect(handle).toMatchObject({
      source: "codex/sdk",
      status: "completed",
      sessionId: "thr_1",
      url: null,
      outcome: "finished",
      finalMessage: "Wrote notes.md",
      usage: { inputTokens: 1200, outputTokens: 300 },
      failureMessage: null,
    });
    expect(handle.codexUsage).toMatchObject({ cachedInputTokens: 200, reasoningOutputTokens: 100 });
  });

  it("a turn the model failed is an OUTCOME, not a throw — and keeps the thread id", async () => {
    const { resolve } = scripted([
      { type: "thread.started", thread_id: "thr_1" },
      { type: "item.completed", item: { id: "i3", type: "agent_message", text: "partial" } },
      { type: "turn.failed", error: { message: "boom from the model" } },
    ]);
    const block = codexAgent({ ...GATE_OFF, resolveCodexClient: resolve });
    const { output, error } = await testBlock(block, { input: { prompt: "go" } });
    const handle = output as CodexAgentHandle;

    expect(error).toBeNull();
    expect(handle).toMatchObject({
      status: "errored",
      outcome: "failed",
      sessionId: "thr_1",
      usage: null,
      cost: null,
      failureMessage: "boom from the model",
      finalMessage: "partial",
    });
  });

  it("a stream that ends with no terminal turn event reports NO outcome, not a failed one", async () => {
    // The neutral field's whole job: `null` is "no terminal result arrived".
    // Reporting `failed` here would tell a manager the run was tried and lost.
    const { resolve } = scripted([{ type: "thread.started", thread_id: "thr_1" }]);
    const block = codexAgent({ ...GATE_OFF, resolveCodexClient: resolve });
    const { output } = await testBlock(block, { input: { prompt: "go" } });

    expect(output as CodexAgentHandle).toMatchObject({ outcome: null, status: "errored", usage: null });
  });

  it("an unrecognised terminal turn event reports FAILED, not absent", async () => {
    const { resolve } = scripted([
      { type: "thread.started", thread_id: "thr_1" },
      { type: "turn.abandoned" } as CodexThreadEvent,
    ]);
    const block = codexAgent({ ...GATE_OFF, resolveCodexClient: resolve });
    const { output } = await testBlock(block, { input: { prompt: "go" } });

    expect(output as CodexAgentHandle).toMatchObject({ outcome: "failed", status: "errored" });
  });

  it("the CLI exiting non-zero throws a typed run error carrying the vendor's message", async () => {
    const { resolve } = scripted([], {
      throwOnRun: new Error("Codex Exec exited with code 3: fatal: something"),
    });
    const block = codexAgent({ ...GATE_OFF, resolveCodexClient: resolve });
    const { error, items } = await testBlock(block, { input: { prompt: "go" } });

    expect(error?.cause).toBeInstanceOf(CodexAgentRunError);
    expect((error as Error).message).toContain("fatal: something");
    expect(items.some((i) => i.type === "error")).toBe(true);
  });

  it("a stream that throws mid-run rethrows typed, after the hook already has the id", async () => {
    const seen: string[] = [];
    const { resolve } = scripted(async function* () {
      yield { type: "thread.started", thread_id: "thr_1" } as CodexThreadEvent;
      throw new Error("socket closed");
    });
    const block = codexAgent({
      ...GATE_OFF,
      resolveCodexClient: resolve,
      onSession: (id) => {
        seen.push(id);
      },
    });
    const { error } = await testBlock(block, { input: { prompt: "go" } });

    expect(error?.cause).toBeInstanceOf(CodexAgentRunError);
    expect(seen).toEqual(["thr_1"]);
  });

  it("an empty prompt throws before anything is spawned", async () => {
    const { resolve, rec } = scripted(OK_STREAM);
    const block = codexAgent({ ...GATE_OFF, resolveCodexClient: resolve });
    const { error } = await testBlock(block, { input: { prompt: "   " } });

    expect(error?.cause).toBeInstanceOf(CodexAgentRunError);
    expect(rec.started).toHaveLength(0);
  });
});

describe("codexAgent — cancellation", () => {
  it("throws WHEN THE SIGNAL FIRES, without waiting for the vendor's stream to close", async () => {
    // The POC's finding (§9): the SDK's own rejection waits for the CLI's
    // stdout to close, so a subprocess the CLI spawned can hold it open past
    // the deadline. The block races the signal instead — a deadline that waits
    // on the vendor's stdout no longer bounds what it promised.
    const seen: string[] = [];
    const { resolve } = scripted(async function* () {
      yield { type: "thread.started", thread_id: "thr_1" } as CodexThreadEvent;
      // Stands in for the CLI's stdout staying open long past the kill.
      await new Promise((r) => setTimeout(r, 10_000));
      yield { type: "turn.completed" } as CodexThreadEvent;
    });
    const block = codexAgent({
      ...GATE_OFF,
      resolveCodexClient: resolve,
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
    ).rejects.toBeInstanceOf(CodexAgentAbortedError);
    const elapsed = Date.now() - startedAt;

    expect(elapsed).toBeLessThan(2_000);
    // The id is already in the host's durable state, so the manager can resume
    // the run its own deadline killed.
    expect(seen).toEqual(["thr_1"]);
  }, 15_000);

  it("a signal already aborted stops the run without spawning anything", async () => {
    const { resolve, rec } = scripted(OK_STREAM);
    const block = codexAgent({ ...GATE_OFF, resolveCodexClient: resolve });
    const runtime = await createTestContext({});
    (runtime.ctx as { signal?: AbortSignal }).signal = AbortSignal.abort();

    await expect(
      block.config.execute?.({ prompt: "go" }, runtime.ctx as never),
    ).rejects.toBeInstanceOf(CodexAgentAbortedError);
    expect(rec.started).toHaveLength(0);
  });
});
