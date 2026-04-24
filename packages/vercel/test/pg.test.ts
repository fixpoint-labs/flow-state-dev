import { describe, expect, it } from "vitest";
import { vercelPgPoolOptions } from "../src/pg";

describe("vercelPgPoolOptions", () => {
  it("exposes Vercel-safe pg.Pool defaults", () => {
    expect(vercelPgPoolOptions).toEqual({
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 15_000,
      max: 1,
      allowExitOnIdle: true
    });
  });

  it("is spreadable for composition with caller overrides", () => {
    const merged = { ...vercelPgPoolOptions, statement_timeout: 30_000 };
    expect(merged.max).toBe(1);
    expect(merged.idleTimeoutMillis).toBe(10_000);
    expect(merged.statement_timeout).toBe(30_000);
  });
});
