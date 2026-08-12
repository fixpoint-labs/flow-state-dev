/**
 * The data-honesty contract stamp (FIX-1063) — a pure browser-safe leaf so the
 * flow, the Summary components, and the artifacts bundle all read one copy.
 *
 * WHAT THE STAMP IS. A **version marker for legacy-report detection**. Its one
 * job is to answer "was this report produced before or after the FIX-1063
 * producer fixes", so an old report can be marked as unvouchable. That is all
 * it is for, and the narrowness is deliberate — see the next paragraph.
 *
 * WHAT IT IS NOT. It is **NOT a certification that every figure in the report
 * was observed.** No stamp can be. The desk reads dozens of provider fields
 * across a dozen adapters, and "no figure anywhere was fabricated" is a claim
 * about all of them at once — unfalsifiable in exactly the way this issue
 * exists to stop. The first draft of this file did make that blanket claim, and
 * review found it false three times running, in three different producer sets
 * (the empty-payload builders, then the OHLCV chart adapters, then the insider
 * adapters). Each fix was correct and each was followed by another, which is
 * the tell that the promise, not the code, was wrong: a guarantee that needs a
 * new fix every round is a guarantee nobody can hold. Do not re-widen it.
 *
 * A LIST IS A PROMISE, ENTRY BY ENTRY. The narrowing below was written from
 * what had been corrected rather than verified line by line, and review then
 * found one of the seven false — the Alpha Vantage insider `shares` entry,
 * whose direction flag was still defaulted rather than measured. That is worse
 * than the blanket claim it replaced: the list is what makes the promise
 * checkable, so a reader has explicit permission to trust every line of it.
 * Before adding an entry here, go to the surface and confirm no absence can
 * still be published as an observation on that path. An entry that cannot be
 * verified cheaply is DELISTED, not asserted.
 *
 * THE SURFACES IT DOES COVER, named so the claim is checkable:
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
 *      `new Date(null)` is a valid 1970-01-01 and once dated a bar to the
 *      epoch; and where a response leaving NO usable bar throws as provider
 *      no-data rather than resolving an empty series under a live tag;
 *   7. the Finnhub + Alpha Vantage insider transactions (`pricePerShare`,
 *      `shares`) — on the Alpha Vantage path this covers the SIGN as well as
 *      the magnitude, because that adapter carries no SEC transaction code, so
 *      a row with no readable `acquisition_or_disposal` is dropped rather than
 *      reported as a sale.
 *
 * Producers outside that list are simply not audited yet — not asserted honest,
 * and not asserted dishonest. The remaining sweep is tracked separately (see
 * FIX-1141); when one lands, extend the list here rather than inflating the
 * claim above it.
 *
 * WHY A STAMP AND NOT A MIGRATION. Reports generated before this landed cannot
 * be repaired. An old record carries nothing that separates a missing zero from
 * a genuinely measured one, so recomputing it would mean guessing which zeros
 * were real — the same dishonesty one layer down, wearing a decimal point. So
 * the marker is forward-looking and the report says so on its face: a report
 * without the stamp reads as pre-fix.
 *
 * WHY ABSENT MEANS PRE-FIX, ALWAYS. The default direction is deliberate and is
 * the one rule here that must not be softened. A missing stamp is read as
 * pre-fix, never as post-fix, so a run that predates the field, a run that
 * stopped early, and a run whose stamp failed to write all under-claim rather
 * than over-claim. Marking a fabricated report as current is unfixable
 * afterwards, because nothing distinguishes those runs later.
 *
 * BUMPING IT. Raise the version when a NEW correction lands that a reader of an
 * older report needs to know about, and treat the old value the way this issue
 * treats an absent one — an older marker is not this marker. Do NOT bump it for
 * an unrelated pipeline change; the number tracks corrections to the data, not
 * builds.
 */

/**
 * The current data-honesty contract version. Stamped onto every run at seed.
 *
 * Read this as a VERSION MARKER, not a quality certificate: it records which
 * round of producer corrections a report was generated under (the seven
 * surfaces named in the file header above), and nothing more. It does not
 * assert that every figure in the report was observed, and no code should be
 * written as though it does.
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
 * present a figure as verified — the marker's whole scope is the seven surfaces
 * named in the file header.
 */
export function isPreDataHonestyFix(version: unknown): boolean {
  return version !== DATA_HONESTY_CONTRACT_VERSION;
}
