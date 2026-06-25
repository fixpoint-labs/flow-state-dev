/**
 * End-to-end tests for the HTTP transport adapter via `createFlowApiRouter`.
 * These assert that the public router shape and behavior is unchanged for
 * existing users while also exercising the new `adapters` option.
 */
import { describe, it, expect } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  createFlowApiRouter,
  createFlowRegistry,
  createInMemoryStores,
  disposeFlowApiRouter,
  TransportRouteCollisionError,
  type InboundTransportAdapter
} from "../../src";

function makeFlow(kind: string, id = kind) {
  return defineFlow({
    kind,
    actions: {
      run: {
        inputSchema: z.object({ value: z.string() }),
        block: handler<{ value: string }, { ok: true }>({
          name: `${kind}-run`,
          execute: () => ({ ok: true })
        })
      }
    }
  })({ id });
}

describe("HTTP transport adapter (via createFlowApiRouter)", () => {
  it("stamps source='http' on RequestRecord written by the default adapter", async () => {
    const registry = createFlowRegistry();
    const stores = createInMemoryStores();
    registry.register(makeFlow("xfer"));

    const router = createFlowApiRouter({ registry, stores });
    const response = await router.POST(
      new Request("http://localhost/api/flows/xfer/sess_xfer/actions/run", {
        method: "POST",
        body: JSON.stringify({
          userId: "u_xfer",
          input: { value: "hi" }
        })
      }),
      { params: { path: ["xfer", "sess_xfer", "actions", "run"] } }
    );

    expect(response.status).toBe(202);
    const payload = (await response.json()) as { request: { id: string } };
    await new Promise((resolve) => setTimeout(resolve, 50));

    const record = await stores.request.get(payload.request.id);
    expect(record?.source).toBe("http");
  });

  it("supports custom adapters mounted alongside the default HTTP adapter", async () => {
    const registry = createFlowRegistry();
    const stores = createInMemoryStores();
    registry.register(makeFlow("custom"));

    const customAdapter: InboundTransportAdapter = {
      source: "test",
      createBindings: () => ({
        routes: [
          {
            method: "GET",
            path: "/api/flows/custom/echo",
            handler: async () => new Response("custom-ok", { status: 200 })
          }
        ]
      })
    };

    const router = createFlowApiRouter({
      registry,
      stores,
      adapters: [customAdapter]
    });

    const customResponse = await router.GET(
      new Request("http://localhost/api/flows/custom/echo"),
      { params: { path: ["custom", "echo"] } }
    );
    expect(customResponse.status).toBe(200);
    expect(await customResponse.text()).toBe("custom-ok");

    // Default routes still work
    const listResponse = await router.GET(
      new Request("http://localhost/api/flows"),
      { params: { path: [] } }
    );
    expect(listResponse.status).toBe(200);
  });

  it("throws TransportRouteCollisionError when two custom adapters declare the same route", () => {
    const registry = createFlowRegistry();
    const stores = createInMemoryStores();

    const a: InboundTransportAdapter = {
      source: "a",
      createBindings: () => ({
        routes: [
          {
            method: "POST",
            path: "/api/flows/x/y",
            handler: async () => new Response()
          }
        ]
      })
    };
    const b: InboundTransportAdapter = {
      source: "b",
      createBindings: () => ({
        routes: [
          {
            method: "POST",
            path: "/api/flows/x/y",
            handler: async () => new Response()
          }
        ]
      })
    };

    expect(() =>
      createFlowApiRouter({
        registry,
        stores,
        adapters: [a, b]
      })
    ).toThrow(TransportRouteCollisionError);
  });

  it("invokes adapter start and stop hooks when mounted and disposed", async () => {
    const registry = createFlowRegistry();
    const stores = createInMemoryStores();

    let started = 0;
    let stopped = 0;
    const adapter: InboundTransportAdapter = {
      source: "lifecycle",
      createBindings: () => ({
        routes: [],
        start: () => {
          started++;
        },
        stop: () => {
          stopped++;
        }
      })
    };

    const router = createFlowApiRouter({
      registry,
      stores,
      adapters: [adapter]
    });
    expect(started).toBe(1);

    await disposeFlowApiRouter(router);
    expect(stopped).toBe(1);
  });

  it("disposeFlowApiRouter is idempotent and a no-op for unknown routers", async () => {
    const registry = createFlowRegistry();
    const stores = createInMemoryStores();
    let stopped = 0;
    const adapter: InboundTransportAdapter = {
      source: "lifecycle-idempotent",
      createBindings: () => ({
        routes: [],
        stop: () => {
          stopped++;
        }
      })
    };
    const router = createFlowApiRouter({
      registry,
      stores,
      adapters: [adapter]
    });
    await disposeFlowApiRouter(router);
    await disposeFlowApiRouter(router);
    expect(stopped).toBe(1);
  });

  it("logs (not throws) when an async start hook rejects", async () => {
    const registry = createFlowRegistry();
    const stores = createInMemoryStores();
    const errors: unknown[] = [];
    const originalConsoleError = console.error;
    console.error = (...args: unknown[]) => errors.push(args);

    try {
      const adapter: InboundTransportAdapter = {
        source: "boom",
        createBindings: () => ({
          routes: [],
          start: async () => {
            throw new Error("startup blew up");
          }
        })
      };

      // Should not throw — async failures surface via console.error.
      const router = createFlowApiRouter({
        registry,
        stores,
        adapters: [adapter]
      });

      // Drain microtasks so the rejected promise's `.catch` runs.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(errors.length).toBeGreaterThan(0);
      await disposeFlowApiRouter(router);
    } finally {
      console.error = originalConsoleError;
    }
  });

  it("returns 400 when userId is missing — default body-userId resolver", async () => {
    const registry = createFlowRegistry();
    const stores = createInMemoryStores();
    registry.register(makeFlow("noauth"));

    const router = createFlowApiRouter({ registry, stores });
    const response = await router.POST(
      new Request("http://localhost/api/flows/noauth/actions/run", {
        method: "POST",
        body: JSON.stringify({ input: { value: "x" } })
      }),
      { params: { path: ["noauth", "actions", "run"] } }
    );
    expect(response.status).toBe(400);
  });

  it("returns 409 ConcurrencyRejected for a second request on a session held under reject (FIX-837)", async () => {
    const registry = createFlowRegistry();
    const stores = createInMemoryStores();

    // A `reject` action whose handler blocks, so the key stays held while the
    // second request arrives. The gate claims the key synchronously inside
    // `dispatch`, so the 409 lands without waiting for the handler to start.
    let release!: () => void;
    const blocked = new Promise<void>((r) => (release = r));
    registry.register(
      defineFlow({
        kind: "rej",
        actions: {
          run: {
            concurrency: "reject",
            inputSchema: z.object({ value: z.string() }),
            block: handler<{ value: string }, { ok: true }>({
              name: "rej-run",
              execute: async () => {
                await blocked;
                return { ok: true };
              }
            })
          }
        }
      })({ id: "rej" })
    );

    const router = createFlowApiRouter({ registry, stores });
    const post = () =>
      router.POST(
        new Request("http://localhost/api/flows/rej/sess_rej/actions/run", {
          method: "POST",
          body: JSON.stringify({ userId: "u_rej", input: { value: "hi" } })
        }),
        { params: { path: ["rej", "sess_rej", "actions", "run"] } }
      );

    const first = await post();
    expect(first.status).toBe(202);
    const firstPayload = (await first.json()) as { request: { id: string } };

    const second = await post();
    expect(second.status).toBe(409);
    const secondPayload = (await second.json()) as {
      error: string;
      requestId?: string;
    };
    expect(secondPayload.error).toBe("ConcurrencyRejected");
    // The 409 names the in-flight request the caller may tail.
    expect(secondPayload.requestId).toBe(firstPayload.request.id);

    // Release the first run; the key frees and a later request is admitted.
    release();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const third = await post();
    expect(third.status).toBe(202);
  });
});
