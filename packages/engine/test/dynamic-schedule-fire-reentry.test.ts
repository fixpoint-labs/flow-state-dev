// FIX-2895.
/**
 * A dynamic schedule's fire can't be re-entered through a public route.
 *
 * Its handler is made by the flow's schedule resolver at dispatch time and
 * carried only on that dispatch, never stored. A retry, continue or resume of
 * it has no handler to run: the flow's own actions don't hold it. So the
 * routes refuse it the way they refuse any request they won't re-enter, and
 * the session's request list marks it not retryable, so a screen never offers
 * a retry that can't run.
 *
 * Before this, a retry answered 202 and started the run in the background,
 * where it failed to find the action and rejected with nothing to catch it. On
 * a Node host an unhandled rejection ends the process: one person's retry
 * took the server down.
 */
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import { createFlowApiRouter, createFlowRegistry, disposeFlowApiRouter, type StoreRegistry } from "../src";
import { createInMemoryStores } from "../src/host";
import { recentTimes } from "./transports/scheduled/recent-times";

const ORG = "org-a";
const SECRET = "scheduler-secret";
const HOURLY = "0 * * * *";
const { previous: PREVIOUS } = recentTimes(HOURLY);

const poll = handler({
  name: "poll",
  inputSchema: z.object({}).passthrough(),
  execute: () => {
    throw new Error("provider unavailable");
  }
});
const noop = handler({ name: "noop", inputSchema: z.object({}).passthrough(), execute: () => ({}) });

/** The scheduler signs in with the bearer secret; a person with `x-user`. */
const signIn = (context: { request?: Request }) => {
  if (context.request?.headers.get("authorization") === `Bearer ${SECRET}`) return { userId: "system", orgId: ORG };
  const user = context.request?.headers.get("x-user");
  return user == null ? null : { userId: user, orgId: ORG };
};

const routers: ReturnType<typeof createFlowApiRouter>[] = [];
afterEach(async () => {
  await Promise.all(routers.splice(0).map((router) => disposeFlowApiRouter(router)));
});

function build() {
  const flow = defineFlow({
    kind: "threads",
    actions: { noop: { block: noop } },
    authentication: { resolvePrincipal: signIn },
    schedules: {
      // `<user>/poll`: run as that user, each fire in a one-off session of its
      // own (the default), so the schedule-session rule doesn't apply.
      resolve: (id: string) => {
        const match = /^([a-z]+)\/poll$/.exec(id);
        return match === null
          ? null
          : { cron: HOURLY, block: poll, onOverlap: "allow" as const, principal: { userId: match[1]!, orgId: ORG } };
      }
    }
  } as never)();
  const registry = createFlowRegistry();
  registry.register(flow as never);
  const stores = createInMemoryStores();
  const router = createFlowApiRouter({ registry, stores, staleSweepIntervalMs: 0 });
  routers.push(router);
  return { router, stores };
}

type Router = ReturnType<typeof createFlowApiRouter>;

function call(router: Router, method: string, path: string[], headers: Record<string, string>, body?: unknown): Promise<Response> {
  const request = new Request(`http://localhost/api/flows/${path.map(encodeURIComponent).join("/")}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const handlerFor = (router as unknown as Record<string, (r: Request, c: unknown) => Promise<Response>>)[method];
  return handlerFor!(request, { params: { path } });
}

const asAlice = { "x-user": "alice" };

async function settle(stores: StoreRegistry, requestId: string) {
  for (let i = 0; i < 300; i += 1) {
    const record = await stores.request.get(requestId);
    if (record !== undefined && record.status !== "in_progress") return record;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`request ${requestId} did not settle`);
}

describe("a failed fire of a dynamic schedule", () => {
  it("is refused by retry, continue and resume, listed not retryable, and nothing crashes", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      const { router, stores } = build();
      const fired = await call(router, "POST", ["threads", "schedules", "alice/poll", "dispatch"], { authorization: `Bearer ${SECRET}` }, { nominalFireTime: PREVIOUS });
      const { requestId: failed } = (await fired.json()) as { requestId: string };
      const record = await settle(stores, failed);
      expect(record.status).toBe("failed");
      // A one-off session the person owns, so only the dynamic-fire rule can refuse it.
      expect(record.userId).toBe("alice");
      const session = record.sessionId!;

      const retry = await call(router, "POST", ["threads", "sessions", session, "requests", failed, "retry"], asAlice, {});
      expect(retry.status).toBe(404);
      const continued = await call(router, "POST", ["threads", "sessions", session, "requests", failed, "continue"], asAlice, {});
      expect(continued.status).toBe(404);
      const resume = await call(router, "POST", ["threads", "requests", failed, "resume"], asAlice, { suspensionId: "x" });
      expect(resume.status).toBe(404);

      const listed = (await (await call(router, "GET", ["sessions", session, "requests"], asAlice)).json()) as {
        requests: { id: string; retryable: boolean }[];
      };
      expect(listed.requests).toEqual([expect.objectContaining({ id: failed, retryable: false })]);
      // Nothing re-ran: the session still holds the one failed fire.
      expect((await stores.request.list({ sessionId: session })).map((request) => request.id)).toEqual([failed]);

      // Node reports an unhandled rejection after the microtask queue drains.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
