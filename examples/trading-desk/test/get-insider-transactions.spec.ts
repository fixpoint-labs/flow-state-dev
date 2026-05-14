/**
 * Tests for the `get_insider_transactions` handler. Covers the three live-mode
 * branches (Finnhub success, Finnhub failure, missing key) plus the fixture
 * branch.
 */
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get_insider_transactions } from "../src/flows/trading-desk/phase-1/tools/get_insider_transactions";
import { _resetCache } from "../src/flows/trading-desk/services/cache";

const FIXTURE_ROOT = path.resolve(__dirname, "..", "fixtures");

// `loadFixture` resolves against `process.cwd()`. Tests anchor cwd to the
// trading-desk package root so the loader finds the curated fixtures.
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

// Minimal stand-in for BlockContext — the handler only reads
// `ctx.session.state.dataSource`. The full BlockContext shape isn't relevant
// to this unit's behavior.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ctx(dataSource: "fixture" | "live"): any {
  return { session: { state: { dataSource } } };
}

// `handler({...})` always produces a `config.execute`. The optional typing
// reflects that other block kinds (e.g. sequencer) can build without one.
const execute = get_insider_transactions.config.execute!;

describe("get_insider_transactions", () => {
  it("loads the curated fixture in fixture mode", async () => {
    const out = await execute(
      { ticker: "NVDA", date: "2026-05-06" },
      ctx("fixture"),
    );
    expect(out.source).toBe("fixture");
    expect(out.ticker).toBe("NVDA");
    expect(out.transactions.length).toBeGreaterThan(0);
    expect(out.windowDays).toBe(90);
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
    const out = await execute(
      { ticker: "NVDA", date: "2026-05-06" },
      ctx("live"),
    );
    expect(out.source).toBe("finnhub");
    expect(out.transactions).toHaveLength(1);
  });

  it("returns unavailable when Finnhub fails in live mode", async () => {
    process.env.FINNHUB_API_KEY = "test-key";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("rate limited", { status: 429 }),
    );
    const out = await execute(
      { ticker: "NVDA", date: "2026-05-06" },
      ctx("live"),
    );
    expect(out.source).toBe("unavailable");
    expect(out.transactions).toEqual([]);
    expect(out.windowDays).toBe(90);
  });

  it("returns unavailable when FINNHUB_API_KEY is unset", async () => {
    const out = await execute(
      { ticker: "NVDA", date: "2026-05-06" },
      ctx("live"),
    );
    expect(out.source).toBe("unavailable");
    expect(out.transactions).toEqual([]);
  });
});
