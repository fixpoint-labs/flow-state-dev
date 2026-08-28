import { createHash } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { mkdir as mkdirAsync, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, win32 } from "node:path";
import { testBlock, createTestContext } from "@flow-state-dev/testing";
import { normalizeResourcePath } from "@flow-state-dev/core/types";
import { defineCapability } from "@flow-state-dev/core";
import { z } from "zod";
import {
  claudeCodeAgent,
  forwardSignalToController,
  runNamespace,
  SDK_SESSION_ID_KEY,
  SDK_AGENT_RUNS_KEY,
} from "../../src/sdk/agent";
import { createDefaultResolveClaudeAgent } from "../../src/sdk/sdk-client";
import { ClaudeAgentSdkNotInstalledError, ClaudeAgentRunError } from "../../src/sdk/errors";
import type {
  SdkAgentHandle,
  SdkMessageLike,
  ResolveClaudeAgent,
  ClaudeAgentQueryOptions,
} from "../../src/sdk/types";

/** Build an async-iterable scripted `query` from a fixed message list. */
function scriptedQuery(
  messages: SdkMessageLike[],
  spy?: (args: { prompt: unknown; options?: ClaudeAgentQueryOptions }) => void,
): ResolveClaudeAgent {
  return () => ({
    query: async function* (args) {
      spy?.(args);
      for (const m of messages) yield m;
    },
  });
}

const RESULT_OK: SdkMessageLike = {
  type: "result",
  subtype: "success",
  result: "final answer",
  session_id: "sess_new",
  usage: { input_tokens: 50, output_tokens: 10 },
  total_cost_usd: 0.01,
};

describe("claudeCodeAgent", () => {
  it("emits message, reasoning, tool_output, and container items in stream order", async () => {
    const messages: SdkMessageLike[] = [
      { type: "system", subtype: "init", session_id: "sess_new" },
      {
        type: "assistant",
        message: {
          content: [
            { type: "thinking", thinking: "thinking..." },
            { type: "text", text: "working on it" },
            { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } },
          ],
        },
      },
      {
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "ok" }] },
      },
      {
        type: "assistant",
        message: {
          content: [{ type: "tool_use", id: "toolu_agent", name: "Agent", input: { task: "sub" } }],
        },
      },
      {
        type: "user",
        message: {
          content: [{ type: "tool_result", tool_use_id: "toolu_agent", content: "child done" }],
        },
      },
      RESULT_OK,
    ];

    // Whole-message (non-partial) path: the script carries complete content
    // blocks with no stream_event deltas, so partials must be OFF for the
    // text/thinking blocks to surface as items.
    const block = claudeCodeAgent({
      resolveClaudeAgent: scriptedQuery(messages),
      includePartialMessages: false,
    });
    const { items, error } = await testBlock(block, { input: { prompt: "do the thing" } });

    expect(error).toBeNull();
    const kinds = items.map((i) => i.type);
    // reasoning + message + tool_output + container appear, in this relative order.
    expect(kinds).toContain("reasoning");
    expect(kinds).toContain("message");
    expect(kinds).toContain("tool_output");
    expect(kinds).toContain("container");

    const reasoningIdx = kinds.indexOf("reasoning");
    const messageIdx = kinds.indexOf("message");
    const toolIdx = kinds.indexOf("tool_output");
    const containerIdx = kinds.indexOf("container");
    expect(reasoningIdx).toBeLessThan(messageIdx);
    expect(messageIdx).toBeLessThan(toolIdx);
    expect(toolIdx).toBeLessThan(containerIdx);

    // tool_output completed with the result.
    const tool = items.find((i) => i.type === "tool_output") as
      | { status: string; output: unknown; toolCall: { name: string } }
      | undefined;
    expect(tool?.status).toBe("completed");
    expect(tool?.output).toBe("ok");
    expect(tool?.toolCall.name).toBe("Bash");
  });

  it("coalesces partial token deltas into the final message text", async () => {
    const messages: SdkMessageLike[] = [
      {
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hel" } },
      },
      {
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "lo" } },
      },
      { type: "result", subtype: "success", result: "Hello", session_id: "sess_x" },
    ];

    const block = claudeCodeAgent({ resolveClaudeAgent: scriptedQuery(messages) });
    const { items, output } = await testBlock(block, { input: { prompt: "hi" } });

    const message = items.find((i) => i.type === "message") as
      | { status: string; content: Array<{ text: string }> }
      | undefined;
    expect(message?.status).toBe("completed");
    expect(message?.content[0].text).toBe("Hello");
    expect((output as SdkAgentHandle).finalMessage).toBe("Hello");
  });

  it("emits exactly ONE message item when partials precede the whole assistant message", async () => {
    // Realistic SDK sequence with includePartialMessages ON (the default): the
    // SDK streams text deltas AND then the whole `assistant` message for the
    // same turn. The whole message must NOT produce a second item — the partial
    // stream is the single source of truth; the whole message only closes it.
    const messages: SdkMessageLike[] = [
      {
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hel" } },
      },
      {
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "lo" } },
      },
      { type: "assistant", message: { content: [{ type: "text", text: "Hello" }] } },
      RESULT_OK,
    ];

    const block = claudeCodeAgent({ resolveClaudeAgent: scriptedQuery(messages) });
    const { items } = await testBlock(block, { input: { prompt: "hi" } });

    const messageItems = items.filter((i) => i.type === "message");
    expect(messageItems).toHaveLength(1);
    const message = messageItems[0] as { status: string; content: Array<{ text: string }> };
    expect(message.status).toBe("completed");
    expect(message.content[0].text).toBe("Hello");
  });

  it("closes the streaming item on each whole assistant message so two turns stay separate", async () => {
    // Two text turns, each as [delta, whole assistant message]. The whole
    // message of turn 1 must close turn 1's streaming item before turn 2's
    // delta opens a new one — otherwise both turns coalesce into a single item.
    const messages: SdkMessageLike[] = [
      {
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "one" } },
      },
      { type: "assistant", message: { content: [{ type: "text", text: "one" }] } },
      {
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "two" } },
      },
      { type: "assistant", message: { content: [{ type: "text", text: "two" }] } },
      RESULT_OK,
    ];

    const block = claudeCodeAgent({ resolveClaudeAgent: scriptedQuery(messages) });
    const { items } = await testBlock(block, { input: { prompt: "hi" } });

    const messageItems = items.filter((i) => i.type === "message") as Array<{
      content: Array<{ text: string }>;
    }>;
    expect(messageItems).toHaveLength(2);
    expect(messageItems.map((m) => m.content[0].text)).toEqual(["one", "two"]);
  });

  it("emits exactly ONE message item on the partials-OFF whole-message path", async () => {
    const messages: SdkMessageLike[] = [
      { type: "assistant", message: { content: [{ type: "text", text: "just one" }] } },
      RESULT_OK,
    ];
    const block = claudeCodeAgent({
      resolveClaudeAgent: scriptedQuery(messages),
      includePartialMessages: false,
    });
    const { items } = await testBlock(block, { input: { prompt: "hi" } });

    const messageItems = items.filter((i) => i.type === "message") as Array<{
      content: Array<{ text: string }>;
    }>;
    expect(messageItems).toHaveLength(1);
    expect(messageItems[0].content[0].text).toBe("just one");
  });

  it("persists the SDK session id and appends the handle after a run", async () => {
    const block = claudeCodeAgent({ resolveClaudeAgent: scriptedQuery([RESULT_OK]) });
    const { state, output } = await testBlock(block, { input: { prompt: "go" } });

    expect(state.session[SDK_SESSION_ID_KEY]).toBe("sess_new");
    const runs = state.session[SDK_AGENT_RUNS_KEY] as SdkAgentHandle[];
    expect(runs).toHaveLength(1);
    expect(runs[0].sessionId).toBe("sess_new");

    const handle = output as SdkAgentHandle;
    expect(handle.source).toBe("sdk");
    expect(handle.status).toBe("completed");
    expect(handle.resultSubtype).toBe("success");
    expect(handle.usage).toEqual({ inputTokens: 50, outputTokens: 10 });
    expect(handle.costUsd).toBe(0.01);
  });

  it("resumes a prior session id on a second run", async () => {
    const spy = vi.fn();
    const block = claudeCodeAgent({ resolveClaudeAgent: scriptedQuery([RESULT_OK], spy) });
    await testBlock(block, {
      input: { prompt: "again" },
      session: { state: { [SDK_SESSION_ID_KEY]: "sess_prior" } },
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].options?.resume).toBe("sess_prior");
  });

  it("gives the run its own working directory, resolved per invocation", async () => {
    const spy = vi.fn();
    const seen: string[] = [];
    const block = claudeCodeAgent({
      resolveClaudeAgent: scriptedQuery([RESULT_OK], spy),
      // A resolver rather than a constant is the shape that matters: one flow
      // build serves every row, so the directory has to be derivable per run.
      cwd: (input) => {
        seen.push(input.prompt);
        return `/work/checkouts/${input.prompt}`;
      },
    });

    await testBlock(block, { input: { prompt: "FIX-1219" } });

    expect(spy.mock.calls[0][0].options?.cwd).toBe("/work/checkouts/FIX-1219");
    // Called once per invocation, with the block's own input — not once at
    // build time, which would make one directory serve every run.
    expect(seen).toEqual(["FIX-1219"]);
  });

  it("installs the capabilities it is handed on the block itself", async () => {
    // Without this slot a caller who wants the agent to carry a capability has
    // to abandon the factory and hand-roll the block. The capability carries
    // session state rather than tools, because the agent is a handler and
    // tools are a generator-only slot.
    const cap = defineCapability({
      name: "agent-uses-probe",
      sessionStateSchema: z.object({
        probe: z.string().nullable().default(null),
      }),
    });
    const block = claudeCodeAgent({ uses: [cap] }) as unknown as {
      config: { uses?: unknown[]; __resolvedCapabilities?: unknown[] };
    };

    expect(block.config.uses).toEqual([cap]);
    // Stored is not the same as installed: assert it was actually resolved,
    // which is what a capability has to be to do anything.
    expect(block.config.__resolvedCapabilities).toHaveLength(1);
  });

  it("declares no capabilities when handed none", async () => {
    // BP-035's off state. Absent must stay absent rather than becoming an
    // empty array — a block that declares an empty capability set is not the
    // same shape as one that declares none.
    const block = claudeCodeAgent({}) as unknown as {
      config: Record<string, unknown>;
    };

    expect("uses" in block.config).toBe(false);
  });

  it("forwards the run's environment, settings sources and sandbox settings", async () => {
    const spy = vi.fn();
    const block = claudeCodeAgent({
      resolveClaudeAgent: scriptedQuery([RESULT_OK], spy),
      settingSources: ["user"],
      env: { PATH: "/usr/bin", CI: "1" },
      sandbox: { enabled: true },
    });

    await testBlock(block, { input: { prompt: "go" } });

    const options = spy.mock.calls[0][0].options;
    expect(options?.settingSources).toEqual(["user"]);
    expect(options?.env).toEqual({ PATH: "/usr/bin", CI: "1" });
    expect(options?.sandbox).toEqual({ enabled: true });
  });

  it("resolves sandbox settings per run, so they can name the run's own paths", async () => {
    // The settings that confine a run name the directory it works in, and one
    // flow build serves many runs. A build-time constant can say "sandboxed"
    // but not "sandboxed to THIS workspace" — the only form that contains
    // anything.
    const spy = vi.fn();
    const seen: string[] = [];
    const block = claudeCodeAgent({
      resolveClaudeAgent: scriptedQuery([RESULT_OK], spy),
      sandbox: (input) => {
        seen.push(input.prompt);
        return { filesystem: { allowWrite: [`/work/${input.prompt}`] } };
      },
    });

    await testBlock(block, { input: { prompt: "run-7" } });

    expect(spy.mock.calls[0][0].options?.sandbox).toEqual({
      filesystem: { allowWrite: ["/work/run-7"] },
    });
    expect(seen).toEqual(["run-7"]);
  });

  it("loads no filesystem settings when handed an empty list", async () => {
    // `[]` and absent are DIFFERENT instructions: absent loads every source,
    // `[]` loads none. Passing the option through as `undefined` would collapse
    // the isolating one into the permissive one, silently.
    const spy = vi.fn();
    const block = claudeCodeAgent({
      resolveClaudeAgent: scriptedQuery([RESULT_OK], spy),
      settingSources: [],
    });

    await testBlock(block, { input: { prompt: "go" } });

    expect(spy.mock.calls[0][0].options?.settingSources).toEqual([]);
  });

  it("names none of the three when they are not set, so the SDK's own defaults stand", async () => {
    // BP-035: the off state. A key present with `undefined` is not the same as
    // an absent key to a callee that checks `in` — and for `settingSources` the
    // difference decides whether the run reads CLAUDE.md out of its workspace.
    const spy = vi.fn();
    const block = claudeCodeAgent({
      resolveClaudeAgent: scriptedQuery([RESULT_OK], spy),
    });

    await testBlock(block, { input: { prompt: "go" } });

    const options = spy.mock.calls[0][0].options ?? {};
    expect("settingSources" in options).toBe(false);
    expect("env" in options).toBe(false);
    expect("sandbox" in options).toBe(false);
  });

  it("resolves a symlinked directory to one physical path for both halves", async () => {
    // `path.resolve` is lexical, so without this the recorder keys the symlink
    // spelling while the spawned SDK process reports the physical path — and
    // the recorder's own divergence check then reads an ordinary write as a
    // contested key, writes a gap, and leaves the row permanently `pending`.
    const base = mkdtempSync(join(tmpdir(), "cwd-symlink-"));
    const real = join(base, "real");
    const link = join(base, "link");
    mkdirSync(real, { recursive: true });
    symlinkSync(real, link);

    const spy = vi.fn();
    const block = claudeCodeAgent({
      resolveClaudeAgent: scriptedQuery([RESULT_OK], spy),
      cwd: () => link,
    });
    await testBlock(block, { input: { prompt: "go" } });

    // The physical directory, which is what the child process will report as
    // its own cwd — so the recorder's keys and the harness's paths agree.
    expect(spy.mock.calls[0][0].options?.cwd).toBe(realpathSync(real));
    expect(spy.mock.calls[0][0].options?.cwd).not.toBe(link);

    rmSync(base, { recursive: true, force: true });
  });

  it("hands back a directory it cannot resolve, rather than dropping it", async () => {
    // Both halves still see ONE value, which is the invariant. An unusable
    // directory is left to fail in the SDK, where the error belongs.
    const spy = vi.fn();
    const missing = join(tmpdir(), `cwd-missing-${Date.now()}`);
    const block = claudeCodeAgent({
      resolveClaudeAgent: scriptedQuery([RESULT_OK], spy),
      cwd: () => missing,
    });
    await testBlock(block, { input: { prompt: "go" } });

    expect(spy.mock.calls[0][0].options?.cwd).toBe(missing);
  });

  it("forwards no working directory when none is configured", async () => {
    // BP-030 / §9's first row. Asserted as ABSENT rather than as a default
    // value: handing the SDK an explicit `process.cwd()` would look identical
    // in a passing run and is a different call.
    const spy = vi.fn();
    const block = claudeCodeAgent({ resolveClaudeAgent: scriptedQuery([RESULT_OK], spy) });
    await testBlock(block, { input: { prompt: "go" } });

    expect(spy.mock.calls[0][0].options).not.toHaveProperty("cwd");
  });

  it("forwards an AbortController to query so the SDK run is cancellable", async () => {
    const spy = vi.fn();
    const block = claudeCodeAgent({ resolveClaudeAgent: scriptedQuery([RESULT_OK], spy) });
    await testBlock(block, { input: { prompt: "go" } });

    const controller = spy.mock.calls[0][0].options?.abortController;
    expect(controller).toBeInstanceOf(AbortController);
  });

  it("forwardSignalToController aborts immediately when ctx.signal is already aborted", () => {
    const already = AbortSignal.abort();
    const controller = forwardSignalToController(already);
    expect(controller.signal.aborted).toBe(true);
  });

  it("forwardSignalToController aborts the controller when ctx.signal aborts later", () => {
    const source = new AbortController();
    const controller = forwardSignalToController(source.signal);
    expect(controller.signal.aborted).toBe(false);
    source.abort();
    expect(controller.signal.aborted).toBe(true);
  });

  it("tolerates an absent ctx.signal without throwing", () => {
    const controller = forwardSignalToController(undefined);
    expect(controller.signal.aborted).toBe(false);
  });

  it("routes onToolApproval deny onto canUseTool and emits a status item", async () => {
    let decision: { behavior: string; message?: string } | undefined;
    const messages: SdkMessageLike[] = [RESULT_OK];
    const resolveClaudeAgent: ResolveClaudeAgent = () => ({
      query: async function* (args) {
        // Exercise the canUseTool adapter the block built.
        decision = await args.options?.canUseTool?.("Bash", { command: "rm -rf /" }, {});
        for (const m of messages) yield m;
      },
    });

    const block = claudeCodeAgent({
      resolveClaudeAgent,
      onToolApproval: () => ({ decision: "deny", message: "nope" }),
    });
    const { items } = await testBlock(block, { input: { prompt: "danger" } });

    expect(decision).toEqual({ behavior: "deny", message: "nope" });
    const status = items.find(
      (i) => i.type === "status" && String((i as { message: string }).message).includes("Denied tool"),
    );
    expect(status).toBeDefined();
  });

  it("persists approval decisions durably and without dedupe-colliding on repeats", async () => {
    // The SDK calls canUseTool(toolName, input, extra). Approving the SAME tool
    // twice must yield TWO durable (non-transient) decision items — the audit
    // trail must replay, and emit.status's same-string dedupe must not swallow
    // the second identical approval.
    const resolveClaudeAgent: ResolveClaudeAgent = () => ({
      query: async function* (args) {
        const extra = { signal: new AbortController().signal };
        await args.options?.canUseTool?.("Bash", { command: "ls" }, extra);
        await args.options?.canUseTool?.("Bash", { command: "pwd" }, extra);
        yield RESULT_OK;
      },
    });

    const block = claudeCodeAgent({
      resolveClaudeAgent,
      onToolApproval: () => ({ decision: "allow" }),
    });
    const { items } = await testBlock(block, { input: { prompt: "go" } });

    const approvals = items.filter(
      (i) =>
        i.type === "status" &&
        String((i as { message: string }).message).includes("Approved tool"),
    ) as Array<{ transient?: boolean }>;
    // Both approvals survive the dedupe and both are durable.
    expect(approvals).toHaveLength(2);
    for (const a of approvals) expect(a.transient).not.toBe(true);
  });

  it("nests a sub-agent's inner items under its container via ownedBy", async () => {
    // A Task/Agent spawn opens a container; the sub-agent's own assistant/tool
    // messages carry parent_tool_use_id = the task's tool_use id. Those inner
    // items must be owned by (nested under) the container, not top-level peers.
    const messages: SdkMessageLike[] = [
      {
        type: "assistant",
        message: {
          content: [{ type: "tool_use", id: "toolu_task", name: "Task", input: { task: "sub" } }],
        },
      },
      // Inner assistant text produced inside the sub-agent loop.
      {
        type: "assistant",
        parent_tool_use_id: "toolu_task",
        message: { content: [{ type: "text", text: "sub result" }] },
      },
      // Inner tool call + result inside the sub-agent loop.
      {
        type: "assistant",
        parent_tool_use_id: "toolu_task",
        message: {
          content: [{ type: "tool_use", id: "toolu_inner", name: "Read", input: { path: "a" } }],
        },
      },
      {
        type: "user",
        parent_tool_use_id: "toolu_task",
        message: { content: [{ type: "tool_result", tool_use_id: "toolu_inner", content: "ok" }] },
      },
      // The sub-agent returns: closes the container.
      {
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "toolu_task", content: "done" }] },
      },
      RESULT_OK,
    ];

    const block = claudeCodeAgent({
      resolveClaudeAgent: scriptedQuery(messages),
      includePartialMessages: false,
    });
    const { items } = await testBlock(block, { input: { prompt: "spawn" } });

    const container = items.find((i) => i.type === "container") as
      | { id: string; blockName?: string; label?: string; startedAt?: number; provenance: { blockInstanceId: string } }
      | undefined;
    expect(container).toBeDefined();
    // Ownership keys off the container's provenance.blockInstanceId, not its item id.
    const ownerId = container!.provenance.blockInstanceId;
    expect(ownerId).not.toBe(container!.id);

    const innerMessage = items.find((i) => i.type === "message") as
      | { ownedBy?: string }
      | undefined;
    const innerTool = items.find((i) => i.type === "tool_output") as
      | { ownedBy?: string }
      | undefined;
    expect(innerMessage?.ownedBy).toBe(ownerId);
    expect(innerTool?.ownedBy).toBe(ownerId);
    // The closed container preserves its identifying fields (not blockName "agent").
    expect(container!.blockName).toBe("Task");
    expect(container!.label).toBe("Sub-agent: Task");
    expect(typeof container!.startedAt).toBe("number");
  });

  it("returns an errored handle and an error item (no throw) on error_max_turns", async () => {
    const messages: SdkMessageLike[] = [
      { type: "result", subtype: "error_max_turns", result: "too many turns", session_id: "sess_e" },
    ];
    const block = claudeCodeAgent({ resolveClaudeAgent: scriptedQuery(messages) });
    const { output, error, items } = await testBlock(block, { input: { prompt: "loop" } });

    expect(error).toBeNull();
    const handle = output as SdkAgentHandle;
    expect(handle.status).toBe("errored");
    expect(handle.resultSubtype).toBe("error_max_turns");
    expect(items.some((i) => i.type === "error")).toBe(true);
  });

  it("wraps a mid-stream SDK throw in ClaudeAgentRunError and rethrows", async () => {
    const resolveClaudeAgent: ResolveClaudeAgent = () => ({
      query: async function* () {
        yield { type: "system", subtype: "init" } as SdkMessageLike;
        throw new Error("stream exploded");
      },
    });
    const block = claudeCodeAgent({ resolveClaudeAgent });
    const { error, items } = await testBlock(block, { input: { prompt: "boom" } });

    expect(error?.cause).toBeInstanceOf(ClaudeAgentRunError);
    expect(items.some((i) => i.type === "error")).toBe(true);
  });

  it("throws a validation error before query on an empty prompt", async () => {
    const spy = vi.fn();
    const block = claudeCodeAgent({ resolveClaudeAgent: scriptedQuery([RESULT_OK], spy) });
    const { error } = await testBlock(block, { input: { prompt: "   " } });

    expect(error?.cause).toBeInstanceOf(ClaudeAgentRunError);
    expect(spy).not.toHaveBeenCalled();
  });

  it("marks a tool left open at stream end as incomplete", async () => {
    const messages: SdkMessageLike[] = [
      {
        type: "assistant",
        message: { content: [{ type: "tool_use", id: "toolu_open", name: "Bash", input: {} }] },
      },
      RESULT_OK,
    ];
    const block = claudeCodeAgent({ resolveClaudeAgent: scriptedQuery(messages) });
    const { items } = await testBlock(block, { input: { prompt: "leave it open" } });

    const tool = items.find((i) => i.type === "tool_output") as { status: string } | undefined;
    expect(tool?.status).toBe("incomplete");
  });

  it("the default resolver throws ClaudeAgentSdkNotInstalledError when the SDK import fails", async () => {
    // Simulate an absent peer dependency by injecting a rejecting importer —
    // the resolver must surface the typed error regardless of what's installed.
    const resolve = createDefaultResolveClaudeAgent(() =>
      Promise.reject(new Error("Cannot find package '@anthropic-ai/claude-agent-sdk'")),
    );
    const fakeCtx = {} as Parameters<typeof resolve>[0];
    await expect(resolve(fakeCtx)).rejects.toBeInstanceOf(ClaudeAgentSdkNotInstalledError);
  });

  it("nests a sub-agent's streamed (partials) inner text under its container via ownedBy", async () => {
    // With partials ON, sub-agent inner text arrives as stream_event deltas
    // carrying parent_tool_use_id — the streamed item must still nest, not float
    // up as a top-level peer.
    const messages: SdkMessageLike[] = [
      {
        type: "assistant",
        message: {
          content: [{ type: "tool_use", id: "toolu_task", name: "Task", input: { task: "sub" } }],
        },
      },
      {
        type: "stream_event",
        parent_tool_use_id: "toolu_task",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "sub streamed" } },
      },
      // Whole assistant message is the partials-ON close boundary for the stream.
      {
        type: "assistant",
        parent_tool_use_id: "toolu_task",
        message: { content: [{ type: "text", text: "sub streamed" }] },
      },
      {
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "toolu_task", content: "done" }] },
      },
      RESULT_OK,
    ];

    const block = claudeCodeAgent({
      resolveClaudeAgent: scriptedQuery(messages),
      includePartialMessages: true,
    });
    const { items } = await testBlock(block, { input: { prompt: "spawn" } });

    const container = items.find((i) => i.type === "container") as
      | { id: string; provenance: { blockInstanceId: string } }
      | undefined;
    expect(container).toBeDefined();
    const innerMessage = items.find((i) => i.type === "message") as { ownedBy?: string } | undefined;
    expect(innerMessage?.ownedBy).toBe(container!.provenance.blockInstanceId);
  });

  it("reports an errored handle for an unrecognized result subtype", async () => {
    const messages: SdkMessageLike[] = [
      {
        type: "result",
        subtype: "error_some_future_mode",
        errors: ["nope"],
        session_id: "s",
      } as SdkMessageLike,
    ];
    const block = claudeCodeAgent({ resolveClaudeAgent: scriptedQuery(messages) });
    const { output, error, items } = await testBlock(block, { input: { prompt: "x" } });

    expect(error).toBeNull();
    expect((output as SdkAgentHandle).status).toBe("errored");
    expect(items.some((i) => i.type === "error")).toBe(true);
  });

});

/**
 * `detached: true` — the mode that runs the block as detached background work.
 *
 * The task board refuses a detached worker whose block (or any block under it)
 * authors a `sessionStateSchema`, because every detached worker in a flow
 * becomes a route on one shared Workstream flow. A background job is one run in
 * one workstream, so the conversation state this block keeps — a resume handle
 * and a run log — has no reader on that path. Detaching stops it being
 * declared, stops the reads and writes that go with it, and stops the resume.
 *
 * The option is three-state — `true`, `false`, omitted — and omitted must keep
 * meaning the default. So each state is asserted EXPLICITLY below rather than
 * inferred from its neighbour, and both observable consequences are pinned for
 * each: whether the schema is declared, and whether the SDK is handed a
 * `resume`. A polarity slip reverses behaviour with no type error, since
 * `boolean | undefined` accepts either sense of the flag.
 */
describe("claudeCodeAgent — detached", () => {
  /** The read the board's refusal performs, spelled the same way. */
  function authoredSessionStateSchema(block: unknown): unknown {
    return (block as { config?: { sessionStateSchema?: unknown } }).config?.sessionStateSchema;
  }

  /**
   * Run the block against a provider that ALWAYS returns a saved session, and
   * report the `resume` the SDK was handed. `undefined` means the provider was
   * never consulted.
   *
   * The assertion is on the OPTIONS HANDED TO THE SDK, not on the schema:
   * suppressing the declaration and the `ctx.session` read while leaving the
   * provider resolution intact would resume a prior conversation with every
   * declared-schema assertion still passing. The shipped default provider
   * returns nothing for an empty key, which is exactly why that would hide.
   */
  async function resumeHandedToSdk(options: { detached?: boolean }): Promise<unknown> {
    const spy = vi.fn();
    const resumingProvider = {
      async resolve() {
        return { sdkSessionId: "sess_saved" };
      },
      async release() {},
    };
    const block = claudeCodeAgent({
      resolveClaudeAgent: scriptedQuery([RESULT_OK], spy),
      sessionProvider: resumingProvider,
      ...options,
    });
    await testBlock(block, {
      input: { prompt: "go" },
      session: { state: { [SDK_SESSION_ID_KEY]: "sess_prior" } },
    });
    return spy.mock.calls[0][0].options?.resume;
  }

  it("declares the conversation-state schema and resumes when the option is omitted", async () => {
    // BP-030. A caller who never heard of this option must be unaffected, and
    // this is the assertion that fails if the default ever flips.
    expect(authoredSessionStateSchema(claudeCodeAgent())).toBeDefined();
    expect(await resumeHandedToSdk({})).toBe("sess_saved");
  });

  it("declares the conversation-state schema and resumes when `detached: false`", async () => {
    // Spelled out rather than folded into the omitted case: `false` and
    // `undefined` are different values arriving at the same read site, and only
    // asserting both catches a read that collapses one into the other.
    expect(authoredSessionStateSchema(claudeCodeAgent({ detached: false }))).toBeDefined();
    expect(await resumeHandedToSdk({ detached: false })).toBe("sess_saved");
  });

  it("declares no schema and hands the SDK no `resume` when `detached: true`", async () => {
    // The board's refusal reads exactly this field, on the block and on every
    // block composed under it, before any context exists.
    expect(authoredSessionStateSchema(claudeCodeAgent({ detached: true }))).toBeUndefined();
    expect(await resumeHandedToSdk({ detached: true })).toBeUndefined();
  });

  it("writes no session state when `detached: true`", async () => {
    // Suppressing only the DECLARATION would leave the writes landing under a
    // key nothing declared — the silent-corruption shape the board's refusal
    // exists to prevent, not a smaller version of the same behaviour.
    const block = claudeCodeAgent({
      resolveClaudeAgent: scriptedQuery([RESULT_OK]),
      detached: true,
    });
    const { state, output, error } = await testBlock(block, { input: { prompt: "go" } });

    expect(error).toBeNull();
    expect(state.session[SDK_SESSION_ID_KEY]).toBeUndefined();
    expect(state.session[SDK_AGENT_RUNS_KEY]).toBeUndefined();
    // The run still happened and still reports what it observed — the handle is
    // the return value, which is a different thing from persisted state.
    expect((output as SdkAgentHandle).sessionId).toBe("sess_new");
  });

  it("writes session state when `detached: false`", async () => {
    // The contrast that makes the assertion above able to fail: the same run on
    // the in-session path DOES persist both keys.
    const block = claudeCodeAgent({
      resolveClaudeAgent: scriptedQuery([RESULT_OK]),
      detached: false,
    });
    const { state, error } = await testBlock(block, { input: { prompt: "go" } });

    expect(error).toBeNull();
    expect(state.session[SDK_SESSION_ID_KEY]).toBe("sess_new");
    expect(state.session[SDK_AGENT_RUNS_KEY]).toHaveLength(1);
  });
});

/**
 * `recordWork` — the option that turns "what the run did" into ordinary state.
 *
 * The artifact under test here is the CONTENT of two resource collections, not
 * the items or the scope state, so these tests need a handle on the resources
 * the run wrote through. See the note below on how they get one.
 *
 * **Why most of this block still drives `block.config.execute`.**
 *
 * The rule everywhere else is that a test dispatches a block the way consumers
 * do — `testBlock` — so a public-composition regression cannot pass while the
 * test stays green. These tests assert on the ROWS the recorder wrote, which
 * needs a handle on `ctx.resources` after the run, and for a long time
 * `TestBlockResult` had no such field: `createTestContext({ declaredResources })`
 * was the only way to hold the collections the assertions read.
 *
 * **That gap is now closed** — `testBlock` returns `resources`, and the
 * empty-cwd test below uses it. The remaining call sites here are pre-existing
 * and have not been moved yet, because several pin a namespace literal built
 * from `runNamespace(ctx)`, and the value legitimately changes when the
 * executor supplies `_blockIdentity` (see below). Moving them is a mechanical
 * follow-up, not a judgement call, and it should happen.
 *
 * **The cost of the old route, concretely**, since "couples to internals" reads
 * as style until you price it: `runNamespace` reads `ctx._blockIdentity`, which
 * only the executor sets. A hand-dispatched run therefore takes the `"0"`
 * fallback branch, so these tests pin a namespace shape production never
 * produces. That is the reason to move them, not tidiness.
 */
describe("claudeCodeAgent — recordWork", () => {
  /** A real run's shapes, trimmed to what the recorder consumes. */
  const RECORDING_SCRIPT: SdkMessageLike[] = [
    { type: "system", subtype: "init", session_id: "sess_new" },
    {
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "toolu_c",
            name: "TaskCreate",
            input: { subject: "Create the file", description: "…", activeForm: "Creating" },
          },
        ],
      },
    },
    {
      type: "user",
      tool_use_result: { task: { id: "5", subject: "Create the file" } },
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_c",
            content: "Task #5 created successfully: Create the file",
          },
        ],
      },
    },
    {
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "toolu_u",
            name: "TaskUpdate",
            input: { taskId: "5", status: "in_progress" },
          },
        ],
      },
    },
    {
      type: "user",
      tool_use_result: { success: true, taskId: "5" },
      message: {
        content: [{ type: "tool_result", tool_use_id: "toolu_u", content: "Updated task #5 status" }],
      },
    },
    {
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "toolu_w",
            name: "Write",
            input: { file_path: "/work/notes.txt", content: "HELLO" },
          },
        ],
      },
    },
    {
      type: "user",
      tool_use_result: { type: "create", filePath: "/work/notes.txt" },
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_w",
            content: "File created successfully at: /work/notes.txt",
          },
        ],
      },
    },
    RESULT_OK,
  ];

  /**
   * The same run, plus a plan create the harness never answers — so the run
   * ends with a row owed to all THREE collections (a file op, a plan item, and
   * a gap for the create that was lost).
   */
  const RECORDING_SCRIPT_WITH_GAP: SdkMessageLike[] = [
    ...RECORDING_SCRIPT.slice(0, -1),
    {
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "toolu_lost",
            name: "TaskCreate",
            input: { subject: "Draft the follow-up", description: "…", activeForm: "Drafting" },
          },
        ],
      },
    },
    // …and the stream ends without a result for it.
    RESULT_OK,
  ];

  it("is off by default and declares nothing", () => {
    const block = claudeCodeAgent({ resolveClaudeAgent: scriptedQuery([RESULT_OK]) });
    expect(block.declaredResources).toBeUndefined();
  });

  it("declares all three collections when on", () => {
    const block = claudeCodeAgent({
      resolveClaudeAgent: scriptedQuery([RESULT_OK]),
      recordWork: true,
    });
    expect(Object.keys(block.declaredResources ?? {}).sort()).toEqual([
      "observed-file-ops",
      "observed-gaps",
      "observed-plan",
    ]);
  });

  it("declares EVERY collection readable by clients, or the read route answers 403", () => {
    const block = claudeCodeAgent({
      resolveClaudeAgent: scriptedQuery([RESULT_OK]),
      recordWork: true,
    });
    for (const config of Object.values(block.declaredResources ?? {})) {
      expect((config as { client?: { state?: { read?: boolean } } }).client?.state?.read).toBe(true);
    }
  });

  it("declares every collection lazily prefetched", () => {
    // Rows are namespaced per run and a workstream is reused across runs, so an
    // eager collection would bulk-load every historical run's rows before this
    // run touched one of its own keys.
    const block = claudeCodeAgent({
      resolveClaudeAgent: scriptedQuery([RESULT_OK]),
      recordWork: true,
    });
    for (const config of Object.values(block.declaredResources ?? {})) {
      expect((config as { prefetchMode?: string }).prefetchMode).toBe("lazy");
    }
  });

  it("treats an empty resolved directory as unset, on BOTH halves", async () => {
    // The bug this pins: `""` is not nullish, so it survived into the SDK's
    // query options while the recorder read the same value as unset. Both
    // halves are asserted in one test, because a test on either alone is what
    // let it through — `canonicalFilePathKey(raw, "")` was already covered.
    const spy = vi.fn();
    const block = claudeCodeAgent({
      resolveClaudeAgent: scriptedQuery(RECORDING_SCRIPT, spy),
      recordWork: true,
      includePartialMessages: false,
      cwd: () => "",
    });
    // Dispatched through `testBlock`, not `block.config.execute`. That is not
    // housekeeping here: `runNamespace` reads `ctx._blockIdentity`, which only
    // the executor sets, so a hand-dispatched run takes the `"0"` fallback
    // branch and this test would have pinned a namespace production never
    // produces. `resources` gives the written rows without giving that up.
    const { error, resources } = await testBlock(block, { input: { prompt: "go" } });

    expect(error).toBeNull();

    // The SDK is handed nothing — not an explicit `""`, which is a different
    // call from forwarding no directory at all.
    expect(spy.mock.calls[0][0].options).not.toHaveProperty("cwd");

    // And the record is keyed against the process directory, unchanged: the
    // path the recorder saw, with no resolved-directory prefix in front of it.
    const fileOps = resources["observed-file-ops"] as {
      list(): Promise<Array<{ path: string }>>;
    };
    const fileRows = await fileOps.list();
    expect(fileRows).toHaveLength(1);
    expect(fileRows[0].path.endsWith("/work/notes.txt")).toBe(true);
  });

  it("records the run's file operations and plan into the two collections", async () => {
    const block = claudeCodeAgent({
      resolveClaudeAgent: scriptedQuery(RECORDING_SCRIPT),
      recordWork: true,
      includePartialMessages: false,
    });
    const runtime = await createTestContext({ declaredResources: block.declaredResources });
    await block.config.execute?.({ prompt: "go" }, runtime.ctx as never);

    const runId = runNamespace(runtime.ctx as never);
    const resources = runtime.ctx.resources as unknown as Record<
      string,
      { list(): Promise<Array<{ path: string; state: Record<string, unknown> }>> }
    >;

    const fileRows = await resources["observed-file-ops"].list();
    expect(fileRows.map((r) => r.path)).toEqual([
      `observed-file-ops/${runId}/work/notes.txt`,
    ]);
    expect(fileRows[0].state).toMatchObject({ lastKind: "created", outcome: "applied" });

    const planRows = await resources["observed-plan"].list();
    expect(planRows.map((r) => r.path)).toEqual([`observed-plan/${runId}/5`]);
    expect(planRows[0].state).toMatchObject({
      title: "Create the file",
      status: "in_progress",
      lastOutcome: "applied",
    });
  });

  it("records all three collections when the request id carries path syntax", async () => {
    // The request id is CALLER-SUPPLIED — `sendOptions.requestId` rides the
    // action request body through to `ctx.request.identity.id` — and it goes
    // into the namespace that keys all three collections. Raw, an id holding a
    // `..` segment is rejected by `normalizeResourcePath`, so every file key,
    // every plan key AND every gap key is unkeyable at once. The gap rows are
    // the fallback that exists to record "we lost something", so when they die
    // with the rest the run finishes CLEAN with three empty collections and
    // nothing anywhere saying anything was dropped.
    for (const requestId of ["release/../42", "tenant/a/run"]) {
      const block = claudeCodeAgent({
        resolveClaudeAgent: scriptedQuery(RECORDING_SCRIPT_WITH_GAP),
        recordWork: true,
        includePartialMessages: false,
      });
      const runtime = await createTestContext({
        requestId,
        declaredResources: block.declaredResources,
      });
      await block.config.execute?.({ prompt: "go" }, runtime.ctx as never);

      const runId = runNamespace(runtime.ctx as never);
      const resources = runtime.ctx.resources as unknown as Record<
        string,
        { list(): Promise<Array<{ path: string; state: Record<string, unknown> }>> }
      >;

      const fileRows = await resources["observed-file-ops"].list();
      expect(fileRows.map((r) => r.path)).toEqual([`observed-file-ops/${runId}/work/notes.txt`]);
      expect(fileRows[0].state).toMatchObject({ lastKind: "created", outcome: "applied" });

      const planRows = await resources["observed-plan"].list();
      expect(planRows.map((r) => r.path)).toEqual([`observed-plan/${runId}/5`]);

      // The gap row matters most: it is the record OF a loss, so if it shares
      // the doomed namespace there is nothing left to notice the failure by.
      const gapRows = await resources["observed-gaps"].list();
      expect(gapRows).toHaveLength(1);
      expect(String(gapRows[0].state.reason)).toContain("Draft the follow-up");
    }
  });

  it("keeps the request id to ONE key segment, whatever syntax it carries", () => {
    // The invariant, stated against the normalizer that actually rejects these
    // rather than against a copy of its rules: whatever a caller supplies, the
    // composed namespace has to be a usable key, and the id has to stay one
    // segment so the path segments after it belong to the file and nothing else.
    const ids = [
      "release/../42",
      "..",
      ".",
      "a\\b",
      `x${String.fromCharCode(7)}y`,
      "100%",
      "a/b/c",
    ];
    for (const id of ids) {
      const ns = runNamespace({ request: { identity: { id } } } as never);
      expect(() => normalizeResourcePath(`${ns}/work/notes.txt`)).not.toThrow();
      expect(ns.split("/")).toHaveLength(2);
    }
  });

  it("leaves an already-keyable request id byte for byte, bar one", () => {
    // Rows written before this change are still keyed by the raw id, so an id
    // the normalizer already accepted must key the same after it — otherwise
    // the fix orphans the very records it exists to protect. `.` and `...` are
    // in here because only `..` is rejected: escaping every run of dots would
    // move rows that were keyed fine.
    for (const id of ["plain-42", "a[1]", "x.y", ".", "...", "a-b_c", "req:1"]) {
      const ns = runNamespace({ request: { identity: { id } } } as never);
      expect(ns).toBe(`${id}/0#0`);
    }
    // The one exception, and it is forced: injectivity needs `%` escaped first,
    // or a literal `a%2Fb` could not be told from an encoded `a/b`. An id
    // carrying a `%` therefore moves, and that is a documented migration.
    expect(runNamespace({ request: { identity: { id: "a%b" } } } as never)).toBe("a%25b/0#0");
  });

  it("keeps apart two request ids a lossy sanitiser would collide", () => {
    // Stripping or replacing the offending characters would also be "safe", and
    // is the wrong fix: it maps distinct ids onto ONE namespace, trading a
    // silent empty recorder for silent CROSS-RUN MIXING — two runs' file rows
    // merging under one key. That is worse, because the result looks healthy.
    const ns = (id: string) => runNamespace({ request: { identity: { id } } } as never);
    const collidable = [
      ["a/b", "a%2Fb"],
      ["a/b", "a-b"],
      ["a/b", "ab"],
      ["a..b", "a.b"],
      ["..", "."],
      ["x/y", "x\\y"],
    ];
    for (const [left, right] of collidable) {
      expect(ns(left)).not.toBe(ns(right));
    }
    // And distinctness must survive the NORMALIZER, not just the encoder — it
    // is the normalized key that two runs would actually end up sharing.
    const ids = [...new Set(collidable.flat())];
    const keys = ids.map((id) => normalizeResourcePath(`${ns(id)}/work/notes.txt`));
    expect(new Set(keys).size).toBe(ids.length);
  });

  it("namespaces by INVOCATION, so two calls in one request do not merge", async () => {
    // A generator holding this agent as a tool can call it several times in one
    // request — the framework's tool executor disambiguates each call by
    // `stepNumber:toolCallId` precisely because that happens. Keying on the
    // request id alone would merge every such run: same paths overwritten, same
    // to-do ids merged, and gap ordinals (which restart at 1 per recorder)
    // clobbering each other outright.
    const requestId = "req_shared";
    const first = {
      request: { identity: { id: requestId } },
      _blockIdentity: { blockPath: "root/tool(claude-code-agent,0:call_a)" },
    };
    const second = {
      request: { identity: { id: requestId } },
      _blockIdentity: { blockPath: "root/tool(claude-code-agent,1:call_b)" },
    };

    expect(runNamespace(first as never)).not.toBe(runNamespace(second as never));
    // …and both still begin with the request id, so a reader can still ask
    // "everything this request did" with one prefix.
    for (const ns of [runNamespace(first as never), runNamespace(second as never)]) {
      expect(ns.startsWith(`${requestId}/`)).toBe(true);
    }
    // One invocation stays ONE key segment, so the path segments that follow it
    // are the file's and nothing else.
    expect(runNamespace(first as never).split("/")).toHaveLength(2);
  });

  it("falls back to a stable discriminator when there is no block identity", () => {
    // A context with no block identity has exactly one invocation by
    // construction, so a constant is honest — and must stay stable, or every
    // run would land in a different namespace.
    const ctx = { request: { identity: { id: "req_x" } } };
    expect(runNamespace(ctx as never)).toBe("req_x/0#0");
    expect(runNamespace(ctx as never)).toBe(runNamespace(ctx as never));
  });

  it("separates the ATTEMPTS of a retried block, which re-enter at one path", async () => {
    // `executeBlock`'s retry loop increments an attempt counter and rebuilds the
    // instance id from `(request, path, attempt)` while leaving the PATH
    // untouched — so a retried run re-enters at the same path, opens a second
    // recorder, and restarts its gap ordinals at 1. Keying on the path alone
    // used two thirds of the framework's own invocation identity, and the
    // earlier attempt's rows lost to the later one.
    const atPath = (attempt: number) =>
      runNamespace({
        request: { identity: { id: "req_retry" } },
        _blockIdentity: { blockPath: "root/tool(claude-code-agent,0:call_a)", attempt },
      } as never);

    expect(atPath(0)).not.toBe(atPath(1));
    // Both still begin with the request id, so one prefix still reads
    // everything that request did — retries included.
    for (const ns of [atPath(0), atPath(1)]) {
      expect(ns.startsWith("req_retry/")).toBe(true);
      expect(ns.split("/")).toHaveLength(2);
    }
  });

  it("records an interrupted plan create as a gap rather than losing it", async () => {
    // The plan side's version of the pending file row. A create has no id until
    // the harness answers, so an interrupt leaves nothing to key a row under —
    // and without this an interrupted plan attempt is indistinguishable from a
    // run that never planned.
    const interrupted: SdkMessageLike[] = [
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "toolu_c",
              name: "TaskCreate",
              input: { subject: "Create the file", description: "…", activeForm: "Creating" },
            },
          ],
        },
      },
      // …and the stream ends. No result ever arrives.
      RESULT_OK,
    ];
    const block = claudeCodeAgent({
      resolveClaudeAgent: scriptedQuery(interrupted),
      recordWork: true,
      includePartialMessages: false,
    });
    const runtime = await createTestContext({ declaredResources: block.declaredResources });
    await block.config.execute?.({ prompt: "go" }, runtime.ctx as never);

    const resources = runtime.ctx.resources as unknown as Record<
      string,
      { list(): Promise<Array<{ path: string; state: Record<string, unknown> }>> }
    >;
    expect(await resources["observed-plan"].list()).toHaveLength(0);
    const gapRows = await resources["observed-gaps"].list();
    expect(gapRows).toHaveLength(1);
    // The wording is carried through, so the gap says WHICH item was lost.
    expect(String(gapRows[0].state.reason)).toContain("Create the file");
  });

  it("delivers a whole translated message to the recorder even if emission throws", async () => {
    // Translation consumes a message and clears its correlation maps for every
    // call in it, so the events are then the only record of what those calls
    // did. Delivering them one at a time, interleaved with the emission await,
    // made every event after the first conditional on item persistence
    // succeeding — one rejection and a settled `TaskCreate` vanished from
    // `observed-plan` AND `observed-gaps`, because the end-of-run drain finds
    // no open create either.
    //
    // The script puts a settled create SECOND in one message, and emission of
    // the first event rejects.
    const batched: SdkMessageLike[] = [
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "toolu_c",
              name: "TaskCreate",
              input: { subject: "Create the file", description: "…", activeForm: "Creating" },
            },
          ],
        },
      },
      {
        type: "user",
        tool_use_result: { task: { id: "5", subject: "Create the file" } },
        message: {
          content: [
            { type: "tool_result", tool_use_id: "toolu_c", content: "Task #5 created" },
          ],
        },
      },
      RESULT_OK,
    ];
    const block = claudeCodeAgent({
      resolveClaudeAgent: scriptedQuery(batched),
      recordWork: true,
      includePartialMessages: false,
    });
    const runtime = await createTestContext({ declaredResources: block.declaredResources });

    const realEmit = runtime.ctx.response.emit.bind(runtime.ctx.response);
    (runtime.ctx.response as { emit: unknown }).emit = async (event: {
      type?: string;
      item?: { type?: string };
    }) => {
      // Reject on the tool_output the settling message emits FIRST, so the
      // plan event behind it in the same batch would be stranded.
      if (event?.type === "item.done" && event.item?.type === "tool_output") {
        throw new Error("the request record rejected the tool item");
      }
      return realEmit(event as never);
    };

    await expect(
      block.config.execute?.({ prompt: "go" }, runtime.ctx as never),
    ).rejects.toThrow();

    const resources = runtime.ctx.resources as unknown as Record<
      string,
      { list(): Promise<Array<{ path: string; state: Record<string, unknown> }>> }
    >;
    // The create is in the record. Without batch-first delivery it is in
    // neither collection.
    const planRows = await resources["observed-plan"].list();
    expect(planRows).toHaveLength(1);
    expect(planRows[0].state).toMatchObject({ title: "Create the file" });
  });

  it("marks inputs revisable exactly when an approval seam is installed", async () => {
    // The translation layer's `inputsMayBeRevised` is only as good as the wire
    // that sets it, and the flag is invisible from outside — so the WIRING gets
    // its own guard, at the level where the option lives.
    const rewording: SdkMessageLike[] = [
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "toolu_u",
              name: "TaskUpdate",
              input: { taskId: "5", subject: "What the run asked for" },
            },
          ],
        },
      },
      {
        type: "user",
        tool_use_result: { success: true, taskId: "5", updatedFields: ["subject"] },
        message: {
          content: [{ type: "tool_result", tool_use_id: "toolu_u", content: "Updated task #5" }],
        },
      },
      RESULT_OK,
    ];
    const gapsFor = async (options: Partial<Parameters<typeof claudeCodeAgent>[0]>) => {
      const block = claudeCodeAgent({
        resolveClaudeAgent: scriptedQuery(rewording),
        recordWork: true,
        includePartialMessages: false,
        ...options,
      });
      const runtime = await createTestContext({ declaredResources: block.declaredResources });
      await block.config.execute?.({ prompt: "go" }, runtime.ctx as never);
      const resources = runtime.ctx.resources as unknown as Record<
        string,
        { list(): Promise<Array<{ path: string; state: Record<string, unknown> }>> }
      >;
      return resources["observed-gaps"].list();
    };

    // With the seam, the executed input may differ from the call we saw.
    expect(await gapsFor({ onToolApproval: async () => ({ decision: "allow" }) })).toHaveLength(1);
    // Without it, the call-time value IS what ran.
    expect(await gapsFor({})).toHaveLength(0);
  });

  it("still shuts the recorder down when item finalization throws", async () => {
    // The third variation on one theme: the durability machinery is fine and
    // something UPSTREAM of it stops it running. Shutdown is in a `finally` for
    // exactly this reason — if it were another statement on the happy path,
    // every step added before it would be a new way to skip it.
    //
    // A response emitter that rejects on the finalizing `item.done` reproduces
    // it: the run fails, and the file the run already wrote must still be in the
    // record.
    // A settled Write (so there is something to record), then a tool call whose
    // result never arrives — so stream end leaves an open tool and
    // `finalizeOpenItems` has an `incomplete` item to persist.
    const openAtEnd: SdkMessageLike[] = [
      ...RECORDING_SCRIPT.slice(0, -1),
      {
        type: "assistant",
        message: {
          content: [{ type: "tool_use", id: "toolu_never", name: "Read", input: { path: "a" } }],
        },
      },
      RESULT_OK,
    ];
    const block = claudeCodeAgent({
      resolveClaudeAgent: scriptedQuery(openAtEnd),
      recordWork: true,
      includePartialMessages: false,
    });
    const runtime = await createTestContext({ declaredResources: block.declaredResources });

    const realEmit = runtime.ctx.response.emit.bind(runtime.ctx.response);
    (runtime.ctx.response as { emit: unknown }).emit = async (event: {
      type?: string;
      item?: { status?: string };
    }) => {
      if (event?.type === "item.done" && event.item?.status === "incomplete") {
        throw new Error("the request record rejected the incomplete item");
      }
      return realEmit(event as never);
    };

    await expect(
      block.config.execute?.({ prompt: "go" }, runtime.ctx as never),
    ).rejects.toThrow("the request record rejected the incomplete item");

    const resources = runtime.ctx.resources as unknown as Record<
      string,
      { list(): Promise<Array<{ path: string; state: Record<string, unknown> }>> }
    >;
    // The record survived the failure. Without the `finally` this is empty.
    expect((await resources["observed-file-ops"].list()).length).toBeGreaterThan(0);
  });

  it("leaves ONE row for one write, even when the harness resolves a different path", async () => {
    // The defect this pins is only visible where translate and the recorder
    // compose: the attempt is keyed at call time and the settlement arrived
    // under the resolved path, so a single write produced a permanent `pending`
    // row beside an `applied` one.
    const divergent: SdkMessageLike[] = [
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "toolu_w",
              name: "Write",
              input: { file_path: "/work/notes.txt", content: "HELLO" },
            },
          ],
        },
      },
      {
        type: "user",
        tool_use_result: { type: "create", filePath: "/work/elsewhere/notes.txt" },
        message: {
          content: [{ type: "tool_result", tool_use_id: "toolu_w", content: "ok" }],
        },
      },
      RESULT_OK,
    ];
    const block = claudeCodeAgent({
      resolveClaudeAgent: scriptedQuery(divergent),
      recordWork: true,
      includePartialMessages: false,
    });
    const runtime = await createTestContext({ declaredResources: block.declaredResources });
    await block.config.execute?.({ prompt: "go" }, runtime.ctx as never);

    const resources = runtime.ctx.resources as unknown as Record<
      string,
      { list(): Promise<Array<{ path: string; state: Record<string, unknown> }>> }
    >;
    const fileRows = await resources["observed-file-ops"].list();
    expect(fileRows).toHaveLength(1);
    // Unsettled, not applied: the harness reported writing somewhere else, so
    // there is nothing confirming a write at the path this row is keyed by.
    expect(fileRows[0].state).toMatchObject({ outcome: "pending" });
    // …and the divergence is visible rather than swallowed.
    const gapRows = await resources["observed-gaps"].list();
    expect(gapRows).toHaveLength(1);
  });

  it("writes nothing when the option is off, on the same script", async () => {
    // The contrast that makes the assertion above able to fail. Declaring the
    // resources here would be the only way to read them back, and the point is
    // that the OFF block declares none — so the absence is asserted on the
    // declaration, and the run is asserted to complete unchanged.
    const block = claudeCodeAgent({
      resolveClaudeAgent: scriptedQuery(RECORDING_SCRIPT),
      includePartialMessages: false,
    });
    const { output, error } = await testBlock(block, { input: { prompt: "go" } });
    expect(error).toBeNull();
    expect((output as SdkAgentHandle).status).toBe("completed");
    expect(block.declaredResources).toBeUndefined();
  });

  it("keeps running, with a visible note, when the collections are not registered", async () => {
    // Watching the work must never break the work: a flow that reaches this
    // block without the refs registered gets an unrecorded run and a status
    // item, not a killed coding run.
    const block = claudeCodeAgent({
      resolveClaudeAgent: scriptedQuery(RECORDING_SCRIPT),
      recordWork: true,
      includePartialMessages: false,
    });
    // Deliberately NOT passing `declaredResources`, so `ctx.resources` is empty.
    const runtime = await createTestContext({});
    const handle = await block.config.execute?.({ prompt: "go" }, runtime.ctx as never);

    expect((handle as SdkAgentHandle).status).toBe("completed");
    const notes = runtime
      .getItems()
      .filter((i) => i.type === "status")
      .map((i) => (i as { message?: string }).message ?? "")
      .join(" ");
    expect(notes).toContain("not recording this run's work");
  });
});

/**
 * The `cwd` snippet from the docs, actually executed.
 *
 * The three prose copies — the option's JSDoc, the package README and the SDK
 * agent guide — shipped an invented `currentRun(ctx)` helper that exists nowhere
 * in the repo, so the first thing a reader would do with a brand-new option was
 * paste code that dies on an undefined symbol.
 *
 * Nothing here compiles fenced code blocks, and this package's `tsconfig`
 * includes only `src/**` — so a type-level guard under `test/` would never have
 * run. This is a runtime one instead: the snippet is reproduced verbatim and
 * driven through the block, so an unresolvable symbol is a hard failure and a
 * resolver whose shape stopped matching the option is a red test.
 *
 * **Keep this a copy-paste match for the three prose copies.** If it needs an
 * edit to pass, they need the same edit.
 */
describe("claudeCodeAgent — the documented cwd examples", () => {
  // ── the "reusing a directory across runs" helper, verbatim ─────────────────
  const CHECKOUT_ROOT = "/var/agent-checkouts";

  function segment(value: string | undefined): string {
    return value === undefined
      ? "0"
      : `1${createHash("sha256").update(Buffer.from(value, "utf16le")).digest("hex")}`;
  }

  function checkoutFor(tenantId: string | undefined, key: string): string {
    const dir = join(CHECKOUT_ROOT, segment(tenantId), segment(key));
    const rel = relative(CHECKOUT_ROOT, dir);
    if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error(`refusing a checkout outside ${CHECKOUT_ROOT}`);
    }
    return dir;
  }
  // ── end snippet ────────────────────────────────────────────────────────────

  /**
   * **These assert PROPERTIES, not a grammar**, and that is the point of the
   * change they cover.
   *
   * Four security findings landed on the validating version of this example —
   * traversal, Windows containment, tenant collision, Windows-aliased segments —
   * because a grammar is a list of things to remember and each round found the
   * next item on it. Encoding removes the list. So the tests name what must be
   * true of any encoding rather than what this one happens to emit: a
   * grammar-shaped test would have had to grow an arm per finding too.
   */
  const HOSTILE = [
    "../../server-repo",
    "../../../etc",
    "a/b",
    "",
    ".",
    "..",
    "CON",
    "PRN",
    "NUL",
    "COM1",
    "acme.",
    "acme..",
    "Acme",
    "\\\\server\\share",
    // Lone surrogates and the replacement character. A JS string is a sequence
    // of UTF-16 code units, and these are legal strings JSON will carry — but
    // they are not valid Unicode, so any UTF-8 encoder maps all three onto the
    // replacement character's bytes and collapses them into one segment.
    "\ud800",
    "\ud801",
    "\udfff",
    "�",
    // A well-formed surrogate PAIR must survive too — the fix must not buy
    // injectivity by mangling ordinary astral characters.
    "😀",
  ];

  it("runs the throwaway-directory example the docs lead with", async () => {
    const spy = vi.fn();
    // The root deliberately does NOT exist — it is a path inside a fresh temp
    // directory, not a directory. `mkdtemp` creates only the unique leaf and
    // returns ENOENT when the parent is missing, so the example has to create
    // the root itself. A test that pre-created the root would pass against an
    // example that never provisions anything, which is exactly what let this
    // through: the reusable example gained recursive `mkdir` and the throwaway
    // one beside it did not.
    const root = join(mkdtempSync(join(tmpdir(), "cwd-docs-")), "agent-checkouts");
    expect(existsSync(root)).toBe(false);

    const agent = claudeCodeAgent({
      cwd: async () => {
        await mkdirAsync(root, { recursive: true });
        return mkdtemp(join(root, "run-"));
      },
      // Part of the documented example, not a test detail — see below.
      detached: true,
      resolveClaudeAgent: scriptedQuery([RESULT_OK], spy),
    });

    const { error } = await testBlock(agent, { input: { prompt: "go" } });

    expect(error).toBeNull();
    expect(spy.mock.calls[0][0].options?.cwd).toMatch(/\/run-[^/]+$/);
    rmSync(root, { recursive: true, force: true });
  });

  it("does not resume a prior conversation into a fresh throwaway directory", async () => {
    // Why `detached: true` is in the example above rather than beside it. By
    // default the agent persists `sdkSessionId` and hands it back as the SDK's
    // `resume` on the next run in the same session. Pair that with a per-run
    // directory and run two resumes a conversation created in a tree that no
    // longer exists — the agent picks up mid-task in an empty checkout.
    // The prior run's handle is SEEDED rather than produced by a first call:
    // two `testBlock` calls each build their own context, so state never
    // carries between them and a two-call version of this test passes whether
    // or not `detached` is set — it cannot fail, so it proves nothing.
    const spy = vi.fn();
    const root = mkdtempSync(join(tmpdir(), "cwd-resume-"));
    const throwaway = {
      cwd: () => mkdtempSync(join(root, "run-")),
      resolveClaudeAgent: scriptedQuery([RESULT_OK], spy),
    };

    // Without `detached`, the seeded handle is forwarded — the run is pointed
    // at a brand-new empty directory AND told to continue a conversation that
    // belongs to a different one.
    await testBlock(claudeCodeAgent(throwaway), {
      input: { prompt: "go" },
      session: { state: { [SDK_SESSION_ID_KEY]: "sess_prior" } },
    });
    expect(spy.mock.calls[0][0].options?.resume).toBe("sess_prior");

    // With it, the session provider is not consulted at all, so a fresh
    // directory always gets a fresh conversation.
    spy.mockClear();
    await testBlock(claudeCodeAgent({ ...throwaway, detached: true }), {
      input: { prompt: "go" },
      session: { state: { [SDK_SESSION_ID_KEY]: "sess_prior" } },
    });
    expect(spy.mock.calls[0][0].options).not.toHaveProperty("resume");

    rmSync(root, { recursive: true, force: true });
  });

  it("reaches a run through the documented derivation", async () => {
    const spy = vi.fn();
    const agent = claudeCodeAgent({
      // Verbatim from the docs: both halves of the identity, each encoded.
      cwd: (_input, ctx) =>
        checkoutFor(ctx.session.identity.tenantId, ctx.session.identity.id),
      resolveClaudeAgent: scriptedQuery([RESULT_OK], spy),
    });

    // `testBlock` pins the session to "test-session" and sets no tenant, so the
    // expectation is a LITERAL — an expectation derived from the implementation
    // agrees with it whatever it does. `0` is the absent-tenant tag; the rest
    // is UTF-16 code units, two bytes each.
    const { error } = await testBlock(agent, { input: { prompt: "go" } });

    expect(error).toBeNull();
    expect(spy.mock.calls[0][0].options?.cwd).toBe(
      "/var/agent-checkouts/0/1c3e80e8d697513453697d7259472182ea9629168cc6bdffb1dd4d658c60c665d",
    );
  });

  it("provisions the directory before the SDK is handed it", async () => {
    // The derivation above is pure, so nothing in it creates the checkout —
    // and the SDK spawns a process into that path, which fails ENOENT if it is
    // not there. The documented resolver therefore mkdirs before returning;
    // this pins that the directory EXISTS at the moment the SDK sees it,
    // rather than that mkdir was called.
    const root = mkdtempSync(join(tmpdir(), "cwd-provision-"));
    const seen: { cwd?: string; existed?: boolean } = {};
    const agent = claudeCodeAgent({
      cwd: async (_input, ctx) => {
        const dir = join(root, segment(ctx.session.identity.tenantId), segment(ctx.session.identity.id));
        await mkdirAsync(dir, { recursive: true });
        return dir;
      },
      resolveClaudeAgent: scriptedQuery([RESULT_OK], (call) => {
        seen.cwd = call.options?.cwd;
        seen.existed = existsSync(call.options?.cwd ?? "");
      }),
    });

    const { error } = await testBlock(agent, { input: { prompt: "go" } });

    expect(error).toBeNull();
    expect(seen.existed).toBe(true);

    // `recursive` is what makes REUSE work rather than throwing on the second
    // run — the whole point of a stable checkout.
    await expect(mkdirAsync(seen.cwd!, { recursive: true })).resolves.not.toThrow();
    rmSync(root, { recursive: true, force: true });
  });

  it("keeps an absent tenant apart from one named like the old fallback", () => {
    // The example used to fill an absent tenant in with `?? "default"`. A
    // stand-in is a value a tenant may legitimately hold, so an un-tenanted
    // host and that tenant landed in one directory and could edit each other's
    // tree. Presence is tagged now, so no present value can forge absence.
    expect(checkoutFor(undefined, "s")).not.toBe(checkoutFor("default", "s"));

    // The general property, not just the one value that happened to be chosen:
    // nothing a tenant can be named collides with absence.
    for (const value of [...HOSTILE, "default", "0", "1", "none", "null"]) {
      expect(checkoutFor(value, "s")).not.toBe(checkoutFor(undefined, "s"));
    }
  });

  it("gives every component a segment `join` will keep", () => {
    // Hex of "" is "", and `join` discards an empty segment — so an empty id
    // silently shortened the path by a level, landing the run in the tenant's
    // own directory and merging distinct tuples. Every encoded component is
    // non-empty by construction now.
    expect(segment("")).not.toBe("");
    expect(segment(undefined)).not.toBe("");

    // The consequence that made it worth fixing: an empty half no longer
    // collapses the tuple onto a shorter path.
    expect(checkoutFor("", "x")).not.toBe(checkoutFor("x", ""));
    expect(checkoutFor("", "x").split("/")).toHaveLength(
      checkoutFor("a", "x").split("/").length,
    );
  });

  it("stays inside the root for every hostile value", () => {
    // Traversal, absolute paths, UNC prefixes, empty and dot-only values. The
    // encoded form cannot express any of them, so this holds by construction
    // rather than by a rule that has to anticipate each one.
    for (const hostile of HOSTILE) {
      const dir = checkoutFor(undefined, hostile);
      expect(relative(CHECKOUT_ROOT, dir).startsWith("..")).toBe(false);
      expect(checkoutFor(hostile, "run-1").startsWith(`${CHECKOUT_ROOT}/`)).toBe(true);
    }
  });

  it("is injective — no two distinct values share a directory", () => {
    // The property "reject, don't strip" was protecting. Injectivity gives it
    // outright: two runs can never share a checkout by accident.
    //
    // Asserted as a PROPERTY over the corpus rather than as the cases named so
    // far, because that is the difference this test exists to hold. Three
    // rounds of findings each closed the instance in front of them — a
    // separator, a Windows alias, an absent tenant — and the next instance kept
    // arriving. The corpus carries lone surrogates now; the assertion is
    // unchanged, which is the point.
    const values = [...HOSTILE, "alice", "bob", "tenant", "tenant.", "a", "a."];
    const dirs = values.map((v) => checkoutFor(undefined, v));
    expect(new Set(dirs).size).toBe(values.length);

    // The same property on the tenant half, and across the pair — a tuple is
    // what actually addresses a checkout.
    const pairs = values.flatMap((t) => values.map((k) => checkoutFor(t, k)));
    expect(new Set(pairs).size).toBe(values.length * values.length);
  });

  it("survives what UTF-8 cannot represent", () => {
    // The finding that ended the hex-of-UTF-8 encoder. `Buffer.from` with utf8
    // substitutes the replacement character for a lone surrogate, so these four
    // distinct strings encoded identically — and a session id arrives as JSON,
    // which carries all four happily. Three sessions, one working tree.
    const indistinguishableUnderUtf8 = ["\ud800", "\ud801", "\udfff", "�"];
    const utf8 = indistinguishableUnderUtf8.map((v) =>
      Buffer.from(v, "utf8").toString("hex"),
    );
    expect(new Set(utf8).size).toBe(1); // the bug, pinned

    const encoded = indistinguishableUnderUtf8.map((v) => segment(v));
    expect(new Set(encoded).size).toBe(indistinguishableUnderUtf8.length);

    // Hashing the string directly reintroduces the same collapse — the digest
    // is not what fixes this, feeding it code units is. Pinned so a later
    // simplification to `.update(value)` fails here rather than in production.
    const hashedAsUtf8 = indistinguishableUnderUtf8.map((v) =>
      createHash("sha256").update(v, "utf8").digest("hex"),
    );
    expect(new Set(hashedAsUtf8).size).toBe(1);

    // An ordinary astral character stays distinct from its own code units read
    // separately, so distinctness was not bought by mangling valid input.
    expect(segment("😀")).not.toBe(segment("\ud83d"));
    expect(segment("😀")).not.toBe(segment("\ude00"));
  });

  it("bounds every segment, whatever the id's length", () => {
    // A filename stops at 255 characters. The previous encoder was reversible
    // and therefore grew with its input — hex of UTF-16 runs to four characters
    // per code unit, so a 64-character session id produced a 257-character
    // component and `mkdir` failed ENAMETOOLONG. Ids that long are ordinary and
    // no retry can shorten one.
    const reversible = (v: string) => `1${Buffer.from(v, "utf16le").toString("hex")}`;
    expect(reversible("a".repeat(64)).length).toBeGreaterThan(255); // the bug, pinned

    // Fixed width now: `1` plus a 64-character digest, for any input at all.
    for (const value of [...HOSTILE, "a".repeat(64), "b".repeat(10_000)]) {
      expect(segment(value)).toHaveLength(65);
    }
    expect(segment(undefined)).toHaveLength(1);

    // The property that actually matters — a full path stays under the limit
    // no matter how long either half of the identity is.
    const long = "x".repeat(10_000);
    for (const part of checkoutFor(long, long).split("/")) {
      expect(part.length).toBeLessThanOrEqual(255);
    }
  });

  it("keeps two tenants sharing one session id apart", () => {
    // The framework namespaces its own session storage by tenant precisely
    // because two tenants can hold the same session id, while exposing the bare
    // id. A path built from the session alone puts both in one directory.
    expect(checkoutFor("tenant-a", "sess_1")).not.toBe(checkoutFor("tenant-b", "sess_1"));
  });

  it("does not let a tenant and a key run together into one path", () => {
    // `a` + `b/c` and `a/b` + `c` must not collapse onto one directory.
    expect(checkoutFor("a", "b/c")).not.toBe(checkoutFor("a/b", "c"));
  });

  it("emits segments Windows keeps distinct and can actually create", () => {
    // The finding that ended the grammar. Win32 strips trailing dots, so `acme`
    // and `acme.` are ONE directory; and `CON`/`PRN`/`NUL`/`COM1` are reserved
    // device names that cannot be directories at all. Both passed the old
    // grammar. The encoded alphabet contains no dot and no letter outside
    // [0-9a-f], so neither is expressible.
    const RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
    for (const value of HOSTILE) {
      const seg = segment(value);
      expect(seg.endsWith(".")).toBe(false);
      expect(RESERVED.test(seg)).toBe(false);
      expect(seg).toMatch(/^[0-9a-f]*$/);
    }
    // And the two that aliased are distinct, under Win32 semantics specifically.
    expect(win32.join("C:\\root", segment("acme"))).not.toBe(
      win32.join("C:\\root", segment("acme.")),
    );
  });

  it("accepts a valid derivation under Windows path semantics too", () => {
    // The containment check is separator-independent: `join` uses the platform
    // separator, so a literal "/" comparison rejected every valid value on
    // Windows — a guard failing closed on the happy path.
    const winContains = (id: string): boolean => {
      const dir = win32.join(CHECKOUT_ROOT, segment(undefined), segment(id));
      const rel = win32.relative(CHECKOUT_ROOT, dir);
      return !(rel === "" || rel.startsWith("..") || win32.isAbsolute(rel));
    };

    expect(winContains("sess_normal_123")).toBe(true);
    expect(winContains("../../server-repo")).toBe(true);
  });

  it("hands cwd and sandbox the same resolved input", async () => {
    // They used to differ: `cwd` got the raw block input while `sandbox` got a
    // freshly built `{ prompt }`. With `pickPrompt` or a padded prompt those
    // are different strings, so a caller deriving coordinated paths from them
    // got a sandbox confining a directory the run was never given.
    const seen: Array<Record<string, unknown>> = [];
    const block = claudeCodeAgent({
      resolveClaudeAgent: () => ({
        query: async function* () {
          yield RESULT_OK;
        },
      }),
      prompt: (input: { prompt: string }) => `picked:${input.prompt}`,
      cwd: (input) => {
        seen.push({ ...input });
        return "/tmp/agent-cwd";
      },
      sandbox: (input) => {
        seen.push({ ...input });
        return { enabled: true };
      },
    } as never);

    await testBlock(block as never, { input: { prompt: "  raw  " } });

    expect(seen).toHaveLength(2);
    expect(seen[0]).toEqual(seen[1]);
    // And the prompt they see is the one the run actually runs: picked, then
    // trimmed, exactly as it reaches the SDK.
    expect(seen[0]!.prompt).toBe("picked:  raw");
  });

});
