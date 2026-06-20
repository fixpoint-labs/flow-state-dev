/**
 * Synthesis of internal actions from inline transport `block` bindings
 * (FIX-439). When a webhook or chat binding carries a `block` instead of an
 * `action`, `defineFlow` mints an internal `ActionConfig` for it, rewrites the
 * binding to reference that action by name, and marks the action `internal`
 * so it stays off the public HTTP and MCP surface. These tests pin the
 * synthesized names, the `internal` flag, binding rewrite, resource bubbling,
 * collision detection, and the no-op path for flows without inline blocks.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "../src";
import { defineResource } from "../src/types/resource";

const noopHandler = handler({
  name: "noop",
  inputSchema: z.object({ id: z.string().optional() }),
  execute: () => undefined
});

describe("defineFlow inline-block synthesis (webhooks)", () => {
  it("synthesizes an internal action and rewrites the binding to reference it", () => {
    const flow = defineFlow({
      kind: "billing",
      actions: {},
      webhooks: {
        stripe: {
          on: {
            "invoice.paid": { block: noopHandler, input: (e) => e.payload }
          }
        }
      }
    });

    const synthName = "__wh.stripe.invoice.paid";
    expect(flow.actions[synthName]).toBeDefined();
    expect(flow.actions[synthName]?.internal).toBe(true);
    expect(flow.actions[synthName]?.block).toBe(noopHandler);

    // The binding no longer carries a bare block — it references the action.
    const binding = flow.webhooks?.stripe?.on?.["invoice.paid"];
    expect(binding?.action).toBe(synthName);
    expect(binding?.block).toBeUndefined();
  });

  it("namespaces synthesized names by provider so identical event keys don't collide", () => {
    const flow = defineFlow({
      kind: "billing",
      actions: {},
      webhooks: {
        stripe: { on: { created: { block: noopHandler, input: () => ({}) } } },
        github: { on: { created: { block: noopHandler, input: () => ({}) } } }
      }
    });

    expect(flow.actions["__wh.stripe.created"]?.internal).toBe(true);
    expect(flow.actions["__wh.github.created"]?.internal).toBe(true);
  });

  it("leaves action-form bindings untouched", () => {
    const flow = defineFlow({
      kind: "billing",
      actions: { recordPayment: { block: noopHandler } },
      webhooks: {
        stripe: {
          on: { "invoice.paid": { action: "recordPayment", input: (e) => e.payload } }
        }
      }
    });

    // No synthesized actions; only the declared one remains.
    expect(Object.keys(flow.actions)).toEqual(["recordPayment"]);
    expect(flow.webhooks?.stripe?.on?.["invoice.paid"]?.action).toBe("recordPayment");
  });

  it("throws when a synthesized name collides with an existing action", () => {
    expect(() =>
      defineFlow({
        kind: "billing",
        actions: { "__wh.stripe.invoice.paid": { block: noopHandler } },
        webhooks: {
          stripe: { on: { "invoice.paid": { block: noopHandler, input: () => ({}) } } }
        }
      })
    ).toThrow(/cannot synthesize internal action/);
  });
});

describe("defineFlow inline-block synthesis (chat)", () => {
  it("synthesizes an internal action and rewrites the binding to reference it", () => {
    const flow = defineFlow({
      kind: "support",
      actions: {},
      chat: {
        on: { mention: { block: noopHandler, input: (e) => e } }
      }
    });

    const synthName = "__chat.mention";
    expect(flow.actions[synthName]?.internal).toBe(true);
    expect(flow.actions[synthName]?.block).toBe(noopHandler);
    expect(flow.chat?.on?.mention?.action).toBe(synthName);
    expect(flow.chat?.on?.mention?.block).toBeUndefined();
  });

  it("preserves input/sessionId/when on the rewritten binding", () => {
    const input = (e: unknown) => e;
    const sessionId = () => "thread-1";
    const when = () => true;
    const flow = defineFlow({
      kind: "support",
      actions: {},
      chat: { on: { mention: { block: noopHandler, input, sessionId, when } } }
    });

    const binding = flow.chat?.on?.mention;
    expect(binding?.input).toBe(input);
    expect(binding?.sessionId).toBe(sessionId);
    expect(binding?.when).toBe(when);
  });
});

describe("defineFlow inline-block synthesis (no-op path)", () => {
  it("does not add internal actions when no binding carries a block", () => {
    const flow = defineFlow({
      kind: "support",
      actions: { reply: { block: noopHandler } },
      chat: { on: { mention: { action: "reply", input: (e) => e } } }
    });
    expect(Object.keys(flow.actions)).toEqual(["reply"]);
    expect(Object.values(flow.actions).every((a) => a.internal !== true)).toBe(true);
  });
});

describe("defineFlow inline-block synthesis (resource bubbling)", () => {
  it("bubbles an inline webhook block's declared resources into flow.resources", () => {
    const ledgerResource = defineResource({
      scope: "session",
      ref: "ledger",
      stateSchema: z.object({ entries: z.array(z.string()) })
    });
    const blockWithResource = handler({
      name: "record",
      resources: { ledger: ledgerResource },
      execute: (v) => v
    });

    const flow = defineFlow({
      kind: "billing",
      actions: {},
      webhooks: {
        stripe: {
          on: { "invoice.paid": { block: blockWithResource, input: () => ({}) } }
        }
      }
    });

    // Synthesis runs before resource collection, so the inline block's
    // resource reaches the flat flow.resources map.
    expect(flow.resources).toEqual({ ledger: ledgerResource });
  });
});
