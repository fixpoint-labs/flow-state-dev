/**
 * The data-honesty contract stamp (FIX-1063) — a pure browser-safe leaf so the
 * flow, the Summary components, and the artifacts bundle all read one copy.
 *
 * WHAT IT IS. A **version marker for legacy-report detection**: it answers "was
 * this report produced before or after the FIX-1063 producer fixes", so an old
 * report can be marked as unvouchable.
 *
 * WHAT IT IS NOT. **NOT a certification that every figure in the report was
 * observed.** Its scope is exactly the surfaces enumerated below. Widening it
 * back into a blanket "nothing here was fabricated" claim would be the same
 * unfalsifiable over-claim this issue exists to stop.
 *
 * THE SURFACES IT COVERS. The list is what makes the claim checkable, so a
 * reader may trust every line of it. Before adding an entry, go to the surface
 * and confirm no absence can still be published as an observation there; an
 * entry that cannot be verified cheaply is DELISTED, not asserted.
 *   1. the empty-payload builders for an unreachable provider
 *      (`tools/empty-payloads.ts`);
 *   2. the technical indicator math and its trend label
 *      (`tools/indicators-math.ts`);
 *   3. the macro read, including the CPI year-over-year
 *      (`tools/data/get_macro_indicators.ts`);
 *   4. factor ranks and the social-sentiment / reddit payloads
 *      (`tools/data/get_factor_ranks.ts`, `tools/data/get_social_sentiment.ts`);
 *   5. the Yahoo + Finnhub fundamentals fields routed through `observedFinite`
 *      — market cap, price-to-sales, ROE, the margins;
 *   6. the Yahoo + Finnhub daily OHLCV bars, where an incomplete bar is
 *      DROPPED rather than zero-filled — including its DATE leg, since
 *      `new Date(null)` is a valid 1970-01-01; and where a response leaving NO
 *      usable bar throws as provider no-data rather than resolving an empty
 *      series under a live tag;
 *   7. the Finnhub + Alpha Vantage insider transactions (`pricePerShare`,
 *      `shares`) — ABSENCE ONLY, and the qualifier is load-bearing. An omitted
 *      price reads `null` rather than `0`; a row with no share count is
 *      dropped; and on the Alpha Vantage path, which carries no SEC transaction
 *      code, a row with no readable `acquisition_or_disposal` is dropped rather
 *      than reported as a sale. It does NOT say the insider figures are
 *      otherwise sound — Finnhub's `shares` falls back to `share` (a
 *      post-transaction BALANCE) when the signed `change` is missing, an
 *      observed number in the wrong role rather than an absence published as an
 *      observation, and outside this line. Tracked as FIX-1143.
 *
 * Producers outside that list are simply not audited yet — not asserted honest,
 * and not asserted dishonest. The remaining sweep is tracked separately (see
 * FIX-1141); when one lands, extend the list here rather than inflating the
 * claim above it.
 *
 * ABSENT MEANS PRE-FIX, ALWAYS. The one rule here that must not be softened. A
 * missing stamp reads as pre-fix, never post-fix, so a run predating the field,
 * a run that stopped early, and a run whose stamp failed to write all
 * under-claim rather than over-claim. Marking a fabricated report as current is
 * unfixable afterwards, because nothing distinguishes those runs later.
 *
 * BUMPING IT. Raise the version when a NEW data correction lands that a reader
 * of an older report needs to know about, and treat the old value the way this
 * contract treats an absent one. Do NOT bump it for an unrelated pipeline
 * change; the number tracks corrections to the data, not builds.
 */

/**
 * The current data-honesty contract version. Stamped onto every run at seed.
 *
 * A VERSION MARKER, not a quality certificate: it records which round of
 * producer corrections a report was generated under (the surfaces named in the
 * file header), and nothing more.
 */
export const DATA_HONESTY_CONTRACT_VERSION = 1;

/**
 * Whether a stored run predates the data-honesty contract — i.e. whether its
 * figures may contain fabricated zeros and its status fields may assert work
 * that never happened.
 *
 * The single reader for every surface that marks a report, so the Summary, the
 * artifacts bundle, and anything added later cannot drift apart on what counts
 * as pre-fix. Takes `unknown` because it reads a hydrated client snapshot and a
 * persisted session state, neither of which is trustworthy in shape: a legacy
 * record has no such field at all, and a client projection that dropped it
 * surfaces as `undefined`. Anything that is not exactly a recognised contract
 * version is pre-fix.
 *
 * `false` means "not known to predate the corrections", NOT "every figure here
 * was observed". Use it to decide whether to DISCLOSE, never as a licence to
 * present a figure as verified.
 */
export function isPreDataHonestyFix(version: unknown): boolean {
  return version !== DATA_HONESTY_CONTRACT_VERSION;
}
