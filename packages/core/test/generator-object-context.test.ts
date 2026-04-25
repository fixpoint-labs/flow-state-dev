/**
 * Integration tests for object-form generator context (FIX-434).
 *
 * Captures the messages array that flows into the model and asserts on
 * the system-message shape: prompt prose followed by a single combined
 * XML block, with cross-source contributions aggregated under shared tags.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineCapability } from "../src/capability";
import { generator } from "../src/blocks/generator";
import { createMockContext } from "./helpers";

interface CapturedCall {
  messages: unknown[];
}

function makeCapturingModel(captured: CapturedCall[]) {
  return {
    modelId: "mock-model",
    async generate(options: { messages: unknown[] }) {
      captured.push({ messages: options.messages });
      return { text: "ok" };
    },
  };
}

function systemMessages(call: CapturedCall): Array<{ role: string; content: string }> {
  return call.messages.filter(
    (m): m is { role: string; content: string } =>
      m !== null &&
      typeof m === "object" &&
      "role" in m &&
      (m as { role: unknown }).role === "system"
  );
}

describe("generator object-form context (FIX-434)", () => {
  it("emits a single combined system message with prompt + XML context", async () => {
    const captured: CapturedCall[] = [];
    const block = generator({
      name: "obj-context",
      model: "mock-model",
      prompt: "You are helpful.",
      context: { documents: "doc body" },
    });
    const ctx = createMockContext({
      resolveModel: () => makeCapturingModel(captured),
    });
    await block.run({ value: 1 }, ctx);

    const sys = systemMessages(captured[0]!);
    expect(sys).toHaveLength(1);
    expect(sys[0]!.content).toBe(
      "You are helpful.\n\n<documents>\n  doc body\n</documents>"
    );
  });

  it("aggregates same-key contributions from two capabilities into one tag", async () => {
    const capA = defineCapability({
      name: "cap-a",
      presets: {
        defaults: { context: () => ({ documents: "from-A" }) },
      },
    });
    const capB = defineCapability({
      name: "cap-b",
      presets: {
        defaults: { context: () => ({ documents: "from-B" }) },
      },
    });

    const captured: CapturedCall[] = [];
    const block = generator({
      name: "two-caps",
      model: "mock-model",
      prompt: "P",
      uses: [capA, capB],
    });
    const ctx = createMockContext({
      resolveModel: () => makeCapturingModel(captured),
    });
    await block.run({ value: 1 }, ctx);

    const sys = systemMessages(captured[0]!);
    expect(sys).toHaveLength(1);
    expect(sys[0]!.content).toBe(
      "P\n\n<documents>\n  from-A\n  from-B\n</documents>"
    );
  });

  it("normalizes tag names so camelCase + snake_case + kebab-case merge", async () => {
    const captured: CapturedCall[] = [];
    const block = generator({
      name: "normalized",
      model: "mock-model",
      prompt: "P",
      context: [
        { userPreferences: "a" },
        { user_preferences: "b" },
        { "user-preferences": "c" },
      ],
    });
    const ctx = createMockContext({
      resolveModel: () => makeCapturingModel(captured),
    });
    await block.run({ value: 1 }, ctx);

    const sys = systemMessages(captured[0]!);
    expect(sys[0]!.content).toBe(
      "P\n\n<user-preferences>\n  a\n  b\n  c\n</user-preferences>"
    );
  });

  it("renders nested object values as nested XML tags", async () => {
    const captured: CapturedCall[] = [];
    const block = generator({
      name: "nested",
      model: "mock-model",
      prompt: "P",
      context: {
        memory: {
          shortTerm: "recent",
          longTerm: "older",
        },
      },
    });
    const ctx = createMockContext({
      resolveModel: () => makeCapturingModel(captured),
    });
    await block.run({ value: 1 }, ctx);

    const sys = systemMessages(captured[0]!);
    expect(sys[0]!.content).toBe(
      "P\n\n<memory>\n  <short-term>\n    recent\n  </short-term>\n  <long-term>\n    older\n  </long-term>\n</memory>"
    );
  });

  it("omits placeholder tags that nobody fills", async () => {
    const captured: CapturedCall[] = [];
    const block = generator({
      name: "placeholder",
      model: "mock-model",
      prompt: "P",
      context: { documents: null, memory: "m" },
    });
    const ctx = createMockContext({
      resolveModel: () => makeCapturingModel(captured),
    });
    await block.run({ value: 1 }, ctx);

    const sys = systemMessages(captured[0]!);
    expect(sys[0]!.content).toBe("P\n\n<memory>\n  m\n</memory>");
  });

  it("preserves placeholder ordering when a contributor fills it", async () => {
    const cap = defineCapability({
      name: "filler",
      presets: {
        defaults: { context: () => ({ documents: "filled" }) },
      },
    });
    const captured: CapturedCall[] = [];
    const block = generator({
      name: "ordered",
      model: "mock-model",
      prompt: "P",
      uses: [cap],
      context: { documents: null, memory: "m" },
    });
    const ctx = createMockContext({
      resolveModel: () => makeCapturingModel(captured),
    });
    await block.run({ value: 1 }, ctx);

    const sys = systemMessages(captured[0]!);
    expect(sys[0]!.content).toBe(
      "P\n\n<documents>\n  filled\n</documents>\n<memory>\n  m\n</memory>"
    );
  });

  it("array-form string entries continue to emit as separate system messages", async () => {
    const captured: CapturedCall[] = [];
    const block = generator({
      name: "string-entries",
      model: "mock-model",
      prompt: "P",
      context: ["string-entry-1", "string-entry-2"],
    });
    const ctx = createMockContext({
      resolveModel: () => makeCapturingModel(captured),
    });
    await block.run({ value: 1 }, ctx);

    const sys = systemMessages(captured[0]!);
    // Combined message holds just the prompt (no tagged content), then two string entries.
    expect(sys.map((m) => m.content)).toEqual([
      "P",
      "string-entry-1",
      "string-entry-2",
    ]);
  });

  it("escapes <, >, & in string-leaf content", async () => {
    const captured: CapturedCall[] = [];
    const block = generator({
      name: "escape",
      model: "mock-model",
      prompt: "P",
      context: { documents: "x < y & z > w" },
    });
    const ctx = createMockContext({
      resolveModel: () => makeCapturingModel(captured),
    });
    await block.run({ value: 1 }, ctx);

    const sys = systemMessages(captured[0]!);
    expect(sys[0]!.content).toBe(
      "P\n\n<documents>\n  x &lt; y &amp; z &gt; w\n</documents>"
    );
  });

  it("rejects reserved tag names at render time", async () => {
    const captured: CapturedCall[] = [];
    const block = generator({
      name: "reserved",
      model: "mock-model",
      prompt: "P",
      context: { tool_use: "x" },
    });
    const ctx = createMockContext({
      resolveModel: () => makeCapturingModel(captured),
    });
    await expect(block.run({ value: 1 }, ctx)).rejects.toThrow(
      /Reserved context tag name/
    );
  });

  it("rejects type mismatches between contributors", async () => {
    const captured: CapturedCall[] = [];
    const block = generator({
      name: "mismatch",
      model: "mock-model",
      prompt: "P",
      context: [{ memory: "scalar" }, { memory: { sub: "nested" } }],
    });
    const ctx = createMockContext({
      resolveModel: () => makeCapturingModel(captured),
    });
    await expect(block.run({ value: 1 }, ctx)).rejects.toThrow(/type mismatch/);
  });
});
