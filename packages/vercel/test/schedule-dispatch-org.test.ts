/**
 * A schedule a run saves fires, through the Vercel tick, into the org it was
 * saved in.
 *
 * The chain is real except for the cron and the index store: a run writes the
 * row through the documented collection API, the collection mirrors it into
 * an in-memory index, the tick claims it and posts to the framework's real
 * router with the scheduled adapter, and the resolver reads the user's cell in
 * the org the dispatch names. The dispatch id names the org, so an org id with
 * uppercase, `.` or `/` must survive the URL, and a row naming another org, or
 * none, must not fire.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import type { FlowInstance, ResourceCollectionRef } from "@flow-state-dev/core/types";
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
  type ScheduleIndex,
  type ScheduleIndexRow,
} from "@flow-state-dev/scheduled";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { createScheduleTickHandler } from "../src/schedules";

const SECRET = "scheduler-secret";
const BASE = "http://localhost";

function boot() {
  const rows: ScheduleIndexRow[] = [];
  const index: ScheduleIndex = {
    async upsert(row) {
      rows.push(row);
    },
    async remove() {},
    async claimDue() {
      return rows;
    },
  };
  const schedules = defineScheduleCollection({ pattern: "schedules/*", index });
  const ping = handler({ name: "ping", inputSchema: z.object({}).passthrough(), execute: () => ({ ok: true }) });
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
  const flow = defineFlow({
    kind: "reminders",
    resources: { schedules },
    authentication: {
      // The gateway authenticates into acme; a dynamic schedule must not
      // borrow that organization.
      resolvePrincipal: createBearerSecretPrincipalResolver({
        secret: SECRET,
        principal: { userId: "system", orgId: "acme" },
      }),
      requireUser: true,
    },
    schedules: {
      resolve: createResourceCollectionScheduleResolver({ collection: schedules, blocks: { ping } }),
    },
    actions: { plan: { inputSchema: z.object({ key: z.string() }), block: plan } },
  })() as unknown as FlowInstance;

  const registry = createFlowRegistry();
  registry.register(flow);
  const stores = createInMemoryStores();
  const router = createFlowApiRouter({ registry, stores, adapters: [createScheduledTransportAdapter()] });
  const posted = vi.fn(async (url: string, init?: RequestInit) =>
    router.POST(new Request(url, init), { params: { path: [] } })
  );
  globalThis.fetch = posted as unknown as typeof fetch;

  const statuses: number[] = [];
  const tick = createScheduleTickHandler({
    flowKind: "reminders",
    index,
    baseUrl: BASE,
    secret: SECRET,
    onDispatch: (_row, status) => statuses.push(status),
  });
  const runTick = () =>
    tick(new Request(`${BASE}/_cron`, { headers: { Authorization: `Bearer ${SECRET}` } }));

  const planIn = (orgId: string) =>
    runAction({
      flow,
      actionName: "plan",
      input: { key: "digest" },
      userId: "alice",
      orgId,
      stores,
      runtimeConfig: { modelResolver: createMockModelResolver({}) },
    });
  const fired = async () => {
    for (let i = 0; i < 200; i++) {
      const found = (await stores.request.list({ limit: 10 })).find((r) => r.source === "scheduled");
      if (found !== undefined) return found;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return undefined;
  };
  return { router, rows, posted, statuses, runTick, planIn, fired };
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("the Vercel schedule tick", () => {
  it.each(["globex", DEFAULT_ORG_ID, "Acme.Corp/EU"])(
    "fires a schedule a run saved in %j into that org",
    async (orgId) => {
      const h = boot();
      try {
        await h.planIn(orgId);
        expect(h.rows).toHaveLength(1);
        expect(h.rows[0]).toMatchObject({ orgId, userId: "alice", key: "digest" });

        expect((await h.runTick()).status).toBe(200);
        expect(h.statuses).toEqual([202]);
        const fired = await h.fired();
        expect(fired?.userId).toBe("alice");
        expect(fired?.orgId).toBe(orgId);
      } finally {
        await disposeFlowApiRouter(h.router);
      }
    }
  );

  it("does not fire the same row under another org's dispatch", async () => {
    const h = boot();
    try {
      await h.planIn("globex");
      h.rows[0] = { ...h.rows[0]!, orgId: "acme" };
      await h.runTick();
      expect(h.statuses).toEqual([404]);
    } finally {
      await disposeFlowApiRouter(h.router);
    }
  });

  it("does not post a row that names no org", async () => {
    const h = boot();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await h.planIn("globex");
      const { orgId: _dropped, ...noOrg } = h.rows[0]!;
      h.rows[0] = noOrg;
      await h.runTick();
      expect(h.posted).not.toHaveBeenCalled();
      expect(h.statuses).toEqual([0]);
    } finally {
      err.mockRestore();
      await disposeFlowApiRouter(h.router);
    }
  });
});
