/**
 * End-to-end roundtrip — wires the adapter into the real
 * `createFlowApiRouter`, dispatches a schedule, and asserts the action
 * ran with `source: 'scheduled'` stamped on the resulting RequestRecord.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import {
  createBearerSecretPrincipalResolver,
  createFlowApiRouter,
  createFlowRegistry,
  createInMemoryStores,
  disposeFlowApiRouter
} from "@flow-state-dev/server";
import { createScheduledTransportAdapter } from "../src";

const SECRET = "scheduler-secret-do-not-share";

function buildRouter() {
  const registry = createFlowRegistry();
  const stores = createInMemoryStores();

  registry.register(
    defineFlow({
      kind: "billing",
      authentication: {
        resolvePrincipal: createBearerSecretPrincipalResolver({
          secret: SECRET,
          principal: { userId: "system" }
        }),
        requireUser: true
      },
      schedules: {
        static: {
          "monthly-invoices": {
            cron: "0 0 1 * *",
            action: "generateInvoices"
          }
        }
      },
      actions: {
        generateInvoices: {
          inputSchema: z.object({ topic: z.string().optional() }),
          block: handler<{ topic?: string }, { ok: true }>({
            name: "generate-invoices",
            execute: () => ({ ok: true })
          })
        }
      }
    })()
  );

  registry.register(
    defineFlow({
      kind: "reminders",
      authentication: {
        resolvePrincipal: async (ctx) => {
          if (ctx.source === "scheduled") {
            const resolver = createBearerSecretPrincipalResolver({
              secret: SECRET,
              principal: { userId: "system" }
            });
            return resolver(ctx);
          }
          return null;
        },
        requireUser: true
      },
      schedules: {
        resolve: async (id) => {
          if (id === "u_1/weekly-digest") {
            return {
              cron: "0 9 * * MON",
              action: "sendDigest",
              principal: { userId: "u_1" }
            };
          }
          return null;
        }
      },
      actions: {
        sendDigest: {
          inputSchema: z.object({}),
          block: handler<Record<string, never>, { ok: true }>({
            name: "send-digest",
            execute: () => ({ ok: true })
          })
        }
      }
    })()
  );

  const router = createFlowApiRouter({
    registry,
    stores,
    adapters: [createScheduledTransportAdapter()]
  });

  return { router, stores, registry };
}

async function postDispatch(
  router: ReturnType<typeof createFlowApiRouter>,
  kind: string,
  scheduleId: string,
  body?: unknown
): Promise<Response> {
  const init: RequestInit = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SECRET}`
    }
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const request = new Request(
    `http://localhost/api/flows/${kind}/schedules/${scheduleId}/dispatch`,
    init
  );
  return router.POST(request, {
    params: { path: [kind, "schedules", scheduleId, "dispatch"] }
  });
}

async function getList(
  router: ReturnType<typeof createFlowApiRouter>,
  kind: string
): Promise<Response> {
  const request = new Request(`http://localhost/api/flows/${kind}/schedules`, {
    method: "GET",
    headers: { Authorization: `Bearer ${SECRET}` }
  });
  return router.GET(request, { params: { path: [kind, "schedules"] } });
}

async function waitForRequest(
  stores: ReturnType<typeof createInMemoryStores>,
  expected = 1,
  timeoutMs = 2000
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const records = await stores.request.list({ limit: 10 });
    if (records.length >= expected) return records;
    await new Promise((r) => setTimeout(r, 10));
  }
  return stores.request.list({ limit: 10 });
}

describe("scheduled adapter — end-to-end", () => {
  it("dispatches a static schedule and stamps source='scheduled'", async () => {
    const { router, stores } = buildRouter();
    try {
      const response = await postDispatch(router, "billing", "monthly-invoices", {
        nominalFireTime: "2026-06-01T00:00:00Z"
      });
      expect(response.status).toBe(202);

      const records = await waitForRequest(stores, 1);
      expect(records.length).toBeGreaterThanOrEqual(1);
      const record = records[0]!;
      expect(record.source).toBe("scheduled");
      expect(record.flowKind).toBe("billing");
      expect((record.metadata as Record<string, unknown>)?.scheduleId).toBe("monthly-invoices");
      expect((record.metadata as Record<string, unknown>)?.origin).toBe("static");
    } finally {
      await disposeFlowApiRouter(router);
    }
  });

  it("dispatches a dynamic schedule with origin='dynamic' as the resolved user", async () => {
    const { router, stores } = buildRouter();
    try {
      const response = await postDispatch(router, "reminders", "u_1/weekly-digest");
      expect(response.status).toBe(202);

      const records = await waitForRequest(stores, 1);
      expect(records.length).toBeGreaterThanOrEqual(1);
      const record = records[0]!;
      expect(record.source).toBe("scheduled");
      expect(record.userId).toBe("u_1");
      expect((record.metadata as Record<string, unknown>)?.origin).toBe("dynamic");
    } finally {
      await disposeFlowApiRouter(router);
    }
  });

  it("rejects dispatch without the bearer secret", async () => {
    const { router } = buildRouter();
    try {
      const request = new Request(
        "http://localhost/api/flows/billing/schedules/monthly-invoices/dispatch",
        { method: "POST" }
      );
      const response = await router.POST(request, {
        params: { path: ["billing", "schedules", "monthly-invoices", "dispatch"] }
      });
      // Missing header → defaultUserId fallback would apply; we set requireUser
      // and no defaultUserId, so the runtime rejects the request with 401.
      expect(response.status).toBe(401);
    } finally {
      await disposeFlowApiRouter(router);
    }
  });

  it("rejects dispatch with a wrong bearer secret (401)", async () => {
    const { router } = buildRouter();
    try {
      const request = new Request(
        "http://localhost/api/flows/billing/schedules/monthly-invoices/dispatch",
        { method: "POST", headers: { Authorization: "Bearer wrong-secret" } }
      );
      const response = await router.POST(request, {
        params: { path: ["billing", "schedules", "monthly-invoices", "dispatch"] }
      });
      expect(response.status).toBe(401);
    } finally {
      await disposeFlowApiRouter(router);
    }
  });

  it("GET /api/flows/:kind/schedules lists static + dynamic.provided", async () => {
    const { router } = buildRouter();
    try {
      const billing = await getList(router, "billing");
      expect(billing.status).toBe(200);
      const billingJson = (await billing.json()) as {
        static: Array<{ id: string }>;
        dynamic: { provided: boolean };
      };
      expect(billingJson.static.map((s) => s.id)).toEqual(["monthly-invoices"]);
      expect(billingJson.dynamic.provided).toBe(false);

      const reminders = await getList(router, "reminders");
      const remindersJson = (await reminders.json()) as {
        static: Array<unknown>;
        dynamic: { provided: boolean };
      };
      expect(remindersJson.static).toEqual([]);
      expect(remindersJson.dynamic.provided).toBe(true);
    } finally {
      await disposeFlowApiRouter(router);
    }
  });
});
