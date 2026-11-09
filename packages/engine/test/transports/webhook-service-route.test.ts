/**
 * The webhook transport's service route (FIX-2535 D1): a verified delivery on
 * a provider entry declared as `service` is normalized and each event routed
 * through the flow's internal entry as `service:<provider>`, in the org the
 * host's principal resolver names, never a session made from the event. The
 * 202 waits for each owner run the routing names to be recorded.
 *
 * Why these matter: GitHub's flow routes every review, comment and CI result
 * this way, with no `sessionId` on the path. A delivery the host didn't record
 * must not be acked as accepted (GitHub doesn't redeliver on its own), and a
 * forged one must not route at all.
 */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import { createFlowState, githubWebhookVerifier, inMemoryStores, resolveUserStorageKey } from "../../src";
import type { InboundTransportHost } from "../../src/host";
import type { WebhookProviderDefinition } from "../../src/transports/webhook/createWebhookTransportAdapter";
import { handleWebhook } from "../../src/transports/webhook/routes";

const SECRET = "gh_secret";
const ORG = "acme";

const eventSchema = z.object({ n: z.number(), fail: z.boolean().optional(), unfinished: z.boolean().optional() }).passthrough();
const routed: Array<{ n: number; as: string; org: string | undefined }> = [];
const delivered: string[] = [];

const route = handler({
  name: "svc-route",
  inputSchema: eventSchema,
  // Any output: a request that stopped before routing finished resolves with no output and no error.
  outputSchema: z.any(),
  execute: async (input, ctx) => {
    const identity = ctx.session.identity as { userId: string; orgId?: string };
    routed.push({ n: input.n, as: identity.userId, org: identity.orgId });
    if (input.fail === true) throw new Error("routing broke");
    if (input.unfinished === true) return undefined;
    return {
      ownerRuns: [{ flowKind: "svc", entry: "deliver", input: { note: `event ${input.n}` }, owner: { userId: "alice", orgId: ORG }, rowKey: "subs/s1" }]
    };
  }
});

const deliver = handler({
  name: "svc-deliver",
  inputSchema: z.object({ note: z.string() }),
  execute: async (input, ctx) => {
    delivered.push(`${(ctx.session.identity as { userId: string }).userId}:${input.note}`);
  }
});

const svc = defineFlow({
  kind: "svc",
  actions: {},
  webhooks: {
    github: {
      service: {
        entry: "route",
        // Each `items` entry is one event; a delivery with none routes nothing.
        normalize: (event) => ((event.payload as { items?: unknown[] }).items ?? []) as never
      }
    }
  },
  internal: {
    actions: {
      route: { inputSchema: eventSchema, block: route },
      deliver: { inputSchema: z.object({ note: z.string() }), block: deliver }
    }
  }
})();

const github: WebhookProviderDefinition = {
  verify: githubWebhookVerifier(SECRET),
  eventType: (_payload, headers) => headers.get("x-github-event"),
  deliveryId: (_payload, headers) => headers.get("x-github-delivery") ?? undefined
};

async function boot() {
  routed.length = 0;
  delivered.length = 0;
  let host: InboundTransportHost | undefined;
  const state = createFlowState({
    flows: { svc },
    stores: { default: { primary: inMemoryStores() } },
    resolvePrincipal: () => ({ userId: "webhook", orgId: ORG }),
    adapters: [{ source: "test", createBindings: (h: InboundTransportHost) => ((host = h), {}) }]
  } as never);
  await state.getRouter();
  await host!.stores.resourceState.set("user", resolveUserStorageKey("alice", ORG, { id: "svc", isolateUserState: false }), "subs/s1", { orgId: ORG, enabled: true } as never, "any");
  return { host: host!, dispose: () => state.dispose() };
}

function signed(body: unknown, secret = SECRET): Request {
  const raw = JSON.stringify(body);
  const signature = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  return new Request("http://test/api/flows/svc/webhooks/github", {
    method: "POST",
    headers: { "x-hub-signature-256": signature, "x-github-event": "pull_request_review", "x-github-delivery": "d-1" },
    body: raw
  });
}

const post = (host: InboundTransportHost, req: Request) => handleWebhook(req, { params: { flowKind: "svc", provider: "github" } }, host, { github });

describe("the webhook service route", () => {
  it("routes each normalized event as the service, in the resolved org, and fires its owner runs before the 202", async () => {
    const { host, dispose } = await boot();
    try {
      const res = await post(host, signed({ items: [{ n: 1 }, { n: 2 }] }));
      expect(res.status).toBe(202);
      expect(await res.json()).toMatchObject({ status: "accepted", events: 2, ownerRuns: 2 });
      expect(routed).toEqual([
        { n: 1, as: "service:github", org: ORG },
        { n: 2, as: "service:github", org: ORG }
      ]);
      // No session is made from the event: the only sessions are the service's routing one and the row's owner-run one.
      const sessions = (await host.stores.session.list({})).map((s) => s.id);
      expect(sessions.every((id) => id.startsWith("service-route:") || id.startsWith("owner-run:"))).toBe(true);
    } finally {
      await dispose();
    }
  });

  it("refuses a forged signature with 401 and routes nothing", async () => {
    const { host, dispose } = await boot();
    try {
      const res = await post(host, signed({ items: [{ n: 1 }] }, "wrong"));
      expect(res.status).toBe(401);
      expect(routed).toEqual([]);
    } finally {
      await dispose();
    }
  });

  it("acks a delivery that normalizes to nothing as ignored, starting no request", async () => {
    const { host, dispose } = await boot();
    try {
      const res = await post(host, signed({ items: [] }));
      expect(res.status).toBe(202);
      expect(await res.json()).toMatchObject({ status: "ignored" });
      expect(await host.stores.request.list({})).toHaveLength(0);
    } finally {
      await dispose();
    }
  });

  it("answers 500, not accepted, when routing fails", async () => {
    const { host, dispose } = await boot();
    try {
      const res = await post(host, signed({ items: [{ n: 1, fail: true }] }));
      expect(res.status).toBe(500);
    } finally {
      await dispose();
    }
  });

  // A routing request the host stopped (a shutdown) resolves with no output and no error: never "routed to no one".
  it("answers 503 when routing never finished, so a redelivery routes it", async () => {
    const { host, dispose } = await boot();
    try {
      const res = await post(host, signed({ items: [{ n: 1, unfinished: true }] }));
      expect(res.status).toBe(503);
    } finally {
      await dispose();
    }
  });

  it("answers 503 when the host failed to record an owner run, so a redelivery sends it", async () => {
    const { host, dispose } = await boot();
    try {
      const failing: InboundTransportHost = {
        ...host,
        dispatch: (envelope) => {
          if (envelope.metadata?.ownerRun !== undefined) throw new Error("store down");
          return host.dispatch(envelope);
        }
      };
      const res = await post(failing, signed({ items: [{ n: 1 }] }));
      expect(res.status).toBe(503);
    } finally {
      await dispose();
    }
  });

  it("refuses a flow that declares both `on` and `service` for one provider", () => {
    expect(() =>
      defineFlow({
        kind: "both",
        actions: {},
        webhooks: { github: { on: {}, service: { entry: "route", normalize: () => [] } } as never }
      })
    ).toThrow(/both `on` and `service`/);
  });
});
