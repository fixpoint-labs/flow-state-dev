import { describe, it, expect, vi } from "vitest";
import { testBlock } from "@flow-state-dev/testing";
import {
  claudeCodeAgent,
  forwardSignalToController,
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
    // trail must replay, and emitStatus's same-string dedupe must not swallow
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
