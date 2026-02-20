import { describe, expect, it } from "vitest";
import { z } from "zod";
import { handler } from "../src";
import { createMockContext } from "./helpers";

describe("handler builder", () => {
  it("builds a handler block definition", async () => {
    const block = handler<string, { message: string }>({
      name: "hello",
      inputSchema: z.string(),
      outputSchema: z.object({ message: z.string() }),
      execute: (input) => ({ message: `hi ${input}` })
    });

    const ctx = createMockContext();
    expect(block.kind).toBe("handler");
    await expect(block.run("team", ctx)).resolves.toEqual({ message: "hi team" });
  });
});
