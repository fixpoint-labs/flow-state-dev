/**
 * Tests for the `get_company_profile` handler. Covers the fixture branch,
 * the Finnhub → Yahoo → empty-payload live-mode chain, and the empty-payload
 * shape (no factual fields invented).
 */
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get_company_profile } from "../src/flows/trading-desk/phase-1/tools/get_company_profile";
import { _resetCache } from "../src/flows/trading-desk/services/cache";
import { emptyPayload } from "../src/flows/trading-desk/phase-1/tools/empty-payloads";
import { companyProfileSchema, FixtureMissingError } from "../src/flows/trading-desk/phase-1/tools/schemas";

const originalCwd = process.cwd();
beforeEach(() => {
  process.chdir(path.resolve(__dirname, ".."));
  _resetCache();
  vi.resetModules();
});
afterEach(() => {
  process.chdir(originalCwd);
  vi.restoreAllMocks();
  delete process.env.FINNHUB_API_KEY;
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ctx(dataSource: "fixture" | "live"): any {
  return { session: { state: { dataSource } } };
}

const execute = get_company_profile.config.execute!;

describe("get_company_profile", () => {
  it("loads the curated fixture in fixture mode", async () => {
    const out = await execute(
      { ticker: "NVDA", date: "2026-05-06" },
      ctx("fixture"),
    );
    expect(out.source).toBe("fixture");
    expect(out.ticker).toBe("NVDA");
    expect(out.name).toBe("NVIDIA Corporation");
    expect(out.sector).toBe("Technology");
    expect(out.industry).toBe("Semiconductors");
    expect(out.businessDescription).toContain("NVIDIA Corporation");
    expect(out.marketCapUsd).toBeGreaterThan(0);
  });

  it("throws FixtureMissingError for an unknown ticker in fixture mode", async () => {
    await expect(
      execute({ ticker: "ZZZZ", date: "2026-05-06" }, ctx("fixture")),
    ).rejects.toBeInstanceOf(FixtureMissingError);
  });

  it("returns Finnhub data in live mode when the API answers", async () => {
    process.env.FINNHUB_API_KEY = "test-key";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          name: "NVIDIA Corp",
          country: "US",
          currency: "USD",
          exchange: "NASDAQ NMS - GLOBAL MARKET",
          finnhubIndustry: "Semiconductors",
          ipo: "1999-01-22",
          marketCapitalization: 3200000,
          employeeTotal: 29600,
          weburl: "https://www.nvidia.com",
        }),
        { status: 200 },
      ),
    );
    const out = await execute(
      { ticker: "NVDA", date: "2026-05-06" },
      ctx("live"),
    );
    expect(out.source).toBe("finnhub");
    expect(out.name).toBe("NVIDIA Corp");
    expect(out.industry).toBe("Semiconductors");
    // 3,200,000 USD millions = $3.2T
    expect(out.marketCapUsd).toBe(3_200_000 * 1_000_000);
    expect(out.employees).toBe(29600);
    // Finnhub does not provide sector / longBusinessSummary.
    expect(out.sector).toBeNull();
    expect(out.businessDescription).toBeNull();
  });

  it("returns unavailable when Finnhub fails and Yahoo is unreachable", async () => {
    process.env.FINNHUB_API_KEY = "test-key";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("rate limited", { status: 429 }),
    );
    // Yahoo will also fail in this environment (no yahoo-finance2 mock).
    const out = await execute(
      { ticker: "NVDA", date: "2026-05-06" },
      ctx("live"),
    );
    expect(out.source).toBe("unavailable");
    expect(out.name).toBe("");
    expect(out.sector).toBeNull();
    expect(out.businessDescription).toBeNull();
    expect(out.marketCapUsd).toBeNull();
  });

  it("empty payload parses against the schema", () => {
    const payload = emptyPayload("get_company_profile", {
      ticker: "ZZZZ",
      date: "2026-05-06",
    });
    expect(() => companyProfileSchema.parse(payload)).not.toThrow();
  });
});
