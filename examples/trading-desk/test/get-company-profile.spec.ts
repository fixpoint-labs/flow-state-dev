/**
 * Tests for the `get_company_profile` handler. Covers the fixture branch,
 * the Finnhub → Yahoo → empty-payload live-mode chain, and the empty-payload
 * shape (no factual fields invented). Uses `testBlock` (per AGENTS.md rule 4
 * — never reach into `block.config.execute`).
 */
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { get_company_profile } from "../src/flows/trading-desk/phase-1/tools/get_company_profile";
import { _resetCache } from "../src/flows/trading-desk/services/cache";
import { emptyPayload } from "../src/flows/trading-desk/phase-1/tools/empty-payloads";
import { companyProfileSchema } from "../src/flows/trading-desk/phase-1/tools/schemas";
import { sessionStateSchema } from "../src/flows/trading-desk/state";

const fixtureFlow = defineFlow({
  kind: "trading-desk-test",
  actions: {
    run: { block: get_company_profile },
  },
  session: { stateSchema: sessionStateSchema },
})({ id: "test" });

function sessionFor(dataSource: "fixture" | "live") {
  return {
    state: {
      ticker: "NVDA",
      date: "2026-05-06",
      costPreset: "fast" as const,
      dataSource,
      activePhase: "idle" as const,
      memoStatus: {},
    },
  };
}

const originalCwd = process.cwd();
beforeEach(() => {
  process.chdir(path.resolve(__dirname, ".."));
  _resetCache();
});
afterEach(() => {
  process.chdir(originalCwd);
  vi.restoreAllMocks();
  delete process.env.FINNHUB_API_KEY;
});

describe("get_company_profile", () => {
  it("loads the curated fixture in fixture mode", async () => {
    const result = await testBlock(get_company_profile, {
      input: { ticker: "NVDA", date: "2026-05-06" },
      flow: fixtureFlow,
      session: sessionFor("fixture"),
    });
    expect(result.error).toBeNull();
    expect(result.output.source).toBe("fixture");
    expect(result.output.ticker).toBe("NVDA");
    expect(result.output.name).toBe("NVIDIA Corporation");
    expect(result.output.sector).toBe("Technology");
    expect(result.output.industry).toBe("Semiconductors");
    expect(result.output.businessDescription).toContain("NVIDIA Corporation");
    expect(result.output.marketCapUsd).toBeGreaterThan(0);
  });

  it("surfaces FixtureMissingError for an unknown ticker in fixture mode", async () => {
    const result = await testBlock(get_company_profile, {
      input: { ticker: "ZZZZ", date: "2026-05-06" },
      flow: fixtureFlow,
      session: sessionFor("fixture"),
    });
    // The framework wraps the FixtureMissingError in a FlowError; the message
    // preserves the original cause.
    expect(result.error).not.toBeNull();
    expect(result.error?.message).toContain("Missing fixture for get_company_profile");
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
    const result = await testBlock(get_company_profile, {
      input: { ticker: "NVDA", date: "2026-05-06" },
      flow: fixtureFlow,
      session: sessionFor("live"),
    });
    expect(result.error).toBeNull();
    expect(result.output.source).toBe("finnhub");
    expect(result.output.name).toBe("NVIDIA Corp");
    expect(result.output.industry).toBe("Semiconductors");
    // 3,200,000 USD millions → absolute USD.
    expect(result.output.marketCapUsd).toBe(3_200_000 * 1_000_000);
    expect(result.output.employees).toBe(29600);
    // Finnhub does not provide sector / longBusinessSummary.
    expect(result.output.sector).toBeNull();
    expect(result.output.businessDescription).toBeNull();
  });

  it("returns unavailable when Finnhub fails and Yahoo is unreachable", async () => {
    process.env.FINNHUB_API_KEY = "test-key";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("rate limited", { status: 429 }),
    );
    // Yahoo will also fail in this environment (no yahoo-finance2 mock).
    const result = await testBlock(get_company_profile, {
      input: { ticker: "NVDA", date: "2026-05-06" },
      flow: fixtureFlow,
      session: sessionFor("live"),
    });
    expect(result.error).toBeNull();
    expect(result.output.source).toBe("unavailable");
    expect(result.output.name).toBe("");
    expect(result.output.sector).toBeNull();
    expect(result.output.businessDescription).toBeNull();
    expect(result.output.marketCapUsd).toBeNull();
  });

  it("empty payload parses against the schema", () => {
    const payload = emptyPayload("get_company_profile", {
      ticker: "ZZZZ",
      date: "2026-05-06",
    });
    expect(() => companyProfileSchema.parse(payload)).not.toThrow();
  });
});
