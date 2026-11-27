// FIX-2895.
/**
 * A dynamic schedule's fire never parks.
 *
 * Its handler is made by the flow's schedule resolver at dispatch time and
 * carried only on that dispatch. Anything that continues a parked request (an
 * answer, a stop, a waited-on child ending, the sweep) re-runs it from its
 * stored record, which holds no handler, so a parked dynamic fire could never
 * run again: an answer was accepted and the turn stayed stopped. So the stop is
 * refused when it is asked for, before any gate is written, and the fire gets
 * no waits. A static schedule's fire, whose handler the flow declares, parks as
 * usual: that is the control.
 */
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import { requestHostOf } from "@flow-state-dev/core/internal";
import { createFlowApiRouter, createFlowRegistry, disposeFlowApiRouter, type StoreRegistry } from "../src";
import { createInMemoryStores } from "../src/host";
import { createCheckpointDurabilityProvider } from "../src/durability/checkpoint-durability-provider";
import { recentTimes } from "./transports/scheduled/recent-times";

const ORG = "org-a";
const SECRET = "scheduler-secret";
const HOURLY = "0 * * * *";
const { previous: PREVIOUS } = recentTimes(HOURLY);

/** Notes whether it was given waits, then stops for the user. */
function asking(seen: { waits?: boolean }) {
  return handler({
    name: "ask",
    inputSchema: z.object({}).passthrough(),
    outputSchema: z.any(),
    execute: async (_input, ctx) => {
      seen.waits = requestHostOf(ctx)?.waits !== undefined;
      return ctx.suspendForUser({ kind: "review", prompt: "Look at this." } as never);
    }
  });
}

const signIn = (context: { request?: Request }) =>
  context.request?.headers.get("authorization") === `Bearer ${SECRET}` ? { userId: "system", orgId: ORG } : null;

const routers: ReturnType<typeof createFlowApiRouter>[] = [];
afterEach(async () => {
  await Promise.all(routers.splice(0).map((router) => disposeFlowApiRouter(router)));
});

function build(origin: "dynamic" | "static") {
  const seen: { waits?: boolean } = {};
  const block = asking(seen);
  const schedule = { cron: HOURLY, block, onOverlap: "allow" as const, principal: { userId: "alice", orgId: ORG } };
  const flow = defineFlow({
    kind: "threads",
    authentication: { resolvePrincipal: signIn },
    schedules:
      origin === "dynamic"
        ? { resolve: (id: string) => (id === "alice-review" ? schedule : null) }
        : { static: { "alice-review": schedule } }
  } as never)();
  const registry = createFlowRegistry();
  registry.register(flow as never);
  const stores = createInMemoryStores();
  const provider = createCheckpointDurabilityProvider(stores);
  const router = createFlowApiRouter({ registry, stores, staleSweepIntervalMs: 0, durabilityProvider: provider, requestHost: {} } as never);
  routers.push(router);
  return { router, stores, provider, seen };
}

async function fire(router: ReturnType<typeof createFlowApiRouter>, stores: StoreRegistry) {
  const path = ["threads", "schedules", "alice-review", "dispatch"];
  const response = await router.POST(
    new Request(`http://localhost/api/flows/${path.map(encodeURIComponent).join("/")}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
      body: JSON.stringify({ nominalFireTime: PREVIOUS })
    }),
    { params: { path } }
  );
  const body = (await response.json()) as { status: string; requestId: string };
  expect(body.status, JSON.stringify(body)).toBe("accepted");
  for (let i = 0; i < 300; i += 1) {
    const record = await stores.request.get(body.requestId);
    if (record !== undefined && record.status !== "in_progress") return record;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`request ${body.requestId} did not settle`);
}

describe("a dynamic schedule's fire", () => {
  it("is refused a stop before any gate is written, and is given no waits", async () => {
    const { router, stores, provider, seen } = build("dynamic");
    const record = await fire(router, stores);
    expect(seen.waits).toBe(false);
    expect(record.status).toBe("failed");
    expect(record.result?.error?.message).toMatch(/dynamic schedule's fire can't stop or wait/);
    expect((await provider.listSuspended({ status: "pending" })).filter((s) => s.requestId === record.id)).toHaveLength(0);
  });

  it("control: a static schedule's fire is given waits and parks", async () => {
    const { router, stores, provider, seen } = build("static");
    const record = await fire(router, stores);
    expect(seen.waits).toBe(true);
    expect(record.status).toBe("suspended");
    expect((await provider.listSuspended({ status: "pending" })).filter((s) => s.requestId === record.id)).toHaveLength(1);
  });
});
