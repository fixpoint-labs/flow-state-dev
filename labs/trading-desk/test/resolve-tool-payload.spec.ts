/**
 * Unit tests for `resolveToolPayload` — the single dispatch point for the
 * three dataSource modes. Covers:
 *   - fixture mode loads from the corpus and never invokes the fetcher
 *   - live mode fetches and records nothing
 *   - record mode fetches AND persists the payload via `recordFixture`
 *   - record mode on a warm cache hit still records (idempotent rewrite)
 *
 * `loadFixture` / `recordFixture` are mocked (their filesystem behavior is
 * covered by fixtures.spec.ts / recorder.spec.ts); the shared TTL cache is
 * real so the cache-hit path is exercised for real. Each test uses distinct
 * args so the module-level cache never crosses test cases.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveToolPayload } from "../src/flows/analysis/tools/runtime/resolve";
import { loadFixture } from "../src/flows/analysis/tools/runtime/fixtures";
import { recordFixture } from "../src/flows/analysis/tools/runtime/recorder";
import { _resetCache } from "../src/lib/cache";
import type { ToolOutput } from "../src/flows/analysis/tools/schemas";

vi.mock("../src/flows/analysis/tools/runtime/fixtures", () => ({
  loadFixture: vi.fn(),
}));
vi.mock("../src/flows/analysis/tools/runtime/recorder", () => ({
  recordFixture: vi.fn(async () => undefined),
}));

type BalanceSheet = ToolOutput<"get_balance_sheet">;

const liveBalanceSheet = (ticker: string): BalanceSheet => ({
  source: "edgar",
  ticker,
  asOf: "2026-06-01",
  totalAssets: 100,
  totalLiabilities: 40,
  totalEquity: 60,
  cashAndEquivalents: 20,
  totalDebt: 10,
  unit: "USD billions",
});

const ctxFor = (dataSource: "fixture" | "live" | "record") => ({
  session: { state: { dataSource } },
});

describe("resolveToolPayload", () => {
  beforeEach(() => {
    _resetCache();
    vi.clearAllMocks();
  });

  it("fixture mode loads from the corpus and never invokes the fetcher", async () => {
    const fixturePayload = { ...liveBalanceSheet("FIXA"), source: "fixture" as const };
    vi.mocked(loadFixture).mockResolvedValue(fixturePayload);
    const fetcher = vi.fn(async () => liveBalanceSheet("FIXA"));
    const args = { ticker: "FIXA", date: "2026-06-01" };

    const out = await resolveToolPayload("get_balance_sheet", args, ctxFor("fixture"), fetcher);

    expect(out).toBe(fixturePayload);
    expect(loadFixture).toHaveBeenCalledWith("get_balance_sheet", args);
    expect(fetcher).not.toHaveBeenCalled();
    expect(recordFixture).not.toHaveBeenCalled();
  });

  it("live mode fetches and writes nothing", async () => {
    const payload = liveBalanceSheet("LIVA");
    const fetcher = vi.fn(async () => payload);

    const out = await resolveToolPayload(
      "get_balance_sheet",
      { ticker: "LIVA", date: "2026-06-01" },
      ctxFor("live"),
      fetcher,
    );

    expect(out).toBe(payload);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(loadFixture).not.toHaveBeenCalled();
    expect(recordFixture).not.toHaveBeenCalled();
  });

  it("record mode fetches AND persists the payload", async () => {
    const payload = liveBalanceSheet("RECA");
    const fetcher = vi.fn(async () => payload);
    const args = { ticker: "RECA", date: "2026-06-01" };

    const out = await resolveToolPayload("get_balance_sheet", args, ctxFor("record"), fetcher);

    expect(out).toBe(payload);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(recordFixture).toHaveBeenCalledTimes(1);
    expect(recordFixture).toHaveBeenCalledWith("get_balance_sheet", args, payload);
    expect(loadFixture).not.toHaveBeenCalled();
  });

  it("record mode on a warm cache hit still records", async () => {
    const payload = liveBalanceSheet("RECB");
    const fetcher = vi.fn(async () => payload);
    const args = { ticker: "RECB", date: "2026-06-01" };

    await resolveToolPayload("get_balance_sheet", args, ctxFor("record"), fetcher);
    const second = await resolveToolPayload("get_balance_sheet", args, ctxFor("record"), fetcher);

    // One upstream fetch (the second call hits the shared cache), two writes.
    expect(second).toBe(payload);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(recordFixture).toHaveBeenCalledTimes(2);
    expect(recordFixture).toHaveBeenLastCalledWith("get_balance_sheet", args, payload);
  });
});
