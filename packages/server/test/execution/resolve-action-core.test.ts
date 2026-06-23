/**
 * Unit tests for `resolveActionCore` — the single seam that resolves which
 * `ActionCore` a dispatch runs. Its security-critical contract: the webhook
 * binding is reachable ONLY for a genuine webhook dispatch (`source ===
 * "webhook"`, set internally by the webhook adapter). For every other source
 * the caller-controlled `metadata.webhook` is inert, so a caller cannot pivot
 * the public action endpoint into a webhook handler (FIX-439). Also covers the
 * ordinary edge cases: missing binding, null event type, no webhooks config.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import { resolveActionCore } from "../../src/execution/resolve-action-core";

const webhookHandler = handler({
  name: "record-payment",
  inputSchema: z.object({ id: z.string().optional() }),
  execute: () => undefined
});

const namedActionBlock = handler({
  name: "run-block",
  inputSchema: z.object({ value: z.string() }),
  execute: () => undefined
});

function flowWithWebhook() {
  return defineFlow({
    kind: "billing",
    actions: { run: { block: namedActionBlock } },
    webhooks: {
      stripe: { on: { "invoice.paid": { block: webhookHandler, input: () => ({}) } } }
    }
  })({ id: "billing" });
}

const WEBHOOK_META = { webhook: { provider: "stripe", eventType: "invoice.paid" } };

describe("resolveActionCore", () => {
  it("resolves the webhook binding for a genuine webhook dispatch", () => {
    const flow = flowWithWebhook();
    const resolved = resolveActionCore(flow, "record-payment", "webhook", WEBHOOK_META);
    expect(resolved).toBe(flow.webhooks!.stripe.on["invoice.paid"]);
    expect(resolved?.block).toBe(webhookHandler);
  });

  it("resolves a named action for a normal http dispatch", () => {
    const flow = flowWithWebhook();
    expect(resolveActionCore(flow, "run", "http", undefined)).toBe(flow.actions.run);
  });

  // The security lock: an http request must never reach a webhook handler, even
  // when it forges `metadata.webhook`. It resolves the named action instead.
  it("does NOT pivot into a webhook handler when source is not 'webhook'", () => {
    const flow = flowWithWebhook();
    // Forged metadata + a bogus action name (the pivot attack): no resolution.
    expect(resolveActionCore(flow, "record-payment", "http", WEBHOOK_META)).toBeUndefined();
    expect(resolveActionCore(flow, "anything", "http", WEBHOOK_META)).toBeUndefined();
    // Forged metadata + a real action name: resolves the named action, never the binding.
    expect(resolveActionCore(flow, "run", "http", WEBHOOK_META)).toBe(flow.actions.run);
  });

  it("ignores forged webhook metadata for an undefined source", () => {
    const flow = flowWithWebhook();
    expect(resolveActionCore(flow, "record-payment", undefined, WEBHOOK_META)).toBeUndefined();
  });

  it("falls back to the named action when the binding does not exist", () => {
    const flow = flowWithWebhook();
    const unknownProvider = { webhook: { provider: "paypal", eventType: "invoice.paid" } };
    expect(resolveActionCore(flow, "run", "webhook", unknownProvider)).toBe(flow.actions.run);
    const unknownEvent = { webhook: { provider: "stripe", eventType: "charge.created" } };
    expect(resolveActionCore(flow, "run", "webhook", unknownEvent)).toBe(flow.actions.run);
  });

  it("falls back when eventType is null", () => {
    const flow = flowWithWebhook();
    const nullEvent = { webhook: { provider: "stripe", eventType: null } };
    expect(resolveActionCore(flow, "run", "webhook", nullEvent)).toBe(flow.actions.run);
  });

  it("falls back for a webhook dispatch with no webhook metadata", () => {
    const flow = flowWithWebhook();
    expect(resolveActionCore(flow, "run", "webhook", undefined)).toBe(flow.actions.run);
  });

  it("returns undefined when nothing matches", () => {
    const flow = flowWithWebhook();
    expect(resolveActionCore(flow, "missing", "http", undefined)).toBeUndefined();
  });

  it("tolerates a flow with no webhooks config", () => {
    const plain = defineFlow({
      kind: "plain",
      actions: { run: { block: namedActionBlock } }
    })({ id: "plain" });
    expect(resolveActionCore(plain, "run", "webhook", WEBHOOK_META)).toBe(plain.actions.run);
  });
});
