/**
 * A webhook delivery whose binding names no session is a run of its own, as
 * before; what changes is who names its session. The webhook route makes the
 * one-off id (`oneOffSessionId()`) before it dispatches, and ensures that
 * session exactly as it ensures a named one, so the envelope, the request
 * record and the session row all carry it from the first write, and the
 * session is born with `metadata.source: "webhook"`.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, defineWebhookBinding, handler } from "@flow-state-dev/core";
import { isOneOffSessionId } from "@flow-state-dev/core/helpers";
import { createInMemoryStores } from "../../src/host";
import type { InboundRequestEnvelope, InboundTransportHost } from "../../src/transports/types";
import type { WebhookProviderDefinition } from "../../src/transports/webhook/createWebhookTransportAdapter";
import { handleWebhook } from "../../src/transports/webhook/routes";

function pingFlow() {
  return defineFlow({
    kind: "pings",
    actions: {},
    authentication: { defaultUserId: "system", requireUser: false },
    webhooks: {
      acme: {
        on: {
          ping: defineWebhookBinding<{ id: string }>({
            block: handler({ name: "record-ping", inputSchema: z.object({}), execute: () => undefined }),
            input: () => ({})
          })
        }
      }
    }
  })({ id: "pings" });
}

const provider: WebhookProviderDefinition = {
  verify: () => true,
  eventType: (payload) => (payload as { type: string }).type,
  deliveryId: (payload) => (payload as { id: string }).id
};

function captureHost(flow: ReturnType<typeof pingFlow>) {
  const stores = createInMemoryStores();
  const dispatched: InboundRequestEnvelope[] = [];
  const host = {
    registry: { get: (kind: string) => (kind === flow.kind ? flow : undefined), list: () => [flow] },
    stores,
    resolvePrincipal: async () => ({ userId: "system", orgId: "org_test" }),
    validateDispatch: async () => undefined,
    dispatch: (envelope: InboundRequestEnvelope) => {
      dispatched.push(envelope);
      return { requestId: "req_1", accepted: Promise.resolve(), finished: Promise.resolve({}), liveStream: null, responseEmitter: {} };
    }
  } as unknown as InboundTransportHost;
  return { host, stores, dispatched };
}

const deliver = (host: InboundTransportHost, id: string) =>
  handleWebhook(
    new Request("http://test/api/flows/pings/webhooks/acme", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "ping", id })
    }),
    { params: { flowKind: "pings", provider: "acme" } },
    host,
    { acme: provider }
  );

describe("a webhook binding that names no session", () => {
  it("dispatches in a fresh one-off session the route made and ensured", async () => {
    const { host, stores, dispatched } = captureHost(pingFlow());
    expect((await deliver(host, "evt_1")).status).toBe(202);
    expect((await deliver(host, "evt_2")).status).toBe(202);

    const [first, second] = dispatched.map((e) => e.sessionId);
    expect(isOneOffSessionId(first!)).toBe(true);
    expect(isOneOffSessionId(second!)).toBe(true);
    expect(first).not.toBe(second);
    const session = await stores.session.get(first!);
    expect(session?.userId).toBe("system");
    expect(session?.metadata).toMatchObject({ source: "webhook", provider: "acme", eventType: "ping" });
  });
});
