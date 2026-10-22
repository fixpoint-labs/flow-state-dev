/**
 * A schedule a run saves fires, through BullMQ, into the org it was saved in.
 *
 * The chain is real except for Redis: a run writes the row through the
 * documented collection API, the collection mirrors it into the BullMQ index
 * (a stub queue records the job), the dispatch worker's processor posts that
 * job to the framework's real router with the scheduled adapter, and the
 * resolver reads the user's cell in the org the dispatch names. The dispatch
 * id names the org, so an org id with uppercase, `.` or `/` must survive the
 * URL, and a job naming another org, or none, must not fire.
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
} from "@flow-state-dev/scheduled";
import { createMockModelResolver } from "@flow-state-dev/testing";

const captured = vi.hoisted(() => ({
  processor: undefined as undefined | ((job: { data: unknown; timestamp?: number; opts?: { prevMillis?: number } }) => Promise<void>),
}));

vi.mock("bullmq", () => ({
  Worker: class {
    constructor(_queue: string, processor: (job: { data: unknown }) => Promise<void>) {
      captured.processor = processor;
    }
  },
  UnrecoverableError: class UnrecoverableError extends Error {},
}));

import { createBullmqScheduleIndex } from "../src/schedule-index";
import { createScheduleDispatchWorker } from "../src/schedules";

const SECRET = "scheduler-secret";

/** The latest Monday 09:00 UTC already due: a time of "0 9 * * MON" that isn't stale. */
function latestMondayNine(now = Date.now()): number {
  const d = new Date(now);
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 9);
  const back = (d.getUTCDay() + 6) % 7; // days since Monday
  let slot = day - back * 86_400_000;
  if (slot > now) slot -= 7 * 86_400_000;
  return slot;
}

const BASE = "http://localhost";

function boot() {
  const jobs: Array<Record<string, unknown>> = [];
  const queue = {
    upsertJobScheduler: vi.fn(async (_id: string, _repeat: unknown, template: { data: Record<string, unknown> }) => {
      jobs.push(template.data);
    }),
    removeJobScheduler: vi.fn(async () => {}),
  };
  const schedules = defineScheduleCollection({
    pattern: "schedules/*",
    index: createBullmqScheduleIndex(queue as never, { flowKind: "reminders" }),
  });
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
  globalThis.fetch = (async (url: string, init?: RequestInit) =>
    router.POST(new Request(url, init), { params: { path: [] } })) as typeof fetch;

  const statuses: number[] = [];
  createScheduleDispatchWorker({
    queueName: "schedules",
    baseUrl: BASE,
    secret: SECRET,
    connection: { host: "localhost" },
    onDispatch: (_job, status) => statuses.push(status),
  });
  const processor = captured.processor!;

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
  return { router, jobs, processor, statuses, planIn, fired };
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("the BullMQ dispatch worker", () => {
  it.each(["globex", DEFAULT_ORG_ID, "Acme.Corp/EU"])(
    "fires a schedule a run saved in %j into that org",
    async (orgId) => {
      const h = boot();
      try {
        await h.planIn(orgId);
        expect(h.jobs).toHaveLength(1);
        expect(h.jobs[0]).toMatchObject({ orgId, userId: "alice", key: "digest" });

        await h.processor({ data: h.jobs[0], timestamp: 1 });
        expect(h.statuses).toEqual([202]);
        const fired = await h.fired();
        expect(fired?.userId).toBe("alice");
        expect(fired?.orgId).toBe(orgId);
      } finally {
        await disposeFlowApiRouter(h.router);
      }
    }
  );

  // The scheduler computes each job's slot (`opts.prevMillis`); the job's own
  // `timestamp` is when it was created, which is no scheduled time. The
  // endpoint fires a scheduled time once, so the slot is what is sent.
  it("fires a job for its scheduler slot, once, however late or often it is processed", async () => {
    const h = boot();
    try {
      await h.planIn("globex");
      // The latest Monday 09:00 UTC: a slot of "0 9 * * MON".
      const slot = latestMondayNine();
      const job = { data: h.jobs[0], timestamp: slot - 7 * 86_400_000 + 1_234, opts: { prevMillis: slot } };
      await h.processor(job);
      // The same slot again, as a retried or second worker's job: answered
      // as a duplicate, which the worker takes as done.
      await h.processor(job);
      expect(h.statuses).toEqual([202, 200]);
      const fired = await h.fired();
      expect((fired?.metadata as { schedule?: { nominalFireTime?: string } }).schedule?.nominalFireTime).toBe(
        new Date(slot).toISOString()
      );
    } finally {
      await disposeFlowApiRouter(h.router);
    }
  });

  it("does not fire the same row under another org's dispatch", async () => {
    const h = boot();
    try {
      await h.planIn("globex");
      await expect(h.processor({ data: { ...h.jobs[0], orgId: "acme" }, timestamp: 1 })).rejects.toThrow(
        "Schedule dispatch failed: 404"
      );
      expect(h.statuses).toEqual([404]);
    } finally {
      await disposeFlowApiRouter(h.router);
    }
  });

  it("refuses a user-scoped job that names no org, without posting it", async () => {
    const h = boot();
    try {
      await h.planIn("globex");
      const { orgId: _dropped, ...noOrg } = h.jobs[0]!;
      await expect(h.processor({ data: noOrg, timestamp: 1 })).rejects.toThrow("no organization");
      expect(h.statuses).toEqual([]);
    } finally {
      await disposeFlowApiRouter(h.router);
    }
  });
});
