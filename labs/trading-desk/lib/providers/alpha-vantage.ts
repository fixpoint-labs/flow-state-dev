/**
 * Alpha Vantage (AV) provider — the foundation the trading desk's AV family
 * (news sentiment, movers, ETF, macro, indicators, events) builds on. AV is a
 * NASDAQ-licensed source used here as a TERMINAL fallback and stub-completer,
 * never a primary/preferred source (that decision is the FIX-675 bake-off's).
 *
 * The one load-bearing correctness property: AV signals failures with an
 * HTTP-200 BODY, not an error status — a quota throttle as `{ Note }` /
 * `{ Information }`, and a request-shape error (e.g. a bad `quarter` label) as
 * `{ "Error Message" }`. `alphaVantageRequest` is the single place that detects
 * these bodies and throws, so every AV fetcher (this issue's and all
 * follow-ons') inherits correct exhaustion handling and apikey injection.
 *
 * The free tier allows only 25 requests/day (5/min), so `alphaVantageRequest`
 * also runs a race-free in-process daily-budget guard governed by a single
 * `ALPHAVANTAGE_DAILY_LIMIT` knob (`0` = unlimited, for a paid plan). The guard
 * is process-scoped and best-effort — a process restart or serverless
 * cold-start resets it; AV's server-side throttle (→ Note body → throw) is the
 * real-exhaustion backstop. See `docs/specs/FIX-798.md`.
 *
 * Every fetch function throws on any failure (no key, budget spent, rate-limit
 * body, non-2xx, parse error) so the calling tool falls through with one
 * `try { ... } catch {}`, per the desk's provider convention.
 */
import type { TickerDatedProviderInput } from "./types";
import { INSIDER_ROW_CAP, INSIDER_WINDOW_DAYS, isoDateDaysBefore } from "./dates";

const AV_BASE = "https://www.alphavantage.co/query";

/** Base AV error. Thrown for a missing key; superclass of the specific errors. */
export class AlphaVantageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AlphaVantageError";
  }
}

/** A quota throttle — AV's `Note` / `Information` HTTP-200 body. The quota is
 *  spent; callers degrade immediately and do NOT retry. */
export class AlphaVantageRateLimitError extends AlphaVantageError {
  constructor(message: string) {
    super(message);
    this.name = "AlphaVantageRateLimitError";
  }
}

/** A request-shape error — AV's `Error Message` HTTP-200 body (e.g. an
 *  unrecognized `quarter` label). NOT a quota signal; the first transcript
 *  label is retry-eligible on this. */
export class AlphaVantageRequestError extends AlphaVantageError {
  constructor(message: string) {
    super(message);
    this.name = "AlphaVantageRequestError";
  }
}

/** The day's in-process budget is already spent. Thrown BEFORE fetching. */
export class AlphaVantageBudgetError extends AlphaVantageError {
  constructor(limit: number) {
    super(`Alpha Vantage daily budget of ${limit} requests is spent`);
    this.name = "AlphaVantageBudgetError";
  }
}

const DEFAULT_DAILY_LIMIT = 25;

/** Process-level daily-budget counter. Module scope, not session state. */
const budget: { dayUtc: string; count: number } = { dayUtc: "", count: 0 };

/** Test hook — reset the in-process daily counter between specs. Not in the barrel. */
export function _resetBudget(): void {
  budget.dayUtc = "";
  budget.count = 0;
}

/** True when an Alpha Vantage key is configured. */
export function hasAlphaVantageKey(): boolean {
  return Boolean(process.env.ALPHAVANTAGE_API_KEY?.trim());
}

/**
 * Resolve the active daily limit from `ALPHAVANTAGE_DAILY_LIMIT`, fail-safe.
 * Only the exact string "0" disables the guard; a positive integer sets the
 * limit; everything else (blank, non-numeric, negative, non-integer, and
 * zero-like typos) falls back to 25 rather than silently disabling protection.
 * The malformed-input cases are enumerated in `alpha-vantage.spec.ts`.
 */
function resolveDailyLimit(): number {
  const raw = process.env.ALPHAVANTAGE_DAILY_LIMIT?.trim();
  if (raw === "0") return 0; // the explicit unlimited sentinel — exact match only
  if (raw === undefined) return DEFAULT_DAILY_LIMIT;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_DAILY_LIMIT;
}

/**
 * Shared AV request. Injects `apikey=ALPHAVANTAGE_API_KEY` (callers pass only
 * the endpoint params — `function`, `symbol`, `quarter`, …), reserves one unit
 * of the daily budget SYNCHRONOUSLY (atomic check-and-increment, before any
 * `await`, so parallel analyst calls can't overshoot the cap), then fetches and
 * treats AV's HTTP-200 rate-limit / exhaustion / error BODIES as failures.
 *
 * Throws `AlphaVantageError` when no key is set (before any reserve or fetch);
 * `AlphaVantageBudgetError` when the day's budget is spent (before fetch); on a
 * `Note`/`Information` body `AlphaVantageRateLimitError`; on an `Error Message`
 * body the distinct `AlphaVantageRequestError`; and a plain error on non-2xx or
 * a JSON parse failure.
 */
export async function alphaVantageRequest(
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  // Require a key BEFORE reserving budget or fetching — a direct helper call
  // (test, script, follow-on tool) with an empty/unset key would otherwise
  // reserve a unit and fire a doomed request that only fails later via AV's
  // HTTP-200 `Information` body. Fail locally instead.
  const key = process.env.ALPHAVANTAGE_API_KEY?.trim();
  if (!key) throw new AlphaVantageError("ALPHAVANTAGE_API_KEY is not set");

  const limit = resolveDailyLimit();
  if (limit > 0) {
    const today = new Date().toISOString().slice(0, 10); // UTC day
    if (budget.dayUtc !== today) {
      budget.dayUtc = today;
      budget.count = 0;
    }
    if (budget.count >= limit) throw new AlphaVantageBudgetError(limit);
    budget.count += 1; // reserve synchronously — before any await
  }

  const url = new URL(AV_BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("apikey", key);

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AlphaVantageError(
      `Alpha Vantage request failed: HTTP ${res.status} ${body.slice(0, 120)}`,
    );
  }
  const parsed = (await res.json()) as Record<string, unknown>;
  // Body-error detection — distinguish quota throttles from request-shape errors.
  if ("Note" in parsed || "Information" in parsed) {
    throw new AlphaVantageRateLimitError(
      String(parsed.Note ?? parsed.Information),
    );
  }
  if ("Error Message" in parsed) {
    throw new AlphaVantageRequestError(String(parsed["Error Message"]));
  }
  return parsed;
}

/** Parse an AV string field to a finite number, else null. AV uses "None"/"-"
 *  for absent values, and every field arrives as a string. */
function num(v: unknown): number | null {
  if (typeof v !== "string") return typeof v === "number" && Number.isFinite(v) ? v : null;
  const trimmed = v.trim();
  if (trimmed === "" || trimmed === "None" || trimmed === "-") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

const TRANSCRIPT_CONTENT_CAP = 12_000;

/**
 * Recent insider transactions from AV `INSIDER_TRANSACTIONS`, normalized to the
 * canonical `get_insider_transactions` shape. Passes the server-side
 * `from=<date − 90d>` filter to shrink the response (a quota-conscious path),
 * keeps the client-side upper/lower window filter for back-dated as-of dates,
 * and caps at 50 rows to match the Finnhub primary's prompt-budget contract.
 *
 * The AV fallback is deliberately COARSER than Finnhub: `transactionCode` is
 * left `""` (AV gives only an A/D direction flag, not the SEC code), with
 * direction carried by the sign of `shares`. Throws on any failure.
 */
export async function fetchAlphaVantageInsiderTransactions(
  input: TickerDatedProviderInput,
) {
  const from = isoDateDaysBefore(input.date, INSIDER_WINDOW_DAYS);
  type Row = {
    transaction_date?: string;
    executive?: string;
    executive_title?: string;
    security_type?: string;
    acquisition_or_disposal?: string;
    shares?: string;
    share_price?: string;
  };
  const body = await alphaVantageRequest({
    function: "INSIDER_TRANSACTIONS",
    symbol: input.ticker,
    from,
  });
  const rows = (body.data as Row[] | undefined) ?? [];
  const transactions = rows
    .filter((r) => {
      const d = r.transaction_date;
      return typeof d === "string" && d >= from && d <= input.date;
    })
    .slice(0, INSIDER_ROW_CAP)
    .map((r) => {
      const magnitude = num(r.shares);
      if (magnitude === null) return null; // a fully unparseable row is dropped
      const dir = r.acquisition_or_disposal === "A" ? 1 : -1;
      const secType = (r.security_type ?? "").toLowerCase();
      const isDerivative = secType.includes("deriv") && !secType.includes("non-deriv");
      return {
        filingDate: r.transaction_date ?? "",
        transactionDate: r.transaction_date ?? "",
        insiderName: r.executive ?? "",
        insiderTitle: r.executive_title ?? "",
        transactionCode: "", // unknown — AV lacks the SEC code; never fabricate P/S
        shares: dir * magnitude,
        pricePerShare: num(r.share_price) ?? 0,
        isDerivative,
      };
    })
    .filter((t): t is NonNullable<typeof t> => t !== null);
  return {
    source: "alphavantage" as const,
    ticker: input.ticker,
    asOf: input.date,
    transactions,
    windowDays: INSIDER_WINDOW_DAYS,
  };
}

type EarningsProbe = {
  annualEarnings?: Array<{ fiscalDateEnding?: string }>;
  quarterlyEarnings?: Array<{ fiscalDateEnding?: string; reportedDate?: string }>;
};

/** Naïve calendar-quarter label for a `YYYY-MM-DD` quarter-end date (e.g.
 *  2023-12-31 → "2023Q4"). Used as the alternate-label retry and the
 *  probe-failure best-effort. */
function calendarQuarterLabel(dateEnding: string): string {
  const d = new Date(dateEnding);
  const y = d.getUTCFullYear();
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return `${y}Q${q}`;
}

/**
 * Derive AV's FISCAL-quarter label (`YYYYQn`) for a quarter-end date, using the
 * issuer's fiscal-year-end month (read from the same EARNINGS response's
 * `annualEarnings[]`, no extra call). For a calendar-year filer this equals the
 * calendar label; for an offset filer (Apple, FY ends September) the Dec-2023
 * quarter resolves to `2024Q1`, not `2023Q4`. The quarter ending 3 months after
 * FY-end is Q1; the quarter ending AT FY-end is Q4.
 */
function deriveFiscalQuarterLabel(quarterEnd: string, fyEndMonth: number): string {
  const d = new Date(quarterEnd);
  const qMonth = d.getUTCMonth() + 1; // 1..12
  const qYear = d.getUTCFullYear();
  const monthsAfterFyEnd = (qMonth - fyEndMonth + 12) % 12;
  const step = monthsAfterFyEnd / 3;
  const qNum = step === 0 ? 4 : step; // ending AT FY-end is Q4
  // The fiscal year is the calendar year in which this fiscal year ENDS: when
  // the quarter ends after the FY-end month, the FY closes next calendar year.
  const fiscalYear = qMonth > fyEndMonth ? qYear + 1 : qYear;
  return `${fiscalYear}Q${qNum}`;
}

type TranscriptBody = {
  transcript?: Array<{ speaker?: string; title?: string; content?: string }>;
};

/** One `EARNINGS_CALL_TRANSCRIPT` fetch for a resolved quarter label. Returns
 *  the joined+capped content, or null when the transcript is empty. */
async function fetchTranscriptForQuarter(
  ticker: string,
  quarter: string,
): Promise<string | null> {
  const body = (await alphaVantageRequest({
    function: "EARNINGS_CALL_TRANSCRIPT",
    symbol: ticker,
    quarter,
  })) as TranscriptBody;
  const entries = body.transcript ?? [];
  if (entries.length === 0) return null;
  const joined = entries
    .map((e) => `${e.speaker ?? "?"} (${e.title ?? ""}): ${e.content ?? ""}`)
    .join("\n");
  return joined.slice(0, TRANSCRIPT_CONTENT_CAP);
}

/**
 * Latest earnings-call transcript from AV, normalized to the canonical
 * `get_earnings_transcript` shape. Resolves the latest *reported* fiscal quarter
 * as-of `input.date` via an `EARNINGS` probe (calendar-quarter derivation is
 * wrong for offset fiscal years and back-dated as-of dates), then fetches the
 * transcript for the derived FISCAL label. The first request uses the fiscal
 * label; only when it returns an empty transcript or an `AlphaVantageRequestError`
 * does it retry once with the alternate calendar label. A budget/rate-limit
 * error on the probe degrades immediately (the quota is spent, don't chase a
 * doomed transcript call); a non-budget probe failure falls back to the
 * most-recent calendar quarter as best-effort. Throws on budget/rate-limit.
 *
 * Budget: 2 units on the happy path (probe + transcript), 3 when the
 * alternate-label retry fires.
 */
export async function fetchAlphaVantageEarningsTranscript(
  input: TickerDatedProviderInput,
) {
  const empty = {
    source: "alphavantage" as const,
    ticker: input.ticker,
    asOf: input.date,
    available: false,
    callDate: null,
    quarter: null as string | null,
    content: null as string | null,
  };

  let probe: EarningsProbe;
  try {
    probe = (await alphaVantageRequest({
      function: "EARNINGS",
      symbol: input.ticker,
    })) as EarningsProbe;
  } catch (err) {
    // Budget / rate-limit → quota spent → degrade immediately, no transcript call.
    if (
      err instanceof AlphaVantageBudgetError ||
      err instanceof AlphaVantageRateLimitError
    ) {
      throw err;
    }
    // Non-budget failure (network / parse) → best-effort calendar quarter.
    const calQuarter = calendarQuarterLabel(isoDateDaysBefore(input.date, 90));
    const content = await fetchTranscriptForQuarter(input.ticker, calQuarter);
    return {
      ...empty,
      quarter: calQuarter,
      available: content !== null,
      content,
    };
  }

  // Latest reported quarter on-or-before the as-of date.
  const reported = (probe.quarterlyEarnings ?? [])
    .filter((q) => typeof q.reportedDate === "string" && q.reportedDate <= input.date)
    .sort((a, b) => (a.reportedDate! < b.reportedDate! ? 1 : -1));
  const latest = reported[0];
  if (!latest || !latest.fiscalDateEnding) return empty;

  const fyEnd = probe.annualEarnings?.[0]?.fiscalDateEnding;
  const fyEndMonth = fyEnd ? new Date(fyEnd).getUTCMonth() + 1 : 12;
  const fiscalLabel = deriveFiscalQuarterLabel(latest.fiscalDateEnding, fyEndMonth);

  let content: string | null = null;
  try {
    content = await fetchTranscriptForQuarter(input.ticker, fiscalLabel);
  } catch (err) {
    // A request-shape rejection of the label is retry-eligible; a spent quota is not.
    if (!(err instanceof AlphaVantageRequestError)) throw err;
  }

  let resolvedQuarter = fiscalLabel;
  if (content === null) {
    // Empty or label-rejected → retry once with the alternate calendar label.
    const altLabel = calendarQuarterLabel(latest.fiscalDateEnding);
    if (altLabel !== fiscalLabel) {
      content = await fetchTranscriptForQuarter(input.ticker, altLabel);
      if (content !== null) resolvedQuarter = altLabel;
    }
  }

  return {
    source: "alphavantage" as const,
    ticker: input.ticker,
    asOf: input.date,
    available: content !== null,
    callDate: latest.reportedDate ?? null,
    quarter: resolvedQuarter,
    content,
  };
}

/**
 * Enrich the Finnhub analyst-estimates baseline with AV `OVERVIEW` (price-target
 * consensus) + `EARNINGS_ESTIMATES` (forward EPS/revenue consensus). Two
 * independent `alphaVantageRequest` calls issued via `Promise.allSettled` so one
 * throttle doesn't reject the other — a single `get_analyst_estimates`
 * invocation therefore costs 2 budget units, not 1. Each field is independent:
 * OVERVIEW filling while EARNINGS_ESTIMATES rejects yields `priceTargets` set,
 * `consensusEstimates` null. Never throws (both fields degrade to null).
 */
export async function fetchAlphaVantageAnalystEnrichment(
  ticker: string,
): Promise<{
  consensusEstimates:
    | { fyEpsAvg: number | null; fyRevenueAvg: number | null; numAnalysts: number | null }
    | null;
  priceTargets:
    | { high: number | null; low: number | null; median: number | null; consensus: number | null }
    | null;
}> {
  const [overview, estimates] = await Promise.allSettled([
    alphaVantageRequest({ function: "OVERVIEW", symbol: ticker }),
    alphaVantageRequest({ function: "EARNINGS_ESTIMATES", symbol: ticker }),
  ]);

  // Only construct a field when AV actually returned a value. A success-but-empty
  // OVERVIEW (`AnalystTargetPrice: "None"`) or estimates row must NOT masquerade
  // as a real answer — an all-null object would wrongly tag the tool
  // `"alphavantage"` instead of degrading to `unavailable` (degrade-honestly).
  let priceTargets:
    | { high: number | null; low: number | null; median: number | null; consensus: number | null }
    | null = null;
  if (overview.status === "fulfilled") {
    const consensus = num(overview.value.AnalystTargetPrice);
    if (consensus !== null) {
      priceTargets = { consensus, high: null, low: null, median: null };
    }
  }

  let consensusEstimates:
    | { fyEpsAvg: number | null; fyRevenueAvg: number | null; numAnalysts: number | null }
    | null = null;
  if (estimates.status === "fulfilled") {
    type EstRow = {
      horizon?: string;
      eps_estimate_average?: string;
      revenue_estimate_average?: string;
      eps_estimate_number_of_analysts?: string;
    };
    const rows = (estimates.value.estimates as EstRow[] | undefined) ?? [];
    const row =
      rows.find((r) => /current fiscal year|annual/i.test(r.horizon ?? "")) ?? rows[0];
    if (row) {
      const fyEpsAvg = num(row.eps_estimate_average);
      const fyRevenueAvg = num(row.revenue_estimate_average);
      const numAnalysts = num(row.eps_estimate_number_of_analysts);
      if (fyEpsAvg !== null || fyRevenueAvg !== null || numAnalysts !== null) {
        consensusEstimates = { fyEpsAvg, fyRevenueAvg, numAnalysts };
      }
    }
  }

  return { consensusEstimates, priceTargets };
}
