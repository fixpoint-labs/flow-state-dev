/**
 * Tests for the webhook request pipeline (FIX-439). A dispatch-capturing mock
 * host lets each test assert the exact envelope the route built; a real host
 * at the end exercises end-to-end principal resolution and session creation.
 */
import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { z } from "zod";
import {
  defineFlow,
  defineWebhookBinding,
  handler,
  type WebhookInboundEvent
} from "@flow-state-dev/core";
import {
  createFlowRegistry,
  createInboundTransportHost,
  createInMemoryStores,
  defaultBodyUserIdPrincipalResolver,
  stripeWebhookVerifier
} from "../../src";
import type { DispatchHandle } from "../../src/transports/types";
import type { InboundRequestEnvelope, InboundTransportHost } from "../../src/transports/types";
import type { WebhookProviderDefinition } from "../../src/transports/webhook/createWebhookTransportAdapter";
import { handleWebhook } from "../../src/transports/webhook/routes";

const noop = handler({
  name: "record",
  inputSchema: z.object({ invoiceId: z.string().optional() }),
  execute: () => undefined
});

function billingFlow() {
  return defineFlow({
    kind: "billing",
    actions: { recordPayment: { block: noop }, refundPayment: { block: noop } },
    authentication: { defaultUserId: "system", requireUser: false },
    webhooks: {
      stripe: {
        on: {
          "invoice.paid": defineWebhookBinding<{ data: { object: { id: string; customer: string } } }>({
            action: "recordPayment",
            input: (e) => ({ invoiceId: e.payload.data.object.id }),
            sessionId: (e) => `customer-${e.payload.data.object.customer}`
          })
        }
      }
    }
  })({ id: "billing" });
}

const stripeProvider: WebhookProviderDefinition = {
  verify: () => true,
  eventType: (payload) => (payload as { type: string }).type,
  deliveryId: (payload) => (payload as { id: string }).id
};

function stripeRequest(body: unknown): Request {
  return new Request("http://test/api/flows/billing/webhooks/stripe", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

function captureHost(flow: ReturnType<typeof billingFlow>) {
  const stores = createInMemoryStores();
  const dispatched: InboundRequestEnvelope[] = [];
  const host = {
    registry: {
      get: (kind: string) => (kind === flow.kind ? flow : undefined),
      list: () => [flow]
    },
    stores,
    resolvePrincipal: async () => ({ userId: "system" }),
    validateDispatch: async () => undefined,
    dispatch: (envelope: InboundRequestEnvelope) => {
      dispatched.push(envelope);
      return {
        requestId: "req_1",
        accepted: Promise.resolve(),
        finished: Promise.resolve({}),
        liveStream: null,
        responseEmitter: {}
      };
    }
  } as unknown as InboundTransportHost;
  return { host, stores, dispatched };
}

describe("handleWebhook", () => {
  const params = { flowKind: "billing", provider: "stripe" };

  it("routes a verified event to the bound action with mapped input + session", async () => {
    const { host, dispatched } = captureHost(billingFlow());
    const res = await handleWebhook(
      stripeRequest({ type: "invoice.paid", id: "evt_1", data: { object: { id: "in_1", customer: "cus_9" } } }),
      { params },
      host,
      { stripe: stripeProvider }
    );

    expect(res.status).toBe(202);
    expect(dispatched).toHaveLength(1);
    const env = dispatched[0]!;
    expect(env.source).toBe("webhook");
    expect(env.action).toBe("recordPayment");
    expect(env.input).toEqual({ invoiceId: "in_1" });
    expect(env.sessionId).toBe("customer-cus_9");
    expect(env.responseEmitter).toBeNull();
    expect(env.metadata).toEqual({
      webhook: { provider: "stripe", eventType: "invoice.paid", deliveryId: "evt_1" }
    });
  });

  it("dispatches the synthesized internal action for an inline `block` binding", async () => {
    // FIX-439: a webhook-only handler declared inline via `block` is lowered
    // into an internal action named `__wh.<provider>.<eventKey>`. The route
    // dispatches that action exactly like a referenced one — the inline block
    // gets the full dispatch runtime without widening the flow's public actions.
    const flow = defineFlow({
      kind: "billing",
      actions: { recordPayment: { block: noop } },
      authentication: { defaultUserId: "system", requireUser: false },
      webhooks: {
        stripe: {
          on: {
            "invoice.paid": {
              block: handler({
                name: "handle-paid-inline",
                inputSchema: z.object({ invoiceId: z.string() }),
                execute: () => undefined
              }),
              input: (e: WebhookInboundEvent<{ data: { object: { id: string } } }>) => ({
                invoiceId: e.payload.data.object.id
              })
            }
          }
        }
      }
    })({ id: "billing" });
    const { host, dispatched } = captureHost(flow);
    const res = await handleWebhook(
      stripeRequest({ type: "invoice.paid", id: "evt_1", data: { object: { id: "in_1" } } }),
      { params },
      host,
      { stripe: stripeProvider }
    );

    expect(res.status).toBe(202);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]!.action).toBe("__wh.stripe.invoice.paid");
    expect(dispatched[0]!.input).toEqual({ invoiceId: "in_1" });
  });

  it("rejects an invalid signature with 401 and never dispatches", async () => {
    const { host, dispatched } = captureHost(billingFlow());
    const res = await handleWebhook(
      stripeRequest({ type: "invoice.paid", id: "evt_1", data: { object: { id: "in_1", customer: "c" } } }),
      { params },
      host,
      { stripe: { ...stripeProvider, verify: () => false } }
    );
    expect(res.status).toBe(401);
    expect(dispatched).toHaveLength(0);
  });

  it("acknowledges (202) and ignores an event with no matching binding", async () => {
    const { host, dispatched } = captureHost(billingFlow());
    const res = await handleWebhook(
      stripeRequest({ type: "charge.created", id: "evt_2", data: {} }),
      { params },
      host,
      { stripe: stripeProvider }
    );
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ status: "ignored" });
    expect(dispatched).toHaveLength(0);
  });

  it("prefers a declarative `on` binding over the `route` escape hatch", async () => {
    const flow = defineFlow({
      kind: "billing",
      actions: { recordPayment: { block: noop }, refundPayment: { block: noop } },
      authentication: { defaultUserId: "system", requireUser: false },
      webhooks: {
        stripe: {
          on: { "invoice.paid": { action: "recordPayment", input: () => ({ invoiceId: "from-on" }) } },
          route: () => ({ action: "refundPayment", input: { invoiceId: "from-route" } })
        }
      }
    })({ id: "billing" });
    const { host, dispatched } = captureHost(flow);
    await handleWebhook(
      stripeRequest({ type: "invoice.paid", id: "e", data: {} }),
      { params },
      host,
      { stripe: stripeProvider }
    );
    expect(dispatched[0]!.action).toBe("recordPayment");
    expect(dispatched[0]!.input).toEqual({ invoiceId: "from-on" });
  });

  it("falls back to `route` when no `on` key matches", async () => {
    const flow = defineFlow({
      kind: "billing",
      actions: { recordPayment: { block: noop } },
      authentication: { defaultUserId: "system", requireUser: false },
      webhooks: {
        stripe: {
          on: { "invoice.paid": { action: "recordPayment", input: () => ({}) } },
          route: (e: WebhookInboundEvent) =>
            e.eventType === "charge.refunded"
              ? { action: "recordPayment", input: { invoiceId: "routed" } }
              : null
        }
      }
    })({ id: "billing" });
    const { host, dispatched } = captureHost(flow);
    await handleWebhook(
      stripeRequest({ type: "charge.refunded", id: "e", data: {} }),
      { params },
      host,
      { stripe: stripeProvider }
    );
    expect(dispatched[0]!.input).toEqual({ invoiceId: "routed" });
  });

  it("treats a throwing `when` predicate as a non-match (202, no dispatch, no 5xx)", async () => {
    const flow = defineFlow({
      kind: "billing",
      actions: { recordPayment: { block: noop } },
      authentication: { defaultUserId: "system", requireUser: false },
      webhooks: {
        stripe: {
          on: {
            "invoice.paid": {
              action: "recordPayment",
              input: () => ({}),
              when: () => {
                throw new Error("predicate bug");
              }
            }
          }
        }
      }
    })({ id: "billing" });
    const { host, dispatched } = captureHost(flow);
    const res = await handleWebhook(
      stripeRequest({ type: "invoice.paid", id: "e", data: {} }),
      { params },
      host,
      { stripe: stripeProvider }
    );
    expect(res.status).toBe(202);
    expect(dispatched).toHaveLength(0);
  });

  it("acknowledges and ignores when the `route` escape hatch throws", async () => {
    const flow = defineFlow({
      kind: "billing",
      actions: { recordPayment: { block: noop } },
      authentication: { defaultUserId: "system", requireUser: false },
      webhooks: {
        stripe: {
          route: () => {
            throw new Error("route bug");
          }
        }
      }
    })({ id: "billing" });
    const { host, dispatched } = captureHost(flow);
    const res = await handleWebhook(
      stripeRequest({ type: "charge.created", id: "e", data: {} }),
      { params },
      host,
      { stripe: stripeProvider }
    );
    expect(res.status).toBe(202);
    expect(dispatched).toHaveLength(0);
  });

  it("echoes a handshake body (Slack url_verification) without dispatching", async () => {
    const { host, dispatched } = captureHost(billingFlow());
    const provider: WebhookProviderDefinition = {
      ...stripeProvider,
      acknowledge: (e) =>
        (e.payload as { type: string }).type === "url_verification"
          ? (e.payload as { challenge: string }).challenge
          : null
    };
    const res = await handleWebhook(
      stripeRequest({ type: "url_verification", challenge: "abc123", id: "e" }),
      { params },
      host,
      { stripe: provider }
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("abc123");
    expect(dispatched).toHaveLength(0);
  });

  it("does not 500 when `acknowledge` throws — falls through to routing", async () => {
    const { host, dispatched } = captureHost(billingFlow());
    const provider: WebhookProviderDefinition = {
      ...stripeProvider,
      acknowledge: () => {
        throw new Error("ack bug");
      }
    };
    const res = await handleWebhook(
      stripeRequest({ type: "invoice.paid", id: "evt_1", data: { object: { id: "in_1", customer: "cus_9" } } }),
      { params },
      host,
      { stripe: provider }
    );
    expect(res.status).toBe(202);
    expect(dispatched).toHaveLength(1);
  });

  it("returns 503 when handle.accepted rejects (durable recording failed)", async () => {
    const flow = billingFlow();
    const host = {
      registry: {
        get: (kind: string) => (kind === flow.kind ? flow : undefined),
        list: () => [flow]
      },
      stores: createInMemoryStores(),
      resolvePrincipal: async () => ({ userId: "system" }),
      validateDispatch: async () => undefined,
      dispatch: () => ({
        requestId: "req_1",
        accepted: Promise.reject(new Error("durable write failed")),
        finished: Promise.resolve({}),
        liveStream: null,
        responseEmitter: {}
      })
    } as unknown as InboundTransportHost;
    const res = await handleWebhook(
      stripeRequest({ type: "invoice.paid", id: "e", data: { object: { id: "in", customer: "c" } } }),
      { params },
      host,
      { stripe: stripeProvider }
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "dispatch_not_durable" });
  });

  it("treats a throwing `eventType` extractor as null and keeps the handshake reachable", async () => {
    const { host, dispatched } = captureHost(billingFlow());
    const provider: WebhookProviderDefinition = {
      verify: () => true,
      eventType: () => {
        throw new Error("eventType bug");
      },
      acknowledge: (e) =>
        (e.payload as { type: string }).type === "url_verification"
          ? (e.payload as { challenge: string }).challenge
          : null
    };
    const res = await handleWebhook(
      stripeRequest({ type: "url_verification", challenge: "abc123" }),
      { params },
      host,
      { stripe: provider }
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("abc123");
    expect(dispatched).toHaveLength(0);
  });

  it("omits deliveryId and still dispatches when the `deliveryId` extractor throws", async () => {
    const { host, dispatched } = captureHost(billingFlow());
    const provider: WebhookProviderDefinition = {
      verify: () => true,
      eventType: (p) => (p as { type: string }).type,
      deliveryId: () => {
        throw new Error("deliveryId bug");
      }
    };
    await handleWebhook(
      stripeRequest({ type: "invoice.paid", id: "evt_1", data: { object: { id: "in_1", customer: "cus_9" } } }),
      { params },
      host,
      { stripe: provider }
    );
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]!.metadata).toEqual({
      webhook: { provider: "stripe", eventType: "invoice.paid" }
    });
  });

  it("returns 503 when the session store fails during ensure-session", async () => {
    const flow = billingFlow();
    const host = {
      registry: {
        get: (kind: string) => (kind === flow.kind ? flow : undefined),
        list: () => [flow]
      },
      stores: {
        session: {
          get: async () => {
            throw new Error("store down");
          },
          set: async () => undefined
        }
      },
      resolvePrincipal: async () => ({ userId: "system" }),
      validateDispatch: async () => undefined,
      dispatch: () => ({
        requestId: "req_1",
        accepted: Promise.resolve(),
        finished: Promise.resolve({}),
        liveStream: null,
        responseEmitter: {}
      })
    } as unknown as InboundTransportHost;
    const res = await handleWebhook(
      stripeRequest({ type: "invoice.paid", id: "e", data: { object: { id: "in", customer: "cus_9" } } }),
      { params },
      host,
      { stripe: stripeProvider }
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "session_unavailable" });
  });

  it("returns 404 for an unknown flow", async () => {
    const { host } = captureHost(billingFlow());
    const res = await handleWebhook(
      stripeRequest({ type: "invoice.paid", id: "e", data: {} }),
      { params: { flowKind: "ghost", provider: "stripe" } },
      host,
      { stripe: stripeProvider }
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 when the provider is not declared on the flow", async () => {
    const { host } = captureHost(billingFlow());
    const res = await handleWebhook(
      stripeRequest({ type: "invoice.paid", id: "e", data: {} }),
      { params: { flowKind: "billing", provider: "paypal" } },
      host,
      { stripe: stripeProvider }
    );
    expect(res.status).toBe(404);
  });
});

describe("handleWebhook with a real host (signed, end-to-end)", () => {
  const SECRET = "whsec_integration";

  // A flow whose action mutates session state, so we can prove the webhook
  // drove a real action run, not just session creation.
  function recordingFlow() {
    const recordPayment = handler({
      name: "record-payment",
      inputSchema: z.object({ invoiceId: z.string() }),
      execute: async (input: { invoiceId: string }, ctx) => {
        await ctx.session.setState({ lastInvoice: input.invoiceId });
      }
    });
    return defineFlow({
      kind: "billing",
      session: { stateSchema: z.object({ lastInvoice: z.string() }).partial() },
      actions: { recordPayment: { block: recordPayment } },
      authentication: { defaultUserId: "system", requireUser: false },
      webhooks: {
        stripe: {
          on: {
            "invoice.paid": defineWebhookBinding<{ data: { object: { id: string; customer: string } } }>({
              action: "recordPayment",
              input: (e) => ({ invoiceId: e.payload.data.object.id }),
              sessionId: (e) => `customer-${e.payload.data.object.customer}`
            })
          }
        }
      }
    })({ id: "billing" });
  }

  function signedStripeRequest(body: unknown): Request {
    const raw = JSON.stringify(body);
    const ts = Math.floor(Date.now() / 1000);
    const signed = new TextEncoder().encode(`${ts}.${raw}`);
    const sig = createHmac("sha256", SECRET).update(signed).digest("hex");
    return new Request("http://test/api/flows/billing/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": `t=${ts},v1=${sig}` },
      body: raw
    });
  }

  it("verifies a real signature, runs the action, and updates session state", async () => {
    const registry = createFlowRegistry();
    registry.register(recordingFlow());
    const stores = createInMemoryStores();
    const host = createInboundTransportHost({
      registry,
      stores,
      resolvePrincipal: defaultBodyUserIdPrincipalResolver,
      runtimeConfig: {}
    });

    // Capture the dispatch handle so we can await the (async) action to completion.
    const realDispatch = host.dispatch.bind(host);
    let handle: DispatchHandle | undefined;
    host.dispatch = (envelope) => {
      handle = realDispatch(envelope);
      return handle;
    };

    const res = await handleWebhook(
      signedStripeRequest({
        type: "invoice.paid",
        id: "evt_1",
        data: { object: { id: "in_1", customer: "cus_42" } }
      }),
      { params: { flowKind: "billing", provider: "stripe" } },
      host,
      { stripe: stripeWebhookVerifierProvider(SECRET) }
    );

    expect(res.status).toBe(202);
    await handle?.finished;

    const session = await stores.session.get("customer-cus_42");
    expect(session?.userId).toBe("system");
    expect(session?.metadata).toMatchObject({ source: "webhook", provider: "stripe" });
    expect(session?.state).toMatchObject({ lastInvoice: "in_1" });
  });

  it("rejects a forged signature with 401 and never creates a session", async () => {
    const registry = createFlowRegistry();
    registry.register(recordingFlow());
    const stores = createInMemoryStores();
    const host = createInboundTransportHost({
      registry,
      stores,
      resolvePrincipal: defaultBodyUserIdPrincipalResolver,
      runtimeConfig: {}
    });

    const forged = new Request("http://test/api/flows/billing/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": "t=9999999999,v1=deadbeef" },
      body: JSON.stringify({ type: "invoice.paid", id: "e", data: { object: { id: "in", customer: "cus_42" } } })
    });
    const res = await handleWebhook(
      forged,
      { params: { flowKind: "billing", provider: "stripe" } },
      host,
      { stripe: stripeWebhookVerifierProvider(SECRET) }
    );
    expect(res.status).toBe(401);
    expect(await stores.session.get("customer-cus_42")).toBeUndefined();
  });
});

function stripeWebhookVerifierProvider(secret: string): WebhookProviderDefinition {
  return {
    verify: stripeWebhookVerifier(secret),
    eventType: (payload) => (payload as { type: string }).type,
    deliveryId: (payload) => (payload as { id: string }).id
  };
}
