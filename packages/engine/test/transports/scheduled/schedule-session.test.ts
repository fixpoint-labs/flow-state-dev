/**
 * Where a scheduled fire runs (FIX-2886). A `per-schedule` schedule's fires
 * all run in one session the dispatch endpoint derives from who the fire runs
 * as, the flow instance and the schedule id, so a poll keeps its history in
 * one place instead of leaving a one-off session per fire. A schedule that
 * says nothing keeps one-off runs, and a fire the overlap check skips never
 * reaches the session.
 */
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler, type ScheduleConfig } from "@flow-state-dev/core";
import {
  createBearerSecretPrincipalResolver,
  createFlowApiRouter,
  createFlowRegistry,
  disposeFlowApiRouter,
  type StoreRegistry
} from "../../../src";
import { createInMemoryStores } from "../../../src/host";
import { isScheduleSessionId } from "../../../src/transports/scheduled/schedule-session-id";
import { isOneOffSessionId } from "@flow-state-dev/core/helpers";
import { recentTimes } from "./recent-times";

const SECRET = "scheduler-secret";
const HOURLY = "0 * * * *";
const { latest: LATEST, previous: PREVIOUS } = recentTimes(HOURLY);

/** Held fires wait here until a test lets them finish. */
let release: (() => void) | undefined;
let held: Promise<void> | undefined;

const tick = handler({
  name: "tick",
  inputSchema: z.object({}).passthrough(),
  execute: async () => {
    if (held !== undefined) await held;
    return { ok: true };
  }
});

function pollFlow(kind: string) {
  const schedule = (extra: Partial<ScheduleConfig>): ScheduleConfig => ({ cron: HOURLY, block: tick, ...extra });
  return defineFlow({
    kind,
    authentication: {
      resolvePrincipal: createBearerSecretPrincipalResolver({ secret: SECRET, principal: { userId: "system", orgId: "org_sys" } }),
      requireUser: true
    },
    schedules: {
      static: {
        poll: schedule({ session: "per-schedule", onOverlap: "allow" }),
        other: schedule({ session: "per-schedule", onOverlap: "allow" }),
        slow: schedule({ session: "per-schedule" }),
        plain: schedule({ onOverlap: "allow" })
      },
      // `<user>/poll`: one schedule per user, run as that user.
      resolve: (id) => {
        const match = /^(u_[a-z]+)\/poll$/.exec(id);
        return match === null
          ? null
          : schedule({ session: "per-schedule", onOverlap: "allow", principal: { userId: match[1]!, orgId: "org_sys" } });
      }
    },
    actions: {}
  })();
}

const routers: ReturnType<typeof createFlowApiRouter>[] = [];
afterEach(async () => {
  release?.();
  release = undefined;
  held = undefined;
  await Promise.all(routers.splice(0).map((router) => disposeFlowApiRouter(router)));
});

function build() {
  const registry = createFlowRegistry();
  registry.register(pollFlow("polls"));
  registry.register(pollFlow("polls-two"));
  const stores = createInMemoryStores();
  const router = createFlowApiRouter({ registry, stores, staleSweepIntervalMs: 0 });
  routers.push(router);
  return { router, stores };
}

async function fire(router: ReturnType<typeof build>["router"], kind: string, scheduleId: string, nominalFireTime: string) {
  const response = await router.POST(
    new Request(`http://localhost/api/flows/${kind}/schedules/${scheduleId}/dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SECRET}` },
      body: JSON.stringify({ nominalFireTime })
    }),
    { params: { path: [kind, "schedules", scheduleId, "dispatch"] } }
  );
  return (await response.json()) as { status: string; requestId: string };
}

/** The request record once it has settled. */
async function settled(stores: StoreRegistry, requestId: string) {
  for (let i = 0; i < 300; i += 1) {
    const record = await stores.request.get(requestId);
    if (record !== undefined && record.status !== "in_progress") return record;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`request ${requestId} did not settle`);
}

/** The session a fired, settled request ran in. */
async function sessionOf(stores: StoreRegistry, fired: { status: string; requestId: string }) {
  expect(fired.status).toBe("accepted");
  return (await settled(stores, fired.requestId)).sessionId!;
}

describe("a per-schedule schedule's fires", () => {
  it("run in one session, named on every fire's request record, created by the first fire", async () => {
    const { router, stores } = build();
    const first = await sessionOf(stores, await fire(router, "polls", "poll", PREVIOUS));
    const second = await sessionOf(stores, await fire(router, "polls", "poll", LATEST));
    expect(first).toBe(second);
    expect(isScheduleSessionId(first)).toBe(true);
    // Reserved, and colon-free: a tenant header can't split it.
    expect(first).not.toContain(":");
    const session = await stores.session.get(first);
    expect(session).toMatchObject({ flowKind: "polls", userId: "system", orgId: "org_sys" });
    const requests = await stores.request.list({ sessionId: first });
    expect(requests).toHaveLength(2);
  });

  it("never share a session across schedule ids, users or flow instances", async () => {
    const { router, stores } = build();
    const ids = [
      await sessionOf(stores, await fire(router, "polls", "poll", LATEST)),
      await sessionOf(stores, await fire(router, "polls", "other", LATEST)),
      await sessionOf(stores, await fire(router, "polls-two", "poll", LATEST)),
      await sessionOf(stores, await fire(router, "polls", "u_alice/poll", LATEST)),
      await sessionOf(stores, await fire(router, "polls", "u_bob/poll", LATEST))
    ];
    expect(ids.every(isScheduleSessionId)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect((await stores.session.get(ids[3]!))?.userId).toBe("u_alice");
    expect((await stores.session.get(ids[4]!))?.userId).toBe("u_bob");
  });

  it("skip an overlapping fire before it reaches the session", async () => {
    const { router, stores } = build();
    held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = await fire(router, "polls", "slow", PREVIOUS);
    expect(first.status).toBe("accepted");
    const overlapping = await fire(router, "polls", "slow", LATEST);
    expect(overlapping).toMatchObject({ status: "skipped", requestId: first.requestId });
    release!();
    const session = await sessionOf(stores, first);
    expect(isScheduleSessionId(session)).toBe(true);
    const requests = await stores.request.list({ sessionId: session });
    expect(requests.map((request) => request.id)).toEqual([first.requestId]);
  });
});

describe("a schedule that does not opt in", () => {
  it("still runs each fire as a one-off, in a session of its own", async () => {
    const { router, stores } = build();
    const fires = [await fire(router, "polls", "plain", PREVIOUS), await fire(router, "polls", "plain", LATEST)];
    for (const fired of fires) await settled(stores, fired.requestId);
    const sessions = (await stores.session.list({})).map((session) => session.id);
    expect(sessions).toHaveLength(2);
    expect(sessions.every(isOneOffSessionId)).toBe(true);
    expect(sessions.some(isScheduleSessionId)).toBe(false);
  });

  it("names its one-off session on the request record from the first write, made at the endpoint", async () => {
    const { router, stores } = build();
    held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fired = await fire(router, "polls", "plain", LATEST);
    expect(fired.status).toBe("accepted");
    // Read while the fire is still running: the record named its session
    // before the run built its context, not after.
    const running = await stores.request.get(fired.requestId);
    expect(running?.status).toBe("in_progress");
    expect(isOneOffSessionId(running!.sessionId!)).toBe(true);
    release!();
    expect((await settled(stores, fired.requestId)).sessionId).toBe(running!.sessionId);
  });
});
