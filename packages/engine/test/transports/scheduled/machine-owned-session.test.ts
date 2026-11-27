// FIX-2942; BP-031.
/**
 * A schedule that fires as the gateway owns nothing but its own session, and
 * so does every later run in that session.
 *
 * Why these matter: the scheduler's bearer principal is one machine user that
 * every gateway schedule shares, so an owner compare alone lets one schedule's
 * turn name another's session. The fence was a stamp on the fire's metadata,
 * which a wake or an internal run in the same session replaces. These fire
 * real schedules through the dispatch endpoint, then judge a named reach from
 * the sessions they were born in, before and after another run in them, and
 * check a schedule naming a person still reaches that person.
 */
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler, type ScheduleConfig } from "@flow-state-dev/core";
import {
  createBearerSecretPrincipalResolver,
  createFlowApiRouter,
  createFlowRegistry,
  disposeFlowApiRouter,
  runAction,
  type StoreRegistry
} from "../../../src";
import { createInMemoryStores } from "../../../src/host";
import { admitNamedSession, type BlockCaller } from "../../../src/context/named-session";
import { recentTimes } from "./recent-times";

const SECRET = "scheduler-secret";
const HOURLY = "0 * * * *";
const { latest: LATEST } = recentTimes(HOURLY);
const ORG = "org_sys";
const GATEWAY = { userId: "cron-gateway", orgId: ORG };

const tick = handler({ name: "tick", inputSchema: z.object({}).passthrough(), execute: async () => ({ ok: true }) });

const schedule = (extra: Partial<ScheduleConfig>): ScheduleConfig => ({ cron: HOURLY, block: tick, session: "per-schedule", onOverlap: "allow", ...extra });

// The host's resolver, not the flow's: a flow with a resolver of its own admits a
// named reach only on that resolver's verdict, which no schedule run carries.
const polls = defineFlow({
  kind: "polls",
  schedules: {
    static: {
      // Falls back to the gateway.
      fallback: schedule({}),
      // Names the gateway's own user and org: the same machine, spelled out.
      explicit: schedule({ principal: { ...GATEWAY } }),
      // Name a person: these run as carol.
      carol: schedule({ principal: { userId: "u_carol", orgId: ORG } }),
      "carol-two": schedule({ principal: { userId: "u_carol", orgId: ORG } })
    }
  },
  actions: {},
  // A later run in a fire's session: what a wake or internal dispatch replays.
  internal: { actions: { wake: { block: tick } } }
})();

const routers: ReturnType<typeof createFlowApiRouter>[] = [];
afterEach(async () => {
  await Promise.all(routers.splice(0).map((router) => disposeFlowApiRouter(router)));
});

function build() {
  const registry = createFlowRegistry();
  registry.register(polls);
  const stores = createInMemoryStores();
  const router = createFlowApiRouter({
    registry,
    stores,
    staleSweepIntervalMs: 0,
    resolvePrincipal: createBearerSecretPrincipalResolver({ secret: SECRET, principal: GATEWAY })
  });
  routers.push(router);
  return { router, stores, registry };
}

async function settled(stores: StoreRegistry, requestId: string) {
  for (let i = 0; i < 300; i += 1) {
    const record = await stores.request.get(requestId);
    if (record !== undefined && record.status !== "in_progress") return record;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`request ${requestId} did not settle`);
}

/** Fire `scheduleId` once and return the session its run landed in, with the principal it ran as. */
async function fire(env: ReturnType<typeof build>, scheduleId: string) {
  const response = await env.router.POST(
    new Request(`http://localhost/api/flows/polls/schedules/${scheduleId}/dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SECRET}` },
      body: JSON.stringify({ nominalFireTime: LATEST })
    }),
    { params: { path: ["polls", "schedules", scheduleId, "dispatch"] } }
  );
  const fired = (await response.json()) as { status: string; requestId: string };
  expect(fired.status).toBe("accepted");
  const record = await settled(env.stores, fired.requestId);
  expect(record.status).toBe("completed");
  return { sessionId: record.sessionId!, userId: record.userId, orgId: record.orgId! };
}

/** A block of `polls` running in `from`'s session, naming `target`. */
function reach(env: ReturnType<typeof build>, from: { sessionId: string; userId: string; orgId: string }, target: string) {
  const caller: BlockCaller = { userId: from.userId, orgId: from.orgId, flowId: "polls", sessionId: from.sessionId };
  return admitNamedSession({ sessions: env.stores.session, registry: env.registry, caller }, target);
}

describe("a gateway schedule's session", () => {
  it("is refused another gateway schedule's session, both ways, as an unknown id", async () => {
    const env = build();
    const fallback = await fire(env, "fallback");
    const explicit = await fire(env, "explicit");
    // Both run as the same machine user: only the fence keeps them apart.
    expect(explicit.userId).toBe(fallback.userId);
    expect(await reach(env, fallback, "nobody-holds-this")).toBeUndefined();
    expect(await reach(env, fallback, explicit.sessionId)).toBeUndefined();
    expect(await reach(env, explicit, fallback.sessionId)).toBeUndefined();
    // Its own session it still holds.
    expect(await reach(env, fallback, fallback.sessionId)).toBeDefined();
  });

  it("stays refused from a later internal run in the same session, which carries no schedule metadata", async () => {
    const env = build();
    const fallback = await fire(env, "fallback");
    const explicit = await fire(env, "explicit");
    const woke = await runAction({
      flow: polls,
      actionName: "wake" as never,
      input: {},
      userId: fallback.userId,
      orgId: fallback.orgId,
      sessionId: fallback.sessionId,
      source: "internal",
      metadata: {},
      stores: env.stores,
      runtimeConfig: {}
    });
    expect((await settled(env.stores, woke.requestId!)).status).toBe("completed");
    expect(await reach(env, fallback, explicit.sessionId)).toBeUndefined();
  });

  it("is a person's when the schedule names a person, and reaches that person's other sessions", async () => {
    const env = build();
    const first = await fire(env, "carol");
    const second = await fire(env, "carol-two");
    expect(first.userId).toBe("u_carol");
    expect(first.sessionId).not.toBe(second.sessionId);
    expect((await reach(env, first, second.sessionId))?.userId).toBe("u_carol");
    // ...and never the gateway's.
    const fallback = await fire(env, "fallback");
    expect(await reach(env, first, fallback.sessionId)).toBeUndefined();
  });
});
