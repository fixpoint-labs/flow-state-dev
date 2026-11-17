/**
 * The scheduled endpoint is one of the router's own adapters: a flow with
 * `schedules` is reachable on its dispatch and listing routes with nothing in
 * `adapters`, also when it is registered after the router is built. A flow
 * with no `schedules` answers both routes exactly as an unknown flow does,
 * before any principal resolver runs, so an app with no schedules never sees a
 * `scheduled` call and the route can't confirm an instance exists.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import type { PrincipalResolver } from "../../src/transports/types";
import {
  createBearerSecretPrincipalResolver,
  createFlowApiRouter,
  createFlowRegistry,
  disposeFlowApiRouter
} from "../../src";
import { createInMemoryStores } from "../../src/host";

const SECRET = "scheduler-secret-do-not-share";

const noop = handler({ name: "noop", inputSchema: z.object({}).passthrough(), execute: () => ({ ok: true }) });

const bearer = createBearerSecretPrincipalResolver({ secret: SECRET, principal: { userId: "system", orgId: "org_sys" } });

function scheduledFlow(kind: string) {
  return defineFlow({
    kind,
    authentication: { resolvePrincipal: bearer, requireUser: true },
    schedules: { static: { "each-minute": { cron: "* * * * *", block: noop } } },
    actions: {}
  })();
}

/** A flow with no schedules whose resolver records every call it is asked to resolve. */
function unscheduledFlow(kind: string, seen: string[]) {
  const recording: PrincipalResolver = async (ctx) => {
    seen.push(ctx.source);
    return bearer(ctx);
  };
  return defineFlow({
    kind,
    authentication: { resolvePrincipal: recording, requireUser: true },
    actions: { run: { block: noop } }
  })();
}

function request(method: "GET" | "POST", path: string, withSecret = true): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(withSecret ? { Authorization: `Bearer ${SECRET}` } : {})
    },
    ...(method === "POST" ? { body: "{}" } : {})
  });
}

function call(router: ReturnType<typeof createFlowApiRouter>, method: "GET" | "POST", path: string, withSecret = true) {
  const segments = path.replace(/^\/api\/flows\//, "").split("/");
  return router[method](request(method, path, withSecret), { params: { path: segments } });
}

describe("the scheduled endpoint is built into the router", () => {
  it("dispatches a static schedule with no adapters passed", async () => {
    const registry = createFlowRegistry();
    registry.register(scheduledFlow("billing"));
    const router = createFlowApiRouter({ registry, stores: createInMemoryStores() });
    try {
      const response = await call(router, "POST", "/api/flows/billing/schedules/each-minute/dispatch");
      expect(response.status).toBe(202);
      expect(await response.json()).toMatchObject({ status: "accepted", scheduleId: "each-minute", origin: "static" });
    } finally {
      await disposeFlowApiRouter(router);
    }
  });

  it("lists a flow's static schedules with no adapters passed", async () => {
    const registry = createFlowRegistry();
    registry.register(scheduledFlow("billing"));
    const router = createFlowApiRouter({ registry, stores: createInMemoryStores() });
    try {
      const response = await call(router, "GET", "/api/flows/billing/schedules");
      expect(response.status).toBe(200);
      const body = (await response.json()) as { static: Array<{ id: string }> };
      expect(body.static.map((entry) => entry.id)).toEqual(["each-minute"]);
    } finally {
      await disposeFlowApiRouter(router);
    }
  });

  // D1: the router's adapters are fixed when it is built; the mount must not be.
  it("routes a scheduled flow registered after the router was built", async () => {
    const registry = createFlowRegistry();
    const router = createFlowApiRouter({ registry, stores: createInMemoryStores() });
    try {
      registry.register(scheduledFlow("late"));
      const response = await call(router, "POST", "/api/flows/late/schedules/each-minute/dispatch");
      expect(response.status).toBe(202);
    } finally {
      await disposeFlowApiRouter(router);
    }
  });

  it("answers a flow with no schedules as an unknown flow, before its resolver runs", async () => {
    const seen: string[] = [];
    const registry = createFlowRegistry();
    registry.register(unscheduledFlow("plain", seen));
    const router = createFlowApiRouter({ registry, stores: createInMemoryStores() });
    try {
      const paths: Array<["GET" | "POST", string]> = [
        ["GET", "/schedules"],
        ["POST", "/schedules/anything/dispatch"]
      ];
      for (const [method, rest] of paths) {
        for (const withSecret of [true, false]) {
          const unknown = await call(router, method, `/api/flows/never-registered${rest}`, withSecret);
          const plain = await call(router, method, `/api/flows/plain${rest}`, withSecret);
          expect(plain.status).toBe(404);
          expect(plain.status).toBe(unknown.status);
          expect(await plain.text()).toBe(await unknown.text());
        }
      }
      expect(seen).not.toContain("scheduled");
    } finally {
      await disposeFlowApiRouter(router);
    }
  });

  it("refuses an app adapter that registers the same schedule path", () => {
    const registry = createFlowRegistry();
    expect(() =>
      createFlowApiRouter({
        registry,
        stores: createInMemoryStores(),
        adapters: [
          {
            source: "mine",
            createBindings: () => ({
              routes: [
                {
                  method: "POST",
                  path: "/api/flows/:flowKind/schedules/*scheduleId/dispatch",
                  handler: async () => new Response(null, { status: 204 })
                }
              ]
            })
          }
        ]
      })
    ).toThrow(/schedules/);
  });
});
