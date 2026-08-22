/**
 * The desk's ONE period-selection rule (FIX-1113). Pure, IO-free.
 *
 * Every statement figure is read at ONE chosen year-end. This module owns the
 * choosing, the "are these the same period" test, and the "are these two
 * periods adjacent" test, so no consumer re-derives any of them.
 *
 * RULES, by name. The derivation is on the pull request; these are the ones a
 * reader has to hold:
 *
 *  - ANCHOR = the most recent annual period end reported by ANY core figure —
 *    each mapper's own anchor-discovery list (`US_GAAP_ANCHOR_TAGS` in
 *    `edgar-companyfacts.ts`, `ANCHOR_SERIES` in `yahoo-timeseries.ts`). NEVER
 *    the most recent end where the core set is COMPLETE — that walks a messy
 *    filer's whole report back a year rather than reporting the current year
 *    with a gap in it.
 *  - A figure the anchor does not carry is ABSENT. It is never filled from a
 *    neighbouring period, and one absent figure never blanks its statement.
 *  - SAME PERIOD is a bounded distance, NOT a shared calendar year. Calendar
 *    year is wrong in both directions: it merges a January year-end with a
 *    December one (eleven months apart), and it splits a 52/53-week filer's
 *    `2025-12-28` from a source reporting `2026-01-03` (six days apart).
 *  - CONSECUTIVE is one reporting interval within a bounded tolerance, NOT
 *    "the calendar years differ by one". Calendar arithmetic rejects a
 *    legitimate pair straddling December; a loose elapsed-time window readmits
 *    the two-year-change-called-one-year bug this exists to kill. Both
 *    tolerances stay far below the interval so two adjacent years can never
 *    merge and a two-year gap can never read as adjacent.
 *
 * TRAP. Anchor discovery is NOT the recovery ladder's completeness test
 * (`statement-recovery.ts` `lacksAnyCritical`), and the two must not be
 * unified. They answer different questions — *which period ends exist* (wide)
 * versus *is this payload complete enough to stop laddering* (narrow).
 * Reconciling them changes which provider answers, which is a coverage change.
 */

/** Days a duration fact must span to count as annual. */
export const ANNUAL_MIN_DAYS = 350;

/**
 * Two period ends describe the SAME period when they are no further apart than
 * this. Far below the ~365-day gap between two consecutive annual periods, so
 * two adjacent years can never merge; wide enough to absorb the systematic
 * per-provider calendar skew (filings `2025-09-27` vs market data `2025-09-30`)
 * and a 52/53-week year-end crossing the January boundary.
 */
export const SAME_PERIOD_TOLERANCE_DAYS = 31;

/** A full reporting interval, and the slack around it that still reads as one
 *  interval (52-week 364, 53-week 371, leap 366). Far below the ~730 days two
 *  intervals span, so a gap year can never pass as adjacent. */
export const REPORTING_INTERVAL_DAYS = 365;
export const CONSECUTIVE_TOLERANCE_DAYS = 45;

/** Whole days between two `YYYY-MM-DD` ends; `null` if either is unparseable. */
export function daysApart(a: string, b: string): number | null {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return null;
  return Math.abs(ta - tb) / 86_400_000;
}

/**
 * True when two period ends describe the same fiscal period.
 *
 * A bounded distance, never `getFullYear()` equality — see the module rules. A
 * null/empty end is not a period and matches nothing, including another null:
 * "both unknown" is not evidence of agreement.
 */
export function samePeriod(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const d = daysApart(a, b);
  return d != null && d <= SAME_PERIOD_TOLERANCE_DAYS;
}

/**
 * True when three period ends are ALL mutually the same period — every pair,
 * via `samePeriod`, so a `null` never counts as agreement (including two
 * `null`s against each other).
 *
 * WHY A CONSUMER NEEDS THIS SEPARATELY FROM `reason`. `isCoherentStatementSet`
 * returns `settled-for-less-than-seen` on the FIRST statement whose own
 * resolution settled for less than it saw (part a) — before it ever reaches
 * part (b), which is what checks whether the three RETURNED periods agree with
 * each other. So that one reason covers two different shapes: three statements
 * uniformly stale at one shared period, AND a stale statement sitting alongside
 * two others that disagree with it (or are themselves unstated). A renderer
 * that assumes the first shape and prints "these agree" on the second is
 * printing a false statement next to periods that visibly contradict it. Both
 * `formatPeriodMismatch` and `formatValuationSpine` call this before choosing
 * which sentence to print, so the two blocks cannot drift on what "these agree"
 * means.
 */
export function periodsMutuallyAgree(
  a: string | null,
  b: string | null,
  c: string | null,
): boolean {
  return samePeriod(a, b) && samePeriod(b, c) && samePeriod(a, c);
}

/**
 * True when `earlier` is exactly one reporting interval before `later` — the
 * adjacency test every two-period comparison must pass before it publishes a
 * change. A pair two intervals apart is NOT consecutive however its labels
 * read; that is the two-year-growth defect this gate exists to kill.
 */
export function areConsecutive(earlier: string | null, later: string | null): boolean {
  if (!earlier || !later) return false;
  const d = daysApart(earlier, later);
  if (d == null) return false;
  return Math.abs(d - REPORTING_INTERVAL_DAYS) <= CONSECUTIVE_TOLERANCE_DAYS;
}

/**
 * The anchor: the most recent end among `candidates`. `null` when there are
 * none — the caller's "unavailable" path, not an error.
 *
 * Completeness is deliberately NOT required: a period represented by a single
 * figure is still a real period (decision 1).
 */
export function chooseAnchorPeriodEnd(candidates: Iterable<string>): string | null {
  let best: string | null = null;
  let bestT = Number.NEGATIVE_INFINITY;
  for (const c of candidates) {
    if (!c) continue;
    const t = Date.parse(c);
    if (Number.isNaN(t)) continue;
    if (t > bestT) {
      bestT = t;
      best = c;
    }
  }
  return best;
}

/**
 * The anchor and the period immediately before it, or `null` when the two most
 * recent ends are not consecutive (a gap year) or only one exists.
 *
 * The ONE accessor every two-period comparison goes through, so "the last two
 * values available" cannot come back per-consumer under a new name.
 */
export function consecutivePeriodPair(
  ends: Iterable<string>,
): { anchor: string; prior: string } | null {
  const sorted = [...new Set([...ends].filter(Boolean))]
    .filter((e) => !Number.isNaN(Date.parse(e)))
    .sort((a, b) => Date.parse(b) - Date.parse(a));
  if (sorted.length < 2) return null;
  const [anchor, prior] = sorted;
  return areConsecutive(prior, anchor) ? { anchor, prior } : null;
}

// ---------------------------------------------------------------------------
// The statement-set contract (decision 6) — DETECTION, not assembly.
// ---------------------------------------------------------------------------

/**
 * What one statement's provider-ladder resolution saw and what it settled on.
 *
 * `observedNewest` is the newest annual period end among the payloads that
 * resolution ACTUALLY FETCHED — not every payload that exists. A provider the
 * ladder never called is not observed, which is the honest limit of this
 * contract (see `isCoherentStatementSet`).
 */
export type PeriodObservation = {
  observedNewest: string | null;
  returned: string | null;
};

/**
 * One statement as the SET-level check sees it: where its resolution landed,
 * plus whether the payload carries any figures at all.
 *
 * `figureless` is REQUIRED rather than defaulted. The distinction it draws —
 * "no figures, so no claim" versus "real figures at an unknown period" — is
 * invisible in the period alone, and a default would let a caller skip the
 * decision silently, which is the bug this field exists to close.
 */
export type StatementPeriodInput = PeriodObservation & {
  /** True only for a genuinely unavailable statement: no figures returned.
   *  A populated statement is NOT figureless even when it states no period. */
  figureless: boolean;
};

export type StatementSetVerdict = {
  coherent: boolean;
  /** The periods the three statements settled on, for the disclosure. */
  periods: { income: string | null; balance: string | null; cashflow: string | null };
  /** Which half failed, so a reader is not left inferring it. */
  reason: "settled-for-less-than-seen" | "periods-disagree" | "period-unstated" | null;
  /** The FRONTIER — the most recent period ANY resolution saw among the ones
   *  that settled for less than they saw — populated only on
   *  `reason: "settled-for-less-than-seen"`. Taking the max across every
   *  offending statement (not the first one the loop finds) matters: nothing
   *  else in this verdict identifies WHICH statement(s) triggered this reason,
   *  so reporting anything less than the frontier understates how stale the
   *  set actually is whenever a LATER statement in iteration order saw
   *  something newer than an EARLIER one that also triggered. */
  observedNewest?: string | null;
  /** True when part (b) found a genuinely undated-but-figured statement EVEN
   *  THOUGH `periods-disagree` won the reason (a real clash decided first —
   *  see the ordering comment below part (b)). Populated only on
   *  `reason: "periods-disagree"`. Without this, a renderer that asserts
   *  "it would mix fiscal periods" as fact is right about the two that
   *  clashed and silently wrong about a THIRD statement whose period is
   *  merely unknown, not confirmed to clash. */
  anyUndatedWithFigures?: boolean;
};

/**
 * Decide ONCE, over the three statements, AFTER all three have returned.
 *
 * The three resolve in a CONCURRENT fan-out (`define-analyst.ts` `.parallel`),
 * each returning its own winner before any set-level view exists — so this
 * DETECTS an incoherent set and withholds. It does NOT make the anchor-year
 * statement win; that needs a barrier and two-phase re-resolution, and is not
 * this change.
 *
 * THE PREDICATE HAS TWO PARTS AND BOTH ARE REQUIRED:
 *
 *   (a) No statement settled for less than it saw. Per-statement and local, so
 *       it survives the fan-out with no ordering discipline.
 *   (b) The three returned periods are mutually compatible, AND every statement
 *       that carries figures actually states a period. An undated statement is
 *       skipped only when it is figureless — see the comment on (b) below.
 *
 * (b) ALONE IS NOT ENOUGH, and simplifying to it is the live trap: "do the
 * three periods match" passes UNIFORM STALENESS — three statements that all
 * fell back to the same older year agree perfectly. (a) is what catches it,
 * because at least one of those resolutions saw the newer period first.
 *
 * NOT DETECTED, by construction: the ladder returned a complete payload WITHOUT
 * fetching the next provider, so a newer period was never observed. (a) has
 * nothing to compare and (b) is satisfied. That is this contract's documented
 * limit — closing it costs a provider request per statement per run.
 */
/**
 * True when a resolution genuinely settled for LESS than it saw — the core
 * test behind part (a) below, pulled out so the DIRECTION invariant is
 * enforced in exactly one place rather than assumed by every caller.
 *
 * Every render site that reports `observedNewest` says the desk saw a MORE
 * RECENT period than what is shown. `samePeriod` alone cannot promise that —
 * it is a direction-blind DISTANCE check, so `!samePeriod(returned,
 * observedNewest)` is equally true whether `observedNewest` is newer OR
 * older than `returned`. Today `loadStatementWithRecovery` only ever grows
 * `observedNewest` via `newer()` (the max of every payload actually fetched,
 * including the one ultimately returned), so a resolution can never observe
 * something OLDER than what it settled on — but that is an invariant of a
 * DIFFERENT module, not of this one, and nothing here enforced it. If it
 * ever broke upstream, this function is what stops "saw a more recent
 * period (2024-09-28)" from printing above three 2025-09-27 lines: an
 * `observedNewest` that is CONFIRMED older than `returned` no longer counts
 * as settling for less.
 *
 * A `null` `returned` has no direction to violate: a resolution that saw a
 * real period and returned nothing settled for less than it saw regardless
 * of chronology, so that case is unconditional.
 */
function settledForLessThanSeen(returned: string | null, observedNewest: string | null): boolean {
  if (observedNewest == null) return false;
  if (samePeriod(returned, observedNewest)) return false;
  if (returned == null) return true;
  const seen = Date.parse(observedNewest);
  const had = Date.parse(returned);
  if (Number.isNaN(seen) || Number.isNaN(had)) return true;
  return seen > had;
}

export function isCoherentStatementSet(observations: {
  income: StatementPeriodInput;
  balance: StatementPeriodInput;
  cashflow: StatementPeriodInput;
}): StatementSetVerdict {
  const periods = {
    income: observations.income.returned,
    balance: observations.balance.returned,
    cashflow: observations.cashflow.returned,
  };

  // (a) — every resolution that observed a newer period and settled for an
  // older one. Compared with `samePeriod`, not string equality: one
  // resolution can observe `2025-09-27` from the filings source and return
  // `2025-09-30` from market data for the SAME fiscal year, which is
  // agreement, not staleness. `settledForLessThanSeen` also enforces the
  // DIRECTION invariant — see its own comment.
  //
  // THE FRONTIER, NOT THE FIRST MATCH. Every offending statement's
  // `observedNewest` is collected and the MAX is reported — nothing else in
  // the verdict says WHICH statement(s) triggered this, so stopping at the
  // first one (by iteration order income/balance/cashflow) understates
  // staleness whenever a LATER statement saw something even newer.
  const sightings: string[] = [];
  for (const o of [observations.income, observations.balance, observations.cashflow]) {
    if (settledForLessThanSeen(o.returned, o.observedNewest)) {
      sightings.push(o.observedNewest as string);
    }
  }
  if (sightings.length > 0) {
    return {
      coherent: false,
      periods,
      reason: "settled-for-less-than-seen",
      observedNewest: chooseAnchorPeriodEnd(sightings),
    };
  }

  // (b) — mutual compatibility across the three returned periods.
  //
  // AN UNDATED STATEMENT IS ONLY SAFE TO SKIP WHEN IT CARRIES NO FIGURES.
  // The genuinely unavailable path returns no figures and so makes no claim to
  // disagree with. A statement carrying REAL FIGURES but stating no period is
  // the opposite case: it still enters the cross-statement valuations, while
  // its period is unknown — so the set cannot be declared to share one.
  //
  // LEGACY RECORDS ARE EXACTLY THAT CASE, and they are the population this
  // guard exists for. `periodEnd` is `.nullable().default(null)`, so a
  // statement stored before the key existed re-parses with real figures and a
  // null period. Filtering on the period alone made the check UNABLE TO FAIL on
  // them: three legacy statements left the compared list empty, the loop never
  // ran, and the function returned `coherent: true` — declaring a shared fiscal
  // period it had never established.
  const present: string[] = [];
  let undatedWithFigures = false;
  for (const o of [observations.income, observations.balance, observations.cashflow]) {
    const period = o.returned != null && o.returned !== "" ? o.returned : null;
    if (period == null) {
      if (!o.figureless) undatedWithFigures = true;
      continue;
    }
    present.push(period);
  }

  // Outright disagreement is decided FIRST: it is the more specific finding,
  // and it lets the disclosure name the two years that actually clashed.
  // `undatedWithFigures` is carried along even though THIS branch wins on the
  // clash, not on it — a third, undated-but-figured statement is a real,
  // independent risk a renderer must not silently drop just because a louder
  // finding took the `reason` slot.
  for (let i = 0; i < present.length; i++) {
    for (let j = i + 1; j < present.length; j++) {
      if (!samePeriod(present[i], present[j])) {
        return {
          coherent: false,
          periods,
          reason: "periods-disagree",
          anyUndatedWithFigures: undatedWithFigures,
        };
      }
    }
  }

  if (undatedWithFigures) {
    return { coherent: false, periods, reason: "period-unstated" };
  }

  return { coherent: true, periods, reason: null };
}
