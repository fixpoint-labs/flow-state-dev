/**
 * A hired seat's dynamic schedules resolve from the seat's own cell.
 *
 * A seat registered with a pin keeps its shared user data — its schedule
 * collection included — in the (org, person) cell. The dispatch route hands
 * the resolver the pin of the instance it addresses, so a schedule the seat
 * wrote resolves, and a row found only in the person's cross-org cell does
 * not. An app flow with no pin resolves from the person's cell, as before.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import type { FlowInstance, InstanceOwnerPin, ResourceCollectionRef } from "@flow-state-dev/core/types";
import {
  createBearerSecretPrincipalResolver,
  createFlowApiRouter,
  createFlowRegistry,
  createInMemoryStores,
  disposeFlowApiRouter,
  runAction,
} from "@flow-state-dev/engine";
import {
  createResourceCollectionScheduleResolver,
  createScheduledTransportAdapter,
  defineScheduleCollection,
} from "../src";
import { createMockModelResolver } from "@flow-state-dev/testing";

const SECRET = "scheduler-secret-do-not-share";

const schedules = defineScheduleCollection({ pattern: "schedules/*" });

const ping = handler({
  name: "ping",
  inputSchema: z.object({}).passthrough(),
  execute: () => ({ ok: true }),
});

/** A run writes one schedule row, the way an agent would set a reminder. */
const plan = handler({
  name: "plan",
  inputSchema: z.object({ key: z.string(), orgId: z.string() }),
  outputSchema: z.object({ ok: z.boolean() }),
  resources: { schedules },
  execute: async (input, ctx) => {
    await (ctx.resources.schedules as unknown as ResourceCollectionRef).create(input.key, {
      orgId: input.orgId,
      cron: "0 9 * * MON",
      kind: "ping",
      enabled: true,
    });
    return { ok: true };
  },
});

const kind = (name: string, cardinality: "collection" | "singleton") =>
  defineFlow({
    kind: name,
    cardinality,
    resources: { schedules },
    authentication: {
      resolvePrincipal: createBearerSecretPrincipalResolver({
        secret: SECRET,
        principal: { userId: "system", orgId: "acme" },
      }),
      requireUser: true,
    },
    schedules: {
      resolve: createResourceCollectionScheduleResolver({ collection: schedules, blocks: { ping } }),
    },
    actions: { plan: { inputSchema: z.object({ key: z.string(), orgId: z.string() }), block: plan } },
  });

const seatKind = kind("research", "collection");
const appKind = kind("reminders", "singleton");

function boot() {
  const registry = createFlowRegistry();
  const stores = createInMemoryStores();
  const router = createFlowApiRouter({
    registry,
    stores,
    adapters: [createScheduledTransportAdapter()],
  });
  const register = (flow: unknown, pin?: InstanceOwnerPin) => {
    registry.register(flow as FlowInstance, pin === undefined ? undefined : { pin });
    return flow as FlowInstance;
  };
  const dispatch = (flowId: string, scheduleId: string) =>
    router.POST(
      new Request(`http://localhost/api/flows/${flowId}/schedules/${scheduleId}/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SECRET}` },
        body: JSON.stringify({ idempotencyKey: `${flowId}:${scheduleId}` }),
      }),
      { params: { path: [flowId, "schedules", scheduleId, "dispatch"] } }
    );
  const plant = (scopeId: string, key: string) =>
    stores.content.set(
      "user",
      scopeId,
      `schedules/${key}`,
      JSON.stringify({ orgId: "acme", cron: "0 9 * * MON", kind: "ping", enabled: true })
    );
  return { router, stores, register, dispatch, plant };
}

describe("a hired seat's dynamic schedules (BR-17)", () => {
  it("resolves a schedule row in the seat's cell, through the seat's dispatch route", async () => {
    const h = boot();
    const seat = h.register(seatKind({ id: "acme.~alice.research" }), { orgId: "acme", userId: "alice" });
    try {
      // A seat run's schedule collection lives in the seat's cell.
      await runAction({
        flow: seat,
        actionName: "plan",
        input: { key: "weekly", orgId: "acme" },
        userId: "alice",
        orgId: "acme",
        stores: h.stores,
        runtimeConfig: { modelResolver: createMockModelResolver({}) },
      });
      expect(await h.stores.resourceState.get("user", "alice:~org:acme", "schedules/weekly")).toBeDefined();
      expect(await h.stores.resourceState.get("user", "alice", "schedules/weekly")).toBeUndefined();

      // The resolver reads the row's serialized form from the content store,
      // as its own unit tests do; planted in the same cell the run wrote.
      await h.plant("alice:~org:acme", "weekly");
      const response = await h.dispatch("acme.~alice.research", "alice/weekly");
      expect(response.status).toBe(202);
      let fired: { userId: string; orgId?: string } | undefined;
      for (let i = 0; i < 200 && fired === undefined; i++) {
        fired = (await h.stores.request.list({ limit: 10 })).find((r) => r.source === "scheduled");
        if (fired === undefined) await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(fired?.userId).toBe("alice");
      expect(fired?.orgId).toBe("acme");
    } finally {
      await disposeFlowApiRouter(h.router);
    }
  });

  it("does not resolve a row found only in the person's cross-org cell", async () => {
    const h = boot();
    h.register(seatKind({ id: "acme.~alice.research" }), { orgId: "acme", userId: "alice" });
    try {
      await h.plant("alice", "legacy");
      const response = await h.dispatch("acme.~alice.research", "alice/legacy");
      expect(response.status).toBe(404);
    } finally {
      await disposeFlowApiRouter(h.router);
    }
  });

  it("does not resolve a row in the seat's cell that names another org", async () => {
    const h = boot();
    h.register(seatKind({ id: "acme.~alice.research" }), { orgId: "acme", userId: "alice" });
    try {
      await h.stores.content.set(
        "user",
        "alice:~org:acme",
        "schedules/moved",
        JSON.stringify({ orgId: "globex", cron: "0 9 * * MON", kind: "ping", enabled: true })
      );
      const response = await h.dispatch("acme.~alice.research", "alice/moved");
      expect(response.status).toBe(404);
    } finally {
      await disposeFlowApiRouter(h.router);
    }
  });

  it("still resolves an unpinned flow's schedule from the person's cell", async () => {
    const h = boot();
    h.register(appKind());
    try {
      await h.plant("alice", "digest");
      const response = await h.dispatch("reminders", "alice/digest");
      expect(response.status).toBe(202);
    } finally {
      await disposeFlowApiRouter(h.router);
    }
  });
});
