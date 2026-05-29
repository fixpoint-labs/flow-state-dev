import { describe, expect, it } from "vitest";
import { z } from "zod";
import { utility, sequencer } from "../src";
import { createMockContext, runForTest } from "./helpers";
describe("utility.contextReducer", () => {
  it("returns a generator block definition", () => {
    const block = utility.contextReducer({
      name: "reduce-context"
    });

    expect(block.kind).toBe("generator");
    expect(block.name).toBe("reduce-context");
  });

  it("supports distill mode instructions", async () => {
    const seenMessages: unknown[] = [];
    const block = utility.contextReducer({
      name: "distill-mode",
      mode: "distill"
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate(options: any) {
          seenMessages.push(...options.messages);
          return {
            structuredOutput: {
              distilled: "Most important ideas",
              keyPoints: ["decision", "constraint"]
            }
          };
        }
      })
    });

    await expect(runForTest(block, "source text", ctx)).resolves.toEqual({
      distilled: "Most important ideas",
      keyPoints: ["decision", "constraint"]
    });
    expect(JSON.stringify(seenMessages)).toContain("distillation assistant");
    expect(JSON.stringify(seenMessages)).toContain("highest-signal");
  });

  it("supports denoise mode instructions", async () => {
    const seenMessages: unknown[] = [];
    const block = utility.contextReducer({
      name: "denoise-mode",
      mode: "denoise"
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate(options: any) {
          seenMessages.push(...options.messages);
          return {
            structuredOutput: {
              cleaned: "Cleaned context",
              removedCategories: ["repetition"]
            }
          };
        }
      })
    });

    await expect(runForTest(block, "source text", ctx)).resolves.toEqual({
      cleaned: "Cleaned context",
      removedCategories: ["repetition"]
    });
    expect(JSON.stringify(seenMessages)).toContain("denoising assistant");
    expect(JSON.stringify(seenMessages)).toContain("Preserve original intent");
  });

  it("supports compress mode instructions", async () => {
    const seenMessages: unknown[] = [];
    const block = utility.contextReducer({
      name: "compress-mode",
      mode: "compress"
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate(options: any) {
          seenMessages.push(...options.messages);
          return {
            structuredOutput: {
              compressed: "Compressed context",
              compressionRatio: 0.35,
              dropped: ["examples"]
            }
          };
        }
      })
    });

    await expect(runForTest(block, "source text", ctx)).resolves.toEqual({
      compressed: "Compressed context",
      compressionRatio: 0.35,
      dropped: ["examples"]
    });
    expect(JSON.stringify(seenMessages)).toContain("compression assistant");
    expect(JSON.stringify(seenMessages)).toContain("strict token or length budgets");
  });

  it("uses default output schema and supports override", async () => {
    const defaultBlock = utility.contextReducer({ name: "default-schema", mode: "compress" });
    const customBlock = utility.contextReducer({
      name: "custom-schema",
      mode: "compress",
      outputSchema: z.object({
        compressed: z.string(),
        tokensSaved: z.number()
      })
    });

    const defaultCtx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate() {
          return {
            structuredOutput: {
              compressed: "ok",
              compressionRatio: 0.4,
              dropped: ["small-talk"]
            }
          };
        }
      })
    });

    const customCtx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate() {
          return { structuredOutput: { compressed: "ok", tokensSaved: 120 } };
        }
      })
    });

    await expect(runForTest(defaultBlock, "x", defaultCtx)).resolves.toEqual({
      compressed: "ok",
      compressionRatio: 0.4,
      dropped: ["small-talk"]
    });
    await expect(runForTest(customBlock, "x", customCtx)).resolves.toEqual({
      compressed: "ok",
      tokensSaved: 120
    });
  });

  it("is composable inside sequencers", async () => {
    const reduce = utility.contextReducer({
      name: "reduce-in-sequencer",
      mode: "distill"
    });

    const chain = sequencer({
      name: "reducer-chain",
      inputSchema: z.object({ source: z.string() })
    })
      .map((input) => input.source)
      .step(reduce);

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate() {
          return {
            structuredOutput: {
              distilled: "condensed",
              keyPoints: ["k1"]
            }
          };
        }
      })
    });

    await expect(runForTest(chain, { source: "details" }, ctx)).resolves.toEqual({
      distilled: "condensed",
      keyPoints: ["k1"]
    });
  });
});
