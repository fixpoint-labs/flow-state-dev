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
  /** True when at least one `constituents` row has a resolvable (non-null)
   *  ticker. False for the "fully covered, nothing nameable" case (e.g. GLD —
   *  every row is an `n/a` symbol with a real weight): `nameCoverage` reads
   *  high and the rows reconcile, so nothing about the mass accounting flags
   *  it, but the consuming leaf (`etf-look-through.ts`) reads this field to
   *  still surface the fund in `opaqueFunds` on the name axis — a diagnostic
   *  signal, not a mass-routing one (every row already routes to the name
   *  residual via its null ticker regardless of this field). Optional on
   *  every OTHER type this normalized shape flows through
   *  (`NormalizedFundProfile`, the leaf's own copy) because a row stored
   *  before this field existed won't have it (BP-030); always populated HERE,
   *  by this fetcher, on every fresh fetch (Codex review, FIX-801 sub-PR c
   *  round 14, connecting to round 8's per-axis taxonomy work). */
  hasResolvableConstituent?: boolean;
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
 * outcome (never throws) for a domain-level judgment. See the FIX-801 spec §9
 * edge-case table for the exact refusal→backoff mapping (owned by the REST
 * route, not this module).
 *
 * **Every early return in this function is one of exactly three kinds — kept
 * enumerated here on purpose (Codex review, FIX-801 sub-PR c) so this
 * function doesn't grow a fifth per-axis bug the same shape as the first
 * four, or lose the combined-failure bucket a fifth review round had to add:**
 *
 * 1. **Legitimately WHOLE-PROFILE** — a permanent, structural fact about the
 *    FUND, true independent of any per-axis data quality, so refusing (and
 *    backing off) the whole profile is correct:
 *    - `not_an_etf` — BOTH raw arrays are empty. There is nothing on either
 *      axis to degrade to.
 *    - `ineligible` (leveraged) — a leveraged/inverse fund. Out of scope by
 *      policy (spec Non-goals), regardless of what either axis' data says.
 *
 * 2. **Per-axis degradation — NEVER refuses the whole profile on its own.**
 *    That judgment belongs to the consuming leaf (Decision 4's per-axis gate;
 *    docs/etf-look-through.md), not this fetcher: a fund can pass on one axis
 *    while failing the other, and every one of these discards just the
 *    affected axis's rows/coverage (`[]` / `0` — read by the leaf exactly
 *    like "the provider sent nothing on this axis") and falls through so the
 *    OTHER axis is still evaluated on its own merits:
 *    - NAME axis rows sum past 100% (over-sum malformed).
 *    - NAME axis has no resolvable constituent — whether from an empty/absent
 *      `holdings` array, rows with no resolvable symbol at all (bullion,
 *      unsymboled debt), or resolvable symbols whose weights all failed to
 *      parse. All three collapse to the same "nothing to attribute on the
 *      name axis" outcome; none of them is a fact about the SECTOR axis, so
 *      none of them may suppress it (this was the case still refusing the
 *      whole profile as of the third review round — the fourth variant of
 *      this same bug class).
 *    - SECTOR axis rows sum past 100% (over-sum malformed).
 *
 * 3. **COMBINED-axis fallback — refuses `malformed`, checked AFTER both axes
 *    are independently evaluated.** Bucket 2 says either axis degrading ALONE
 *    is fine; it does not say BOTH degrading together is fine. If neither axis
 *    survives (`constituents` ends up empty AND `sectors` ends up empty — by
 *    any combination of the bucket-2 routes, or one axis malformed and the
 *    other simply never present), that is not a thin-but-real profile — the
 *    provider returned something (bucket 1's both-raw-empty check already
 *    caught a literal empty response), but nothing on it survived to store.
 *    Falling through to an unconditional `"profile"` success here would (a)
 *    misreport a corrupted/garbage response as merely "thin coverage", and
 *    (b) earn the standard ~30-day freshness window instead of `malformed`'s
 *    ~7-day retry, leaving a fund that gave garbage data opaque for a month
 *    (Codex review, FIX-801 sub-PR c, round 8 — the fifth review pass on this
 *    function). The GLD-style "fully covered, nothing nameable" profile
 *    (bucket 2's unsymboled-but-priced case) never lands here: it keeps its
 *    null-ticker rows in `constituents`, so `constituents.length` is never 0
 *    for it even though nothing is attributable.
 *
 * The `malformed` `EtfRefusalReason` is consequently produced ONLY by bucket
 * 3 — every bucket-2 case that used to return it now degrades that one axis
 * instead.
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
    // No ATTRIBUTABLE NAME-axis data — covers THREE distinct raw shapes,
    // none of which is a fact about the fund as a whole (Codex review,
    // FIX-801 sub-PR c, fourth variant of the per-axis bug class): an
    // empty/absent `holdings` array (`constituents`/`nameCoverage` are
    // already `[]`/`0` — the loop above had nothing to iterate), resolvable
    // symbols whose weights all failed to parse (also already `[]`/`0` — an
    // unparseable weight is `continue`d before ever pushing a row), or rows
    // with NO resolvable symbol at all but VALID weights (bullion,
    // unsymboled debt) — this last shape is different: those rows WERE
    // pushed (a `null`-ticker constituent is kept, per this file's own
    // `EtfConstituent` docblock, "present in even well-covered funds, not
    // dropped"), so `nameCoverage` can be genuinely non-zero here (e.g. a
    // fund whose holdings are 100% cash/futures/bonds reports full coverage,
    // zero attributable names) — that is not malformed data, it is an
    // honest "fully covered, nothing nameable" fund, so it is intentionally
    // left as-is rather than zeroed. All three collapse to the same verdict
    // for THIS check (nothing to attribute a single name to), and per
    // Decision 4's per-axis contract that must not suppress a possibly-valid
    // SECTOR axis (docs/etf-look-through.md) — this used to return a
    // whole-profile refusal here (`ineligible` for the two unsymboled
    // shapes, `malformed` for the unparseable-weight shape; see the
    // function's own docblock for the full early-return inventory). Mark the
    // axis malformed and fall through to sector parsing below, which judges
    // the sector axis entirely on its own merits.
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

  // The third bucket the per-axis taxonomy needs (Codex review, FIX-801
  // sub-PR c, round 8): each axis degrading independently is correct, but if
  // BOTH axes end up with nothing usable — `constituents` empty (no
  // attributable name AND no real coverage figure either — the GLD-style
  // "fully covered, nothing nameable" case above always leaves at least one
  // null-ticker row, so it never lands here) and `sectors` empty, regardless
  // of whether either got there via the over-sum branch or was simply never
  // present — that is not a thin-but-real profile. It is a malformed
  // response: the provider returned SOMETHING (the top-of-function
  // both-raw-empty check already caught a literal empty response), but
  // nothing on it survives to store. Persisting this as a normal `"profile"`
  // success would (1) misrepresent a corrupted/garbage response as merely
  // "thin coverage", and (2) earn the standard ~30-day freshness window
  // instead of the `malformed` refusal's ~7-day retry, leaving a fund that
  // genuinely gave garbage data opaque for a month before trying again.
  if (constituents.length === 0 && sectors.length === 0) {
    return {
      kind: "refused",
      reason: "malformed",
      detail: "no usable data on either axis",
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
    hasResolvableConstituent,
  };
  return { kind: "profile", profile };
}
