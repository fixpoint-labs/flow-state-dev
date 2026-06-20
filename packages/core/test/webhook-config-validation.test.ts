/**
 * Registration-time validation for the per-flow `webhooks` config (FIX-439).
 * Covers `validateWebhookConfig` directly and through `defineFlow`: a provider
 * with neither `on` nor `route` throws, unknown actions and malformed binding
 * fields throw, and absent configs are accepted as no-ops. Also covers
 * `defineWebhookBinding` passthrough.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "../src";
import {
  defineWebhookBinding,
  validateWebhookConfig,
  type WebhookConfig
} from "../src/types/webhooks";
import type { ActionConfig } from "../src/types/flow";

const noopHandler = handler({
  name: "noop",
  inputSchema: z.object({ id: z.string().optional() }),
  execute: () => undefined
});

const actions: Record<string, ActionConfig> = {
  recordPayment: { block: noopHandler }
};

describe("validateWebhookConfig", () => {
  it("is a no-op when webhooks is absent", () => {
    expect(() => validateWebhookConfig("billing", undefined, actions)).not.toThrow();
  });

  it("accepts a minimal valid `on` subscription", () => {
    const webhooks: WebhookConfig = {
      stripe: { on: { "invoice.paid": { action: "recordPayment", input: () => ({}) } } }
    };
    expect(() => validateWebhookConfig("billing", webhooks, actions)).not.toThrow();
  });

  it("accepts a provider declaring only a `route`", () => {
    const webhooks: WebhookConfig = {
      stripe: { route: () => ({ action: "recordPayment", input: {} }) }
    };
    expect(() => validateWebhookConfig("billing", webhooks, actions)).not.toThrow();
  });

  it("rejects a provider declaring neither `on` nor `route`", () => {
    const webhooks = { stripe: {} } as WebhookConfig;
    expect(() => validateWebhookConfig("billing", webhooks, actions)).toThrow(
      /declares neither `on` nor `route`/
    );
  });

  it("rejects an empty provider key", () => {
    const webhooks: WebhookConfig = {
      "": { on: { "invoice.paid": { action: "recordPayment", input: () => ({}) } } }
    };
    expect(() => validateWebhookConfig("billing", webhooks, actions)).toThrow(
      /empty name/
    );
  });

  it("rejects a binding referencing an unknown action", () => {
    const webhooks: WebhookConfig = {
      stripe: { on: { "invoice.paid": { action: "ghost", input: () => ({}) } } }
    };
    expect(() => validateWebhookConfig("billing", webhooks, actions)).toThrow(
      /references action "ghost"/
    );
  });

  it("rejects an empty event key", () => {
    const webhooks: WebhookConfig = {
      stripe: { on: { "": { action: "recordPayment", input: () => ({}) } } }
    };
    expect(() => validateWebhookConfig("billing", webhooks, actions)).toThrow(
      /empty event key/
    );
  });

  it("rejects a non-function input", () => {
    const webhooks = {
      stripe: { on: { "invoice.paid": { action: "recordPayment", input: "nope" } } }
    } as unknown as WebhookConfig;
    expect(() => validateWebhookConfig("billing", webhooks, actions)).toThrow(/`input`/);
  });

  it("rejects a non-function route", () => {
    const webhooks = { stripe: { route: "nope" } } as unknown as WebhookConfig;
    expect(() => validateWebhookConfig("billing", webhooks, actions)).toThrow(/`route`/);
  });

  it("rejects a non-function sessionId", () => {
    const webhooks = {
      stripe: {
        on: { "invoice.paid": { action: "recordPayment", input: () => ({}), sessionId: "x" } }
      }
    } as unknown as WebhookConfig;
    expect(() => validateWebhookConfig("billing", webhooks, actions)).toThrow(/`sessionId`/);
  });

  it("rejects a non-function when predicate", () => {
    const webhooks = {
      stripe: {
        on: { "invoice.paid": { action: "recordPayment", input: () => ({}), when: true } }
      }
    } as unknown as WebhookConfig;
    expect(() => validateWebhookConfig("billing", webhooks, actions)).toThrow(/`when`/);
  });

  it("accepts an inline `block` binding (webhook-only handler)", () => {
    const webhooks: WebhookConfig = {
      stripe: { on: { "invoice.paid": { block: noopHandler, input: () => ({}) } } }
    };
    expect(() => validateWebhookConfig("billing", webhooks, actions)).not.toThrow();
  });

  it("rejects a binding declaring both `action` and `block`", () => {
    const webhooks: WebhookConfig = {
      stripe: {
        on: { "invoice.paid": { action: "recordPayment", block: noopHandler, input: () => ({}) } }
      }
    };
    expect(() => validateWebhookConfig("billing", webhooks, actions)).toThrow(
      /exactly one of `action`.*or `block`/
    );
  });

  it("rejects a binding declaring neither `action` nor `block`", () => {
    const webhooks = {
      stripe: { on: { "invoice.paid": { input: () => ({}) } } }
    } as unknown as WebhookConfig;
    expect(() => validateWebhookConfig("billing", webhooks, actions)).toThrow(
      /exactly one of `action`.*or `block`/
    );
  });

  it("rejects a `block` that is not a block definition", () => {
    const webhooks = {
      stripe: { on: { "invoice.paid": { block: "nope", input: () => ({}) } } }
    } as unknown as WebhookConfig;
    expect(() => validateWebhookConfig("billing", webhooks, actions)).toThrow(
      /not a block definition/
    );
  });
});

describe("defineWebhookBinding", () => {
  it("returns the binding unchanged (runtime passthrough)", () => {
    const input = (e: { payload: { id: string } }) => ({ id: e.payload.id });
    const binding = defineWebhookBinding<{ id: string }>({ action: "recordPayment", input });
    expect(binding.action).toBe("recordPayment");
    expect(binding.input).toBe(input);
  });
});

describe("defineFlow with webhooks config", () => {
  it("registers a flow declaring valid webhook subscriptions", () => {
    const flow = defineFlow({
      kind: "billing",
      actions: { recordPayment: { block: noopHandler } },
      webhooks: {
        stripe: {
          on: {
            "invoice.paid": defineWebhookBinding({
              action: "recordPayment",
              input: (e) => e.payload,
              sessionId: () => "customer-1",
              when: () => true
            })
          }
        }
      }
    });
    expect(flow.webhooks?.stripe?.on?.["invoice.paid"]?.action).toBe("recordPayment");
  });

  it("throws at definition time when a binding names an unknown action", () => {
    expect(() =>
      defineFlow({
        kind: "billing",
        actions: { recordPayment: { block: noopHandler } },
        webhooks: { stripe: { on: { "invoice.paid": { action: "missing", input: (e) => e } } } }
      })
    ).toThrow(/references action "missing"/);
  });
});
