/**
 * Postgres-specific index behaviour the shared conformance suite cannot
 * reach: that a row and its index entries commit in one statement, and that a
 * build marker's key regex answers as core's `matchesPattern` does when
 * Postgres's own regex engine runs it.
 */
import { describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { matchesPattern } from "@flow-state-dev/core/types";
import { freshPglite } from "./shared-pglite";
import { createPostgresResourceStateStore, initializeSchema, type QueryExecutor } from "../src";
import { collectionKeyRegex } from "../src/collection-key-regex";

function pgliteExecutor(pglite: PGlite): QueryExecutor {
  return {
    async query(text: string, values?: unknown[]) {
      const result = await pglite.query(text, values);
      return { rows: result.rows as Record<string, unknown>[], rowCount: result.affectedRows ?? 0 };
    }
  };
}

async function freshExecutor(): Promise<QueryExecutor> {
  const executor = pgliteExecutor(await freshPglite());
  await initializeSchema(executor);
  return executor;
}

const entries = { indexEntries: [{ collection: "work/**", index: "byId@1", values: ["a"] }] };

describe("Postgres resource state: a row and its index entries commit together", () => {
  it("leaves no row behind when its entries cannot be written", async () => {
    const executor = await freshExecutor();
    const store = createPostgresResourceStateStore(executor);
    await executor.query("DROP TABLE resource_index");
    for (const expected of [0, "absent", "any"] as const) {
      await expect(store.set("session", "s1", `work/${expected}`, { n: 1 }, expected, entries)).rejects.toThrow();
    }
    expect(await store.getAll("session", "s1")).toEqual({});
  });

  it("leaves the row unchanged when an update's entries cannot be written", async () => {
    const executor = await freshExecutor();
    const store = createPostgresResourceStateStore(executor);
    await store.set("session", "s1", "work/k", { n: 1 }, 0, entries);
    await executor.query("DROP TABLE resource_index");
    await expect(store.set("session", "s1", "work/k", { n: 2 }, 1, entries)).rejects.toThrow();
    await expect(store.delete("session", "s1", "work/k", 1)).rejects.toThrow();
    expect(await store.get("session", "s1", "work/k")).toEqual({ state: { n: 1 }, version: 1 });
  });
});

describe("collectionKeyRegex under Postgres's regex engine", () => {
  const patterns = [
    "work/**",
    "files/*",
    "a.b/*",
    "50%_off/**",
    "data/[topic]/notes",
    "data/[topic]/observations",
    "tasks/[ledger]/[partition]/*",
    "(x)+/**",
    "plain"
  ];
  const keys = [
    "work/a",
    "work/a/b/c",
    "work",
    "work/",
    "workx/a",
    "files/a",
    "files/a/b",
    "files/",
    "a.b/c",
    "aXb/c",
    "50%_off/x",
    "50%_offx",
    "data/x/notes",
    "data/x/y/notes",
    "data/x/observations",
    "data//notes",
    "tasks/[ledger]/[partition]/k",
    "tasks/l/p/k",
    "(x)+/k",
    "xx/k",
    "work/line\nbreak",
    "files/line\nbreak",
    "plain"
  ];

  it("matches exactly the keys matchesPattern matches", async () => {
    const executor = await freshExecutor();
    const mismatches: string[] = [];
    for (const pattern of patterns) {
      const regex = collectionKeyRegex(pattern);
      for (const key of keys) {
        const expected = matchesPattern(pattern, key);
        const result = await executor.query("SELECT ($1::text ~ $2::text) IS TRUE AS hit", [key, regex]);
        const actual = result.rows[0]!.hit === true;
        if (actual !== expected) mismatches.push(`${pattern} ~ ${JSON.stringify(key)}: ${actual}, want ${expected}`);
      }
    }
    expect(mismatches).toEqual([]);
    // The corpus reaches both answers for every kind of pattern.
    expect(keys.filter((key) => matchesPattern("data/[topic]/notes", key))).toEqual(["data/x/notes"]);
  });
});
