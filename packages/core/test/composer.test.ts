import { describe, expect, it } from "vitest";
import { z } from "zod";
import { macro, sequencer } from "../src";
import { createMockContext } from "./helpers";

describe("macro.composer", () => {
  it("returns a generator block definition", () => {
    const block = macro.composer({
      name: "compose-report"
    });

    expect(block.kind).toBe("generator");
    expect(block.name).toBe("compose-report");
  });

  it("composes output from multiple parts", async () => {
    const block = macro.composer({
      name: "compose-multi-part"
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate() {
          return {
            structuredOutput: {
              composed: "Intro\n\nBody\n\nConclusion",
              structure: ["intro", "body", "conclusion"]
            }
          };
        }
      })
    });

    await expect(
      block.run(
        {
          parts: [
            { id: "intro", content: "Intro" },
            { id: "body", content: "Body" },
            { id: "conclusion", content: "Conclusion" }
          ],
          constraints: {
            ordering: ["intro", "body", "conclusion"]
          }
        },
        ctx
      )
    ).resolves.toEqual({
      composed: "Intro\n\nBody\n\nConclusion",
      structure: ["intro", "body", "conclusion"]
    });
  });

  it("adds objective guidance when provided", async () => {
    const seenMessages: unknown[] = [];
    const block = macro.composer({
      name: "objective-focused",
      objectives: ["Preserve chronology", "Keep section headings"]
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate(options: any) {
          seenMessages.push(...options.messages);
          return { structuredOutput: { composed: "assembled" } };
        }
      })
    });

    await expect(block.run({ parts: ["a", "b"] }, ctx)).resolves.toEqual({ composed: "assembled" });
    const serialized = JSON.stringify(seenMessages);
    expect(serialized).toContain("Focus the composition on these objectives");
    expect(serialized).toContain("Preserve chronology");
    expect(serialized).toContain("Keep section headings");
  });

  it("uses default output schema and supports override", async () => {
    const defaultBlock = macro.composer({ name: "default-schema" });
    const customBlock = macro.composer({
      name: "custom-schema",
      outputSchema: z.object({
        composed: z.string(),
        confidence: z.number()
      })
    });

    const defaultCtx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate() {
          return {
            structuredOutput: { composed: "ok", structure: ["intro", "body"] }
          };
        }
      })
    });

    const customCtx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate() {
          return { structuredOutput: { composed: "ok", confidence: 0.95 } };
        }
      })
    });

    await expect(defaultBlock.run({ parts: ["x"] }, defaultCtx)).resolves.toEqual({
      composed: "ok",
      structure: ["intro", "body"]
    });
    await expect(customBlock.run({ parts: ["x"] }, customCtx)).resolves.toEqual({
      composed: "ok",
      confidence: 0.95
    });
  });

  it("is composable inside sequencers", async () => {
    const compose = macro.composer({
      name: "compose-in-sequencer"
    });

    const chain = sequencer({
      name: "composition-chain",
      inputSchema: z.object({ parts: z.array(z.string()) })
    })
      .map((input) => ({ parts: input.parts }))
      .then(compose);

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate() {
          return {
            structuredOutput: {
              composed: "A\nB"
            }
          };
        }
      })
    });

    await expect(chain.run({ parts: ["A", "B"] }, ctx)).resolves.toEqual({ composed: "A\nB" });
  });
});
