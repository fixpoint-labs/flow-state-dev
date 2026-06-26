/**
 * Tests for the webhook request pipeline (FIX-439). A webhook binding is an
 * action in webhook form — it carries its handler `block` inline and lives on
 * `flow.webhooks`, never `flow.actions`. The dispatched envelope's `action` is
 * the handler block's name (provenance); the runtime resolves the actual
 * handler from `flow.webhooks[provider].on[event]` via `metadata.webhook`.
 *
 * A dispatch-capturing mock host lets each test assert the exact envelope the
 * route built; a real host at the end exercises end-to-end resolution,
 * principal resolution, and session creation.
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

const recordBlock = handler({
  name: "record-payment",
  inputSchema: z.object({ invoiceId: z.string().optional() }),
  execute: () => undefined
});

function billingFlow() {
  return defineFlow({
    kind: "billing",
    actions: {},
    authentication: { defaultUserId: "system", requireUser: false },
    webhooks: {
      stripe: {
        on: {
          "invoice.paid": defineWebhookBinding<{ data: { object: { id: string; customer: string } } }>({
            block: recordBlock,
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

  it("routes a verified event to the bound handler with mapped input + session", async () => {
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
    // `action` is the handler block's name — provenance on the request record.
    expect(env.action).toBe("record-payment");
    expect(env.input).toEqual({ invoiceId: "in_1" });
    expect(env.sessionId).toBe("customer-cus_9");
    expect(env.responseEmitter).toBeNull();
    expect(env.metadata).toEqual({
      webhook: { provider: "stripe", eventType: "invoice.paid", deliveryId: "evt_1" }
    });
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

  it("treats a throwing `when` predicate as a non-match (202, no dispatch, no 5xx)", async () => {
    const flow = defineFlow({
      kind: "billing",
      actions: {},
      authentication: { defaultUserId: "system", requireUser: false },
      webhooks: {
        stripe: {
          on: {
            "invoice.paid": {
              block: recordBlock,
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

  // A flow whose webhook handler mutates session state, so we can prove the
  // webhook drove a real action run resolved from `flow.webhooks` (not
  // `flow.actions`), not just session creation.
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
      actions: {},
      authentication: { defaultUserId: "system", requireUser: false },
      webhooks: {
        stripe: {
          on: {
            "invoice.paid": defineWebhookBinding<{ data: { object: { id: string; customer: string } } }>({
              block: recordPayment,
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

  it("verifies a real signature, resolves the webhook handler, and updates session state", async () => {
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

  it("drops a concurrent double-fire on the same session with a 200 skipped under reject (FIX-837)", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((r) => (release = r));
    const blockingHandler = handler({
      name: "record-payment",
      inputSchema: z.object({ invoiceId: z.string() }),
      execute: async () => {
        await blocked;
      }
    });
    const flow = defineFlow({
      kind: "billing",
      // Flow-level default applies to the webhook handler (which lives on
      // `flow.webhooks`, not `flow.actions`); key defaults to the session.
      request: { concurrency: "reject" },
      actions: {},
      authentication: { defaultUserId: "system", requireUser: false },
      webhooks: {
        stripe: {
          on: {
            "invoice.paid": defineWebhookBinding<{ data: { object: { id: string; customer: string } } }>({
              block: blockingHandler,
              input: (e) => ({ invoiceId: e.payload.data.object.id }),
              sessionId: (e) => `customer-${e.payload.data.object.customer}`
            })
          }
        }
      }
    })({ id: "billing" });

    const registry = createFlowRegistry();
    registry.register(flow);
    const stores = createInMemoryStores();
    const host = createInboundTransportHost({
      registry,
      stores,
      resolvePrincipal: defaultBodyUserIdPrincipalResolver,
      runtimeConfig: {}
    });
    const providers = { stripe: stripeWebhookVerifierProvider(SECRET) };
    const params = { params: { flowKind: "billing", provider: "stripe" } };

    // First delivery: dispatched, holding the session key while it runs.
    const first = await handleWebhook(
      signedStripeRequest({ type: "invoice.paid", id: "evt_1", data: { object: { id: "in_1", customer: "cus_99" } } }),
      params,
      host,
      providers
    );
    expect(first.status).toBe(202);

    // Second, distinct delivery for the same customer arrives while the first
    // still holds the key → dropped with a benign 200 skipped so the provider
    // stops retrying.
    const second = await handleWebhook(
      signedStripeRequest({ type: "invoice.paid", id: "evt_2", data: { object: { id: "in_2", customer: "cus_99" } } }),
      params,
      host,
      providers
    );
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ status: "skipped", reason: "in_flight" });

    release();
  });
});

function stripeWebhookVerifierProvider(secret: string): WebhookProviderDefinition {
  return {
    verify: stripeWebhookVerifier(secret),
    eventType: (payload) => (payload as { type: string }).type,
    deliveryId: (payload) => (payload as { id: string }).id
  };
}
