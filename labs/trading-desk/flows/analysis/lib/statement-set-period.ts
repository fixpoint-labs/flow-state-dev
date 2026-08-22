/**
 * The ONE adapter from a statement set to a period verdict (FIX-1113).
 *
 * `isCoherentStatementSet` (`lib/providers/financial-period.ts`) owns the rule;
 * this owns turning the two shapes the desk actually holds — the persisted
 * `financialsData` spine, and the fundamentals analyst's raw tool payloads —
 * into its input. Both consumer sites call this, so they cannot drift on what
 * "the statements disagree" means.
 *
 * WHY IT LIVES HERE RATHER THAN AT EITHER CONSUMER. There are two valuation
 * sites and they are not in a line: the fundamentals analyst computes and
 * publishes its own valuation from its own tool payloads BEFORE the spine is
 * written, so it is not downstream of the spine and cannot be made downstream
 * without re-ordering the pipeline. A guard on stored state does not cover a
 * consumer that computes its own copy earlier.
 *
 * THE OBSERVATIONS ARE OPTIONAL AND THEIR ABSENCE IS MEANINGFUL. A statement
 * that never ran the live ladder (fixture replay — the DEFAULT analysis path —
 * or a peer probe) has no observation, which reads as "observed nothing" and
 * cannot trip part (a). That is correct rather than lenient: nothing was
 * fetched, so nothing was passed over.
 */
import type { FinancialsDataState } from "../financials-data-resource";
import {
  isCoherentStatementSet,
  periodsMutuallyAgree,
  type PeriodObservation,
  type StatementPeriodInput,
} from "@/lib/providers/financial-period";
import type { PeriodDisclosure } from "./valuation-spine";

/** The minimum a statement payload has to expose to be placed at a period. */
type PeriodBearing = { periodEnd?: string | null } | null | undefined;

/** A statement's declared period. Reads `periodEnd`, NEVER `asOf` — `asOf`
 *  still carries a request-date fallback, so using it here would manufacture
 *  agreement out of two statements that both failed to state a period. */
function declared(payload: PeriodBearing): string | null {
  const end = payload?.periodEnd;
  return typeof end === "string" && end !== "" ? end : null;
}

/**
 * Keys every statement payload carries whether or not the provider returned any
 * figures. Everything else on the object is a figure.
 *
 * Listed as METADATA rather than listing the figures, because the three
 * statements have different figure names and this adapter is generic over all
 * three. The failure direction is deliberate: a future metadata key that is
 * NUMERIC and unlisted would read as a figure, making an empty statement look
 * populated — which withholds. Wrong in the safe direction. Listing figures
 * instead would fail the other way, silently skipping a statement whose new
 * figure key nobody added.
 */
const STATEMENT_METADATA_KEYS = new Set(["source", "ticker", "asOf", "periodEnd", "unit"]);

/**
 * True when the payload carries no figures at all — the genuinely unavailable
 * statement, which is the ONLY undated statement safe to leave out of the
 * mutual-compatibility check.
 *
 * A statement with real figures and a null `periodEnd` (a record stored before
 * `periodEnd` existed) is NOT figureless, and must not be treated as one.
 */
function figureless(payload: PeriodBearing): boolean {
  if (payload == null || typeof payload !== "object") return true;
  return !Object.entries(payload).some(
    ([key, value]) =>
      !STATEMENT_METADATA_KEYS.has(key) && typeof value === "number" && Number.isFinite(value),
  );
}

function observationFor(
  payload: PeriodBearing,
  recorded: PeriodObservation | undefined,
): StatementPeriodInput {
  return {
    observedNewest: recorded?.observedNewest ?? null,
    returned: recorded?.returned ?? declared(payload),
    figureless: figureless(payload),
  };
}

/**
 * The period verdict for a statement set, as the disclosure the spine carries.
 * `null` means coherent — compute normally.
 *
 * Returns `null` when a statement is missing entirely: there is no
 * cross-statement figure to withhold, and the envelope is already absent for
 * the ordinary reason. Withholding on top of that would attribute a
 * period mismatch to a run that simply had no data.
 */
export function statementSetDisclosure(
  fin: Pick<
    FinancialsDataState,
    | "incomeStatement"
    | "balanceSheet"
    | "cashflow"
    | "incomeStatementPeriodObservation"
    | "balanceSheetPeriodObservation"
    | "cashflowPeriodObservation"
  >,
): PeriodDisclosure | null {
  if (!fin.incomeStatement || !fin.balanceSheet || !fin.cashflow) return null;

  const verdict = isCoherentStatementSet({
    income: observationFor(fin.incomeStatement, fin.incomeStatementPeriodObservation),
    balance: observationFor(fin.balanceSheet, fin.balanceSheetPeriodObservation),
    cashflow: observationFor(fin.cashflow, fin.cashflowPeriodObservation),
  });

  if (verdict.coherent || verdict.reason == null) return null;
  return {
    reason: verdict.reason,
    income: verdict.periods.income,
    balance: verdict.periods.balance,
    cashflow: verdict.periods.cashflow,
    // Only meaningful on `settled-for-less-than-seen` — omitted (rather than
    // `null`) on the other two reasons so a disclosure literal built without it
    // (every pre-existing caller) still matches exactly.
    ...(verdict.reason === "settled-for-less-than-seen"
      ? { observedNewest: verdict.observedNewest ?? null }
      : {}),
  };
}

/**
 * The same verdict from the fundamentals analyst's own tool payloads, which
 * arrive as generator input and never touch the spine resource directly.
 *
 * OBSERVATIONS ARE REACHABLE HERE, and passing them is what makes part (a) of
 * the predicate fire at this site too. The statement-recovery runtime writes
 * each `*PeriodObservation` field onto the SAME session-scoped `financialsData`
 * resource the spine reads, and the analyst's tool fan-out (`.parallel`, in
 * `define-analyst.ts`) is awaited before its generator step runs — so by the
 * time this fires, `ctx.resources.financialsData.state` already carries
 * whatever the ladder saw. The optional second argument is how a caller
 * threads that through; the fundamentals generator's context slot passes it
 * from `ctx.resources.financialsData?.state`.
 *
 * Omit it — fixture mode never runs the live ladder, and a peer/benchmark
 * probe never writes to the subject's resource — and this degrades to exactly
 * today's behaviour: only part (b) can fire, an absent observation reads as
 * "observed nothing" rather than as staleness. That degrade is deliberate,
 * not a gap: it is `observationFor`'s `recorded?.observedNewest ?? null`, the
 * same fallback the spine site relies on.
 */
export function analystStatementDisclosure(
  payloads: {
    incomeStatement: PeriodBearing;
    balanceSheet: PeriodBearing;
    cashflow: PeriodBearing;
  },
  observations?: {
    incomeStatement?: PeriodObservation;
    balanceSheet?: PeriodObservation;
    cashflow?: PeriodObservation;
  },
): PeriodDisclosure | null {
  return statementSetDisclosure({
    incomeStatement: payloads.incomeStatement as FinancialsDataState["incomeStatement"],
    balanceSheet: payloads.balanceSheet as FinancialsDataState["balanceSheet"],
    cashflow: payloads.cashflow as FinancialsDataState["cashflow"],
    incomeStatementPeriodObservation: observations?.incomeStatement,
    balanceSheetPeriodObservation: observations?.balanceSheet,
    cashflowPeriodObservation: observations?.cashflow,
  });
}

/**
 * The sentence the analyst's context carries when the periods disagree, and the
 * instruction not to combine across them.
 *
 * ADVISORY, and the only surface here that is. The mappers and the spine either
 * withhold a figure or they do not, and a test can prove which. This one is
 * reachable only by telling a model the periods and telling it not to combine
 * them — a model can ignore an instruction, so a memo can still carry a ratio
 * the spine withheld. Assert what the analyst was TOLD; never assert what it
 * concluded.
 */
export function formatPeriodMismatch(disclosure: PeriodDisclosure | null): string {
  if (disclosure == null) return "";

  // EVERY SENTENCE BELOW MUST BE TRUE OF THE PRINTED PERIODS, FOR EVERY
  // REACHABLE STATE OF THE REASON — not just the state the reason is named
  // after. `settled-for-less-than-seen` is the one that bites: `isCoherent-
  // StatementSet` returns it on the FIRST statement whose own resolution
  // settled for less than it saw (part a), before part (b) ever checks
  // whether the three RETURNED periods agree with each other. So this reason
  // covers two different printed shapes — uniform staleness (all three
  // genuinely agree) AND a stale statement sitting alongside peers that
  // disagree with it, or that are themselves unstated (`null`) — and "these
  // agree" is only true on the first. `periodsMutuallyAgree` (imported, not
  // reimplemented here) is what tells the two apart; do not assume agreement
  // from the reason name.
  const settledAllAgree =
    disclosure.reason === "settled-for-less-than-seen" &&
    periodsMutuallyAgree(disclosure.income, disclosure.balance, disclosure.cashflow);
  const seen = disclosure.observedNewest ?? "a newer period";

  const lead =
    disclosure.reason === "period-unstated"
      ? "The desk CANNOT ESTABLISH that the three financial statements below describe the same fiscal period — at least one carries figures but states no period:"
      : disclosure.reason === "settled-for-less-than-seen"
        ? settledAllAgree
          ? `The three financial statements below agree on a fiscal period, but the desk saw a more recent one (${seen}) and settled for this older one instead — the set is STALE, not in disagreement:`
          : `At least one of the three financial statements below is STALE: the desk saw a more recent period (${seen}) while resolving it than it actually returned. These periods are NOT confirmed to all describe one shared fiscal period:`
        : "The three financial statements below do NOT describe the same fiscal period:";

  // THE JUSTIFICATION TRACKS THE SAME THING THE LEAD DOES. "It would mix
  // fiscal periods" is a claim of KNOWN disagreement — true on
  // `periods-disagree`, false on `settled-for-less-than-seen` when the three
  // agree (nothing is mixed; every figure is simply the SAME stale period),
  // and overclaimed on `period-unstated`, where mixing is merely POSSIBLE —
  // the desk does not know, it never established a period to compare.
  const justification =
    disclosure.reason === "period-unstated"
      ? [
          "Do NOT compute any ratio that divides a figure from one of these statements",
          "by a figure from another — because at least one statement's period is",
          "unknown, such a ratio COULD combine two different fiscal periods with",
          "nobody able to tell. Figures WITHIN a single statement are unaffected.",
          "The desk has already withheld its own cross-statement figures for this",
          "reason; say so rather than filling the gap.",
        ]
      : disclosure.reason === "settled-for-less-than-seen"
        ? settledAllAgree
          ? [
              "Do NOT compute any ratio that divides a figure from one of these statements",
              "by a figure from another — every one of them is drawn from the STALE period,",
              "not the newer one the desk saw, so the ratio would present a superseded",
              "figure as current. The desk has already withheld its own cross-statement",
              "figures for this reason; say so rather than filling the gap.",
            ]
          : [
              "Do NOT compute any ratio that divides a figure from one of these statements",
              "by a figure from another — at least one of them is stale relative to what",
              "the desk actually saw, and the three are not confirmed to all describe one",
              "shared fiscal period. The desk has already withheld its own cross-statement",
              "figures for this reason; say so rather than filling the gap.",
            ]
        : [
            // `periods-disagree` only: a real, confirmed clash between at least
            // two of the three returned periods (see `isCoherentStatementSet`
            // part b) — "mix fiscal periods" and the within/across split are
            // both true claims here, unlike the two branches above.
            "Do NOT compute any ratio that divides a figure from one of these statements",
            "by a figure from another — it would mix fiscal periods. Figures WITHIN a",
            "single statement are fine. The desk has already withheld its own",
            "cross-statement figures for this reason; say so rather than filling the gap.",
          ];

  return [
    "<periodMismatch>",
    lead,
    `  income statement: ${disclosure.income ?? "no period stated"}`,
    `  balance sheet:    ${disclosure.balance ?? "no period stated"}`,
    `  cash flow:        ${disclosure.cashflow ?? "no period stated"}`,
    ...justification,
    "</periodMismatch>",
  ].join("\n");
}
