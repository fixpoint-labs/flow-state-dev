import { afterEach, describe, expect, it, vi } from "vitest";
import { vercelPostgresStores } from "../src/store";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("vercelPostgresStores", () => {
  it("declares the primary and scheduler capabilities", () => {
    const adapter = vercelPostgresStores();
    expect(adapter.capabilities).toEqual(["primary", "scheduler"]);
  });

  it("exposes a schedule index that no-ops before the pool is resolved", async () => {
    const adapter = vercelPostgresStores();
    // Calling index methods before resolve() must not throw or connect.
    await expect(adapter.scheduleIndex.upsert({} as never)).resolves.toBeUndefined();
    await expect(adapter.scheduleIndex.claimDue(Date.now())).resolves.toEqual([]);
    await expect(adapter.scheduleIndex.remove("u1", "k1")).resolves.toBeUndefined();
  });

  it("fails fast with a clear error when no connection string is available", async () => {
    vi.stubEnv("FSD_DB_URL", "");
    vi.stubEnv("DATABASE_URL", "");
    const adapter = vercelPostgresStores();
    await expect(adapter.resolve(["primary"])).rejects.toThrow(/connection string/i);
  });
});
