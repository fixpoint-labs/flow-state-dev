/**
 * Tests for the webhook transport adapter shell (FIX-439): route shape, the
 * `source` identifier, and the `start()` registration check that fails fast
 * when a flow declares a provider the mount didn't configure.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import {
  createInboundTransportConformanceTests,
  createMockTransportHost
} from "@flow-state-dev/testing/conformance";
import {
  createFlowApiRouter,
  createFlowRegistry,
  createInMemoryStores,
  createInboundTransportHost
} from "../../src";
import {
  createWebhookTransportAdapter,
  WEBHOOK_TRANSPORT_SOURCE
} from "../../src/transports/webhook/createWebhookTransportAdapter";

const noop = handler({ name: "n", inputSchema: z.object({}), execute: () => undefined });

function hostFor(flow: ReturnType<ReturnType<typeof defineFlow>>) {
  const registry = createFlowRegistry();
  registry.register(flow);
  return createInboundTransportHost({
    registry,
    stores: createInMemoryStores(),
    resolvePrincipal: async () => ({ userId: "system" }),
    runtimeConfig: {}
  });
}

const stripeFlow = defineFlow({
  kind: "billing",
  actions: { recordPayment: { block: noop } },
  authentication: { defaultUserId: "system", requireUser: false },
  webhooks: { stripe: { on: { "invoice.paid": { action: "recordPayment", input: () => ({}) } } } }
})({ id: "billing" });

describe("createWebhookTransportAdapter", () => {
  it("uses the webhook source and mounts the provider route", () => {
    const adapter = createWebhookTransportAdapter({ providers: { stripe: { verify: () => true } } });
    expect(adapter.source).toBe(WEBHOOK_TRANSPORT_SOURCE);
    const bindings = adapter.createBindings(hostFor(stripeFlow));
    expect(bindings.routes).toEqual([
      expect.objectContaining({ method: "POST", path: "/api/flows/:flowKind/webhooks/:provider" })
    ]);
  });

  it("honors a custom basePath", () => {
    const adapter = createWebhookTransportAdapter({
      providers: { stripe: { verify: () => true } },
      basePath: "/hooks"
    });
    const bindings = adapter.createBindings(hostFor(stripeFlow));
    expect(bindings.routes?.[0]?.path).toBe("/hooks/:flowKind/webhooks/:provider");
  });

  it("start() passes when every declared provider has a complete definition", () => {
    const adapter = createWebhookTransportAdapter({
      providers: { stripe: { verify: () => true, eventType: (p) => (p as { type: string }).type } }
    });
    const bindings = adapter.createBindings(hostFor(stripeFlow));
    expect(() => bindings.start?.()).not.toThrow();
  });

  it("start() throws when a flow declares a provider with no definition", () => {
    const adapter = createWebhookTransportAdapter({ providers: {} });
    const bindings = adapter.createBindings(hostFor(stripeFlow));
    expect(() => bindings.start?.()).toThrow(/provider "stripe" but no provider definition/);
  });

  it("start() throws when a flow uses `on` but the provider has no eventType extractor", () => {
    const adapter = createWebhookTransportAdapter({ providers: { stripe: { verify: () => true } } });
    const bindings = adapter.createBindings(hostFor(stripeFlow));
    expect(() => bindings.start?.()).toThrow(/no `eventType` extractor/);
  });

  it("mounts via createFlowApiRouter without route collisions", () => {
    const registry = createFlowRegistry();
    registry.register(stripeFlow);
    expect(() =>
      createFlowApiRouter({
        registry,
        stores: createInMemoryStores(),
        adapters: [
          createWebhookTransportAdapter({
            providers: { stripe: { verify: () => true, eventType: (p) => (p as { type: string }).type } }
          })
        ]
      })
    ).not.toThrow();
  });
});

createInboundTransportConformanceTests({
  name: "webhook",
  factory: () =>
    createWebhookTransportAdapter({
      providers: { stripe: { verify: () => true, eventType: (p) => (p as { type: string }).type } }
    }),
  helpers: {
    buildEnvelope: async (adapter, host) => {
      // Patch the mock host's registry to surface a webhook flow. The binding
      // omits sessionId so no session upsert is needed against the mock store.
      (host as unknown as { registry: unknown }).registry = {
        get: (k: string) => (k === stripeFlow.kind ? stripeFlow : undefined),
        list: () => [stripeFlow]
      };
      const route = adapter.createBindings(host).routes!.find((r) => r.method === "POST")!;
      const request = new Request("http://localhost/api/flows/billing/webhooks/stripe", {
        method: "POST",
        body: JSON.stringify({ type: "invoice.paid" })
      });
      await route.handler(request, { params: { flowKind: "billing", provider: "stripe" } });
      const envelope = host.dispatchCalls[0]?.envelope;
      if (envelope === undefined) throw new Error("Adapter did not call host.dispatch");
      return envelope;
    }
  }
});
