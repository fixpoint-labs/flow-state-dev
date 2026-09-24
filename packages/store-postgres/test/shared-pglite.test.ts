/**
 * The contract every other test file relies on when it swaps `new PGlite()`
 * for `freshPglite()`: the instance is reused, but nothing a previous test
 * wrote is visible to the next one. The cases run in order, so the second
 * one reads what the first one left behind.
 */
import { describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshPglite } from "./shared-pglite";

let first: PGlite | undefined;

describe("freshPglite", () => {
  it("hands out a database a test can write to", async () => {
    first = await freshPglite();
    await first.exec("CREATE TABLE leftover (id TEXT PRIMARY KEY)");
    await first.query("INSERT INTO leftover (id) VALUES ('from the first test')");
  });

  it("reuses the same instance with none of the previous test's tables or rows", async () => {
    const next = await freshPglite();
    expect(next).toBe(first);

    const tables = await next.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
    );
    expect(tables.rows).toEqual([]);
  });
});
