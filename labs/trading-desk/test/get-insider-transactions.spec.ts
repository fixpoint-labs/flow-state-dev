/**
 * Tests for the `get_insider_transactions` handler. Covers the three live-mode
 * branches (Finnhub success, Finnhub failure, missing key) plus the fixture
 * branch. Uses `testBlock` (per AGENTS.md rule 4 — never reach into
 * `block.config.execute`) so the `analysisCache` capability resolves
 * `ctx.cap.cache` the live branch reads.
 */
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { get_insider_transactions } from "../src/flows/analysis/tools/data/get_insider_transactions";
import { sessionStateSchema } from "../src/flows/analysis/state";

const FIXTURE_ROOT = path.resolve(__dirname, "..", "fixtures");

const fixtureFlow = defineFlow({
  kind: "trading-desk-test",
  actions: {
    run: { block: get_insider_transactions },
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
    },
  };
}

// `loadFixture` resolves against `process.cwd()`. Tests anchor cwd to the
// trading-desk package root so the loader finds the curated fixtures.
const originalCwd = process.cwd();
beforeEach(() => {
  process.chdir(path.resolve(__dirname, ".."));
});
afterEach(() => {
  process.chdir(originalCwd);
  vi.restoreAllMocks();
  delete process.env.FINNHUB_API_KEY;
});

describe("get_insider_transactions", () => {
  it("loads the curated fixture in fixture mode", async () => {
    const result = await testBlock(get_insider_transactions, {
      input: { ticker: "NVDA", date: "2026-05-06" },
      flow: fixtureFlow,
      session: sessionFor("fixture"),
    });
    expect(result.error).toBeNull();
    expect(result.output.source).toBe("fixture");
    expect(result.output.ticker).toBe("NVDA");
    expect(result.output.transactions.length).toBeGreaterThan(0);
    expect(result.output.windowDays).toBe(90);
    expect(FIXTURE_ROOT).toContain("trading-desk");
  });

  it("returns Finnhub data in live mode when the API answers", async () => {
    process.env.FINNHUB_API_KEY = "test-key";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              name: "Sample CEO",
              position: "CEO",
              filingDate: "2026-04-28",
              transactionDate: "2026-04-24",
              transactionCode: "S",
              change: -1000,
              transactionPrice: 100,
              isDerivative: false,
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const result = await testBlock(get_insider_transactions, {
      input: { ticker: "NVDA", date: "2026-05-06" },
      flow: fixtureFlow,
      session: sessionFor("live"),
    });
    expect(result.error).toBeNull();
    expect(result.output.source).toBe("finnhub");
    expect(result.output.transactions).toHaveLength(1);
  });

  it("returns unavailable when Finnhub fails in live mode", async () => {
    process.env.FINNHUB_API_KEY = "test-key";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("rate limited", { status: 429 }),
    );
    const result = await testBlock(get_insider_transactions, {
      input: { ticker: "NVDA", date: "2026-05-06" },
      flow: fixtureFlow,
      session: sessionFor("live"),
    });
    expect(result.error).toBeNull();
    expect(result.output.source).toBe("unavailable");
    expect(result.output.transactions).toEqual([]);
    expect(result.output.windowDays).toBe(90);
  });

  it("returns unavailable when FINNHUB_API_KEY is unset", async () => {
    const result = await testBlock(get_insider_transactions, {
      input: { ticker: "NVDA", date: "2026-05-06" },
      flow: fixtureFlow,
      session: sessionFor("live"),
    });
    expect(result.error).toBeNull();
    expect(result.output.source).toBe("unavailable");
    expect(result.output.transactions).toEqual([]);
  });
});
