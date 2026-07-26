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
  const n = s.endsWith("%") ? Number(s.slice(0, -1)) / 100 : Number(s);
  if (!Number.isFinite(n)) return null;
  // Range-check the INDIVIDUAL weight, not just the aggregate sum: a
  // malformed/corrupted provider value (e.g. a negative weight, or one
  // reported as a raw percent like "728" instead of "7.28") must never enter
  // the sums silently. Left unchecked, a negative weight could offset an
  // oversized positive one so the aggregate sum-to-~100% malformed check in
  // `fetchEtfProfile` still passes over genuinely corrupted data (Codex
  // review, FIX-801 sub-PR a). Out-of-range → contributes nothing, same as an
  // unparseable weight.
  if (n < 0 || n > 1) return null;
  return n;
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
 * at all (`not_an_etf`), a leveraged/inverse fund (`ineligible`), or a
 * response with genuinely unsymboled holdings — bullion, unsymboled debt —
 * (`ineligible`, a permanent fact about the fund rather than a data glitch).
 * See the FIX-801 spec §9 edge-case table for the exact refusal→backoff
 * mapping (owned by the REST route, not this module).
 *
 * **Per-axis malformed handling does NOT refuse the whole profile** — that
 * judgment is the consuming leaf's business (Decision 4's per-axis gate;
 * docs/etf-look-through.md), not this fetcher's, and it applies
 * symmetrically to both axes, and to every way an axis can turn out
 * unusable. A NAME axis whose rows sum past 100% has its rows discarded
 * (`constituents: []`, `nameCoverage: 0` — read by the leaf exactly like "the
 * provider sent no holdings data"); a SECTOR axis with the same over-sum
 * problem is discarded the same way; a response with resolvable constituent
 * SYMBOLS whose weights are ALL unparseable/corrupted (leaving nothing to sum
 * on the name axis at all) discards the same way too, rather than refusing
 * the whole profile the way it used to (Codex review, FIX-801 sub-PR c —
 * this was the third variant of the same bug class: the `malformed`
 * `EtfRefusalReason` is consequently no longer produced by this fetcher at
 * all, though the type/backoff-table entry stays for any future path that
 * needs it). Either axis can be malformed — by any of these routes — while
 * the OTHER stays fully usable, and the fetch still returns a normal
 * `"profile"` outcome — never suppressed for ~7 days over a single-axis data
 * glitch when the other axis is fine.
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

  let constituents: EtfConstituent[] = [];
  let nameCoverage = 0;
  for (const row of rawHoldings) {
    const weight = parseFraction(row.weight);
    if (weight === null) continue; // an unparseable weight contributes nothing (never fabricated)
    nameCoverage += weight;
    constituents.push({ ticker: normalizeConstituentTicker(row.symbol), weight });
  }

  // Mirror of the sector-malformed handling below: a malformed NAME axis
  // must not discard an otherwise-usable SECTOR axis either — the same
  // per-axis contract applies symmetrically (Codex review, FIX-801 sub-PR c,
  // follow-up to the sector-side fix). Discard just the malformed name rows
  // (same shape as "the provider sent no holdings data") and keep going; the
  // sector axis, checked further below, is still evaluated on its own
  // merits. `nameMalformed` guards the `hasResolvableConstituent` check
  // right below from re-deriving a DIFFERENT verdict (`ineligible`/a
  // duplicate `malformed`) off the now-emptied `constituents` — this branch
  // already knows exactly why the axis is empty.
  let nameMalformed = false;
  if (nameCoverage > 1 + COVERAGE_OVERAGE_EPSILON) {
    nameMalformed = true;
    constituents = [];
    nameCoverage = 0;
  } else {
    // A sum inside the accepted tolerance (100–101%, pure rounding across
    // hundreds of rows) still must not EXCEED 1 in what gets stored: the
    // consuming leaf's `safeWeight` (`etf-look-through.ts`) has a strict
    // `[0, 1]` contract and zeroes anything outside it — so an unclamped
    // 1.005 would silently read back as 0% coverage (fully opaque)
    // downstream instead of the ~100% this profile actually has. Clamping
    // here, not loosening the leaf's contract, is the fix (Codex review,
    // FIX-801 sub-PR c): the leaf's strict range is correct; this is the
    // one place that produces a value outside it. Individual constituent
    // weights never need this — `parseFraction` already rejects any single
    // weight > 1 — only the AGGREGATE sum can land just over 1. The leaf's
    // own over-sum scaling (`nameScale`) still applies correctly afterward:
    // clamping only the declared coverage (not the individual rows) keeps
    // `actualNameSum` from re-summing the rows slightly ABOVE the clamped
    // `nameCoverage`, which the leaf's reconciliation tolerance already
    // absorbs and its scaling logic already handles.
    nameCoverage = Math.min(nameCoverage, 1);
  }

  const hasResolvableConstituent = constituents.some((c) => c.ticker !== null);
  if (!nameMalformed && !hasResolvableConstituent) {
    // "No resolvable constituent" covers TWO distinct raw shapes, which must
    // not share a verdict (Codex review, FIX-801 sub-PR a): a genuinely
    // unsymboled book (bullion, unsymboled debt) is a permanent fact about
    // the fund — `ineligible`, ~90-day backoff, the one remaining
    // whole-profile refusal in this block. A response with sector rows but
    // an EMPTY/absent `holdings` array (`rawHoldings.length === 0`) falls
    // through to this same check too — this is no longer gated on
    // `rawHoldings.length > 0`, since an empty holdings array trivially has
    // no resolvable symbol either and must not silently pass through as a
    // zero-constituent "profile" (a second Codex review, FIX-801 sub-PR a —
    // distinct from the initial both-empty `not_an_etf` check above, which
    // only fires when sectors are ALSO empty).
    const hasResolvableSymbol = rawHoldings.some((row) => !isAbsent(row.symbol));
    if (!hasResolvableSymbol) {
      return { kind: "refused", reason: "ineligible", detail: "no resolvable constituent tickers" };
    }
    // Symbols WERE resolvable but every weight failed to parse (corrupted/
    // out-of-range) — a NAME-axis data glitch, not a permanent fact about
    // the fund. Per the same per-axis contract as the two over-sum branches
    // below, this must not refuse the whole profile and discard a
    // possibly-valid sector axis (Codex review, FIX-801 sub-PR c, third
    // variant of the same bug class as the sector-malformed / name-malformed
    // over-sum fixes). `constituents`/`nameCoverage` are already `[]`/`0`
    // here (nothing parsed) — mark the axis malformed and fall through to
    // sector parsing below, which judges the sector axis entirely on its own
    // merits.
    nameMalformed = true;
  }

  let sectors: EtfSectorRow[] = [];
  let sectorCoverage = 0;
  for (const row of rawSectors) {
    const weight = parseFraction(row.weight);
    if (weight === null || isAbsent(row.sector)) continue;
    sectorCoverage += weight;
    sectors.push({ sector: mapSectorLabel(row.sector as string), weight });
  }

  if (sectorCoverage > 1 + COVERAGE_OVERAGE_EPSILON) {
    // A malformed SECTOR axis must not discard an otherwise-usable NAME axis
    // (docs/etf-look-through.md's own per-axis contract — a fund can pass on
    // names while failing sectors, and per-axis malformed handling is the
    // consuming leaf's business, not the fetcher's — see the leaf's own
    // "sector data malformed" reconciliation check, which exists precisely
    // because a per-axis judgment, not a whole-profile refusal, is the
    // correct granularity here). Refusing the WHOLE profile — and backing it
    // off for ~7 days — would suppress a fund's fully-usable name-axis data
    // over a sector-only data glitch (Codex review, FIX-801 sub-PR c).
    // Discard just the malformed sector rows (same shape as "the provider
    // sent no sector data at all" — the leaf's existing below-floor handling
    // already renders that honestly as sector-axis-opaque) and keep going;
    // the profile still returns as a usable "profile" outcome, not a refusal.
    sectors = [];
    sectorCoverage = 0;
  } else {
    // Same clamp, same reason as `nameCoverage` above — a within-tolerance
    // over-sum must not persist above the leaf's strict `[0, 1]` contract.
    sectorCoverage = Math.min(sectorCoverage, 1);
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
