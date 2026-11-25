import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineProjectedResourceCollection, handler } from "../src";
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

  it("registers a conditional resource only when enabled", () => {
    const notes = defineProjectedResourceCollection({
      pattern: "notes/*",
      scope: "user",
      stateSchema: z.object({ body: z.string() }),
      read: async () => null,
      search: async () => ({ hits: [] })
    });
    const block = (enabled: boolean) => handler({
      name: "optional-notes",
      resources: { ...(enabled ? { notes } : {}) },
      execute: () => undefined
    });

    expect(block(false).declaredResources?.notes).toBeUndefined();
    expect(block(true).declaredResources?.notes).toBe(notes);
  });
});
