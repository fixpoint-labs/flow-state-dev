/**
 * Served-path setup failures must settle the request.
 *
 * The HTTP 202 path awaits acceptance (`onRegistered`), not `finished`.
 * `createExecutionContext` can still throw after that write — ambient
 * `FSDEV_DEFAULT_MODEL` with no declared intents, or a session/user
 * mismatch — and `finished` is then swallowed so it is not an unhandled
 * rejection. If the already-written `in_progress` row is not marked
 * terminal, a client polling `GET …/requests/:id/status` hangs forever
 * (FIX-1511).
 */
import { afterEach, describe, expect, it } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  createFlowApiRouter,
  createFlowRegistry,
  createInMemoryStores,
  disposeFlowApiRouter,
  type StoreRegistry
} from "../src";

const DEFAULT_MODEL_ENV = "FSDEV_DEFAULT_MODEL";

function pingFlow() {
  return defineFlow({
    kind: "ping",
    actions: {
      run: {
        inputSchema: z.object({}),
        block: handler({
          name: "ping-run",
          inputSchema: z.object({}),
          execute: () => ({ ok: true })
        })
      }
    }
  })();
}

async function postRun(
  router: ReturnType<typeof createFlowApiRouter>,
  sessionId: string,
  userId: string
) {
  return router.POST(
    new Request(`http://localhost/api/flows/ping/${sessionId}/actions/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, input: {} })
    }),
    { params: { path: ["ping", sessionId, "actions", "run"] } }
  );
}

async function getStatus(
  router: ReturnType<typeof createFlowApiRouter>,
  requestId: string
) {
  return router.GET(
    new Request(`http://localhost/api/flows/ping/requests/${requestId}/status`),
    { params: { path: ["ping", "requests", requestId, "status"] } }
  );
}

/**
 * Poll the status route the way a 202 client does. Returns the last
 * snapshot (or 404 body) after a terminal status or the wait budget.
 */
async function waitForServedStatus(
  router: ReturnType<typeof createFlowApiRouter>,
  requestId: string
): Promise<{ httpStatus: number; body: Record<string, unknown> }> {
  let last: { httpStatus: number; body: Record<string, unknown> } | undefined;
  for (let i = 0; i < 50; i += 1) {
    const response = await getStatus(router, requestId);
    const body = (await response.json()) as Record<string, unknown>;
    last = { httpStatus: response.status, body };
    if (response.status === 200 && body.status !== "in_progress") {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return last ?? { httpStatus: 0, body: {} };
}

async function settleStore(stores: StoreRegistry, requestId: string) {
  for (let i = 0; i < 50; i += 1) {
    const record = await stores.request.get(requestId);
    if (record !== undefined && record.status !== "in_progress") return record;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return stores.request.get(requestId);
}

describe("served setup failure (FIX-1511)", () => {
  const previousDefaultModel = process.env[DEFAULT_MODEL_ENV];

  afterEach(() => {
    if (previousDefaultModel === undefined) delete process.env[DEFAULT_MODEL_ENV];
    else process.env[DEFAULT_MODEL_ENV] = previousDefaultModel;
  });

  it("settles a request when createModelResolver throws on ambient FSDEV_DEFAULT_MODEL", async () => {
    process.env[DEFAULT_MODEL_ENV] = "openai/gpt-5-mini";

    const registry = createFlowRegistry();
    const stores = createInMemoryStores();
    registry.register(pingFlow());
    const router = createFlowApiRouter({ registry, stores });

    const posted = await postRun(router, "sess_env", "user-a");
    expect(posted.status).toBe(202);
    const { request } = (await posted.json()) as { request: { id: string } };

    const snapshot = await waitForServedStatus(router, request.id);
    const record = await settleStore(stores, request.id);

    await disposeFlowApiRouter(router);

    expect(snapshot.httpStatus).toBe(200);
    expect(snapshot.body.status).toBe("failed");
    expect(record?.status).toBe("failed");
    expect(record?.items?.some((item) =>
      item.type === "error" &&
      typeof item.message === "string" &&
      item.message.includes("FSDEV_DEFAULT_MODEL was set, but no intents are declared")
    )).toBe(true);
  });

  it("settles a request when the session user does not match the caller", async () => {
    delete process.env[DEFAULT_MODEL_ENV];

    const registry = createFlowRegistry();
    const stores = createInMemoryStores();
    registry.register(pingFlow());
    const router = createFlowApiRouter({ registry, stores });

    const owner = await postRun(router, "sess_owner", "user-a");
    expect(owner.status).toBe(202);
    const ownerBody = (await owner.json()) as { request: { id: string } };
    const ownerRecord = await settleStore(stores, ownerBody.request.id);
    expect(ownerRecord?.status).toBe("completed");

    const interloper = await postRun(router, "sess_owner", "user-b");
    expect(interloper.status).toBe(202);
    const { request } = (await interloper.json()) as { request: { id: string } };

    const snapshot = await waitForServedStatus(router, request.id);
    const record = await settleStore(stores, request.id);

    await disposeFlowApiRouter(router);

    expect(snapshot.httpStatus).toBe(200);
    expect(snapshot.body.status).toBe("failed");
    expect(record?.status).toBe("failed");
    expect(record?.items?.some((item) =>
      item.type === "error" &&
      typeof item.message === "string" &&
      item.message.includes("owned by user user-a")
    )).toBe(true);
  });

  it("still completes a healthy served request", async () => {
    delete process.env[DEFAULT_MODEL_ENV];

    const registry = createFlowRegistry();
    const stores = createInMemoryStores();
    registry.register(pingFlow());
    const router = createFlowApiRouter({ registry, stores });

    const posted = await postRun(router, "sess_ok", "user-a");
    expect(posted.status).toBe(202);
    const { request } = (await posted.json()) as { request: { id: string } };

    const snapshot = await waitForServedStatus(router, request.id);
    await disposeFlowApiRouter(router);

    expect(snapshot.httpStatus).toBe(200);
    expect(snapshot.body.status).toBe("completed");
  });
});
