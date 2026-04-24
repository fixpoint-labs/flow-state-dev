/**
 * Tests for the `poolOptions` / `createPool` passthrough and the default
 * pool error listener. Uses a fake `createPool` to inspect the config pg.Pool
 * would be constructed with, without needing a real Postgres endpoint.
 */

import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import type { Pool, PoolConfig } from "pg";
import { createPostgresStores } from "../src";

/** Minimal pg.Pool stand-in: records the config, stubs the two methods the adapter uses. */
function fakePool(overrides?: Partial<Pool>) {
  const emitter = new EventEmitter();
  // Schema init acquires a dedicated client, takes an advisory lock via
  // pg_try_advisory_lock, runs CREATE TABLE / CREATE INDEX, then releases.
  // The fake resolves lock queries as { locked: true } so init completes
  // without needing a real Postgres. Other queries resolve empty.
  const clientQuery = async (text: string) => {
    if (text.includes("pg_try_advisory_lock")) {
      return { rows: [{ locked: true }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  };
  const connect = async () => ({
    query: clientQuery,
    release: () => {}
  });
  const pool = {
    query: async () => ({ rows: [], rowCount: 0 }),
    end: async () => {},
    connect,
    on: emitter.on.bind(emitter),
    once: emitter.once.bind(emitter),
    off: emitter.off.bind(emitter),
    emit: emitter.emit.bind(emitter),
    listenerCount: emitter.listenerCount.bind(emitter),
    ...overrides
  } as unknown as Pool;
  return { pool, emitter };
}

describe("createPostgresStores — pool options passthrough", () => {
  it("forwards poolOptions into the Pool constructor", async () => {
    let seen: PoolConfig | undefined;
    const { pool } = fakePool();
    const stores = await createPostgresStores({
      connectionString: "postgres://u:p@localhost/db",
      poolOptions: {
        max: 1,
        idleTimeoutMillis: 10_000,
        connectionTimeoutMillis: 15_000,
        allowExitOnIdle: true
      },
      createPool: (cfg) => {
        seen = cfg;
        return pool;
      }
    });
    await stores.close();

    expect(seen).toBeDefined();
    expect(seen!.max).toBe(1);
    expect(seen!.idleTimeoutMillis).toBe(10_000);
    expect(seen!.connectionTimeoutMillis).toBe(15_000);
    expect(seen!.allowExitOnIdle).toBe(true);
    expect(seen!.connectionString).toBe("postgres://u:p@localhost/db");
  });

  it("poolOptions wins over the named convenience fields on overlap", async () => {
    let seen: PoolConfig | undefined;
    const { pool } = fakePool();
    const stores = await createPostgresStores({
      connectionString: "postgres://u:p@localhost/db",
      max: 20,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 60_000,
      poolOptions: {
        max: 1,
        connectionTimeoutMillis: 15_000,
        idleTimeoutMillis: 10_000
      },
      createPool: (cfg) => {
        seen = cfg;
        return pool;
      }
    });
    await stores.close();

    expect(seen!.max).toBe(1);
    expect(seen!.connectionTimeoutMillis).toBe(15_000);
    expect(seen!.idleTimeoutMillis).toBe(10_000);
  });

  it("current behavior is preserved when poolOptions is omitted", async () => {
    let seen: PoolConfig | undefined;
    const { pool } = fakePool();
    const stores = await createPostgresStores({
      connectionString: "postgres://u:p@localhost/db",
      createPool: (cfg) => {
        seen = cfg;
        return pool;
      }
    });
    await stores.close();

    expect(seen!.max).toBe(10);
    expect(seen!.connectionTimeoutMillis).toBe(10_000);
    expect(seen!.idleTimeoutMillis).toBe(30_000);
    expect(seen!.allowExitOnIdle).toBe(true);
  });

  it("uses createPool to construct the Pool", async () => {
    let created = 0;
    const { pool } = fakePool();
    const stores = await createPostgresStores({
      connectionString: "postgres://u:p@localhost/db",
      createPool: () => {
        created++;
        return pool;
      }
    });
    await stores.close();

    expect(created).toBe(1);
  });

  it("attaches a default error listener so dead-socket events don't crash the process", async () => {
    const { pool, emitter } = fakePool();
    const stores = await createPostgresStores({
      connectionString: "postgres://u:p@localhost/db",
      createPool: () => pool
    });

    expect(emitter.listenerCount("error")).toBeGreaterThanOrEqual(1);

    // Emitting 'error' with no listener would crash the process; with the
    // default listener attached it must not throw.
    expect(() => emitter.emit("error", new Error("dead socket"))).not.toThrow();

    await stores.close();
  });

  it("throws when no connection info is available", async () => {
    const prev = { fsd: process.env.FSD_DB_URL, db: process.env.DATABASE_URL };
    delete process.env.FSD_DB_URL;
    delete process.env.DATABASE_URL;
    try {
      await expect(
        createPostgresStores({
          createPool: () => fakePool().pool
        })
      ).rejects.toThrow(/no connection string/i);
    } finally {
      if (prev.fsd !== undefined) process.env.FSD_DB_URL = prev.fsd;
      if (prev.db !== undefined) process.env.DATABASE_URL = prev.db;
    }
  });

  it("accepts host-based poolOptions without a connectionString", async () => {
    let seen: PoolConfig | undefined;
    const { pool } = fakePool();
    const stores = await createPostgresStores({
      poolOptions: { host: "localhost", database: "db", user: "u", password: "p" },
      createPool: (cfg) => {
        seen = cfg;
        return pool;
      }
    });
    await stores.close();

    expect(seen!.host).toBe("localhost");
    expect(seen!.connectionString).toBeUndefined();
  });
});
