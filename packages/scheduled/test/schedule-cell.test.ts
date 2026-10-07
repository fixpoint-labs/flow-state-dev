/**
 * A schedule a run creates through the documented collection API fires into
 * the org the run was in.
 *
 * `schedules.create(key, { cron, kind, enabled })` names no organization, and
 * the row lands in the user's cell in the run's org. The dispatch id names
 * that org, `<orgId>/<userId>/<key>`, each part URL-encoded: the resolver
 * reads that org's cell and dispatches only a row naming the same org, into
 * that org — not into the scheduler gateway's. A dispatch naming no org, or
 * another org, resolves as missing, as does a row in the cross-org cell older
 * releases wrote. On a hired worker the id must also name the pin's org, and
 * on a private one its user.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
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
  defaultParseScheduleId,
  defineScheduleCollection,
  formatScheduleId,
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

/** The user's cell in one org, where every flow keeps their schedule rows. */
const cellOf = (userId: string, orgId: string) =>
  `${userId.replace(/[\\:]/g, "\\$&")}:~org:${orgId.replace(/[\\:]/g, "\\$&")}`;

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
  /** POST the dispatch for an id, encoded onto the URL as one path segment. */
  const dispatch = (flowId: string, scheduleId: string) =>
    router.POST(
      new Request(
        `http://localhost/api/flows/${flowId}/schedules/${encodeURIComponent(scheduleId)}/dispatch`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SECRET}` },
          body: JSON.stringify({ idempotencyKey: `${flowId}:${scheduleId}` }),
        }
      ),
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

describe("a schedule created through the collection fires into the org that saved it", () => {
  it.each(["globex", DEFAULT_ORG_ID, "Acme.Corp/EU", "a:b\\c"])(
    "fires an unpinned flow's schedule saved in %j, named by its org",
    async (orgId) => {
      const h = boot();
      const app = h.register(appKind());
      try {
        // The gateway that fires the beat is acme; the run was in `orgId`.
        await h.runPlan(app, "digest", orgId);
        expect(await h.stores.resourceState.get("user", cellOf("alice", orgId), "schedules/digest")).toBeDefined();
        expect(await h.stores.resourceState.get("user", "alice", "schedules/digest")).toBeUndefined();

        const response = await h.dispatch("reminders", formatScheduleId(orgId, "alice", "digest"));
        expect(response.status).toBe(202);
        const fired = await h.fired();
        expect(fired?.userId).toBe("alice");
        expect(fired?.orgId).toBe(orgId);
      } finally {
        await disposeFlowApiRouter(h.router);
      }
    }
  );

  // No org id has a length limit, so neither may the route: a long org the
  // resolver admits must still reach its schedule, or that org's beats are
  // refused before resolution and never fire.
  it("fires a schedule saved in an org with a long id", async () => {
    const orgId = `Acme Corp/${"é".repeat(400)}`;
    const h = boot();
    const app = h.register(appKind());
    try {
      await h.runPlan(app, "digest", orgId);
      const response = await h.dispatch("reminders", formatScheduleId(orgId, "alice", "digest"));
      expect(response.status).toBe(202);
      expect((await h.fired())?.orgId).toBe(orgId);
    } finally {
      await disposeFlowApiRouter(h.router);
    }
  });

  it("does not fire a row saved in one org under another org's dispatch", async () => {
    const h = boot();
    const app = h.register(appKind());
    try {
      await h.runPlan(app, "digest", "globex");
      const response = await h.dispatch("reminders", formatScheduleId("acme", "alice", "digest"));
      expect(response.status).toBe(404);
    } finally {
      await disposeFlowApiRouter(h.router);
    }
  });

  it("does not fire a dispatch that names no org", async () => {
    const h = boot();
    const app = h.register(appKind());
    try {
      await h.runPlan(app, "digest", "globex");
      const response = await h.dispatch("reminders", "alice/digest");
      expect(response.status).toBe(404);
    } finally {
      await disposeFlowApiRouter(h.router);
    }
  });

  it("does not fire a row in the cross-org cell older releases wrote", async () => {
    const h = boot();
    h.register(appKind());
    try {
      await h.plant("alice", "legacy", { orgId: "globex" });
      expect((await h.dispatch("reminders", formatScheduleId("globex", "alice", "legacy"))).status).toBe(404);
      expect((await h.dispatch("reminders", "alice/legacy")).status).toBe(404);
    } finally {
      await disposeFlowApiRouter(h.router);
    }
  });

  it("does not fire a row in the named org's cell that names another org", async () => {
    const h = boot();
    h.register(appKind());
    try {
      await h.plant(cellOf("alice", "acme"), "moved", { orgId: "globex" });
      expect((await h.dispatch("reminders", formatScheduleId("acme", "alice", "moved"))).status).toBe(404);
      expect((await h.dispatch("reminders", formatScheduleId("globex", "alice", "moved"))).status).toBe(404);
    } finally {
      await disposeFlowApiRouter(h.router);
    }
  });

  it("does not fire a row that stores no organization", async () => {
    const h = boot();
    h.register(appKind());
    try {
      await h.plant(cellOf("alice", "globex"), "legacy", {});
      const response = await h.dispatch("reminders", formatScheduleId("globex", "alice", "legacy"));
      expect(response.status).toBe(404);
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
      expect((await h.stores.resourceState.get("user", cellOf("alice", "globex"), "schedules/digest"))?.state.cron).toBe("30 17 * * FRI");

      const response = await h.dispatch("reminders", formatScheduleId("globex", "alice", "digest"));
      expect(response.status).toBe(202);
      expect((await h.fired())?.orgId).toBe("globex");
    } finally {
      await disposeFlowApiRouter(h.router);
    }
  });

  it("cannot be reached by a run of the same person in another organization", async () => {
    const h = boot();
    const app = h.register(appKind());
    try {
      // Alice, acting under initech, finds no row: globex's schedule is in her
      // globex cell, and her initech cell is empty.
      await h.runPlan(app, "digest", "globex");
      const elsewhere = await h.runReschedule(app, "digest", "initech");
      expect(String(elsewhere.error)).toContain("not found");
      expect((await h.stores.resourceState.get("user", cellOf("alice", "globex"), "schedules/digest"))?.state.cron).toBe("0 9 * * MON");

      const response = await h.dispatch("reminders", formatScheduleId("globex", "alice", "digest"));
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
      expect(await h.stores.resourceState.get("user", cellOf("alice", "globex"), "schedules/elsewhere")).toBeUndefined();

      expect((await h.dispatch("reminders", formatScheduleId("globex", "alice", "elsewhere"))).status).toBe(404);
      expect((await h.dispatch("reminders", formatScheduleId("initech", "alice", "elsewhere"))).status).toBe(404);
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
      const stored = (await h.stores.resourceState.get("user", cellOf("alice", "globex"), "schedules/digest"))?.state;
      expect(stored?.orgId).toBe("globex");
      expect(stored?.cron).toBe("0 9 * * MON");

      const response = await h.dispatch("reminders", formatScheduleId("globex", "alice", "digest"));
      expect(response.status).toBe(202);
      expect((await h.fired())?.orgId).toBe("globex");
    } finally {
      await disposeFlowApiRouter(h.router);
    }
  });
});

describe("a hired worker's dynamic schedules", () => {
  it("fires a schedule the worker's own run created, from her cell in its org", async () => {
    const h = boot();
    const seat = h.register(seatKind({ id: "acme.~alice.research" }), { orgId: "acme", userId: "alice" });
    try {
      await h.runPlan(seat, "weekly", "acme");
      expect(await h.stores.resourceState.get("user", cellOf("alice", "acme"), "schedules/weekly")).toBeDefined();

      const response = await h.dispatch("acme.~alice.research", formatScheduleId("acme", "alice", "weekly"));
      expect(response.status).toBe(202);
      const fired = await h.fired();
      expect(fired?.userId).toBe("alice");
      expect(fired?.orgId).toBe("acme");
    } finally {
      await disposeFlowApiRouter(h.router);
    }
  });

  it("does not resolve a dispatch naming another org than the worker's pin", async () => {
    const h = boot();
    h.register(seatKind({ id: "acme.~alice.research" }), { orgId: "acme", userId: "alice" });
    try {
      // A real row in her globex cell, naming globex: not this worker's.
      await h.plant(cellOf("alice", "globex"), "weekly", { orgId: "globex" });
      const response = await h.dispatch("acme.~alice.research", formatScheduleId("globex", "alice", "weekly"));
      expect(response.status).toBe(404);
    } finally {
      await disposeFlowApiRouter(h.router);
    }
  });

  it("does not tell another person's schedule apart from a missing one on a private worker", async () => {
    const h = boot();
    h.register(seatKind({ id: "acme.~alice.research" }), { orgId: "acme", userId: "alice" });
    try {
      // Bob's row really exists in his own Acme cell. Addressed through
      // Alice's private worker it must answer exactly like a missing row.
      await h.plant(cellOf("bob", "acme"), "weekly", { orgId: "acme" });
      const response = await h.dispatch("acme.~alice.research", formatScheduleId("acme", "bob", "weekly"));
      expect(response.status).toBe(404);
    } finally {
      await disposeFlowApiRouter(h.router);
    }
  });
});

describe("the dispatch id", () => {
  it.each([
    ["acme", "alice", "daily"],
    [DEFAULT_ORG_ID, "auth0|abc", "daily/report"],
    ["Acme/EU", "u/1", "k%"],
    ["a b", "é", "x:y"],
  ])("round-trips (%j, %j, %j) through the default parser", (orgId, userId, key) => {
    expect(defaultParseScheduleId(formatScheduleId(orgId, userId, key))).toEqual({
      orgId,
      userId,
      collectionKey: key,
    });
  });

  it("keeps a hand-built nested key whole", () => {
    expect(defaultParseScheduleId("acme/alice/daily/report")).toEqual({
      orgId: "acme",
      userId: "alice",
      collectionKey: "daily/report",
    });
  });

  it.each(["alice/digest", "acme//digest", "/alice/digest", "acme/alice/", "acme/%E0/x"])(
    "parses %j as no schedule",
    (id) => {
      expect(defaultParseScheduleId(id)).toBeNull();
    }
  );
});
