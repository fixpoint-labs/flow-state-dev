/**
 * The data-honesty contract stamp (FIX-1063) — a pure browser-safe leaf so the
 * flow, the Summary components, and the artifacts bundle all read one copy.
 *
 * THE CONTRACT. A run stamped with this version was produced by a pipeline in
 * which a figure the desk did not observe is recorded as `null`, never as `0`,
 * and a verdict or status field describes only work that actually happened.
 * Both halves matter. The second is the same fabrication one layer up: a
 * status that says "checked" when only a code path ran turns a provider outage
 * into a completed search that found nothing, which is how a caller ends up
 * treating an absence of evidence as evidence of absence.
 *
 * WHY A STAMP AND NOT A MIGRATION. Reports generated before this landed cannot
 * be repaired. An old record carries nothing that separates a missing zero from
 * a genuinely measured one, so recomputing it would mean guessing which zeros
 * were real — the same dishonesty one layer down, wearing a decimal point. So
 * the guarantee is forward-looking and the report says so on its face: a report
 * without the stamp reads as pre-fix.
 *
 * WHY ABSENT MEANS PRE-FIX, ALWAYS. The default direction is deliberate and is
 * the one rule here that must not be softened. A missing stamp is read as
 * pre-fix, never as post-fix, so a run that predates the field, a run that
 * stopped early, and a run whose stamp failed to write all under-claim rather
 * than over-claim. Certifying a fabricated report as honest is unfixable
 * afterwards, because nothing distinguishes those runs later.
 *
 * BUMPING IT. Raise the version only when the guarantee itself changes, and
 * treat the old value the way this issue treats an absent one — an older
 * contract is not this contract. Do NOT bump it for an unrelated pipeline
 * change; the number is a promise about the data, not a build id.
 */

/** The current data-honesty contract version. Stamped onto every run at seed. */
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
 */
export function isPreDataHonestyFix(version: unknown): boolean {
  return version !== DATA_HONESTY_CONTRACT_VERSION;
}
