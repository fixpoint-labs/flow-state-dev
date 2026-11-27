// FIX-2752; FIX-1442.
/**
 * A schedule a run saves fires, through the Vercel route, into the org it was
 * saved in.
 *
 * The chain is real except for the cron, the network and the index store: a
 * run writes the row through the documented collection API, the collection
 * mirrors it into an in-memory index, Vercel Cron's GET reaches
 * `vercelScheduler`'s route, the app's tick claims the row and posts it over
 * the network (here, `fetch` answered by the same app's router) to the real
 * scheduled endpoint, and the resolver reads the user's cell in the org the
 * dispatch names. The dispatch id names the org in the URL path, so an org id
 * with uppercase, `.` or `/` must survive it, and a row naming another org, or
 * none, must not fire.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import type { FlowInstance, ResourceCollectionRef } from "@flow-state-dev/core/types";
import { createBearerSecretPrincipalResolver, createFlowState, runAction, type FlowState } from "@flow-state-dev/engine";
import {
  createResourceCollectionScheduleResolver,
  defineScheduleCollection,
  type ScheduleIndex,
  type ScheduleIndexEntry
} from "@flow-state-dev/scheduled";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { vercelScheduler } from "../src/scheduler";
import { oneOffSessionId } from "@flow-state-dev/core/helpers";

const SECRET = "scheduler-secret";
const DEPLOYMENT = "https://reminders.example.com";

/** The latest Monday 09:00 UTC already due: a time of "0 9 * * MON" that isn't stale. */
function latestMondayNine(now = Date.now()): number {
  const d = new Date(now);
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 9);
  const back = (d.getUTCDay() + 6) % 7; // days since Monday
  let slot = day - back * 86_400_000;
  if (slot > now) slot -= 7 * 86_400_000;
  return slot;
}

const apps: FlowState[] = [];
const realFetch = globalThis.fetch;
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.dispose()));
  globalThis.fetch = realFetch;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function boot(secretFrom: "env" | "option" = "env") {
  vi.stubEnv("CRON_SECRET", secretFrom === "env" ? SECRET : "");
  const rows: ScheduleIndexEntry[] = [];
  const index: ScheduleIndex = {
    async upsert(row) {
      rows.push(row);
    },
    async remove() {},
    // A real index returns only rows already due; every row here is.
    async claimDue() {
      return rows.map((row) => ({ ...row, nextFireAt: latestMondayNine() }));
    }
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
        enabled: true
      });
      return { ok: true };
    }
  });
  const flow = defineFlow({
    kind: "reminders",
    resources: { schedules },
    authentication: {
      // The gateway authenticates into acme; a dynamic schedule must not
      // borrow that organization.
      resolvePrincipal: createBearerSecretPrincipalResolver({
        secret: SECRET,
        principal: { userId: "system", orgId: "acme" }
      }),
      requireUser: true
    },
    schedules: {
      resolve: createResourceCollectionScheduleResolver({ collection: schedules, blocks: { ping } }),
      index
    },
    actions: { plan }
  })() as unknown as FlowInstance;

  const scheduler = vercelScheduler(secretFrom === "option" ? { secret: SECRET } : {});
  const app = createFlowState({
    flows: [flow],
    modelResolver: createMockModelResolver({}),
    scheduler
  });
  apps.push(app);

  // The network: each dispatch the tick sends reaches this app's router.
  const statuses: number[] = [];
  const posted = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const router = await app.getRouter();
    const res = await router.POST(new Request(url, init), { params: { path: [] } });
    statuses.push(res.status);
    return res;
  });
  globalThis.fetch = posted as unknown as typeof fetch;

  const cron = () =>
    scheduler.route(new Request(`${DEPLOYMENT}/api/cron/schedules`, { headers: { Authorization: `Bearer ${SECRET}` } }));
  const planIn = async (orgId: string) => {
    const { stores, runtimeConfig } = await app.getRuntime();
    return runAction({ sessionId: oneOffSessionId(), flow, actionName: "plan", input: { key: "digest" }, userId: "alice", orgId, stores, runtimeConfig });
  };
  const fired = async () => {
    const { stores } = await app.getRuntime();
    for (let i = 0; i < 200; i++) {
      const found = (await stores.request.list({ limit: 10 })).find((r) => r.source === "scheduled");
      if (found !== undefined) return found;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return undefined;
  };
  return { rows, posted, statuses, cron, planIn, fired };
}

describe("a dynamic schedule fired through the Vercel route", () => {
  // The secret that let the cron call in is the one each fire carries, or the
  // flow's bearer check refuses every fire of an app that configures it in code.
  it("carries the adapter's configured secret on each fire when CRON_SECRET is unset", async () => {
    const h = boot("option");
    await h.planIn("globex");

    expect((await h.cron()).status).toBe(200);
    expect(h.statuses).toEqual([202]);
    expect((await h.fired())?.orgId).toBe("globex");
  });

  it.each(["globex", DEFAULT_ORG_ID, "Acme.Corp/EU"])("fires a schedule a run saved in %j into that org", async (orgId) => {
    const h = boot();
    await h.planIn(orgId);
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0]).toMatchObject({ orgId, userId: "alice", key: "digest" });

    expect((await h.cron()).status).toBe(200);
    expect(h.posted.mock.calls.map(([url]) => String(url).startsWith(`${DEPLOYMENT}/api/flows/reminders/schedules/`))).toEqual([true]);
    expect(h.statuses).toEqual([202]);
    const fired = await h.fired();
    expect(fired?.userId).toBe("alice");
    expect(fired?.orgId).toBe(orgId);
  });

  it("does not fire the same row under another org's dispatch", async () => {
    const h = boot();
    await h.planIn("globex");
    h.rows[0] = { ...h.rows[0]!, orgId: "acme" };
    await h.cron();
    expect(h.statuses).toEqual([404]);
  });

  it("does not post a row that names no org", async () => {
    const h = boot();
    // The default runtime logger is quiet under NODE_ENV=test; the refusal is a console line.
    vi.stubEnv("NODE_ENV", "development");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await h.planIn("globex");
    const { orgId: _dropped, ...noOrg } = h.rows[0]!;
    h.rows[0] = noOrg;
    expect((await h.cron()).status).toBe(200);
    expect(h.posted).not.toHaveBeenCalled();
    expect(err.mock.calls.filter(([line]) => String(line).includes("alice/digest has no organization"))).toHaveLength(1);
  });
});
