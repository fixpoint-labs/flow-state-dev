/**
 * Registration-time validation for the per-flow `webhooks` config (FIX-439).
 * A webhook binding is an action in webhook form: it carries the handler
 * `block` inline plus the event mapping. Covers `validateWebhookConfig`
 * directly and through `defineFlow`: a provider without an `on` map throws, a
 * binding missing its `block` or with malformed `input`/`sessionId`/`when`
 * throws, and absent configs are accepted as no-ops. Also covers
 * `defineWebhookBinding` passthrough.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "../src";
import { defineResource } from "../src/types/resource";
import {
  defineWebhookBinding,
  validateWebhookConfig,
  type WebhookConfig
} from "../src/types/webhooks";

const noopHandler = handler({
  name: "record",
  inputSchema: z.object({ id: z.string().optional() }),
  execute: () => undefined
});

describe("validateWebhookConfig", () => {
  it("is a no-op when webhooks is absent", () => {
    expect(() => validateWebhookConfig("billing", undefined)).not.toThrow();
  });

  it("accepts a minimal valid `on` subscription", () => {
    const webhooks: WebhookConfig = {
      stripe: { on: { "invoice.paid": { block: noopHandler, input: () => ({}) } } }
    };
    expect(() => validateWebhookConfig("billing", webhooks)).not.toThrow();
  });

  it("rejects a provider declaring no `on` map", () => {
    const webhooks = { stripe: {} } as unknown as WebhookConfig;
    expect(() => validateWebhookConfig("billing", webhooks)).toThrow(/must be an object with an `on`/);
  });

  it("rejects an empty provider key", () => {
    const webhooks: WebhookConfig = {
      "": { on: { "invoice.paid": { block: noopHandler, input: () => ({}) } } }
    };
    expect(() => validateWebhookConfig("billing", webhooks)).toThrow(/empty name/);
  });

  it("rejects a binding with no `block`", () => {
    const webhooks = {
      stripe: { on: { "invoice.paid": { input: () => ({}) } } }
    } as unknown as WebhookConfig;
    expect(() => validateWebhookConfig("billing", webhooks)).toThrow(/must declare a `block`/);
  });

  it("rejects a `block` that is not a block definition", () => {
    const webhooks = {
      stripe: { on: { "invoice.paid": { block: "nope", input: () => ({}) } } }
    } as unknown as WebhookConfig;
    expect(() => validateWebhookConfig("billing", webhooks)).toThrow(/must declare a `block`/);
  });

  it("rejects an empty event key", () => {
    const webhooks: WebhookConfig = {
      stripe: { on: { "": { block: noopHandler, input: () => ({}) } } }
    };
    expect(() => validateWebhookConfig("billing", webhooks)).toThrow(/empty event key/);
  });

  it("rejects a non-function input", () => {
    const webhooks = {
      stripe: { on: { "invoice.paid": { block: noopHandler, input: "nope" } } }
    } as unknown as WebhookConfig;
    expect(() => validateWebhookConfig("billing", webhooks)).toThrow(/`input`/);
  });

  it("rejects a non-function sessionId", () => {
    const webhooks = {
      stripe: {
        on: { "invoice.paid": { block: noopHandler, input: () => ({}), sessionId: "x" } }
      }
    } as unknown as WebhookConfig;
    expect(() => validateWebhookConfig("billing", webhooks)).toThrow(/`sessionId`/);
  });

  it("rejects a non-function when predicate", () => {
    const webhooks = {
      stripe: {
        on: { "invoice.paid": { block: noopHandler, input: () => ({}), when: true } }
      }
    } as unknown as WebhookConfig;
    expect(() => validateWebhookConfig("billing", webhooks)).toThrow(/`when`/);
  });
});

describe("defineWebhookBinding", () => {
  it("returns the binding unchanged (runtime passthrough)", () => {
    const input = (e: { payload: { id: string } }) => ({ id: e.payload.id });
    const binding = defineWebhookBinding<{ id: string }>({ block: noopHandler, input });
    expect(binding.block).toBe(noopHandler);
    expect(binding.input).toBe(input);
  });

  it("carries action-core execution policy (e.g. durable)", () => {
    const binding = defineWebhookBinding({ block: noopHandler, durable: true, input: () => ({}) });
    expect(binding.durable).toBe(true);
  });
});

describe("defineFlow with webhooks config", () => {
  it("registers a flow declaring valid webhook subscriptions", () => {
    const flow = defineFlow({
      kind: "billing",
      actions: {},
      webhooks: {
        stripe: {
          on: {
            "invoice.paid": defineWebhookBinding({
              block: noopHandler,
              input: (e) => e.payload,
              sessionId: () => "customer-1",
              when: () => true
            })
          }
        }
      }
    });
    expect(flow.webhooks?.stripe?.on?.["invoice.paid"]?.block).toBe(noopHandler);
  });

  it("keeps webhook handlers out of `flow.actions`", () => {
    const flow = defineFlow({
      kind: "billing",
      actions: {},
      webhooks: {
        stripe: { on: { "invoice.paid": { block: noopHandler, input: () => ({}) } } }
      }
    });
    // A webhook binding is event-addressed; it never enters the caller-addressed
    // action map, so it has no HTTP/MCP surface.
    expect(Object.keys(flow.actions)).toEqual([]);
  });

  it("throws at definition time when a binding has no block", () => {
    expect(() =>
      defineFlow({
        kind: "billing",
        actions: {},
        // @ts-expect-error — block is required on a webhook binding
        webhooks: { stripe: { on: { "invoice.paid": { input: (e) => e } } } }
      })
    ).toThrow(/must declare a `block`/);
  });

  it("bubbles a webhook handler block's declared resources into flow.resources", () => {
    const ledgerResource = defineResource({
      scope: "session",
      ref: "ledger",
      stateSchema: z.object({ entries: z.array(z.string()) })
    });
    const blockWithResource = handler({
      name: "record-with-resource",
      resources: { ledger: ledgerResource },
      execute: (v) => v
    });

    const flow = defineFlow({
      kind: "billing",
      actions: {},
      webhooks: {
        stripe: { on: { "invoice.paid": { block: blockWithResource, input: () => ({}) } } }
      }
    });

    // A webhook binding's block participates in resource aggregation exactly
    // like a `flow.actions` block.
    expect(flow.resources).toEqual({ ledger: ledgerResource });
  });
});
