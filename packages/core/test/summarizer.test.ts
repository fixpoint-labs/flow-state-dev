import { describe, expect, it } from "vitest";
import { z } from "zod";
import { helper, sequencer } from "../src";
import { createMockContext } from "./helpers";

describe("helper.summarizer", () => {
  it("returns a generator block definition", () => {
    const block = helper.summarizer({
      name: "summarize-brief"
    });

    expect(block.kind).toBe("generator");
    expect(block.name).toBe("summarize-brief");
  });

  it("supports brief granularity instructions", async () => {
    const seenMessages: unknown[] = [];
    const block = helper.summarizer({
      name: "brief",
      granularity: "brief"
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate(options: any) {
          seenMessages.push(...options.messages);
          return { structuredOutput: { summary: "short" } };
        }
      })
    });

    await expect(block.run("source text", ctx)).resolves.toEqual({ summary: "short" });
    expect(JSON.stringify(seenMessages)).toContain("1-2 sentence");
  });

  it("supports detailed granularity instructions", async () => {
    const seenMessages: unknown[] = [];
    const block = helper.summarizer({
      name: "detailed",
      granularity: "detailed"
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate(options: any) {
          seenMessages.push(...options.messages);
          return { structuredOutput: { summary: "long" } };
        }
      })
    });

    await expect(block.run("source text", ctx)).resolves.toEqual({ summary: "long" });
    expect(JSON.stringify(seenMessages)).toContain("paragraph-level");
  });

  it("supports executive granularity instructions", async () => {
    const seenMessages: unknown[] = [];
    const block = helper.summarizer({
      name: "executive",
      granularity: "executive"
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate(options: any) {
          seenMessages.push(...options.messages);
          return { structuredOutput: { summary: "exec", keyPoints: ["k1"] } };
        }
      })
    });

    await expect(block.run("source text", ctx)).resolves.toEqual({ summary: "exec", keyPoints: ["k1"] });
    expect(JSON.stringify(seenMessages)).toContain("key decisions");
    expect(JSON.stringify(seenMessages)).toContain("recommendations");
  });

  it("uses default output schema and supports override", async () => {
    const defaultBlock = helper.summarizer({ name: "default-schema" });
    const customBlock = helper.summarizer({
      name: "custom-schema",
      outputSchema: z.object({
        summary: z.string(),
        confidence: z.number()
      })
    });

    const defaultCtx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate() {
          return { structuredOutput: { summary: "ok", keyPoints: ["a"] } };
        }
      })
    });

    const customCtx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate() {
          return { structuredOutput: { summary: "ok", confidence: 0.9 } };
        }
      })
    });

    await expect(defaultBlock.run("x", defaultCtx)).resolves.toEqual({ summary: "ok", keyPoints: ["a"] });
    await expect(customBlock.run("x", customCtx)).resolves.toEqual({ summary: "ok", confidence: 0.9 });
  });

  it("is composable inside sequencers", async () => {
    const summarize = helper.summarizer({
      name: "summarize-in-sequencer"
    });

    const chain = sequencer({
      name: "summary-chain",
      inputSchema: z.object({ source: z.string() })
    })
      .map((input) => input.source)
      .then(summarize);

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate() {
          return { structuredOutput: { summary: "condensed" } };
        }
      })
    });

    await expect(chain.run({ source: "details" }, ctx)).resolves.toEqual({ summary: "condensed" });
  });
});
