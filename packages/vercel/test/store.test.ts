import { afterEach, describe, expect, it, vi } from "vitest";
import { vercelPostgresStores } from "../src/store";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("vercelPostgresStores", () => {
  it("declares the primary and bus capabilities; its schedule index is a property, not a slot", () => {
    const adapter = vercelPostgresStores();
    expect(adapter.capabilities).toEqual(["primary", "bus"]);
  });

  it("exposes a schedule index that no-ops before the pool is resolved", async () => {
    const adapter = vercelPostgresStores();
    // Calling index methods before resolve() must not throw or connect.
    await expect(adapter.scheduleIndex.upsert({} as never)).resolves.toBeUndefined();
    await expect(adapter.scheduleIndex.claimDue(Date.now())).resolves.toEqual([]);
    await expect(adapter.scheduleIndex.remove({ cell: "u1", key: "k1" })).resolves.toBeUndefined();
  });

  it("fails fast with a clear error when no connection string is available", async () => {
    vi.stubEnv("FSD_DB_URL", "");
    vi.stubEnv("DATABASE_URL", "");
    const adapter = vercelPostgresStores();
    await expect(adapter.resolve(["primary"])).rejects.toThrow(/connection string/i);
  });
});

// A deployment runs many instances on one database, and this adapter's pool
// has no listener (Neon's pooled endpoint can't hold one). Its bus must say it
// doesn't cross, so open session views keep their once-a-second read; a
// profile left to the in-memory bus would claim every change reaches it.
describe("vercelPostgresStores · the bus a deployment's profile gets", () => {
  it("backs the bus slot with a Postgres bus that never says it crosses", async () => {
    vi.resetModules();
    vi.doMock("pg", () => {
      class Pool {
        on() {
          return this;
        }
        async query() {
          return { rows: [], rowCount: 0 };
        }
        async connect() {
          return { query: async () => ({ rows: [], rowCount: 0 }), release() {} };
        }
        async end() {}
      }
      return { default: { Pool } };
    });
    const { vercelPostgresStores: fresh } = await import("../src/store");
    const { createFlowState } = await import("@flow-state-dev/engine");
    const state = createFlowState({
      flows: [],
      stores: { default: { primary: fresh({ connectionString: "postgres://deploy.example/app" }) } },
      durable: false,
      detectInterruptedOnStartup: false
    } as never);
    try {
      const { stores } = await state.getRuntime();
      expect(stores.bus).toBeDefined();
      expect(stores.bus?.crossesProcesses).toBe(false);
    } finally {
      await state.dispose();
      vi.doUnmock("pg");
    }
  });
});
