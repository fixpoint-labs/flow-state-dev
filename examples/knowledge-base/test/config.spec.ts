// ---------------------------------------------------------------------------
// fsdev.config.ts profile selection + fail-closed auth guard.
//
// Each case sets env vars, resets the module registry, and dynamically
// imports the config fresh — `import()` triggers module evaluation exactly
// once per module identity, and the guard runs at that evaluation time.
// `createFlowState` itself is lazy (stores/adapters resolve on first
// `ready()`/`getRouter()`), so importing never opens a real DB connection —
// safe to run without a live Postgres instance.
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it, vi } from "vitest";

const ENV_KEYS = ["FSD_DB_URL", "DATABASE_URL", "KB_MCP_SECRET"] as const;
const original = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

function setEnv(overrides: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>): void {
  for (const key of ENV_KEYS) {
    const value = overrides[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function loadConfig() {
  vi.resetModules();
  return import("../fsdev.config");
}

describe("fsdev.config profile selection + fail-closed guard", () => {
  afterEach(() => {
    setEnv(original);
    vi.resetModules();
  });

  it("dev profile (no Postgres URL, no secret) loads without throwing", async () => {
    setEnv({ FSD_DB_URL: undefined, DATABASE_URL: undefined, KB_MCP_SECRET: undefined });
    await expect(loadConfig()).resolves.toBeDefined();
  });

  it("prod profile (DATABASE_URL set) with no secret throws at config load", async () => {
    setEnv({ FSD_DB_URL: undefined, DATABASE_URL: "postgres://example/db", KB_MCP_SECRET: undefined });
    await expect(loadConfig()).rejects.toThrow(/KB_MCP_SECRET must be set/);
  });

  it("prod profile (FSD_DB_URL set) with no secret throws at config load", async () => {
    setEnv({ FSD_DB_URL: "postgres://example/db", DATABASE_URL: undefined, KB_MCP_SECRET: undefined });
    await expect(loadConfig()).rejects.toThrow(/KB_MCP_SECRET must be set/);
  });

  it("prod profile with the secret set loads without throwing", async () => {
    setEnv({ FSD_DB_URL: undefined, DATABASE_URL: "postgres://example/db", KB_MCP_SECRET: "test-secret" });
    await expect(loadConfig()).resolves.toBeDefined();
  });
});
