/**
 * Framework-owned generator step loop (FIX-814 PR2).
 *
 * When the resolved model implements `generateStep` (non-streaming) /
 * `streamStep` (streaming), the generator drives the multi-step tool loop
 * itself: one model call per step, framework tools executed by FSD between
 * steps, inter-step messages built from the shared llm-messages module.
 * Models without the step methods keep the SDK-driven legacy path.
 *
 * All mocks here are hand-rolled STEP-CAPABLE models — the existing suites
 * (generate/stream-only mocks) pin the legacy path.
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { generator, handler, providerTool, SuspensionError } from "../src";
import { createFallbackModel } from "../src/models/fallbackModel";
import type {
  GeneratorModel,
  GeneratorModelCallOptions,
  GeneratorModelResult,
  GeneratorModelStreamChunk,
} from "../src/types/model";
import { createMockContext, runForTest } from "./helpers";

type StepScript = Array<
  (options: GeneratorModelCallOptions) => GeneratorModelResult
>;

/** Step-capable mock: consumes one script entry per generateStep call. */
function stepModel(script: StepScript, modelId = "step-model") {
  const seen: GeneratorModelCallOptions[] = [];
  const model: GeneratorModel = {
    modelId,
    async generate() {
      throw new Error("legacy generate must not be called on a step-capable model");
    },
    async generateStep(options) {
      seen.push(options);
      const entry = script[seen.length - 1];
      if (entry === undefined) {
        throw new Error(`no script entry for step ${seen.length - 1}`);
      }
      return entry(options);
    },
  };
  return { model, seen };
}

function assistantMessages(messages: unknown[]): Array<Record<string, unknown>> {
  return (messages as Array<Record<string, unknown>>).filter(
    (m) => m.role === "assistant"
  );
}

function toolMessages(messages: unknown[]): Array<Record<string, unknown>> {
  return (messages as Array<Record<string, unknown>>).filter(
    (m) => m.role === "tool"
  );
}

describe("generator owned step loop — non-streaming", () => {
  it("makes exactly one generateStep call per step and completes with text", async () => {
    const toolRuns: unknown[] = [];
    const adder = handler({
      name: "adder",
      inputSchema: z.object({ a: z.number() }),
      outputSchema: z.object({ sum: z.number() }),
      execute: (input) => {
        toolRuns.push(input);
        return { sum: input.a + 1 };
      },
    });

    const { model, seen } = stepModel([
      () => ({
        toolCalls: [{ toolCallId: "c1", toolName: "adder", args: { a: 1 } }],
        finishReason: "tool-calls",
      }),
      () => ({
        toolCalls: [{ toolCallId: "c2", toolName: "adder", args: { a: 2 } }],
        finishReason: "tool-calls",
      }),
      () => ({ text: "done", finishReason: "stop" }),
    ]);

    const block = generator({
      name: "loop-gen",
      model,
      prompt: "p",
      tools: [adder],
    });

    await expect(runForTest(block, { q: 1 }, createMockContext())).resolves.toBe("done");
    expect(seen.length).toBe(3);
    expect(toolRuns).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("builds ONE assistant message containing all of a multi-tool step's calls", async () => {
    const echo = handler({
      name: "echo",
      inputSchema: z.object({ v: z.string() }),
      outputSchema: z.object({ v: z.string() }),
      execute: (input) => ({ v: input.v }),
    });

    const { model, seen } = stepModel([
      () => ({
        toolCalls: [
          { toolCallId: "t1", toolName: "echo", args: { v: "one" } },
          { toolCallId: "t2", toolName: "echo", args: { v: "two" } },
        ],
        finishReason: "tool-calls",
      }),
      () => ({ text: "ok", finishReason: "stop" }),
    ]);

    const block = generator({
      name: "parallel-gen",
      model,
      prompt: "p",
      tools: [echo],
    });

    await expect(runForTest(block, {}, createMockContext())).resolves.toBe("ok");

    // The second step's request must carry ONE assistant message with BOTH
    // tool-call parts, followed by one tool-result message per call in order.
    const step2 = seen[1]!.messages;
    const withToolCalls = assistantMessages(step2).filter(
      (m) =>
        Array.isArray(m.content) &&
        (m.content as Array<{ type: string }>).some((p) => p.type === "tool-call")
    );
    expect(withToolCalls.length).toBe(1);
    const parts = withToolCalls[0]!.content as Array<Record<string, unknown>>;
    expect(parts.map((p) => p.type)).toEqual(["tool-call", "tool-call"]);
    expect(parts.map((p) => p.toolCallId)).toEqual(["t1", "t2"]);

    const results = toolMessages(step2);
    expect(results.length).toBe(2);
    const resultParts = results.map(
      (m) => (m.content as Array<Record<string, unknown>>)[0]!
    );
    expect(resultParts.map((p) => p.toolCallId)).toEqual(["t1", "t2"]);
    expect(resultParts.map((p) => p.output)).toEqual([
      { type: "json", value: { v: "one" } },
      { type: "json", value: { v: "two" } },
    ]);
  });

  it("disambiguates colliding tool names across steps via unique aliases", async () => {
    const executed: string[] = [];
    const dotTool = handler({
      name: "foo.bar",
      inputSchema: z.object({}),
      outputSchema: z.object({ from: z.string() }),
      execute: () => {
        executed.push("foo.bar");
        return { from: "dot" };
      },
    });
    const slashTool = handler({
      name: "foo/bar",
      inputSchema: z.object({}),
      outputSchema: z.object({ from: z.string() }),
      execute: () => {
        executed.push("foo/bar");
        return { from: "slash" };
      },
    });

    const { model, seen } = stepModel([
      (options) => {
        // The tool dictionary passed to the model must carry the DEDUPED
        // aliases, not two entries that sanitize to the same name.
        expect(options.tools!.map((t) => t.name)).toEqual(["foo_bar", "foo_bar_2"]);
        return {
          toolCalls: [{ toolCallId: "c1", toolName: "foo_bar_2", args: {} }],
          finishReason: "tool-calls",
        };
      },
      (options) => {
        expect(options.tools!.map((t) => t.name)).toEqual(["foo_bar", "foo_bar_2"]);
        return {
          toolCalls: [{ toolCallId: "c2", toolName: "foo_bar", args: {} }],
          finishReason: "tool-calls",
        };
      },
      () => ({ text: "done", finishReason: "stop" }),
    ]);

    const block = generator({
      name: "collide-gen",
      model,
      prompt: "p",
      tools: [dotTool, slashTool],
    });

    await expect(runForTest(block, {}, createMockContext())).resolves.toBe("done");

    // Correct correlation: the suffixed alias routed to the slash tool.
    expect(executed).toEqual(["foo/bar", "foo.bar"]);

    // Inter-step messages reference the deduped aliases so the next step's
    // request sanitization can't reassign a colliding name.
    const step3 = seen[2]!.messages;
    const calls = assistantMessages(step3)
      .flatMap((m) => (Array.isArray(m.content) ? m.content : []) as Array<Record<string, unknown>>)
      .filter((p) => p.type === "tool-call");
    expect(calls.map((p) => [p.toolCallId, p.toolName])).toEqual([
      ["c1", "foo_bar_2"],
      ["c2", "foo_bar"],
    ]);
    const results = [...toolMessages(seen[1]!.messages), ...toolMessages(step3)].map(
      (m) => (m.content as Array<Record<string, unknown>>)[0]!
    );
    expect(results.map((p) => [p.toolCallId, p.toolName])).toEqual([
      ["c1", "foo_bar_2"],
      ["c1", "foo_bar_2"],
      ["c2", "foo_bar"],
    ]);
    expect(results.map((p) => p.output)).toEqual([
      { type: "json", value: { from: "slash" } },
      { type: "json", value: { from: "slash" } },
      { type: "json", value: { from: "dot" } },
    ]);
  });

  it("turns a tool's SuspensionError into a model-visible failed result (no suspension in PR2)", async () => {
    const gate = handler({
      name: "gated-tool",
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: () => {
        // Simulates ctx.suspend() throwing inside a generator tool.
        throw new SuspensionError({ suspensionId: "susp_1", reason: "approval" });
      },
    });

    const { model, seen } = stepModel([
      () => ({
        toolCalls: [{ toolCallId: "g1", toolName: "gated-tool", args: {} }],
        finishReason: "tool-calls",
      }),
      () => ({ text: "carried on", finishReason: "stop" }),
    ]);

    const emitted: Array<{ type: string; item?: Record<string, unknown> }> = [];
    const ctx = createMockContext({
      response: {
        emit: (event: unknown) => {
          emitted.push(event as { type: string; item?: Record<string, unknown> });
        },
        getItems: () => emitted.filter((e) => e.item).map((e) => e.item),
      } as never,
    });

    const block = generator({
      name: "suspend-gen",
      model,
      prompt: "p",
      tools: [gate],
    });

    // The run COMPLETES — the suspension is swallowed as an ordinary tool
    // error until PR3 wires propagation.
    await expect(runForTest(block, {}, ctx)).resolves.toBe("carried on");

    // Model-visible failed tool result on the next step.
    const results = toolMessages(seen[1]!.messages).map(
      (m) => (m.content as Array<Record<string, unknown>>)[0]!
    );
    expect(results).toHaveLength(1);
    expect(results[0]!.output).toEqual({
      type: "error-text",
      value: "Flow suspended: approval",
    });

    // Durable failed tool_output emitted, same as the legacy SDK path.
    const toolOutputs = emitted.filter(
      (e) => e.type === "item.done" && e.item?.type === "tool_output"
    );
    expect(toolOutputs).toHaveLength(1);
    expect(toolOutputs[0]!.item!.status).toBe("failed");
  });

  it("terminates the loop on the surfacing step when loop.runTools is false", async () => {
    const toolCall = vi.fn();
    const tool = handler({
      name: "unused-tool",
      inputSchema: z.object({ value: z.number() }),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: () => {
        toolCall();
        return { ok: false };
      },
    });

    const { model, seen } = stepModel([
      () => ({
        toolCalls: [{ toolCallId: "u1", toolName: "unused-tool", args: { value: 1 } }],
        structuredOutput: { ok: true },
        finishReason: "tool-calls",
      }),
    ]);

    const block = generator({
      name: "no-run-tools",
      model,
      prompt: "p",
      outputSchema: z.object({ ok: z.boolean() }),
      tools: [tool],
      loop: { runTools: false },
    });

    await expect(runForTest(block, { value: 1 }, createMockContext())).resolves.toEqual({
      ok: true,
    });
    expect(toolCall).not.toHaveBeenCalled();
    expect(seen.length).toBe(1);
  });

  it("forwards providerTools to every step call", async () => {
    const echo = handler({
      name: "echo",
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: () => ({ ok: true }),
    });
    const pt = providerTool("web_search", { marker: "raw-tool" });

    const { model, seen } = stepModel([
      () => ({
        toolCalls: [{ toolCallId: "c1", toolName: "echo", args: {} }],
        finishReason: "tool-calls",
      }),
      () => ({ text: "done", finishReason: "stop" }),
    ]);

    const block = generator({
      name: "pt-gen",
      model,
      prompt: "p",
      tools: [echo],
      providerTools: [pt],
    });

    await expect(runForTest(block, {}, createMockContext())).resolves.toBe("done");
    expect(seen.length).toBe(2);
    for (const call of seen) {
      expect(call.providerTools).toEqual([pt]);
    }
  });

  it("skips a provider-executed tool call (no run, no unknown-tool error, no extra step)", async () => {
    // A step-capable model returns a provider-executed call (web_search ran
    // server-side) plus final text and the raw assistant turn. FSD must NOT
    // execute it, must NOT surface an unknown-tool error, and must NOT loop —
    // the step is terminal from FSD's view (no framework calls to run).
    const rawAssistant = {
      role: "assistant",
      content: [
        { type: "tool-call", toolCallId: "ws1", toolName: "web_search", input: { q: "x" } },
        { type: "text", text: "the answer" },
      ],
    };

    const { model, seen } = stepModel([
      () => ({
        text: "the answer",
        toolCalls: [
          { toolCallId: "ws1", toolName: "web_search", args: { q: "x" }, providerExecuted: true },
        ],
        finishReason: "stop",
        responseMessages: [rawAssistant],
      }),
    ]);

    const emitted: Array<{ type: string; item?: Record<string, unknown> }> = [];
    const ctx = createMockContext({
      response: {
        emit: (event: unknown) => {
          emitted.push(event as never);
        },
        getItems: () => emitted.filter((e) => e.item).map((e) => e.item),
      } as never,
    });

    const block = generator({
      name: "provider-only-gen",
      model,
      prompt: "p",
      search: true,
    });

    await expect(runForTest(block, {}, ctx)).resolves.toBe("the answer");
    // Exactly one step consumed — no looping on the provider-executed call.
    expect(seen.length).toBe(1);
    // No tool_output emitted (FSD ran nothing).
    expect(
      emitted.filter((e) => e.type === "item.done" && e.item?.type === "tool_output")
    ).toHaveLength(0);
  });

  it("runs framework tools but skips provider-executed calls in a mixed step, carrying both results forward", async () => {
    const frameworkRuns: unknown[] = [];
    const fetchTool = handler({
      name: "fetchDoc",
      inputSchema: z.object({ id: z.string() }),
      outputSchema: z.object({ body: z.string() }),
      execute: (input) => {
        frameworkRuns.push(input);
        return { body: `doc:${input.id}` };
      },
    });

    // Step 0: one provider-executed web_search (+ its raw role:"tool" result)
    // AND one framework fetchDoc call. The raw response carries the assistant
    // turn (both tool-call parts) and the provider tool-result message.
    const rawAssistant = {
      role: "assistant",
      content: [
        { type: "tool-call", toolCallId: "ws1", toolName: "web_search", input: { q: "x" } },
        { type: "tool-call", toolCallId: "fd1", toolName: "fetchDoc", input: { id: "42" } },
      ],
    };
    const rawProviderResult = {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "ws1",
          toolName: "web_search",
          output: { type: "json", value: { hits: ["a", "b"] } },
        },
      ],
    };

    const { model, seen } = stepModel([
      () => ({
        toolCalls: [
          { toolCallId: "ws1", toolName: "web_search", args: { q: "x" }, providerExecuted: true },
          { toolCallId: "fd1", toolName: "fetchDoc", args: { id: "42" } },
        ],
        finishReason: "tool-calls",
        responseMessages: [rawAssistant, rawProviderResult],
      }),
      () => ({ text: "done", finishReason: "stop" }),
    ]);

    const block = generator({
      name: "mixed-gen",
      model,
      prompt: "p",
      tools: [fetchTool],
      search: true,
    });

    await expect(runForTest(block, {}, createMockContext())).resolves.toBe("done");
    // The framework tool ran exactly once; the provider call did not run.
    expect(frameworkRuns).toEqual([{ id: "42" }]);
    expect(seen.length).toBe(2);

    // Step 1's messages carry the raw assistant turn, the PROVIDER result
    // (from raw), then the FSD-built FRAMEWORK result — correctly ordered.
    const step2 = seen[1]!.messages as Array<Record<string, unknown>>;
    const assistantIdx = step2.findIndex((m) => m.role === "assistant" && Array.isArray(m.content));
    const providerResultIdx = step2.findIndex(
      (m) =>
        m.role === "tool" &&
        (m.content as Array<Record<string, unknown>>)[0]?.toolCallId === "ws1"
    );
    const frameworkResultIdx = step2.findIndex(
      (m) =>
        m.role === "tool" &&
        (m.content as Array<Record<string, unknown>>)[0]?.toolCallId === "fd1"
    );
    expect(assistantIdx).toBeGreaterThanOrEqual(0);
    expect(providerResultIdx).toBeGreaterThan(assistantIdx);
    expect(frameworkResultIdx).toBeGreaterThan(providerResultIdx);

    // The provider result is the raw one verbatim; the framework result is
    // FSD-built from the tool's output.
    expect((step2[providerResultIdx]!.content as Array<Record<string, unknown>>)[0]!.output).toEqual({
      type: "json",
      value: { hits: ["a", "b"] },
    });
    expect((step2[frameworkResultIdx]!.content as Array<Record<string, unknown>>)[0]!.output).toEqual({
      type: "json",
      value: { body: "doc:42" },
    });
  });

  it("still surfaces a model-visible error for a genuine hallucinated unknown tool", async () => {
    // A NON-provider-executed call that resolves to no framework tool is a
    // hallucination — the skip logic must not swallow it.
    const real = handler({
      name: "real",
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: () => ({ ok: true }),
    });

    const { model, seen } = stepModel([
      () => ({
        toolCalls: [{ toolCallId: "h1", toolName: "ghost", args: {} }],
        finishReason: "tool-calls",
      }),
      () => ({ text: "recovered", finishReason: "stop" }),
    ]);

    const block = generator({
      name: "hallucinated-gen",
      model,
      prompt: "p",
      tools: [real],
    });

    await expect(runForTest(block, {}, createMockContext())).resolves.toBe("recovered");
    // The loop DID continue (framework call present, even if unknown) and the
    // model saw the error result.
    expect(seen.length).toBe(2);
    const result = toolMessages(seen[1]!.messages).map(
      (m) => (m.content as Array<Record<string, unknown>>)[0]!
    )[0]!;
    expect(result.output).toEqual({
      type: "error-text",
      value: 'Model called unknown tool "ghost"',
    });
  });

  it("throws when built with two tools sharing an identical name", async () => {
    // Exact-duplicate names are unresolvable (the owned loop keys its toolset
    // by name/alias, collapsing them to one entry). Reject with a clear error
    // naming the generator and the duplicated name. Distinct names that only
    // collide on sanitization are fine (covered by the collision test above).
    const dupA = handler({
      name: "same-name",
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: () => ({ ok: true }),
    });
    const dupB = handler({
      name: "same-name",
      inputSchema: z.object({ q: z.string() }),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: () => ({ ok: false }),
    });

    const block = generator({
      name: "dup-tools-gen",
      model: stepModel([() => ({ text: "x", finishReason: "stop" })]).model,
      prompt: "p",
      tools: [dupA, dupB],
    });

    await expect(runForTest(block, {}, createMockContext())).rejects.toThrow(
      /Generator "dup-tools-gen" has two tools named "same-name"/
    );
  });

  it("allows the SAME tool instance appearing twice (capability preset overlap)", async () => {
    // Capability presets can contribute the same tool object through two
    // presets (e.g. a skills catalog + a feature-flag preset). Identical
    // instances are one tool — dedupe by reference, don't reject.
    const shared = handler({
      name: "shared-tool",
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: () => ({ ok: true }),
    });

    const { model } = stepModel([() => ({ text: "ok", finishReason: "stop" })]);

    const block = generator({
      name: "dup-ref-gen",
      model,
      prompt: "p",
      tools: [shared, shared],
    });

    await expect(runForTest(block, {}, createMockContext())).resolves.toBe("ok");
  });

  it("does not execute a tool the step deactivated via prepareStep.activeTools", async () => {
    // Dynamic tools: step 0 exposes [alpha, beta]; before step 1 the tools
    // resolver drops `beta`, so prepareStep.activeTools narrows to [alpha].
    // If the model still calls `beta`, the owned loop must surface a
    // model-visible unknown-tool error and NOT run it (the legacy SDK path
    // only advertised active tools and rejected out-of-set calls).
    let resolveCount = 0;
    const alphaRuns = vi.fn();
    const betaRuns = vi.fn();
    const alpha = handler({
      name: "alpha",
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: () => {
        alphaRuns();
        return { ok: true };
      },
    });
    const beta = handler({
      name: "beta",
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: () => {
        betaRuns();
        return { ok: true };
      },
    });

    const { model, seen } = stepModel([
      // Step 0: model calls alpha (active) → runs, loop continues.
      () => ({
        toolCalls: [{ toolCallId: "a1", toolName: "alpha", args: {} }],
        finishReason: "tool-calls",
      }),
      // Step 1: model calls beta, which was deactivated for this step.
      () => ({
        toolCalls: [{ toolCallId: "b1", toolName: "beta", args: {} }],
        finishReason: "tool-calls",
      }),
      () => ({ text: "done", finishReason: "stop" }),
    ]);

    const block = generator({
      name: "active-tools-gen",
      model,
      prompt: "p",
      // Dynamic resolver: first call returns both tools, later calls drop beta.
      tools: () => {
        resolveCount += 1;
        return resolveCount <= 1 ? [alpha, beta] : [alpha];
      },
    });

    await expect(runForTest(block, {}, createMockContext())).resolves.toBe("done");
    expect(alphaRuns).toHaveBeenCalledTimes(1);
    // Deactivated tool must never run.
    expect(betaRuns).not.toHaveBeenCalled();

    // Step 1's active-tool dictionary excludes beta, and the stale beta call
    // surfaced a model-visible unknown-tool error. Step 2's input accumulates
    // every prior tool result, so select beta's by its call id.
    expect(seen[1]!.tools!.map((t) => t.name)).toEqual(["alpha"]);
    const betaResult = toolMessages(seen[2]!.messages)
      .map((m) => (m.content as Array<Record<string, unknown>>)[0]!)
      .find((p) => p.toolCallId === "b1")!;
    expect(betaResult.output).toEqual({
      type: "error-text",
      value: 'Model called unknown tool "beta"',
    });
  });

  it("continues past a deferred provider-only step (finishReason tool-calls) to the terminal text", async () => {
    // A deferred provider tool (AI SDK v7 supportsDeferredResults) returns a
    // provider-executed call whose result isn't ready this turn, with
    // finishReason "tool-calls" — the model expects another step. FSD has no
    // framework call to run, but the step is NOT terminal, so the loop must
    // carry the raw turn forward and continue rather than returning undefined.
    const rawAssistant1 = {
      role: "assistant",
      content: [
        { type: "tool-call", toolCallId: "d1", toolName: "deferred_search", input: { q: "x" } },
      ],
    };

    const { model, seen } = stepModel([
      () => ({
        toolCalls: [
          { toolCallId: "d1", toolName: "deferred_search", args: { q: "x" }, providerExecuted: true },
        ],
        // Deferred: result not ready → NOT terminal.
        finishReason: "tool-calls",
        responseMessages: [rawAssistant1],
      }),
      () => ({ text: "final answer", finishReason: "stop" }),
    ]);

    const block = generator({
      name: "deferred-provider-gen",
      model,
      prompt: "p",
      search: true,
    });

    const result = await runForTest(block, {}, createMockContext());
    expect(result).toBe("final answer");
    // Two steps consumed — the loop did NOT terminate on the deferred step.
    expect(seen.length).toBe(2);
    // The raw provider turn was carried into the second step's messages.
    const step2 = seen[1]!.messages as Array<Record<string, unknown>>;
    expect(step2).toContainEqual(rawAssistant1);
  });

  it("aggregates per-step usage into one onGeneratorModelResult report", async () => {
    const echo = handler({
      name: "echo",
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: () => ({ ok: true }),
    });

    const { model } = stepModel([
      () => ({
        toolCalls: [{ toolCallId: "c1", toolName: "echo", args: {} }],
        finishReason: "tool-calls",
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, cacheReadInputTokens: 4 },
      }),
      () => ({
        text: "done",
        finishReason: "stop",
        usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
      }),
    ]);

    const onGeneratorModelResult = vi.fn();
    const ctx = createMockContext({
      _runtimeHooks: { onGeneratorModelResult },
    } as never);

    const block = generator({
      name: "usage-gen",
      model,
      prompt: "p",
      tools: [echo],
    });

    await expect(runForTest(block, {}, ctx)).resolves.toBe("done");
    expect(onGeneratorModelResult).toHaveBeenCalledTimes(1);
    expect(onGeneratorModelResult.mock.calls[0]![0].usage).toEqual({
      promptTokens: 30,
      completionTokens: 15,
      totalTokens: 45,
      cacheReadInputTokens: 4,
    });
  });

  it("appends the raw responseMessages assistant turn verbatim (reasoning preserved), tool results FSD-built", async () => {
    const echo = handler({
      name: "echo",
      inputSchema: z.object({ v: z.string() }),
      outputSchema: z.object({ v: z.string() }),
      execute: (input) => ({ v: input.v }),
    });

    // Raw assistant turn as a provider/SDK would return it — reasoning part
    // with a provider signature plus the tool-call part.
    const rawAssistant = {
      role: "assistant",
      content: [
        {
          type: "reasoning",
          text: "let me think",
          providerOptions: { anthropic: { signature: "sig_abc" } },
        },
        { type: "tool-call", toolCallId: "r1", toolName: "echo", input: { v: "hi" } },
      ],
    };

    const { model, seen } = stepModel([
      () => ({
        toolCalls: [{ toolCallId: "r1", toolName: "echo", args: { v: "hi" } }],
        finishReason: "tool-calls",
        responseMessages: [rawAssistant],
      }),
      () => ({ text: "done", finishReason: "stop" }),
    ]);

    const block = generator({
      name: "reasoning-gen",
      model,
      prompt: "p",
      tools: [echo],
    });

    await expect(runForTest(block, {}, createMockContext())).resolves.toBe("done");

    const step2 = seen[1]!.messages as Array<Record<string, unknown>>;
    // The raw assistant message is appended VERBATIM (reasoning + provider
    // signature intact) — not a reconstructed one.
    const assistants = assistantMessages(step2).filter(
      (m) =>
        Array.isArray(m.content) &&
        (m.content as Array<{ type: string }>).some((p) => p.type === "tool-call")
    );
    expect(assistants).toHaveLength(1);
    expect(assistants[0]).toEqual(rawAssistant);

    // Tool results stay FSD-constructed (FSD ran the tool; the raw response
    // has no result for an execute-less tool).
    const results = toolMessages(step2).map(
      (m) => (m.content as Array<Record<string, unknown>>)[0]!
    );
    expect(results).toEqual([
      {
        type: "tool-result",
        toolCallId: "r1",
        toolName: "echo",
        output: { type: "json", value: { v: "hi" } },
      },
    ]);
  });

  it("synthesizes the same tool_call_progress items as the legacy non-streaming path", async () => {
    const echo = handler({
      name: "echo",
      inputSchema: z.object({ v: z.string() }),
      outputSchema: z.object({ v: z.string() }),
      execute: (input) => ({ v: input.v }),
    });

    const { model } = stepModel([
      () => ({
        toolCalls: [{ toolCallId: "p1", toolName: "echo", args: { v: "hi" } }],
        finishReason: "tool-calls",
      }),
      () => ({ text: "done", finishReason: "stop" }),
    ]);

    const emitted: Array<{ type: string; item?: Record<string, unknown> }> = [];
    const ctx = createMockContext({
      response: {
        emit: (event: unknown) => {
          emitted.push(event as never);
        },
        getItems: () => emitted.filter((e) => e.item).map((e) => e.item),
      } as never,
    });

    const block = generator({
      name: "progress-gen",
      model,
      prompt: "p",
      tools: [echo],
      itemVisibility: { client: true, history: true },
    });

    await expect(runForTest(block, {}, ctx)).resolves.toBe("done");

    // FIX-661 pairing from `generation.steps`: in_progress (with args) then
    // completed (with result), framework tool name on both.
    const progress = emitted
      .filter((e) => e.type === "item.done" && e.item?.type === "tool_call_progress")
      .map((e) => e.item!);
    expect(progress.map((p) => [p.status, p.toolName, p.toolCallId])).toEqual([
      ["in_progress", "echo", "p1"],
      ["completed", "echo", "p1"],
    ]);
    expect(progress[0]!.argsDelta).toBe(JSON.stringify({ v: "hi" }));
    expect(progress[1]!.result).toEqual({ v: "hi" });

    // Durable tool_output emitted during execution, BEFORE the synthesized
    // progress items (same relative order as the legacy non-streaming path,
    // where tools ran inside model.generate()).
    const doneTypes = emitted
      .filter((e) => e.type === "item.done")
      .map((e) => e.item?.type);
    expect(doneTypes.indexOf("tool_output")).toBeLessThan(
      doneTypes.indexOf("tool_call_progress")
    );
  });

  it("applies mapModelOutput in memory when building the model-facing tool result", async () => {
    const richTool = handler({
      name: "rich",
      inputSchema: z.object({}),
      outputSchema: z.object({ secret: z.string(), summary: z.string() }),
      execute: () => ({ secret: "s3cr3t", summary: "the gist" }),
    }).mapModelOutput((output) => `summary: ${output.summary}`);

    const { model, seen } = stepModel([
      () => ({
        toolCalls: [{ toolCallId: "m1", toolName: "rich", args: {} }],
        finishReason: "tool-calls",
      }),
      () => ({ text: "done", finishReason: "stop" }),
    ]);

    const block = generator({
      name: "mapped-gen",
      model,
      prompt: "p",
      tools: [richTool],
    });

    await expect(runForTest(block, {}, createMockContext())).resolves.toBe("done");

    // The model sees the mapped string in the v7 content envelope (matching
    // the adapter's toModelOutput bridge), never the structured value.
    const result = toolMessages(seen[1]!.messages).map(
      (m) => (m.content as Array<Record<string, unknown>>)[0]!
    )[0]!;
    expect(result.output).toEqual({
      type: "content",
      value: [{ type: "text", text: "summary: the gist" }],
    });
    expect(JSON.stringify(seen[1]!.messages)).not.toContain("s3cr3t");
  });

  it("falls back to the legacy SDK-driven path for generate-only models", async () => {
    let receivedMaxSteps: number | undefined;
    const block = generator({
      name: "legacy-gen",
      model: "m",
      prompt: "p",
    });

    const ctx = createMockContext({
      resolveModel: (() => ({
        modelId: "m",
        async generate(options: { maxSteps?: number }) {
          receivedMaxSteps = options.maxSteps;
          return { text: "legacy" };
        },
      })) as never,
    });

    await expect(runForTest(block, {}, ctx)).resolves.toBe("legacy");
    // The legacy path still delegates the loop to the model via maxSteps.
    expect(receivedMaxSteps).toBe(8);
  });
});

describe("generator owned step loop — streaming", () => {
  type StreamScript = Array<GeneratorModelStreamChunk[]>;

  function streamStepModel(script: StreamScript, modelId = "stream-step-model") {
    const seen: GeneratorModelCallOptions[] = [];
    const streamCalls: GeneratorModelCallOptions[] = [];
    const model: GeneratorModel = {
      modelId,
      async generate() {
        throw new Error("generate must not be called");
      },
      async *stream(options) {
        streamCalls.push(options);
        throw new Error("legacy stream must not be called on a streamStep-capable model");
      },
      async *streamStep(options) {
        seen.push(options);
        const chunks = script[seen.length - 1];
        if (chunks === undefined) {
          throw new Error(`no stream script entry for step ${seen.length - 1}`);
        }
        for (const chunk of chunks) {
          yield chunk;
        }
      },
    };
    return { model, seen, streamCalls };
  }

  it("drives one streamStep call per step, streams deltas, and executes tools between steps", async () => {
    const toolRuns: unknown[] = [];
    const lookup = handler({
      name: "lookup",
      inputSchema: z.object({ q: z.string() }),
      outputSchema: z.object({ answer: z.string() }),
      execute: (input) => {
        toolRuns.push(input);
        return { answer: `answer:${input.q}` };
      },
    });

    const { model, seen, streamCalls } = streamStepModel([
      [
        {
          type: "tool_call_delta",
          toolCallDelta: { toolCallId: "s1", toolName: "lookup", argsDelta: '{"q":"x"}' },
        },
        {
          type: "finish",
          finishReason: "tool-calls",
          fullResult: {
            text: "",
            toolCalls: [{ toolCallId: "s1", toolName: "lookup", args: { q: "x" } }],
            finishReason: "tool-calls",
            usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 },
          },
        },
      ],
      [
        { type: "text_delta", textDelta: "final " },
        { type: "text_delta", textDelta: "answer" },
        {
          type: "finish",
          finishReason: "stop",
          fullResult: {
            text: "final answer",
            finishReason: "stop",
            usage: { promptTokens: 8, completionTokens: 4, totalTokens: 12 },
          },
        },
      ],
    ]);

    const emitted: Array<{ type: string; item?: Record<string, unknown>; delta?: string }> = [];
    const onGeneratorModelResult = vi.fn();
    const ctx = createMockContext({
      response: {
        emit: (event: unknown) => {
          emitted.push(event as never);
        },
        getItems: () => emitted.filter((e) => e.item).map((e) => e.item),
      } as never,
      _runtimeHooks: { onGeneratorModelResult },
    } as never);

    const block = generator({
      name: "stream-loop-gen",
      model,
      prompt: "p",
      tools: [lookup],
      itemVisibility: { client: true, history: true },
    });

    await expect(runForTest(block, {}, ctx)).resolves.toBe("final answer");
    expect(seen.length).toBe(2);
    expect(streamCalls.length).toBe(0);
    expect(toolRuns).toEqual([{ q: "x" }]);

    // Second step receives the assistant tool-call message + tool result.
    const step2 = seen[1]!.messages;
    expect(toolMessages(step2)).toHaveLength(1);

    // Streamed text accumulated into a completed assistant message item.
    const doneMessages = emitted.filter(
      (e) => e.type === "item.done" && e.item?.type === "message"
    );
    expect(doneMessages).toHaveLength(1);
    expect((doneMessages[0]!.item!.content as Array<{ text: string }>)[0]!.text).toBe(
      "final answer"
    );

    // tool_call_progress lifecycle: in_progress from the stream chunk,
    // completed after FSD ran the tool; durable tool_output in between.
    const progressStatuses = emitted
      .filter((e) => e.type === "item.done" && e.item?.type === "tool_call_progress")
      .map((e) => e.item!.status);
    expect(progressStatuses).toEqual(["in_progress", "completed"]);
    const toolOutputs = emitted.filter(
      (e) => e.type === "item.done" && e.item?.type === "tool_output"
    );
    expect(toolOutputs).toHaveLength(1);
    expect(toolOutputs[0]!.item!.status).toBe("completed");

    // Aggregate usage reported once.
    expect(onGeneratorModelResult).toHaveBeenCalledTimes(1);
    expect(onGeneratorModelResult.mock.calls[0]![0].usage).toEqual({
      promptTokens: 13,
      completionTokens: 6,
      totalTokens: 19,
    });
  });

  it("uses the legacy stream path when the model lacks streamStep", async () => {
    const tool = handler({
      name: "noop",
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: () => ({ ok: true }),
    });

    let legacyStreamCalls = 0;
    const model: GeneratorModel = {
      modelId: "legacy-stream",
      async generate() {
        throw new Error("generate must not be called");
      },
      async *stream(options) {
        legacyStreamCalls += 1;
        expect(options.maxSteps).toBe(8);
        yield { type: "text_delta", textDelta: "legacy" } as GeneratorModelStreamChunk;
        yield {
          type: "finish",
          finishReason: "stop",
          fullResult: { text: "legacy", finishReason: "stop" },
        } as GeneratorModelStreamChunk;
      },
    };

    const block = generator({
      name: "legacy-stream-gen",
      model,
      prompt: "p",
      tools: [tool],
    });

    await expect(runForTest(block, {}, createMockContext())).resolves.toBe("legacy");
    expect(legacyStreamCalls).toBe(1);
  });

  it("routes per mode: generateStep-only models stream via legacy stream, step-generate via owned loop", async () => {
    // Model with generateStep but NO stream/streamStep: text schema + tools
    // cannot stream, so the non-streaming owned loop must run.
    const echo = handler({
      name: "echo",
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: () => ({ ok: true }),
    });

    const { model, seen } = stepModel([
      () => ({
        toolCalls: [{ toolCallId: "c1", toolName: "echo", args: {} }],
        finishReason: "tool-calls",
      }),
      () => ({ text: "owned", finishReason: "stop" }),
    ]);

    const block = generator({
      name: "mode-gen",
      model,
      prompt: "p",
      tools: [echo],
    });

    await expect(runForTest(block, {}, createMockContext())).resolves.toBe("owned");
    expect(seen.length).toBe(2);
  });
});

describe("createFallbackModel — step method forwarding", () => {
  const okStepModel = (modelId: string, text: string): GeneratorModel => ({
    modelId,
    async generate() {
      return { text: `${text}-legacy` };
    },
    async generateStep() {
      return { text, finishReason: "stop" };
    },
    async *streamStep() {
      yield { type: "text_delta", textDelta: text } as GeneratorModelStreamChunk;
      yield {
        type: "finish",
        finishReason: "stop",
        fullResult: { text, finishReason: "stop" },
      } as GeneratorModelStreamChunk;
    },
  });

  const legacyOnlyModel = (modelId: string): GeneratorModel => ({
    modelId,
    async generate() {
      return { text: "legacy-only" };
    },
  });

  it("exposes generateStep/streamStep iff every candidate implements them", () => {
    const allCapable = createFallbackModel({
      groupName: "caps",
      models: [
        { modelId: "a", providerName: "p", model: okStepModel("a", "A") },
        { modelId: "b", providerName: "p", model: okStepModel("b", "B") },
      ],
      retryPolicy: { maxAttemptsPerModel: 1, baseDelayMs: 0, maxDelayMs: 0 },
    });
    expect(typeof allCapable.generateStep).toBe("function");
    expect(typeof allCapable.streamStep).toBe("function");

    const mixed = createFallbackModel({
      groupName: "mixed",
      models: [
        { modelId: "a", providerName: "p", model: okStepModel("a", "A") },
        { modelId: "b", providerName: "p", model: legacyOnlyModel("b") },
      ],
      retryPolicy: { maxAttemptsPerModel: 1, baseDelayMs: 0, maxDelayMs: 0 },
    });
    expect(mixed.generateStep).toBeUndefined();
    expect(mixed.streamStep).toBeUndefined();
  });

  it("falls through failing candidates and fires onResolved for the winner", async () => {
    const failing: GeneratorModel = {
      modelId: "bad",
      async generate() {
        throw new Error("nope");
      },
      async generateStep() {
        const err = new Error("rate limited") as Error & { statusCode: number };
        err.statusCode = 429;
        throw err;
      },
      async *streamStep() {
        const err = new Error("rate limited") as Error & { statusCode: number };
        err.statusCode = 429;
        throw err;
      },
    };

    const resolved: string[] = [];
    const fallback = createFallbackModel({
      groupName: "grp",
      models: [
        { modelId: "bad", providerName: "p", model: failing },
        { modelId: "good", providerName: "p", model: okStepModel("good", "WIN") },
      ],
      retryPolicy: { maxAttemptsPerModel: 1, baseDelayMs: 0, maxDelayMs: 0 },
      onResolved: (entry) => {
        resolved.push(entry.modelId);
      },
    });

    const result = await fallback.generateStep!({ messages: [] });
    expect(result.text).toBe("WIN");

    const chunks: GeneratorModelStreamChunk[] = [];
    for await (const chunk of fallback.streamStep!({ messages: [] })) {
      chunks.push(chunk);
    }
    expect(chunks.some((c) => c.type === "text_delta" && c.textDelta === "WIN")).toBe(true);

    expect(resolved).toEqual(["good", "good"]);
  });
});
