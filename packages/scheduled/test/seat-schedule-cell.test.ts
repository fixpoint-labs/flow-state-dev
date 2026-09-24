/**
 * A schedule a run creates through the documented collection API fires.
 *
 * `schedules.create(key, { cron, kind, enabled })` names no organization, and
 * the row lands in resource state. The resolver reads the row where the
 * collection wrote it and finds on it the organization the creating run was
 * admitted under, so the dispatch fires into that organization — not into the
 * scheduler gateway's.
 *
 * A hired seat keeps its shared user data — its schedule collection included —
 * in the (org, person) cell. The dispatch route hands the resolver the pin of
 * the instance it addresses, so a schedule the seat wrote resolves, and a row
 * found only in the person's cross-org cell does not. An app flow with no pin
 * resolves from the person's cell.
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

/**
 * A run writes one schedule row, the way an agent would set a reminder: the
 * documented call, which names no organization.
 */
const plan = handler({
  name: "plan",
  inputSchema: z.object({ key: z.string() }),
  outputSchema: z.object({ ok: z.boolean() }),
  resources: { schedules },
  execute: async (input, ctx) => {
    await (ctx.resources.schedules as unknown as ResourceCollectionRef).create(input.key, {
      cron: "0 9 * * MON",
      kind: "ping",
      enabled: true,
    });
    return { ok: true };
  },
});

/**
 * A later run moves the schedule the way the reference digest flow does: a full
 * `setState` of the row, which again names no organization.
 */
const reschedule = handler({
  name: "reschedule",
  inputSchema: z.object({ key: z.string() }),
  outputSchema: z.object({ ok: z.boolean() }),
  resources: { schedules },
  execute: async (input, ctx) => {
    const row = await (ctx.resources.schedules as unknown as ResourceCollectionRef).get(input.key);
    await row.setState({ cron: "30 17 * * FRI", kind: "ping", enabled: true });
    return { ok: true };
  },
});

/** A run that tries to name the organization the schedule fires into. */
const planInto = handler({
  name: "plan-into",
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

/** A later run that tries to move the schedule to another organization. */
const moveInto = handler({
  name: "move-into",
  inputSchema: z.object({ key: z.string(), orgId: z.string() }),
  outputSchema: z.object({ ok: z.boolean() }),
  resources: { schedules },
  execute: async (input, ctx) => {
    const row = await (ctx.resources.schedules as unknown as ResourceCollectionRef).get(input.key);
    await row.setState({ cron: "30 17 * * FRI", kind: "ping", enabled: true, orgId: input.orgId });
    return { ok: true };
  },
});

const kind = (name: string, cardinality: "collection" | "singleton") =>
  defineFlow({
    kind: name,
    cardinality,
    resources: { schedules },
    authentication: {
      // The scheduler gateway authenticates into acme. A dynamic schedule must
      // not borrow that organization.
      resolvePrincipal: createBearerSecretPrincipalResolver({
        secret: SECRET,
        principal: { userId: "system", orgId: "acme" },
      }),
      requireUser: true,
    },
    schedules: {
      resolve: createResourceCollectionScheduleResolver({ collection: schedules, blocks: { ping } }),
    },
    actions: {
      plan: { inputSchema: z.object({ key: z.string() }), block: plan },
      reschedule: { inputSchema: z.object({ key: z.string() }), block: reschedule },
      planInto: { inputSchema: z.object({ key: z.string(), orgId: z.string() }), block: planInto },
      moveInto: { inputSchema: z.object({ key: z.string(), orgId: z.string() }), block: moveInto },
    },
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
  /** Alice runs `actionName` on `flow` while admitted under `orgId`. */
  const run = (actionName: "plan" | "reschedule", flow: FlowInstance, key: string, orgId: string) =>
    runAction({
      flow,
      actionName,
      input: { key },
      userId: "alice",
      orgId,
      stores,
      runtimeConfig: { modelResolver: createMockModelResolver({}) },
    });
  const runPlan = (flow: FlowInstance, key: string, orgId: string) => run("plan", flow, key, orgId);
  const runReschedule = (flow: FlowInstance, key: string, orgId: string) => run("reschedule", flow, key, orgId);
  /**
   * A row no run of this flow created — a legacy or foreign one — written
   * where the collection keeps its rows.
   */
  const plant = (scopeId: string, key: string, state: Record<string, unknown>) =>
    stores.resourceState.set("user", scopeId, `schedules/${key}`, { cron: "0 9 * * MON", kind: "ping", enabled: true, ...state }, "any");
  /** The scheduled request the dispatch started, once it is recorded. */
  const fired = async () => {
    for (let i = 0; i < 200; i++) {
      const found = (await stores.request.list({ limit: 10 })).find((r) => r.source === "scheduled");
      if (found !== undefined) return found;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return undefined;
  };
  return { router, stores, register, dispatch, runPlan, runReschedule, plant, fired };
}

describe("a schedule created through the collection fires", () => {
  it("fires an unpinned flow's schedule into the organization its run was in", async () => {
    const h = boot();
    const app = h.register(appKind());
    try {
      // The run is in globex; the gateway that fires the beat is acme.
      await h.runPlan(app, "digest", "globex");
      expect(await h.stores.resourceState.get("user", "alice", "schedules/digest")).toBeDefined();

      const response = await h.dispatch("reminders", "alice/digest");
      expect(response.status).toBe(202);
      const fired = await h.fired();
      expect(fired?.userId).toBe("alice");
      expect(fired?.orgId).toBe("globex");
    } finally {
      await disposeFlowApiRouter(h.router);
    }
  });

  it("still fires after a run reschedules it with a full setState", async () => {
    const h = boot();
    const app = h.register(appKind());
    try {
      await h.runPlan(app, "digest", "globex");
      await h.runReschedule(app, "digest", "globex");
      expect((await h.stores.resourceState.get("user", "alice", "schedules/digest"))?.state.cron).toBe("30 17 * * FRI");

      const response = await h.dispatch("reminders", "alice/digest");
      expect(response.status).toBe(202);
      expect((await h.fired())?.orgId).toBe("globex");
    } finally {
      await disposeFlowApiRouter(h.router);
    }
  });

  it("keeps the creating organization when a run in another organization reschedules it", async () => {
    const h = boot();
    const app = h.register(appKind());
    try {
      // The same person, acting under initech, rewrites the row. The schedule
      // stays bound to globex, which created it; an update never re-points it.
      await h.runPlan(app, "digest", "globex");
      await h.runReschedule(app, "digest", "initech");

      const response = await h.dispatch("reminders", "alice/digest");
      expect(response.status).toBe(202);
      expect((await h.fired())?.orgId).toBe("globex");
    } finally {
      await disposeFlowApiRouter(h.router);
    }
  });

  it("cannot point a schedule it creates at another organization", async () => {
    const h = boot();
    const app = h.register(appKind());
    try {
      // A run in globex names initech. The create is refused, so nothing can
      // later dispatch into initech on this run's say-so.
      await runAction({
        flow: app,
        actionName: "planInto",
        input: { key: "elsewhere", orgId: "initech" },
        userId: "alice",
        orgId: "globex",
        stores: h.stores,
        runtimeConfig: { modelResolver: createMockModelResolver({}) },
      }).catch(() => undefined);
      expect(await h.stores.resourceState.get("user", "alice", "schedules/elsewhere")).toBeUndefined();

      const response = await h.dispatch("reminders", "alice/elsewhere");
      expect(response.status).toBe(404);
    } finally {
      await disposeFlowApiRouter(h.router);
    }
  });

  it("cannot move a schedule to another organization with a later update", async () => {
    const h = boot();
    const app = h.register(appKind());
    try {
      await h.runPlan(app, "digest", "globex");
      // A later run names initech on the row. The update is refused, and the
      // row is left as it was.
      await runAction({
        flow: app,
        actionName: "moveInto",
        input: { key: "digest", orgId: "initech" },
        userId: "alice",
        orgId: "globex",
        stores: h.stores,
        runtimeConfig: { modelResolver: createMockModelResolver({}) },
      }).catch(() => undefined);
      const stored = (await h.stores.resourceState.get("user", "alice", "schedules/digest"))?.state;
      expect(stored?.orgId).toBe("globex");
      expect(stored?.cron).toBe("0 9 * * MON");

      const response = await h.dispatch("reminders", "alice/digest");
      expect(response.status).toBe(202);
      expect((await h.fired())?.orgId).toBe("globex");
    } finally {
      await disposeFlowApiRouter(h.router);
    }
  });

  it("does not fire a row that stores no organization", async () => {
    const h = boot();
    h.register(appKind());
    try {
      await h.plant("alice", "legacy", {});
      const response = await h.dispatch("reminders", "alice/legacy");
      expect(response.status).toBe(404);
    } finally {
      await disposeFlowApiRouter(h.router);
    }
  });
});

describe("a hired seat's dynamic schedules (BR-17)", () => {
  it("fires a schedule the seat's own run created, from the seat's cell", async () => {
    const h = boot();
    const seat = h.register(seatKind({ id: "acme.~alice.research" }), { orgId: "acme", userId: "alice" });
    try {
      await h.runPlan(seat, "weekly", "acme");
      // A seat run's schedule collection lives in the seat's cell.
      expect(await h.stores.resourceState.get("user", "alice:~org:acme", "schedules/weekly")).toBeDefined();
      expect(await h.stores.resourceState.get("user", "alice", "schedules/weekly")).toBeUndefined();

      const response = await h.dispatch("acme.~alice.research", "alice/weekly");
      expect(response.status).toBe(202);
      const fired = await h.fired();
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
      await h.plant("alice", "legacy", { orgId: "acme" });
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
      await h.plant("alice:~org:acme", "moved", { orgId: "globex" });
      const response = await h.dispatch("acme.~alice.research", "alice/moved");
      expect(response.status).toBe(404);
    } finally {
      await disposeFlowApiRouter(h.router);
    }
  });

  it("does not tell another person's schedule apart from a missing one on a private seat", async () => {
    const h = boot();
    h.register(seatKind({ id: "acme.~alice.research" }), { orgId: "acme", userId: "alice" });
    try {
      // Bob's row really exists in his own (acme, bob) cell. Addressed through
      // Alice's private seat it must answer exactly like a missing row.
      await h.plant("bob:~org:acme", "weekly", { orgId: "acme" });
      const response = await h.dispatch("acme.~alice.research", "bob/weekly");
      expect(response.status).toBe(404);
    } finally {
      await disposeFlowApiRouter(h.router);
    }
  });
});
