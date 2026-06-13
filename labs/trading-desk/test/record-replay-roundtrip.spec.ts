/**
 * Record → replay round-trip integration test (the FIX-787 acceptance
 * criterion as a test): payloads recorded into a fixture corpus replay
 * deep-equal modulo the source-translation rule — a real provider tag
 * (`"yahoo"`, `"fred"`, ...) replays as `"fixture"`, while a recorded
 * `"unavailable"` is preserved so a provider miss stays a miss.
 *
 * Composes `recordFixture` + `loadFixture` directly against a tmp
 * `rootDir`: `resolveToolPayload`'s record path deliberately writes to the
 * real corpus (it threads no rootDir option), and its mode dispatch is
 * covered by resolve-tool-payload.spec.ts with mocks. The direct
 * composition here is the exact write→read pair a record run followed by a
 * fixture run performs, without touching the real fixtures/ directory.
 * Neither function goes through the shared tool cache, so no cross-test
 * cache interference is possible.
 *
 * Also asserts the pre-flight guard path: `resolveTicker` in fixture mode
 * admits a ticker/date present in the corpus and rejects an absent one.
 * The resolver probes the real `FIXTURE_ROOT` (it has no rootDir seam), so
 * that assertion runs read-only against the checked-in corpus.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import path from "node:path";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { recordFixture } from "../src/flows/analysis/tools/runtime/recorder";
import { loadFixture } from "../src/flows/analysis/tools/runtime/fixtures";
import { emptyPayload } from "../src/flows/analysis/tools/empty-payloads";
import { resolveTicker } from "../src/flows/analysis/lib/ticker-resolver";
import type { ToolOutput } from "../src/flows/analysis/tools/schemas";

const DATE = "2026-06-12";

describe("record → replay round-trip", () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = mkdtempSync(path.join(tmpdir(), "td-roundtrip-"));
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('a recorded provider payload replays deep-equal with source translated to "fixture"', async () => {
    const recorded: ToolOutput<"get_balance_sheet"> = {
      source: "yahoo",
      ticker: "XOM",
      asOf: DATE,
      totalAssets: 376.3,
      totalLiabilities: 163.8,
      totalEquity: 212.5,
      cashAndEquivalents: 23.2,
      totalDebt: 41.6,
      unit: "USD billions",
    };
    await recordFixture(
      "get_balance_sheet",
      { ticker: "XOM", date: DATE },
      recorded,
      { rootDir },
    );

    const replayed = await loadFixture(
      "get_balance_sheet",
      { ticker: "XOM", date: DATE },
      { rootDir },
    );

    // Deep equality modulo the source translation: the live provider tag
    // becomes "fixture" on replay; every data field survives byte-for-byte.
    expect(replayed).toEqual({ ...recorded, source: "fixture" });
  });

  it("a macro tool (no ticker) records under _macro/{DATE}/ and replays", async () => {
    const recorded: ToolOutput<"get_macro_indicators"> = {
      source: "fred",
      asOf: DATE,
      cpiYoy: 2.4,
      unemployment: 4.2,
      fedFundsRate: 4.25,
      tenYearYield: 4.4,
      oilWtiUsd: 68.1,
      yieldCurve2s10s: 0.45,
      hyCreditSpread: 3.2,
      dollarIndex: 99.5,
      industrialProduction: 0.2,
    };
    await recordFixture("get_macro_indicators", { date: DATE }, recorded, {
      rootDir,
    });

    // Ticker-agnostic tools land under the `_macro` sentinel directory —
    // the same layout `loadFixture` resolves for a no-ticker input.
    expect(
      existsSync(path.join(rootDir, "_macro", DATE, "macro-indicators.json")),
    ).toBe(true);

    const replayed = await loadFixture(
      "get_macro_indicators",
      { date: DATE },
      { rootDir },
    );
    expect(replayed).toEqual({ ...recorded, source: "fixture" });
  });

  it("an exhausted provider chain records the unavailable payload and replay preserves the tag", async () => {
    // Edge case: every provider failed during the record run, so the tool
    // returned the schema-valid empty payload — that is what gets recorded,
    // and the replay must stay `"unavailable"` (missing signal, not data).
    const recorded = emptyPayload("get_fundamentals", {
      ticker: "XOM",
      date: DATE,
    });
    expect(recorded.source).toBe("unavailable");
    await recordFixture(
      "get_fundamentals",
      { ticker: "XOM", date: DATE },
      recorded,
      { rootDir },
    );

    const replayed = await loadFixture(
      "get_fundamentals",
      { ticker: "XOM", date: DATE },
      { rootDir },
    );

    // No source translation here — deep equality including the tag.
    expect(replayed).toEqual(recorded);
    expect(replayed.source).toBe("unavailable");
  });
});

describe("pre-flight guard against the date-addressed corpus", () => {
  it("fixture mode admits a corpus-backed ticker/date and rejects an absent one", async () => {
    // Read-only probe of the real checked-in corpus: NVDA has a curated
    // 2026-05-06 snapshot; 2099-01-01 has none. A recorded snapshot is
    // admitted by the same existence probe, so this pins the date-addressed
    // guard behavior without writing to the real fixtures/ directory.
    const present = await resolveTicker({
      ticker: "NVDA",
      date: "2026-05-06",
      dataSource: "fixture",
    });
    expect(present).toEqual({ resolved: true, reason: null });

    const absent = await resolveTicker({
      ticker: "NVDA",
      date: "2099-01-01",
      dataSource: "fixture",
    });
    expect(absent.resolved).toBe(false);
    expect(absent.reason).toMatch(/2099-01-01/);
  });
});
