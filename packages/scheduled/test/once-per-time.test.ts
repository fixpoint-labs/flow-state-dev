/**
 * At most once per scheduled time (FIX-2085 D2): two hosts over one store, a
 * restart, a late or early fire, a fire with no time. Each host is its own
 * router and its own adapter over a shared store, as two processes are, so a
 * guarantee that lives in one process's memory fails here.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import {
  createBearerSecretPrincipalResolver,
  createFlowApiRouter,
  createFlowRegistry,
  createInMemoryStores,
  disposeFlowApiRouter,
  type StoreRegistry
} from "@flow-state-dev/engine";
import { createScheduledTransportAdapter } from "../src";

const SECRET = "scheduler-secret";
const runs: string[] = [];

const invoices = handler({
  name: "send-invoices",
  inputSchema: z.object({}),
  execute: (_input, ctx) => {
    runs.push(String((ctx as { request?: { id?: string } }).request?.id ?? "run"));
    return { ok: true };
  }
});

/** Monthly, on the 1st at midnight UTC: every time used below is already due. */
const MONTHLY = "0 0 1 * *";

function flowWith(cron: string) {
  return defineFlow({
    kind: "billing",
    authentication: {
      resolvePrincipal: createBearerSecretPrincipalResolver({
        secret: SECRET,
        principal: { userId: "system", orgId: "org_sys" }
      }),
      requireUser: true
    },
    schedules: { static: { "monthly-invoices": { cron, block: invoices, onOverlap: "allow" } } },
    actions: {}
  })();
}

/** One host: its own registry, router and adapter, over `stores`. */
function host(stores: StoreRegistry, cron = MONTHLY) {
  const registry = createFlowRegistry();
  registry.register(flowWith(cron));
  return createFlowApiRouter({ registry, stores, adapters: [createScheduledTransportAdapter()] });
}

async function fire(router: ReturnType<typeof host>, body?: unknown) {
  const init: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SECRET}` }
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const response = await router.POST(
    new Request("http://localhost/api/flows/billing/schedules/monthly-invoices/dispatch", init),
    { params: { path: ["billing", "schedules", "monthly-invoices", "dispatch"] } }
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function withHosts<T>(count: number, body: (routers: ReturnType<typeof host>[], stores: StoreRegistry) => Promise<T>) {
  const stores = createInMemoryStores();
  const routers = Array.from({ length: count }, () => host(stores));
  try {
    return await body(routers, stores);
  } finally {
    for (const router of routers) await disposeFlowApiRouter(router);
  }
}

const JUNE = "2026-06-01T00:00:00.000Z";
const JULY = "2026-07-01T00:00:00.000Z";

describe("one firing per scheduled time", () => {
  it("fires a time once when two hosts sharing a store both POST it", async () => {
    await withHosts(2, async ([a, b]) => {
      const [first, second] = await Promise.all([fire(a!, { nominalFireTime: JUNE }), fire(b!, { nominalFireTime: JUNE })]);
      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([200, 202]);
      const duplicate = first.status === 200 ? first : second;
      expect(duplicate.body.status).toBe("duplicate");
    });
  });

  it("answers a time already fired as a duplicate after a restart", async () => {
    const stores = createInMemoryStores();
    const before = host(stores);
    expect((await fire(before, { nominalFireTime: JUNE })).status).toBe(202);
    await disposeFlowApiRouter(before);
    // A fresh adapter and router: nothing in memory survives.
    const after = host(stores);
    try {
      const again = await fire(after, { nominalFireTime: JUNE });
      expect(again.status).toBe(200);
      expect(again.body.status).toBe("duplicate");
    } finally {
      await disposeFlowApiRouter(after);
    }
  });

  it("refuses a time earlier than one already fired, and fires a later one", async () => {
    await withHosts(1, async ([a]) => {
      expect((await fire(a!, { nominalFireTime: JULY })).status).toBe(202);
      const late = await fire(a!, { nominalFireTime: JUNE });
      expect(late.status).toBe(200);
      expect(late.body.status).toBe("duplicate");
      expect((await fire(a!, { nominalFireTime: "2026-08-01T00:00:00.000Z" })).status).toBe(202);
    });
  });

  it("lands a time carried a second early on that scheduled time", async () => {
    await withHosts(1, async ([a]) => {
      const early = await fire(a!, { nominalFireTime: "2026-05-31T23:59:59.000Z" });
      expect(early.status).toBe(202);
      expect((await fire(a!, { nominalFireTime: JUNE })).body.status).toBe("duplicate");
    });
  });

  it("refuses a carried time that is no scheduled time, with 400", async () => {
    await withHosts(1, async ([a]) => {
      const off = await fire(a!, { nominalFireTime: "2026-06-03T12:00:00.000Z" });
      expect(off.status).toBe(400);
      expect(off.body.error).toBe("not_a_scheduled_time");
    });
  });

  it("refuses a carried time not yet due, with 400", async () => {
    const stores = createInMemoryStores();
    // Every minute: the next minute is a scheduled time that hasn't arrived.
    const router = host(stores, "* * * * *");
    try {
      const next = new Date(Math.floor(Date.now() / 60_000) * 60_000 + 120_000).toISOString();
      const early = await fire(router, { nominalFireTime: next });
      expect(early.status).toBe(400);
      expect(early.body.error).toBe("not_yet_due");
    } finally {
      await disposeFlowApiRouter(router);
    }
  });

  it("counts a fire with no time against the latest time already due, never the next", async () => {
    await withHosts(2, async ([a, b]) => {
      const untimed = await fire(a!);
      expect(untimed.status).toBe(202);
      // A timed fire for that same latest due time is the same firing.
      const latestDue = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
      const timed = await fire(b!, { nominalFireTime: latestDue });
      expect(timed.body.status).toBe("duplicate");
      // And a second untimed fire, on another host, is a duplicate too.
      expect((await fire(b!)).body.status).toBe("duplicate");
    });
  });

  it("starts fresh when the schedule's cron changes", async () => {
    const stores = createInMemoryStores();
    const monthly = host(stores);
    expect((await fire(monthly, { nominalFireTime: JULY })).status).toBe(202);
    await disposeFlowApiRouter(monthly);
    // Now daily: June 15th is a scheduled time of the new cron, earlier than
    // July, and the record written under the old cron doesn't refuse it.
    const daily = host(stores, "0 0 * * *");
    try {
      expect((await fire(daily, { nominalFireTime: "2026-06-15T00:00:00.000Z" })).status).toBe(202);
    } finally {
      await disposeFlowApiRouter(daily);
    }
  });

  it("refuses a body idempotencyKey with 400 naming the change", async () => {
    await withHosts(1, async ([a]) => {
      const keyed = await fire(a!, { nominalFireTime: JUNE, idempotencyKey: "june" });
      expect(keyed.status).toBe(400);
      expect(keyed.body.error).toBe("idempotency_key_removed");
      expect(String(keyed.body.message)).toContain("scheduled time");
      // Nothing was claimed by the refused fire.
      expect((await fire(a!, { nominalFireTime: JUNE })).status).toBe(202);
    });
  });

  it("refuses the removed idempotencyWindowMs option at construction", () => {
    expect(() => createScheduledTransportAdapter({ idempotencyWindowMs: 60_000 } as never)).toThrow(/idempotencyWindowMs/);
    expect(() => createScheduledTransportAdapter({ idempotencyOptions: {} } as never)).toThrow(/idempotencyOptions/);
  });
});
