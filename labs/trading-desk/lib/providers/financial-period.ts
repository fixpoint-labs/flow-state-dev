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
 *  - ANCHOR = the most recent annual period end reported by ANY core figure
 *    (`ANCHOR_DISCOVERY_FIELDS`). NEVER the most recent end where the core set
 *    is COMPLETE — that walks a messy filer's whole report back a year rather
 *    than reporting the current year with a gap in it.
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
 * TRAP. `ANCHOR_DISCOVERY_FIELDS` is NOT the recovery ladder's completeness
 * test (`statement-recovery.ts` `lacksAnyCritical`), and the two must not be
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

/**
 * The canonical ANCHOR-DISCOVERY set — one representative per category across
 * the three statements. A period end reported by ANY of these is a candidate.
 *
 * Named as a field vocabulary rather than provider tags so both mappers
 * discover the same candidates from their own tag/series names.
 */
export const ANCHOR_DISCOVERY_FIELDS = {
  income: ["revenue", "operatingIncome", "netIncome"],
  cashflow: ["operatingCashFlow", "freeCashFlow"],
  balance: ["totalAssets", "totalEquity", "cashAndEquivalents", "totalDebt"],
} as const;

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

export type StatementSetVerdict = {
  coherent: boolean;
  /** The periods the three statements settled on, for the disclosure. */
  periods: { income: string | null; balance: string | null; cashflow: string | null };
  /** Which half failed, so a reader is not left inferring it. */
  reason: "settled-for-less-than-seen" | "periods-disagree" | null;
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
 *   (b) The three returned periods are mutually compatible.
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
export function isCoherentStatementSet(observations: {
  income: PeriodObservation;
  balance: PeriodObservation;
  cashflow: PeriodObservation;
}): StatementSetVerdict {
  const periods = {
    income: observations.income.returned,
    balance: observations.balance.returned,
    cashflow: observations.cashflow.returned,
  };

  // (a) — a resolution that observed a newer period and settled for an older
  // one. Compared with `samePeriod`, not string equality: one resolution can
  // observe `2025-09-27` from the filings source and return `2025-09-30` from
  // market data for the SAME fiscal year, which is agreement, not staleness.
  for (const o of [observations.income, observations.balance, observations.cashflow]) {
    if (o.observedNewest == null) continue;
    if (!samePeriod(o.returned, o.observedNewest)) {
      return { coherent: false, periods, reason: "settled-for-less-than-seen" };
    }
  }

  // (b) — mutual compatibility across the three returned periods. A statement
  // with no period at all (the unavailable path) carries no claim to disagree
  // with, so it is not compared.
  const present = [periods.income, periods.balance, periods.cashflow].filter(
    (p): p is string => p != null && p !== "",
  );
  for (let i = 0; i < present.length; i++) {
    for (let j = i + 1; j < present.length; j++) {
      if (!samePeriod(present[i], present[j])) {
        return { coherent: false, periods, reason: "periods-disagree" };
      }
    }
  }

  return { coherent: true, periods, reason: null };
}
