/**
 * Pre-flight ticker resolution check (FIX-605).
 *
 * Returns whether a ticker can be resolved to real data under the requested
 * data source, without committing to a full Phase 1 fan-out. The check is
 * deliberately cheap: a single existence probe in fixture mode, a single
 * fundamentals fetch (Finnhub → Yahoo) in live mode.
 *
 * Definition of "resolvable" by mode:
 *   - fixture: the per-ticker fixture directory contains the canonical
 *     `fundamentals.json` snapshot. Missing → unresolvable. (The macro
 *     sentinel ticker `_macro` is never validated through this path —
 *     callers only resolve real tickers.)
 *   - live: at least one wired fundamentals provider returns without
 *     throwing. Every provider throwing → unresolvable. We do not gate on
 *     non-zero values because the empty-payload fallback is what we are
 *     trying to detect upstream of, not after.
 */
import { access } from "node:fs/promises";
import path from "node:path";
import { fetchFinnhubFundamentals, hasFinnhubKey } from "../providers/finnhub";
import { FIXTURE_ROOT, FIXTURE_SNAPSHOT } from "./fixtures";
import { fetchYahooFundamentals } from "../providers/yahoo";

const FIXTURE_PROBE_FILE = "fundamentals.json";

export type ResolveTickerInput = {
  ticker: string;
  /**
   * Used only in live mode (passed through to the provider fetch). Fixture
   * mode ignores it — fixtures are a single pinned snapshot at
   * `FIXTURE_SNAPSHOT`, matching the same behavior in `loadFixture`.
   */
  date: string;
  dataSource: "fixture" | "live";
};

export type ResolveTickerResult = {
  resolved: boolean;
  /** Short, human-readable reason on unresolved; null on resolved. */
  reason: string | null;
};

/** Probe the fixture snapshot for a single canonical file. */
async function resolveFixture(ticker: string): Promise<ResolveTickerResult> {
  const filePath = path.join(
    FIXTURE_ROOT,
    ticker,
    FIXTURE_SNAPSHOT,
    FIXTURE_PROBE_FILE,
  );
  try {
    await access(filePath);
    return { resolved: true, reason: null };
  } catch {
    return {
      resolved: false,
      reason: `No fixture data for ticker ${ticker}. Fixtures cover NVDA, AAPL, JPM at snapshot ${FIXTURE_SNAPSHOT}.`,
    };
  }
}

/** Try Finnhub then Yahoo for a single fundamentals fetch. */
async function resolveLive(
  input: ResolveTickerInput,
): Promise<ResolveTickerResult> {
  const fetchInput = { ticker: input.ticker, date: input.date };
  if (hasFinnhubKey()) {
    try {
      await fetchFinnhubFundamentals(fetchInput);
      return { resolved: true, reason: null };
    } catch {}
  }
  try {
    await fetchYahooFundamentals(fetchInput);
    return { resolved: true, reason: null };
  } catch {}
  return {
    resolved: false,
    reason: `Could not resolve ticker ${input.ticker} with any live provider (Finnhub, Yahoo).`,
  };
}

export function resolveTicker(
  input: ResolveTickerInput,
): Promise<ResolveTickerResult> {
  return input.dataSource === "fixture"
    ? resolveFixture(input.ticker)
    : resolveLive(input);
}
