import { afterEach, describe, expect, it, vi } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  createFlowState,
  inMemoryStores,
  FlowStateConfigError,
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

/** An in-memory adapter that counts dispose() calls. */
function spyAdapter(): StoreAdapter & { disposed: () => number } {
  let disposed = 0;
  const inner = inMemoryStores();
  return {
    capabilities: inner.capabilities,
    resolve: (slots) => inner.resolve(slots),
    dispose: () => {
      disposed += 1;
    },
    disposed: () => disposed
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createFlowState — construction validation", () => {
  it("throws synchronously when stores declares no profile", () => {
    expect(() =>
      createFlowState({ flows: flows(), stores: {} })
    ).toThrow(FlowStateConfigError);
  });

  it("throws synchronously when defaultProfile names an unknown profile", () => {
    expect(() =>
      createFlowState({
        flows: flows(),
        stores: { dev: { primary: inMemoryStores() } },
        defaultProfile: "prod"
      })
    ).toThrow(FlowStateConfigError);
  });

  it("exposes meta synchronously", () => {
    const fs = createFlowState({
      flows: flows(),
      stores: {
        prod: { primary: inMemoryStores() },
        dev: { primary: inMemoryStores() }
      }
    });
    expect(fs.meta.flowKeys).toEqual(["noop"]);
    expect(fs.meta.profileKeys).toEqual(["prod", "dev"]);
    expect(fs.meta.declaredSlots).toEqual({
      prod: ["primary"],
      dev: ["primary"]
    });
  });
});

describe("createFlowState — profile selection", () => {
  it("selects the profile named by FSD_ENV", async () => {
    vi.stubEnv("FSD_ENV", "prod");
    const fs = createFlowState({
      flows: flows(),
      stores: {
        dev: { primary: inMemoryStores() },
        prod: { primary: inMemoryStores() }
      }
    });
    await fs.ready();
    expect(fs.activeProfile).toBe("prod");
  });

  it("selects defaultProfile when FSD_ENV is unset", async () => {
    const fs = createFlowState({
      flows: flows(),
      stores: {
        dev: { primary: inMemoryStores() },
        prod: { primary: inMemoryStores() }
      },
      defaultProfile: "prod"
    });
    await fs.ready();
    expect(fs.activeProfile).toBe("prod");
  });

  it("falls back to the first declared profile", async () => {
    const fs = createFlowState({
      flows: flows(),
      stores: {
        dev: { primary: inMemoryStores() },
        prod: { primary: inMemoryStores() }
      }
    });
    await fs.ready();
    expect(fs.activeProfile).toBe("dev");
  });

  it("throws at ready() when FSD_ENV names an unknown profile", async () => {
    vi.stubEnv("FSD_ENV", "staging");
    const fs = createFlowState({
      flows: flows(),
      stores: { dev: { primary: inMemoryStores() } }
    });
    await expect(fs.ready()).rejects.toBeInstanceOf(FlowStateConfigError);
  });
});

describe("createFlowState — lifecycle", () => {
  it("memoizes the router across getRouter() calls", async () => {
    const fs = createFlowState({
      flows: flows(),
      stores: { default: { primary: inMemoryStores() } }
    });
    const a = fs.getRouter();
    const b = fs.getRouter();
    expect(a).toBe(b);
    const router = await a;
    expect(typeof router.GET).toBe("function");
  });

  it("disposes resolved adapters", async () => {
    const adapter = spyAdapter();
    const fs = createFlowState({
      flows: flows(),
      stores: { default: { primary: adapter } }
    });
    await fs.ready();
    await fs.dispose();
    expect(adapter.disposed()).toBe(1);
  });

  it("dispose() is idempotent", async () => {
    const adapter = spyAdapter();
    const fs = createFlowState({
      flows: flows(),
      stores: { default: { primary: adapter } }
    });
    await fs.ready();
    await fs.dispose();
    await fs.dispose();
    expect(adapter.disposed()).toBe(1);
  });

  it("throws FlowStateDisposedError when used after dispose()", async () => {
    const fs = createFlowState({
      flows: flows(),
      stores: { default: { primary: inMemoryStores() } }
    });
    await fs.ready();
    await fs.dispose();
    expect(() => fs.getRouter()).toThrow(FlowStateDisposedError);
  });
});
