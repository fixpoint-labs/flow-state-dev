/**
 * Tests for the `mcp` config validation surface added to `defineFlow`.
 * Mirrors the rules defined in the FIX-22 spec § 3.2 and § 3.4.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "../src";

const noopBlock = handler({
  name: "noop",
  inputSchema: z.object({}),
  execute: () => undefined
});

describe("defineFlow mcp config validation", () => {
  it("accepts a flow with mcp.enabled: false (default) and no descriptions", () => {
    expect(() =>
      defineFlow({
        kind: "demo",
        actions: {
          run: { inputSchema: z.object({}), block: noopBlock }
        }
      })
    ).not.toThrow();
  });

  it("requires description on every exposed action when mcp.enabled is true", () => {
    expect(() =>
      defineFlow({
        kind: "demo",
        mcp: { enabled: true },
        actions: {
          run: { inputSchema: z.object({}), block: noopBlock }
        }
      })
    ).toThrow(/exposes action "run" via MCP but the action has no description/);
  });

  it("rejects empty-string descriptions", () => {
    expect(() =>
      defineFlow({
        kind: "demo",
        mcp: { enabled: true },
        actions: {
          run: { inputSchema: z.object({}), block: noopBlock, description: "   " }
        }
      })
    ).toThrow(/no description/);
  });

  it("accepts an exposed action with a non-empty description", () => {
    expect(() =>
      defineFlow({
        kind: "demo",
        mcp: { enabled: true },
        actions: {
          run: {
            inputSchema: z.object({}),
            block: noopBlock,
            description: "Run the thing."
          }
        }
      })
    ).not.toThrow();
  });

  it("does not require description on actions opted out via action.mcp.enabled: false", () => {
    expect(() =>
      defineFlow({
        kind: "demo",
        mcp: { enabled: true },
        actions: {
          run: {
            inputSchema: z.object({}),
            block: noopBlock,
            description: "Public."
          },
          internal: {
            inputSchema: z.object({}),
            block: noopBlock,
            mcp: { enabled: false }
          }
        }
      })
    ).not.toThrow();
  });

  it("does not require description on actions outside mcp.exposeActions allowlist", () => {
    expect(() =>
      defineFlow({
        kind: "demo",
        mcp: { enabled: true, exposeActions: ["public"] },
        actions: {
          public: {
            inputSchema: z.object({}),
            block: noopBlock,
            description: "Public."
          },
          private: { inputSchema: z.object({}), block: noopBlock }
        }
      })
    ).not.toThrow();
  });

  it("rejects exposeActions referencing a missing action", () => {
    expect(() =>
      defineFlow({
        kind: "demo",
        mcp: { enabled: true, exposeActions: ["nope"] },
        actions: {
          run: {
            inputSchema: z.object({}),
            block: noopBlock,
            description: "Run."
          }
        }
      })
    ).toThrow(/mcp\.exposeActions references unknown action "nope"/);
  });

  it("propagates mcp config onto FlowInstance", () => {
    const flow = defineFlow({
      kind: "demo",
      mcp: { enabled: true, exposeResources: false },
      actions: {
        run: {
          inputSchema: z.object({}),
          block: noopBlock,
          description: "Run."
        }
      }
    });
    expect(flow.mcp?.enabled).toBe(true);
    expect(flow.mcp?.exposeResources).toBe(false);
    const instance = flow();
    expect(instance.mcp?.enabled).toBe(true);
  });
});
