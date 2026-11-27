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
import { defineFlow, dispatcher, handler, type ScheduleConfig } from "@flow-state-dev/core";
import {
  createBearerSecretPrincipalResolver,
  createFlowApiRouter,
  createFlowRegistry,
  disposeFlowApiRouter,
  runAction,
  type StoreRegistry
} from "../../../src";
import { createInMemoryStores } from "../../../src/host";
import { admitNamedSession } from "../../../src/context/named-session";
import type { Principal } from "../../../src/context/principal";
import { recentTimes } from "./recent-times";

const SECRET = "scheduler-secret";
const HOURLY = "0 * * * *";
const { latest: LATEST } = recentTimes(HOURLY);
const ORG = "org_sys";
const GATEWAY = { userId: "cron-gateway", orgId: ORG };

const tick = handler({ name: "tick", inputSchema: z.object({}).passthrough(), execute: async () => ({ ok: true }) });

/** Children the `spawn` schedule's dispatch started: request ids, in order. */
const spawned: string[] = [];
const child = handler({
  name: "child",
  inputSchema: z.object({}).passthrough(),
  execute: async (_input, ctx) => {
    spawned.push(ctx.request.identity.id);
    return {};
  }
});
/** A gateway schedule whose turn dispatches into a keyed child session, which the child is born in. */
const spawn = dispatcher({
  name: "spawn",
  type: "internal",
  action: "child",
  inputSchema: z.object({}).passthrough(),
  session: { key: () => "spawned" },
  payload: () => ({})
});

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
      "carol-two": schedule({ principal: { userId: "u_carol", orgId: ORG } }),
      spawn: schedule({ block: spawn })
    }
  },
  actions: {},
  // A later run in a fire's session: what a wake or internal dispatch replays.
  internal: { actions: { wake: { block: tick }, child: { block: child } } }
})();

const HOST_RESOLVER = createBearerSecretPrincipalResolver({ secret: SECRET, principal: GATEWAY });

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
    resolvePrincipal: HOST_RESOLVER
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
  return runOf(record);
}

/** The run a request record stored: its session, and the principal its door set. */
function runOf(record: { sessionId?: string; userId: string; orgId?: string; principalKind?: Principal["kind"]; resolvedBy?: string }) {
  const principal: Principal = {
    userId: record.userId,
    orgId: record.orgId!,
    kind: record.principalKind ?? "machine",
    ...(record.resolvedBy !== undefined ? { resolvedBy: record.resolvedBy } : {})
  };
  return { sessionId: record.sessionId!, userId: record.userId, orgId: record.orgId!, principal };
}

/** A block of `polls` running in `from`'s session, as its principal, naming `target`. */
function reach(env: ReturnType<typeof build>, from: ReturnType<typeof runOf>, target: string) {
  return admitNamedSession(
    { stores: env.stores, registry: env.registry, hostResolver: HOST_RESOLVER, principal: from.principal, sessionId: from.sessionId },
    target
  );
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
    const later = runOf(await settled(env.stores, woke.requestId!));
    expect(later.principal.kind).toBe("machine");
    expect(await reach(env, later, explicit.sessionId)).toBeUndefined();
  });

  it("makes the child session it dispatches into a machine's too, refused the other schedule's session", async () => {
    const env = build();
    spawned.length = 0;
    const fallback = await fire(env, "fallback");
    await fire(env, "spawn");
    for (let i = 0; i < 300 && spawned.length === 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(spawned).toHaveLength(1);
    const childRun = await settled(env.stores, spawned[0]!);
    const childSession = runOf(childRun);
    // Born a machine's, and run as one: the dispatch carried the fire's principal.
    expect((await env.stores.session.get(childSession.sessionId))?.principalKind).toBe("machine");
    expect(childSession.principal.kind).toBe("machine");
    // The child runs as the machine, under the dispatch's source and metadata: no schedule stamp at all.
    expect(childSession.userId).toBe(GATEWAY.userId);
    expect(childRun.source).not.toBe("scheduled");
    expect(childSession.sessionId).not.toBe(fallback.sessionId);
    expect(await reach(env, childSession, fallback.sessionId)).toBeUndefined();
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
