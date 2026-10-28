/**
 * At most once per scheduled time (FIX-2085 D2): two hosts over one store, a
 * restart, a late or early fire, a fire with no time. Each host is its own
 * router and its own adapter over a shared store, as two processes are, so a
 * guarantee that lives in one process's memory fails here.
 */
import { describe, it, expect, vi } from "vitest";
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
import { recentTimes } from "./recent-times";

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


// The latest monthly time already due, and the one before it: neither is stale.
const { latest: LATEST, previous: PREVIOUS } = recentTimes(MONTHLY);
const second = (iso: string, by: number) => new Date(Date.parse(iso) + by * 1_000).toISOString();

describe("one firing per scheduled time", () => {
  it("fires a time once when two hosts sharing a store both POST it", async () => {
    await withHosts(2, async ([a, b]) => {
      const [first, other] = await Promise.all([fire(a!, { nominalFireTime: LATEST }), fire(b!, { nominalFireTime: LATEST })]);
      const statuses = [first.status, other.status].sort();
      expect(statuses).toEqual([200, 202]);
      const duplicate = first.status === 200 ? first : other;
      expect(duplicate.body.status).toBe("duplicate");
    });
  });

  it("answers a time already fired as a duplicate after a restart", async () => {
    const stores = createInMemoryStores();
    const before = host(stores);
    expect((await fire(before, { nominalFireTime: LATEST })).status).toBe(202);
    await disposeFlowApiRouter(before);
    // A fresh adapter and router: nothing in memory survives.
    const after = host(stores);
    try {
      const again = await fire(after, { nominalFireTime: LATEST });
      expect(again.status).toBe(200);
      expect(again.body.status).toBe("duplicate");
    } finally {
      await disposeFlowApiRouter(after);
    }
  });

  it("refuses a time earlier than one already fired", async () => {
    await withHosts(1, async ([a]) => {
      expect((await fire(a!, { nominalFireTime: LATEST })).status).toBe(202);
      const late = await fire(a!, { nominalFireTime: PREVIOUS });
      expect(late.status).toBe(200);
      expect(late.body.status).toBe("duplicate");
    });
  });

  it("fires a late retry of the previous time, then the latest", async () => {
    await withHosts(1, async ([a]) => {
      expect((await fire(a!, { nominalFireTime: PREVIOUS })).status).toBe(202);
      expect((await fire(a!, { nominalFireTime: LATEST })).status).toBe(202);
    });
  });

  it("lands a time carried a second early on that scheduled time", async () => {
    await withHosts(1, async ([a]) => {
      expect((await fire(a!, { nominalFireTime: second(LATEST, -1) })).status).toBe(202);
      expect((await fire(a!, { nominalFireTime: LATEST })).body.status).toBe("duplicate");
    });
  });

  it("refuses a carried time that is no scheduled time, with 400", async () => {
    await withHosts(1, async ([a]) => {
      const off = await fire(a!, { nominalFireTime: second(LATEST, 3_600) });
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
      const timed = await fire(b!, { nominalFireTime: LATEST });
      expect(timed.body.status).toBe("duplicate");
      // And a second untimed fire, on another host, is a duplicate too.
      expect((await fire(b!)).body.status).toBe("duplicate");
    });
  });

  it("answers a fixed time more than one period old as a stale duplicate, says so, and runs nothing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await withHosts(1, async ([a], stores) => {
        // A scheduler body written once, months ago, and sent unchanged on every run.
        const stale = monthBefore(PREVIOUS);
        const answered = await fire(a!, { nominalFireTime: stale });
        expect(answered.status).toBe(200);
        expect(answered.body).toMatchObject({ status: "duplicate", reason: "stale" });
        expect(warn.mock.calls.map((c) => String(c[0])).join("\n")).toMatch(/more than one period behind/);
        expect(await stores.request.list({})).toEqual([]);
        // It claimed nothing: the latest time still fires.
        expect((await fire(a!, { nominalFireTime: LATEST })).status).toBe(202);
      });
    } finally {
      warn.mockRestore();
    }
  });

  it("refuses a body idempotencyKey with 400 naming the change", async () => {
    await withHosts(1, async ([a]) => {
      const keyed = await fire(a!, { nominalFireTime: LATEST, idempotencyKey: "latest" });
      expect(keyed.status).toBe(400);
      expect(keyed.body.error).toBe("idempotency_key_removed");
      expect(String(keyed.body.message)).toContain("scheduled time");
      // Nothing was claimed by the refused fire.
      expect((await fire(a!, { nominalFireTime: LATEST })).status).toBe(202);
    });
  });

  it("refuses the removed idempotencyWindowMs option at construction", () => {
    expect(() => createScheduledTransportAdapter({ idempotencyWindowMs: 60_000 } as never)).toThrow(/idempotencyWindowMs/);
    expect(() => createScheduledTransportAdapter({ idempotencyOptions: {} } as never)).toThrow(/idempotencyOptions/);
  });
});

/** The first of the month before `iso`'s month, at midnight UTC. */
function monthBefore(iso: string): string {
  const d = new Date(iso);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString();
}
