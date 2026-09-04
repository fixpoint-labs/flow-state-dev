import { afterEach, describe, expect, it, vi } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  createFlowState,
  inMemoryStores,
  FlowStateDisposedError,
  type StoreAdapter
} from "../../src";

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

function flows() {
  return { noop: noopFlow };
}

/** An in-memory adapter that counts resolve() (store-init) calls. */
function resolveSpyAdapter(): StoreAdapter & { resolves: () => number } {
  let resolves = 0;
  const inner = inMemoryStores();
  return {
    capabilities: inner.capabilities,
    resolve: (slots) => {
      resolves += 1;
      return inner.resolve(slots);
    },
    resolves: () => resolves
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("FlowState.getRuntime()", () => {
  it("returns the registry, stores, and runtimeConfig", async () => {
    const fs = createFlowState({
      flows: flows(),
      stores: { default: { primary: inMemoryStores() } }
    });

    const runtime = await fs.getRuntime();

    // registry carries the registered flow (the worker dispatches against it)
    expect(runtime.registry.get("noop-flow")?.kind).toBe("noop-flow");
    // stores are the resolved StoreRegistry the runtime persists to
    expect(runtime.stores.request).toBeDefined();
    expect(runtime.stores.traces).toBeDefined();
    // runtimeConfig is the forwarded instance bundle
    expect(runtime.runtimeConfig).toBeDefined();
  });

  it("memoizes — repeat calls return the same instance", async () => {
    const fs = createFlowState({
      flows: flows(),
      stores: { default: { primary: inMemoryStores() } }
    });

    const a = fs.getRuntime();
    const b = fs.getRuntime();
    expect(a).toBe(b);
    expect(await a).toBe(await b);
  });

  it("triggers store init once, shared with getRouter()", async () => {
    const adapter = resolveSpyAdapter();
    const fs = createFlowState({
      flows: flows(),
      stores: { default: { primary: adapter } }
    });

    await fs.getRuntime();
    await fs.getRouter();

    // Both surfaces resolve from the same memoized store init.
    expect(adapter.resolves()).toBe(1);
  });

  it("throws FlowStateDisposedError when called after dispose()", async () => {
    const fs = createFlowState({
      flows: flows(),
      stores: { default: { primary: inMemoryStores() } }
    });
    await fs.ready();
    await fs.dispose();
    expect(() => fs.getRuntime()).toThrow(FlowStateDisposedError);
  });

  it("narrates the active profile through a host logger installed before getRuntime()", async () => {
    const info = vi.fn();
    const errors: unknown[][] = [];
    const restore = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    try {
      const fs = createFlowState({
        flows: flows(),
        stores: { default: { primary: inMemoryStores() } }
      });
      fs.setLogger({ info });
      const runtime = await fs.getRuntime();
      expect(info).toHaveBeenCalledWith(
        `[flowstate] active profile: "default"`,
        expect.objectContaining({ profile: "default" })
      );
      expect(
        errors.some((args) => String(args[0] ?? "").includes("active profile"))
      ).toBe(false);
      expect(runtime.runtimeConfig.logger).toEqual({ info });
    } finally {
      console.error = restore;
    }
  });

  it("replaces the host logger on the shared runtimeConfig after resolve", async () => {
    const first = { info: vi.fn() };
    const second = { warn: vi.fn() };
    const fs = createFlowState({
      flows: flows(),
      stores: { default: { primary: inMemoryStores() } }
    });
    fs.setLogger(first);
    const runtime = await fs.getRuntime();
    fs.setLogger(second);
    expect(runtime.runtimeConfig.logger).toBe(second);
  });

  it("prints the active profile on stderr when no host logger is installed", async () => {
    const errors: unknown[][] = [];
    const restore = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    try {
      const fs = createFlowState({
        flows: flows(),
        stores: { default: { primary: inMemoryStores() } }
      });
      await fs.getRuntime();
      expect(
        errors.some(
          (args) => String(args[0] ?? "") === `[flowstate] active profile: "default"`
        )
      ).toBe(true);
    } finally {
      console.error = restore;
    }
  });
});
