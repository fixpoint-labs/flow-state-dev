/**
 * Alpha Vantage `ETF_PROFILE` fetcher (FIX-801) — a fund's holdings + sector
 * allocation, normalized into a provider-neutral shape. Composes the landed
 * `alphaVantageRequest` (key gating, HTTP-200 body-error detection, the shared
 * daily budget + minute pacing) and adds nothing of its own on top — every
 * provider quirk stops here so `db/repository.ts` and the REST route never see
 * a raw AV field.
 *
 * Every scalar and every weight arrives from AV as a STRING, with `"n/a"` as
 * the absent-value sentinel. Weights are fractions in `[0, 1]` by convention,
 * parsed defensively (`parseWeight` also accepts a trailing `%` form, since a
 * production client in the wild has to handle both). The response does NOT
 * echo which fund it describes (identity comes from the request ticker) and
 * carries NO as-of or portfolio date at all — the caller's own fetch time is
 * the only date available (see `db/schema.ts`'s `etf_profiles.fetched_at`).
 * The documented `asset_allocation` field is absent from live responses and is
 * deliberately not read (open question 2, `classify-instrument.ts`).
 *
 * This fetcher THROWS on any transport/AV-body failure (`AlphaVantageError`
 * and subclasses), like every other fetcher in this module — the caller
 * degrades. It does NOT throw for a domain-level refusal (no profile for this
 * ticker, a leveraged/inverse fund, unparseable weights): those are judged
 * HERE (an "already-judged, provider-neutral profile", per the FIX-801 spec
 * §7) and returned as a typed `{ kind: "refused" }` outcome, because they are
 * not transport failures — the request succeeded; the fund is just not one
 * this feature attributes. The coverage FLOOR (Decision 4's ~85% gate) is
 * deliberately NOT decided here — a thin profile is stored, not refused, so
 * that judgment is a presentation verdict the (later) pure leaf makes at read
 * time, not a fetch-time one.
 */
import { alphaVantageRequest } from "./alpha-vantage";

/** One constituent holding. `ticker` is `null` for AV's `"n/a"` rows (foreign
 *  lines, futures, cash) — present in even well-covered funds, not dropped
 *  (dropping would inflate apparent coverage), and never attributable to a
 *  single name. `weight` is a fraction in `[0, 1]`. */
export type EtfConstituent = {
  ticker: string | null;
  weight: number;
};

/** One sector-allocation row, AFTER mapping AV's upper-case GICS label onto
 *  the app's existing sector vocabulary (`sector-resolution.ts`'s `GICS_TO_ETF`
 *  keys). An unmapped label becomes its own explicit bucket (prefixed, so it's
 *  visibly distinct from a resolved app sector) rather than being folded into
 *  a neighbour. `weight` is a fraction in `[0, 1]`. */
export type EtfSectorRow = {
  sector: string;
  weight: number;
};

/** The normalized, provider-neutral profile — what gets stored (as the table's
 *  jsonb payload) and, eventually, what the pure look-through leaf consumes.
 *  Coverage figures are the SUM of the respective weight column (including
 *  non-attributable `n/a` rows for `nameCoverage` — they count against
 *  coverage even though they can't be attributed to a name) — fractions in
 *  `[0, 1]`, not `0..100` (this module never touches the health payload's
 *  `Pct`-suffixed convention; that mapping is the consuming leaf's job). */
export type NormalizedEtfProfile = {
  leveraged: boolean;
  constituents: EtfConstituent[];
  nameCoverage: number;
  sectors: EtfSectorRow[];
  sectorCoverage: number;
  netExpenseRatio: number | null;
  inceptionDate: string | null;
};

/** Why a fetched ticker was refused attribution — a JUDGMENT about the
 *  response's content, not a transport failure (those throw). Mirrors the
 *  non-`quota`/`transient` rows of the FIX-801 §9 backoff table; `quota` and
 *  `transient` are represented by `alphaVantageRequest` throwing instead. */
export type EtfRefusalReason = "not_an_etf" | "ineligible" | "malformed";

export type EtfProfileFetch =
  | { kind: "profile"; profile: NormalizedEtfProfile }
  | { kind: "refused"; reason: EtfRefusalReason; detail: string };

/** AV's `"n/a"` absent-value sentinel (case-insensitive, matching the alpha-
 *  vantage module's own `"None"`/`"-"` handling for other endpoints). */
function isAbsent(v: unknown): boolean {
  return typeof v !== "string" || v.trim() === "" || v.trim().toLowerCase() === "n/a";
}

/** Parse an AV numeric/weight string defensively: a plain fraction (`"0.0728"`)
 *  or a percent form (`"51.1%"`) both resolve to a fraction. Unparseable or
 *  absent → `null` (never coerced to `0`, which would understate coverage). */
function parseFraction(v: unknown): number | null {
  if (isAbsent(v)) return null;
  const s = (v as string).trim();
  if (s.endsWith("%")) {
    const n = Number(s.slice(0, -1));
    return Number.isFinite(n) ? n / 100 : null;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Parse a plain AV numeric string (not a weight — no `%` handling). */
function parseNumber(v: unknown): number | null {
  if (isAbsent(v)) return null;
  const n = Number((v as string).trim());
  return Number.isFinite(n) ? n : null;
}

/** AV's `leveraged` field is a `"YES"`/`"NO"` string. Absent defaults to
 *  non-leveraged (the field is documented as always present; a missing value
 *  is treated the same as `"NO"` rather than making the whole profile
 *  unparseable over one field). */
function parseLeveraged(v: unknown): boolean {
  return typeof v === "string" && v.trim().toUpperCase() === "YES";
}

/**
 * AV's upper-case GICS sector label → the app's existing sector vocabulary
 * (`sector-resolution.ts`'s `GICS_TO_ETF` keys — the 11 standard GICS
 * sectors, Yahoo's naming). A label not in this table is NOT silently folded
 * into a neighbour (Decision 7's trap) — `mapSectorLabel` returns it as its
 * own explicit bucket instead.
 */
const AV_SECTOR_TO_APP_SECTOR: Record<string, string> = {
  "INFORMATION TECHNOLOGY": "Technology",
  TECHNOLOGY: "Technology",
  "HEALTH CARE": "Healthcare",
  HEALTHCARE: "Healthcare",
  FINANCIALS: "Financial Services",
  "FINANCIAL SERVICES": "Financial Services",
  "CONSUMER DISCRETIONARY": "Consumer Cyclical",
  "CONSUMER CYCLICAL": "Consumer Cyclical",
  "COMMUNICATION SERVICES": "Communication Services",
  TELECOMMUNICATIONS: "Communication Services",
  INDUSTRIALS: "Industrials",
  "CONSUMER STAPLES": "Consumer Defensive",
  "CONSUMER DEFENSIVE": "Consumer Defensive",
  ENERGY: "Energy",
  UTILITIES: "Utilities",
  "REAL ESTATE": "Real Estate",
  MATERIALS: "Basic Materials",
  "BASIC MATERIALS": "Basic Materials",
};

/** Map one AV sector label to the app vocabulary. An unmapped label becomes
 *  its own explicit bucket, title-cased and marked, rather than dropped or
 *  merged (Decision 7). */
export function mapSectorLabel(raw: string): string {
  const key = raw.trim().toUpperCase();
  const mapped = AV_SECTOR_TO_APP_SECTOR[key];
  if (mapped) return mapped;
  // Unmapped — keep it visibly distinct (e.g. "Other: Precious Metals") rather
  // than silently joining an existing bucket.
  const titled = raw
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return `Other: ${titled}`;
}

type RawEtfProfileBody = {
  net_expense_ratio?: unknown;
  inception_date?: unknown;
  leveraged?: unknown;
  sectors?: Array<{ sector?: unknown; weight?: unknown }>;
  holdings?: Array<{ symbol?: unknown; weight?: unknown }>;
};

/** A resolvable constituent ticker — trimmed/upper-cased, matching the app's
 *  canonical ticker key convention. `null` for AV's `"n/a"` rows. */
function normalizeConstituentTicker(symbol: unknown): string | null {
  if (isAbsent(symbol)) return null;
  return (symbol as string).trim().toUpperCase();
}

const COVERAGE_OVERAGE_EPSILON = 0.01; // 1pp slack for rounding across ~500 rows

/**
 * Fetch and normalize one ticker's ETF profile. Throws `AlphaVantageError` (or
 * a subclass) on any transport/budget/rate-limit failure — the caller
 * degrades exactly as with every other AV fetcher. Returns a `"refused"`
 * outcome (never throws) for a domain-level judgment: no usable profile data
 * at all (`not_an_etf`), a leveraged/inverse fund or one with no resolvable
 * constituents at all — bullion, unsymboled debt (`ineligible`), or
 * constituent weights summing past 100% (`malformed`, a provider-side data
 * bug). See the FIX-801 spec §9 edge-case table for the exact refusal→backoff
 * mapping (owned by the REST route, not this module).
 */
export async function fetchEtfProfile(ticker: string): Promise<EtfProfileFetch> {
  const body = (await alphaVantageRequest({
    function: "ETF_PROFILE",
    symbol: ticker,
  })) as RawEtfProfileBody;

  const rawHoldings = Array.isArray(body.holdings) ? body.holdings : [];
  const rawSectors = Array.isArray(body.sectors) ? body.sectors : [];

  if (rawHoldings.length === 0 && rawSectors.length === 0) {
    return { kind: "refused", reason: "not_an_etf", detail: "empty profile response" };
  }

  const leveraged = parseLeveraged(body.leveraged);
  if (leveraged) {
    return { kind: "refused", reason: "ineligible", detail: "leveraged/inverse fund" };
  }

  const constituents: EtfConstituent[] = [];
  let nameCoverage = 0;
  for (const row of rawHoldings) {
    const weight = parseFraction(row.weight);
    if (weight === null) continue; // an unparseable weight contributes nothing (never fabricated)
    nameCoverage += weight;
    constituents.push({ ticker: normalizeConstituentTicker(row.symbol), weight });
  }

  if (nameCoverage > 1 + COVERAGE_OVERAGE_EPSILON) {
    return {
      kind: "refused",
      reason: "malformed",
      detail: `constituent weights sum to ${(nameCoverage * 100).toFixed(1)}%`,
    };
  }

  const hasResolvableConstituent = constituents.some((c) => c.ticker !== null);
  if (rawHoldings.length > 0 && !hasResolvableConstituent) {
    // Every holding row is AV's "n/a" — a commodity/bond fund whose lines are
    // bullion or unsymboled debt, or another shape with nothing to attribute.
    return { kind: "refused", reason: "ineligible", detail: "no resolvable constituent tickers" };
  }

  const sectors: EtfSectorRow[] = [];
  let sectorCoverage = 0;
  for (const row of rawSectors) {
    const weight = parseFraction(row.weight);
    if (weight === null || isAbsent(row.sector)) continue;
    sectorCoverage += weight;
    sectors.push({ sector: mapSectorLabel(row.sector as string), weight });
  }

  if (sectorCoverage > 1 + COVERAGE_OVERAGE_EPSILON) {
    return {
      kind: "refused",
      reason: "malformed",
      detail: `sector weights sum to ${(sectorCoverage * 100).toFixed(1)}%`,
    };
  }

  const profile: NormalizedEtfProfile = {
    leveraged,
    constituents,
    nameCoverage,
    sectors,
    sectorCoverage,
    netExpenseRatio: parseNumber(body.net_expense_ratio),
    inceptionDate: isAbsent(body.inception_date) ? null : (body.inception_date as string),
  };
  return { kind: "profile", profile };
}
