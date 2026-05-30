import { describe, expect, it } from "vitest";
import { z } from "zod";
import { utility, sequencer } from "../src";
import { createMockContext, runForTest } from "./helpers";
describe("utility.combiner", () => {
  it("returns a handler block definition", () => {
    const block = utility.combiner({ name: "merge-results" });

    expect(block.kind).toBe("handler");
    expect(block.name).toBe("merge-results");
  });

  it("merges multiple objects with deterministic rules", async () => {
    const block = utility.combiner({ name: "object-merge" });

    await expect(
      runForTest(block, 
        [
          {
            topic: "alpha",
            tags: ["a", "shared"],
            metadata: { score: 0.4, owner: "team-a" }
          },
          {
            tags: ["shared", "b"],
            metadata: { score: 0.9 },
            summary: "done"
          }
        ],
        createMockContext()
      )
    ).resolves.toEqual({
      combined: {
        topic: "alpha",
        tags: ["a", "shared", "b"],
        metadata: { score: 0.9, owner: "team-a" },
        summary: "done"
      },
      mergeNotes: [
        "combined.tags: deduplicated array entries during merge.",
        "combined.metadata.score: conflicting values resolved by taking the later artifact."
      ]
    });
  });

  it("concatenates and deduplicates top-level arrays", async () => {
    const block = utility.combiner({ name: "array-merge" });

    await expect(
      runForTest(block, 
        [
          ["a", "b", "shared"],
          ["shared", "c"],
          ["c", "d"]
        ],
        createMockContext()
      )
    ).resolves.toEqual({
      combined: ["a", "b", "shared", "c", "d"],
      mergeNotes: ["combined: deduplicated array entries during merge."]
    });
  });

  it("normalizes mixed input artifact types", async () => {
    const block = utility.combiner({ name: "mixed-merge" });

    await expect(
      runForTest(block, 
        {
          artifacts: [
            { id: 1 },
            "note",
            { id: 1 },
            ["a"],
            "note"
          ]
        },
        createMockContext()
      )
    ).resolves.toEqual({
      combined: [{ id: 1 }, "note", ["a"]],
      mergeNotes: [
        "Mixed artifact types detected; normalized by preserving artifact order and deduplicating exact matches."
      ]
    });
  });

  it("uses default output schema and supports override", async () => {
    const defaultBlock = utility.combiner({ name: "default-schema" });
    const customBlock = utility.combiner({
      name: "custom-schema",
      outputSchema: z.object({
        combined: z.object({ title: z.string() }),
        mergeNotes: z.array(z.string()).optional()
      })
    });

    await expect(runForTest(defaultBlock, [], createMockContext())).resolves.toEqual({
      combined: [],
      mergeNotes: ["No artifacts provided; returned an empty combined array."]
    });

    await expect(
      runForTest(customBlock, [{ title: "first" }, { title: "second" }], createMockContext())
    ).resolves.toEqual({
      combined: { title: "second" },
      mergeNotes: ["combined.title: conflicting values resolved by taking the later artifact."]
    });
  });

  it("is composable inside sequencers", async () => {
    const combine = utility.combiner({ name: "combine-in-sequencer" });

    const chain = sequencer({
      name: "combine-chain",
      inputSchema: z.object({
        primary: z.object({
          tags: z.array(z.string())
        }),
        secondary: z.object({
          tags: z.array(z.string())
        })
      })
    })
      .map((input) => [input.primary, input.secondary])
      .step(combine);

    await expect(
      runForTest(chain, 
        {
          primary: { tags: ["a", "shared"] },
          secondary: { tags: ["shared", "b"] }
        },
        createMockContext()
      )
    ).resolves.toEqual({
      combined: {
        tags: ["a", "shared", "b"]
      },
      mergeNotes: ["combined.tags: deduplicated array entries during merge."]
    });
  });
});
