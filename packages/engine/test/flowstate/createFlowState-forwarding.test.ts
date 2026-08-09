/**
 * Verifies that power-user passthrough options on `createFlowState` reach
 * `createFlowApiRouter` unchanged. These options have no observable effect on
 * the returned handle, so the only honest assertion is on the options object
 * handed to the router factory.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import type { CreateFlowApiRouterOptions } from "../../src/routes/createFlowApiRouter";

const calls: CreateFlowApiRouterOptions[] = [];

vi.mock("../../src/routes/createFlowApiRouter", async (importActual) => {
  const actual =
    await importActual<typeof import("../../src/routes/createFlowApiRouter")>();
  return {
    ...actual,
    createFlowApiRouter: (options: CreateFlowApiRouterOptions) => {
      calls.push(options);
      return actual.createFlowApiRouter(options);
    }
  };
});

const { createFlowState, inMemoryStores } = await import("../../src");

const noopFlow = defineFlow({
  kind: "noop-flow",
  actions: {
    ping: {
      inputSchema: z.object({}).passthrough(),
      block: handler({
        name: "ping",
        inputSchema: z.object({}).passthrough(),
        execute: () => undefined
      })
    }
  }
})();

// A no-op model resolver bypasses the env-driven `createModelResolver` path,
// keeping these tests focused on option forwarding rather than model config.
const stubModelResolver = (() => undefined) as never;

afterEach(() => {
  calls.length = 0;
});

describe("createFlowState — router option forwarding", () => {
  it("forwards resolvePrincipal, staleSweepIntervalMs and staleSweepThresholdMs", async () => {
    const resolvePrincipal = vi.fn(async () => ({ userId: "system" }));
    const fs = createFlowState({
      flows: { noop: noopFlow },
      stores: { default: { primary: inMemoryStores() } },
      modelResolver: stubModelResolver,
      resolvePrincipal,
      staleSweepIntervalMs: 5_000,
      staleSweepThresholdMs: 90_000
    });
    await fs.ready();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.resolvePrincipal).toBe(resolvePrincipal);
    expect(calls[0]?.staleSweepIntervalMs).toBe(5_000);
    expect(calls[0]?.staleSweepThresholdMs).toBe(90_000);
    await fs.dispose();
  });

  it("forwards queuedGraceMs to the router AND resolves it onto the shared config", async () => {
    const fs = createFlowState({
      flows: { noop: noopFlow },
      stores: { default: { primary: inMemoryStores() } },
      modelResolver: stubModelResolver,
      queuedGraceMs: 30 * 60_000
    });
    await fs.ready();
    // The router builds its own sweeper from the flat option...
    expect(calls[0]?.queuedGraceMs).toBe(30 * 60_000);
    // ...and the shared config carries the resolved value to the worker and to
    // the sweep paths that read it there (startup detection, check-interrupted).
    expect(calls[0]?.runtimeConfig?.queuedGraceMs).toBe(30 * 60_000);
    // It is a sweep bound, not a liveness-gate fact: putting it on the seam
    // would give the read a second clock on a question the sweep owns.
    expect(
      (calls[0]?.runtimeConfig?.requestHost as Record<string, unknown> | undefined)
        ?.queuedGraceMs
    ).toBeUndefined();
    await fs.dispose();
  });

  it("defaults the shared config's grace to ten minutes when unset", async () => {
    const fs = createFlowState({
      flows: { noop: noopFlow },
      stores: { default: { primary: inMemoryStores() } },
      modelResolver: stubModelResolver
    });
    await fs.ready();
    expect(calls[0]?.queuedGraceMs).toBeUndefined();
    expect(calls[0]?.runtimeConfig?.queuedGraceMs).toBe(10 * 60_000);
    await fs.dispose();
  });

  it("forwards durabilityRetention into the runtimeConfig bundle", async () => {
    const retention = { sweepIntervalMs: 1234, batchLimit: 7 };
    const fs = createFlowState({
      flows: { noop: noopFlow },
      stores: { default: { primary: inMemoryStores() } },
      modelResolver: stubModelResolver,
      durabilityRetention: retention
    });
    await fs.ready();
    expect(calls[0]?.runtimeConfig?.durabilityRetention).toEqual(retention);
    await fs.dispose();
  });

  it("builds a durabilityProvider from resolved stores when durable: true", async () => {
    const fs = createFlowState({
      flows: { noop: noopFlow },
      stores: { default: { primary: inMemoryStores() } },
      modelResolver: stubModelResolver,
      durable: true
    });
    await fs.ready();
    expect(calls[0]?.runtimeConfig?.durabilityProvider).toBeDefined();
    expect(typeof calls[0]?.runtimeConfig?.durabilityProvider?.suspend).toBe(
      "function"
    );
    await fs.dispose();
  });

  it("leaves durabilityProvider undefined when durable is unset", async () => {
    const fs = createFlowState({
      flows: { noop: noopFlow },
      stores: { default: { primary: inMemoryStores() } },
      modelResolver: stubModelResolver
    });
    await fs.ready();
    expect(calls[0]?.runtimeConfig?.durabilityProvider).toBeUndefined();
    await fs.dispose();
  });

  it("omits the options when unset (router defaults apply)", async () => {
    const fs = createFlowState({
      flows: { noop: noopFlow },
      stores: { default: { primary: inMemoryStores() } },
      modelResolver: stubModelResolver
    });
    await fs.ready();
    expect(calls[0]?.resolvePrincipal).toBeUndefined();
    expect(calls[0]?.staleSweepIntervalMs).toBeUndefined();
    expect(calls[0]?.staleSweepThresholdMs).toBeUndefined();
    await fs.dispose();
  });
});
