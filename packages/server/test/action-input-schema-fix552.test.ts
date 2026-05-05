/**
 * FIX-552: action.inputSchema is optional and falls back to block.inputSchema.
 * Action-level override still validates first when provided.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { createInMemoryStores, runAction } from "../src";

describe("FIX-552: optional action.inputSchema", () => {
  it("falls back to block.inputSchema when action.inputSchema is omitted", async () => {
    const echo = handler({
      name: "echo",
      inputSchema: z.object({ message: z.string().min(1) }),
      outputSchema: z.string(),
      execute: ({ message }) => message
    });

    const flow = defineFlow({
      kind: "fix552-fallback",
      actions: {
        run: { block: echo }
      }
    })();

    const ok = await runAction({
      flow,
      actionName: "run",
      input: { message: "hello" },
      userId: "u1",
      sessionId: "s1",
      stores: createInMemoryStores()
    });
    expect(ok.error).toBeUndefined();
    expect(ok.output).toBe("hello");

    const bad = await runAction({
      flow,
      actionName: "run",
      input: { message: "" },
      userId: "u1",
      sessionId: "s2",
      stores: createInMemoryStores()
    });
    expect(bad.error?.message).toMatch(/Action input validation failed/);
  });

  it("uses the explicit action.inputSchema when provided (narrower than block)", async () => {
    // Block accepts any string; action narrows to length >= 3.
    const echo = handler({
      name: "echo-loose",
      inputSchema: z.object({ message: z.string() }),
      outputSchema: z.string(),
      execute: ({ message }) => message
    });

    const flow = defineFlow({
      kind: "fix552-narrow",
      actions: {
        run: {
          block: echo,
          inputSchema: z.object({ message: z.string().min(3) })
        }
      }
    })();

    const rejected = await runAction({
      flow,
      actionName: "run",
      input: { message: "hi" },
      userId: "u1",
      sessionId: "s1",
      stores: createInMemoryStores()
    });
    expect(rejected.error?.message).toMatch(/Action input validation failed/);

    const accepted = await runAction({
      flow,
      actionName: "run",
      input: { message: "hello" },
      userId: "u1",
      sessionId: "s2",
      stores: createInMemoryStores()
    });
    expect(accepted.error).toBeUndefined();
    expect(accepted.output).toBe("hello");
  });

  it("typed userMessage callback sees block.inputSchema's inferred input when action.inputSchema is omitted", async () => {
    const echo = handler({
      name: "echo",
      inputSchema: z.object({ message: z.string() }),
      outputSchema: z.string(),
      execute: ({ message }) => message
    });

    let captured = "";
    const flow = defineFlow({
      kind: "fix552-userMessage",
      actions: {
        run: {
          block: echo,
          userMessage: (input) => {
            captured = input.message;
            return input.message;
          }
        }
      }
    })();

    const result = await runAction({
      flow,
      actionName: "run",
      input: { message: "hi" },
      userId: "u1",
      sessionId: "s1",
      stores: createInMemoryStores()
    });
    expect(result.error).toBeUndefined();
    expect(captured).toBe("hi");
  });
});
