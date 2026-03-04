import { describe, expect, it } from "vitest";
import { z } from "zod";
import { utility, sequencer } from "../src";
import { createMockContext } from "./helpers";

describe("utility.memoryExtractor", () => {
  it("returns a generator block definition", () => {
    const block = utility.memoryExtractor({
      name: "extract-memories"
    });

    expect(block.kind).toBe("generator");
    expect(block.name).toBe("extract-memories");
  });

  it("uses a default output schema with memory type classification", async () => {
    const block = utility.memoryExtractor({ name: "default-schema" });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate() {
          return {
            structuredOutput: {
              memories: [
                { type: "fact", content: "User is in Berlin", confidence: 0.8, source: "chat" },
                { type: "preference", content: "Prefers concise answers" },
                { type: "constraint", content: "Cannot use Docker" },
                { type: "decision", content: "Ship on Friday" }
              ]
            }
          };
        }
      })
    });

    await expect(block.run("conversation", ctx)).resolves.toEqual({
      memories: [
        { type: "fact", content: "User is in Berlin", confidence: 0.8, source: "chat" },
        { type: "preference", content: "Prefers concise answers" },
        { type: "constraint", content: "Cannot use Docker" },
        { type: "decision", content: "Ship on Friday" }
      ]
    });
  });

  it("supports override output schemas", async () => {
    const block = utility.memoryExtractor({
      name: "custom-schema",
      outputSchema: z.object({
        memories: z.array(
          z.object({
            type: z.enum(["fact", "preference", "constraint", "decision"]),
            content: z.string()
          })
        ),
        summary: z.string()
      })
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate() {
          return {
            structuredOutput: {
              memories: [{ type: "fact", content: "Team is remote" }],
              summary: "one durable memory"
            }
          };
        }
      })
    });

    await expect(block.run("conversation", ctx)).resolves.toEqual({
      memories: [{ type: "fact", content: "Team is remote" }],
      summary: "one durable memory"
    });
  });

  it("extracts from varied input types by serializing non-string input", async () => {
    const seenMessages: unknown[] = [];
    const block = utility.memoryExtractor({ name: "varied-input" });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate(options: any) {
          seenMessages.push(...options.messages);
          return {
            structuredOutput: {
              memories: [{ type: "decision", content: "Adopt semantic release" }]
            }
          };
        }
      })
    });

    await expect(
      block.run(
        {
          conversation: [
            { role: "user", content: "I prefer markdown answers" },
            { role: "assistant", content: "Noted" }
          ],
          artifacts: [{ id: "a-1", notes: "Decision: use pnpm" }]
        },
        ctx
      )
    ).resolves.toEqual({
      memories: [{ type: "decision", content: "Adopt semantic release" }]
    });

    const serialized = JSON.stringify(seenMessages);
    expect(serialized).toContain("conversation");
    expect(serialized).toContain("artifacts");
    expect(serialized).toContain("prefer markdown answers");
  });

  it("is composable inside sequencers", async () => {
    const extract = utility.memoryExtractor({
      name: "extract-in-sequencer"
    });

    const chain = sequencer({
      name: "memory-chain",
      inputSchema: z.object({ content: z.string() })
    })
      .map((input) => ({ transcript: input.content }))
      .then(extract);

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "m",
        async generate() {
          return {
            structuredOutput: {
              memories: [{ type: "preference", content: "Likes checklists" }]
            }
          };
        }
      })
    });

    await expect(chain.run({ content: "User likes checklists" }, ctx)).resolves.toEqual({
      memories: [{ type: "preference", content: "Likes checklists" }]
    });
  });
});
