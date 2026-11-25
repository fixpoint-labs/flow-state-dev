import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { defineProjectedResourceCollection, handler } from "../src";
import type { BlockContext, InferResourcesFromDefinitions } from "../src/types/block";
import { createMockContext, runForTest } from "./helpers";
describe("handler builder", () => {
  it("builds a handler block definition", async () => {
    const block = handler({
      name: "hello",
      inputSchema: z.string(),
      outputSchema: z.object({ message: z.string() }),
      execute: (input) => ({ message: `hi ${input}` })
    });

    const ctx = createMockContext();
    expect(block.kind).toBe("handler");
    await expect(runForTest(block, "team", ctx)).resolves.toEqual({ message: "hi team" });
  });

  it("keeps conditionally declared resource handles optional and typed", () => {
    const notes = defineProjectedResourceCollection({
      pattern: "notes/*",
      scope: "user",
      stateSchema: z.object({ body: z.string() }),
      read: async () => null,
      search: async () => ({ hits: [] })
    });
    type NotesRef = InferResourcesFromDefinitions<{ notes: typeof notes }>["notes"];
    const block = (enabled: boolean) => handler({
      name: "optional-notes",
      resources: { ...(enabled ? { notes } : {}) },
      execute: async (_input, ctx) => {
        expectTypeOf(ctx).toExtend<BlockContext>();
        expectTypeOf(ctx.resources.notes).toEqualTypeOf<NotesRef | undefined>();
        expectTypeOf(ctx.resources.get("notes")).toEqualTypeOf<NotesRef>();
        expectTypeOf(ctx.resources.list()).toEqualTypeOf<NotesRef[]>();
        return (await ctx.resources.notes?.list())?.items ?? [];
      }
    });

    expect(block(false).declaredResources?.notes).toBeUndefined();
    expect(block(true).declaredResources?.notes).toBe(notes);
  });
});
