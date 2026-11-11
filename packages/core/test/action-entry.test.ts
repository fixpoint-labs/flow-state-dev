/**
 * A flow entry may be its block alone. `defineFlow` turns the bare block into
 * `{ block }` once, so every reader past it sees one shape, and resolves an
 * action's description from its block when the action sets none, so MCP and
 * the devtool read the same value.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "../src";
import type { ActionConfig } from "../src/types/flow";

const chat = handler({
  name: "chat",
  description: "Answer a message.",
  inputSchema: z.object({ message: z.string() }),
  execute: () => null
});
const plain = handler({ name: "plain", inputSchema: z.object({ message: z.string() }), execute: () => null });

describe("bare-block entries", () => {
  it("publishes a bare action block as `{ block }` on the blueprint and the instance", () => {
    const flow = defineFlow({ kind: "bare-actions", actions: { chat, plain } });
    expect(flow.actions.plain).toEqual({ block: plain });
    expect(flow().actions.plain).toEqual({ block: plain });
    expect(flow().actions.chat.block).toBe(chat);
  });

  it("mixes bare blocks with the object form", () => {
    const userMessage = (input: { message: string }) => input.message;
    const flow = defineFlow({ kind: "mixed", actions: { chat, plain: { block: plain, userMessage } } });
    expect(flow().actions.plain).toEqual({ block: plain, userMessage });
  });

  it("accepts a bare block for internal and task entries and reads", () => {
    const flow = defineFlow({
      kind: "bare-entries",
      actions: {},
      internal: { actions: { wake: plain } },
      reads: { view: plain }
    });
    expect(flow().internal?.actions.wake).toEqual({ block: plain });
    expect(flow().reads?.view).toEqual({ block: plain });
  });

  it("accepts a bare block as an instance's action override", () => {
    const flow = defineFlow({ kind: "bare-override", actions: { chat } });
    const actions: Record<string, ActionConfig> = flow({ actions: { extra: plain } }).actions;
    expect(actions.extra).toEqual({ block: plain });
  });

  it("still mints a definition that carries no actions map", () => {
    const flow = defineFlow({ kind: "no-actions-map" } as never);
    expect(Object.keys((flow as unknown as () => { actions: object })().actions)).toEqual([]);
  });

  it("still refuses an entry that is neither a block nor `{ block }`", () => {
    expect(() =>
      defineFlow({ kind: "bad-read", actions: {}, reads: { view: {} as never } })
    ).toThrow(/read "view" has no block/);
  });
});

describe("action description falls back to the block's", () => {
  it("resolves an unset action description from its block", () => {
    const flow = defineFlow({ kind: "desc-fallback", actions: { chat, wrapped: { block: chat } } });
    const actions: Record<string, ActionConfig> = flow().actions;
    expect(actions.chat?.description).toBe("Answer a message.");
    expect(actions.wrapped?.description).toBe("Answer a message.");
  });

  it("keeps an action's own description over its block's", () => {
    const flow = defineFlow({
      kind: "desc-override",
      actions: { chat: { block: chat, description: "Talk to the support desk." } }
    });
    expect(flow().actions.chat.description).toBe("Talk to the support desk.");
  });

  it("takes the description of the block an instance override swaps in", () => {
    const flow = defineFlow({ kind: "desc-swap", actions: { run: plain } });
    expect(flow().actions.run.description).toBeUndefined();
    expect(flow({ actions: { run: { block: chat } } }).actions.run.description).toBe("Answer a message.");
  });

  it("resolves a read's description the same way", () => {
    const flow = defineFlow({ kind: "read-desc", actions: {}, reads: { view: chat } });
    expect(flow().reads?.view.description).toBe("Answer a message.");
  });

  it("lets an MCP-exposed action rely on its block's description", () => {
    expect(() => defineFlow({ kind: "mcp-bare", mcp: { enabled: true }, actions: { chat } })).not.toThrow();
  });

  it("refuses an MCP-exposed action when neither it nor its block has a description", () => {
    expect(() => defineFlow({ kind: "mcp-none", mcp: { enabled: true }, actions: { plain } })).toThrow(
      /exposes action "plain" via MCP but the action has no description, and neither does its block "plain"/
    );
  });
});
