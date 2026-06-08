import { describe, expect, it, vi } from "vitest";
import { createMockModelResolver, mockGenerator } from "../src";

describe("mockGenerator", () => {
  it("returns scripted steps in order and supports reset", () => {
    const mock = mockGenerator({
      name: "gpt-test",
      script: [
        { text: "one" },
        { structuredOutput: { done: true } }
      ]
    });

    expect(mock.next()).toEqual({ text: "one" });
    expect(mock.next()).toEqual({ structuredOutput: { done: true } });
    expect(mock.next()).toBeUndefined();

    mock.reset();

    expect(mock.next()).toEqual({ text: "one" });
  });

  it("resolves mocks by block name first, then model id", async () => {
    const byBlock = mockGenerator({
      name: "block-mock",
      script: [{ structuredOutput: { source: "block" } }]
    });
    const byModel = mockGenerator({
      name: "model-mock",
      script: [{ structuredOutput: { source: "model" } }]
    });

    const resolver = createMockModelResolver({
      generators: { "chat-generator": byBlock },
      models: { "openai/gpt-4o-mini": byModel }
    });

    const blockModel = resolver("openai/gpt-4o-mini", "chat-generator");
    const blockResult = await blockModel.generate({ messages: [] });
    expect(blockResult.structuredOutput).toEqual({ source: "block" });

    const modelModel = resolver("openai/gpt-4o-mini", "other-generator");
    const modelResult = await modelModel.generate({ messages: [] });
    expect(modelResult.structuredOutput).toEqual({ source: "model" });
  });

  describe("predicate entries", () => {
    it("matches calls by predicate without consuming the entry", () => {
      const mock = mockGenerator({
        name: "predicate-only",
        script: [
          {
            when: (input) => JSON.stringify(input).includes("alpha"),
            then: { text: "A response" }
          },
          {
            when: (input) => JSON.stringify(input).includes("beta"),
            then: { text: "B response" }
          }
        ]
      });

      expect(mock.next("alpha goes here")).toEqual({ text: "A response" });
      expect(mock.next("beta goes here")).toEqual({ text: "B response" });
      // Same predicate fires repeatedly:
      expect(mock.next("alpha again")).toEqual({ text: "A response" });
      expect(mock.next("alpha once more")).toEqual({ text: "A response" });
    });

    it("evaluates predicates in script order; first match wins", () => {
      const mock = mockGenerator({
        name: "ordered-predicates",
        script: [
          { when: () => true, then: { text: "first" } },
          { when: () => true, then: { text: "second" } }
        ]
      });

      expect(mock.next("anything")).toEqual({ text: "first" });
      expect(mock.next("anything")).toEqual({ text: "first" });
    });

    it("falls through to plain steps when no predicate matches", () => {
      const mock = mockGenerator({
        name: "mixed",
        script: [
          {
            when: (input) => JSON.stringify(input).includes("special"),
            then: { text: "special response" }
          },
          { text: "plain-1" },
          { text: "plain-2" }
        ]
      });

      // Predicate matches — plain queue not advanced.
      expect(mock.next("special call")).toEqual({ text: "special response" });
      // Predicate doesn't match — plain queue head consumed.
      expect(mock.next("nothing here")).toEqual({ text: "plain-1" });
      // Predicate matches again — plain queue still has plain-2.
      expect(mock.next("special again")).toEqual({ text: "special response" });
      expect(mock.next("nothing here")).toEqual({ text: "plain-2" });
    });

    it("returns undefined only when no predicate matches and plain queue is empty", () => {
      const mock = mockGenerator({
        name: "exhaustion",
        script: [
          {
            when: (input) => JSON.stringify(input).includes("yes"),
            then: { text: "matched" }
          },
          { text: "fallback" }
        ]
      });

      expect(mock.next("yes")).toEqual({ text: "matched" });
      expect(mock.next("no")).toEqual({ text: "fallback" });
      // Plain queue exhausted; predicate doesn't match.
      expect(mock.next("no again")).toBeUndefined();
      // Predicate still matches once it's in the input.
      expect(mock.next("yes again")).toEqual({ text: "matched" });
    });

    it("throws a descriptive error when invoked with no matching entry", async () => {
      const mock = mockGenerator({
        name: "predicate-strict",
        script: [
          {
            when: (input) => JSON.stringify(input).includes("only-this"),
            then: { text: "ok" }
          }
        ]
      });

      const resolver = createMockModelResolver({
        generators: { "x": mock }
      });

      const model = resolver("any/model", "x");
      // First call matches.
      await expect(
        model.generate({ messages: "only-this" as unknown as never })
      ).resolves.toMatchObject({ text: "ok" });

      // Second call: no match, no plain queue → resolver throws.
      await expect(
        model.generate({ messages: "something-else" as unknown as never })
      ).rejects.toThrow(/no script entry matching/);
    });
  });

  describe("stream() (FIX-661)", () => {
    it("exposes a stream() method matching production chunk shape", async () => {
      const mock = mockGenerator({
        name: "echo-mock",
        script: [
          { toolCalls: [{ toolCallId: "tc_1", toolName: "echo", args: { v: 1 } }] },
          { text: "done" }
        ]
      });
      const resolver = createMockModelResolver({ generators: { "g": mock } });
      const model = resolver("any/model", "g");
      expect(model.stream).toBeDefined();

      const execute = vi.fn(async (args: unknown) => ({ echoed: (args as { v: number }).v }));
      const echoTool = { name: "echo", execute };

      const chunks: any[] = [];
      for await (const chunk of model.stream!({ messages: [], tools: [echoTool] })) {
        chunks.push(chunk);
      }

      expect(chunks[0]).toEqual({
        type: "tool_call_delta",
        toolCallDelta: { toolCallId: "tc_1", toolName: "echo", argsDelta: '{"v":1}' }
      });
      expect(chunks[1]).toEqual({
        type: "tool_result",
        toolResult: { toolCallId: "tc_1", toolName: "echo", result: { echoed: 1 } }
      });
      expect(chunks[2]).toEqual({ type: "text_delta", textDelta: "done" });
      expect(chunks[3].type).toBe("finish");
      expect(chunks[3].fullResult.text).toBe("done");

      expect(execute).toHaveBeenCalledTimes(1);
      expect(execute).toHaveBeenCalledWith({ v: 1 }, { toolCallId: "tc_1" });
    });

    it("generate() returns the same shape after the runScript refactor", async () => {
      const mock = mockGenerator({
        name: "regression-mock",
        script: [
          { toolCalls: [{ toolCallId: "tc_a", toolName: "ping", args: { n: 1 } }] },
          { text: "pong" }
        ]
      });
      const resolver = createMockModelResolver({ generators: { "g": mock } });
      const model = resolver("any/model", "g");

      const execute = vi.fn(async () => ({ ok: true }));
      const result = await model.generate({ messages: [], tools: [{ name: "ping", execute }] });

      expect(result.text).toBe("pong");
      expect(result.finishReason).toBe("stop");
      expect(result.toolCalls).toEqual([
        { toolCallId: "tc_a", toolName: "ping", args: { n: 1 } }
      ]);
      expect(execute).toHaveBeenCalledTimes(1);
    });

    it("records one calls[] entry per external invocation regardless of surface", async () => {
      const mock = mockGenerator({
        name: "calls-counter",
        script: [
          { text: "first" },
          { text: "second" }
        ]
      });
      const resolver = createMockModelResolver({ generators: { "g": mock } });
      const model = resolver("any/model", "g");

      await model.generate({ messages: [] });
      expect(mock.calls.length).toBe(1);

      const chunks: any[] = [];
      for await (const chunk of model.stream!({ messages: [] })) {
        chunks.push(chunk);
      }
      expect(mock.calls.length).toBe(2);
    });
  });

  describe("unmocked-generator policy", () => {
    it("throws for an unmocked generator under the default policy (error)", () => {
      const resolver = createMockModelResolver({ generators: {} });
      expect(() => resolver("any/model", "missing")).toThrow(/No mock for generator/);
    });

    it("yields the caller-supplied default under policy 'default'", async () => {
      const resolver = createMockModelResolver({
        generators: {},
        policy: "default",
        unmockedDefault: { structuredOutput: { ok: true } }
      });
      const model = resolver("any/model", "missing");
      const result = await model.generate({ messages: [] });
      expect(result.structuredOutput).toEqual({ ok: true });
    });

    it("resolves a factory default with the resolved model/block info", async () => {
      const resolver = createMockModelResolver({
        generators: {},
        policy: "default",
        unmockedDefault: ({ modelId, blockName }) => ({
          text: `${blockName}@${modelId}`
        })
      });
      const result = await resolver("m1", "b1").generate({ messages: [] });
      expect(result.text).toBe("b1@m1");
    });

    it("survives repeated calls on the same default-resolved model", async () => {
      const resolver = createMockModelResolver({
        generators: {},
        policy: "default",
        unmockedDefault: { text: "fallback" }
      });
      const model = resolver("any/model", "missing");
      expect((await model.generate({ messages: [] })).text).toBe("fallback");
      expect((await model.generate({ messages: [] })).text).toBe("fallback");
    });

    it("falls back to a no-op terminal when 'default' has no unmockedDefault", async () => {
      const resolver = createMockModelResolver({ generators: {}, policy: "default" });
      const result = await resolver("any/model", "missing").generate({ messages: [] });
      expect(result.finishReason).toBe("stop");
      expect(result.text).toBeUndefined();
    });

    it("still prefers a real mock over the default fallback", async () => {
      const resolver = createMockModelResolver({
        generators: { real: mockGenerator({ name: "real", script: [{ text: "real" }] }) },
        policy: "default",
        unmockedDefault: { text: "fallback" }
      });
      expect((await resolver("m", "real").generate({ messages: [] })).text).toBe("real");
      expect((await resolver("m", "missing").generate({ messages: [] })).text).toBe("fallback");
    });
  });
});
