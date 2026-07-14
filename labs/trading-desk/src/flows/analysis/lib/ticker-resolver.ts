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
 *     `fundamentals.json` snapshot for the requested date. Missing →
 *     unresolvable. (The macro sentinel ticker `_macro` is never validated
 *     through this path — callers only resolve real tickers.)
 *   - live: at least one wired fundamentals provider returns without
 *     throwing. Every provider throwing → unresolvable. We do not gate on
 *     non-zero values because the empty-payload fallback is what we are
 *     trying to detect upstream of, not after.
 *   - record: same as live — a record run resolves tickers live.
 */
import { access } from "node:fs/promises";
import path from "node:path";
import { fetchFinnhubFundamentals, hasFinnhubKey } from "@/src/providers/finnhub";
import { assertFixtureDate, FIXTURE_ROOT } from "../tools/runtime/fixtures";
import { fetchYahooFundamentals } from "@/src/providers/yahoo";

const FIXTURE_PROBE_FILE = "fundamentals.json";

export type ResolveTickerInput = {
  ticker: string;
  /**
   * In fixture mode this addresses the snapshot directory probed
   * (`{ticker}/{date}/fundamentals.json`, matching `loadFixture`); in
   * live/record mode it passes through to the provider fetch.
   */
  date: string;
  dataSource: "fixture" | "live" | "record";
};

export type ResolveTickerResult = {
  resolved: boolean;
  /** Short, human-readable reason on unresolved; null on resolved. */
  reason: string | null;
};

/** Probe the requested date's fixture snapshot for a single canonical file. */
async function resolveFixture(
  input: ResolveTickerInput,
): Promise<ResolveTickerResult> {
  // The date is a user-controlled path segment, same as in `loadFixture`. A
  // malformed value is treated as unresolvable rather than reaching `path.join`.
  try {
    assertFixtureDate(input.date);
  } catch {
    return {
      resolved: false,
      reason: `Invalid fixture date "${input.date}" — expected YYYY-MM-DD.`,
    };
  }
  const filePath = path.join(
    FIXTURE_ROOT,
    input.ticker,
    input.date,
    FIXTURE_PROBE_FILE,
  );
  try {
    await access(filePath);
    return { resolved: true, reason: null };
  } catch {
    return {
      resolved: false,
      reason: `No fixture snapshot for ticker ${input.ticker} at ${input.date}. Pick a recorded ticker/date or run with live data.`,
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
  // Record mode resolves live: a record run fetches from the live providers
  // (and persists the results), so the resolvability question is the live one.
  return input.dataSource === "fixture"
    ? resolveFixture(input)
    : resolveLive(input);
}
