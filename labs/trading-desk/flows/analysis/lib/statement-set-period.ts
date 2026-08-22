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
  type PeriodObservation,
  type StatementPeriodInput,
} from "@/lib/providers/financial-period";
import {
  disclosureHasUnknownPeriod,
  disclosurePrintShape,
  type PeriodDisclosure,
} from "./valuation-spine";

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
    // Only meaningful on `periods-disagree`, and only when TRUE — a fixture
    // with no undated statement stays byte-identical to every pre-existing
    // disclosure literal.
    ...(verdict.reason === "periods-disagree" && verdict.anyUndatedWithFigures
      ? { anyUndatedWithFigures: true }
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
  // REACHABLE STATE OF THE SHAPE — not just the state a bare `reason` name
  // suggests. `disclosurePrintShape` (`valuation-spine.ts`) is the ONE place
  // that "do these three periods actually agree" gets computed; this
  // function and `withheldReasonLine` both read it rather than re-deriving
  // it themselves — see the classifier's own comment for why `reason` alone
  // cannot answer that question.
  const shape = disclosurePrintShape(disclosure);
  const seen = disclosure.observedNewest ?? "a newer period";

  let lead: string;
  let justification: string[];

  switch (shape) {
    case "unstated":
      lead =
        "The desk CANNOT ESTABLISH that the three financial statements below describe the same fiscal period — at least one carries figures but states no period:";
      justification = [
        "Do NOT compute any ratio that divides a figure from one of these statements",
        "by a figure from another — because at least one statement's period is",
        "unknown, such a ratio COULD combine two different fiscal periods with",
        "nobody able to tell. Figures WITHIN a single statement are unaffected.",
        "The desk has already withheld its own cross-statement figures for this",
        "reason; say so rather than filling the gap.",
      ];
      break;

    case "uniform-stale":
      lead = `The three financial statements below agree on a fiscal period, but the desk saw a more recent one (${seen}) and settled for this older one instead — the set is STALE, not in disagreement:`;
      justification = [
        "Do NOT compute any ratio that divides a figure from one of these statements",
        "by a figure from another — every one of them is drawn from the STALE period,",
        "not the newer one the desk saw, so the ratio would present a superseded",
        "figure as current. The desk has already withheld its own cross-statement",
        "figures for this reason; say so rather than filling the gap.",
      ];
      break;

    case "divergent-stale":
      // ABSENT-vs-STALE: a PM told "stale" re-pulls a number; told "missing"
      // waits for a filing — see `disclosureHasUnknownPeriod`'s own comment.
      if (disclosureHasUnknownPeriod(disclosure)) {
        lead = `At least one of the three financial statements below did not return a period at all, even though the desk's own resolution observed one (${seen}) while resolving it — that statement may be MISSING data rather than merely stale. These periods are NOT confirmed to all describe one shared fiscal period:`;
        justification = [
          "Do NOT compute any ratio that divides a figure from one of these statements",
          "by a figure from another — at least one of them did not return a period at",
          "all, which may mean it is missing rather than merely outdated, and the three",
          "are not confirmed to all describe one shared fiscal period. The desk has",
          "already withheld its own cross-statement figures for this reason; say so",
          "rather than filling the gap.",
        ];
      } else {
        lead = `At least one of the three financial statements below is STALE: the desk saw a more recent period (${seen}) while resolving it than it actually returned. These periods are NOT confirmed to all describe one shared fiscal period:`;
        justification = [
          "Do NOT compute any ratio that divides a figure from one of these statements",
          "by a figure from another — at least one of them is stale relative to what",
          "the desk actually saw, and the three are not confirmed to all describe one",
          "shared fiscal period. The desk has already withheld its own cross-statement",
          "figures for this reason; say so rather than filling the gap.",
        ];
      }
      break;

    case "disagree":
      // A real, confirmed clash between at least two of the three returned
      // periods — UNLESS a third, undated-but-figured statement rides along
      // with that clash, in which case its own period is merely unknown, not
      // confirmed to conflict (`isCoherentStatementSet` returns this shape
      // ahead of `unstated` because the clash is the more specific finding,
      // but that ordering must not erase the third statement's own unknown
      // period).
      if (disclosure.anyUndatedWithFigures) {
        lead = "The three financial statements below do NOT describe the same fiscal period:";
        justification = [
          "Do NOT compute any ratio that divides a figure from one of these statements",
          "by a figure from another. At least two of them are CONFIRMED to describe",
          "different fiscal periods. At least one other statement carries figures but",
          "states no period, so a ratio involving it COULD combine two different fiscal",
          "periods with nobody able to tell. The desk has already withheld its own",
          "cross-statement figures for this reason; say so rather than filling the gap.",
        ];
      } else {
        lead = "The three financial statements below do NOT describe the same fiscal period:";
        justification = [
          "Do NOT compute any ratio that divides a figure from one of these statements",
          "by a figure from another — it would mix fiscal periods. Figures WITHIN a",
          "single statement are fine. The desk has already withheld its own",
          "cross-statement figures for this reason; say so rather than filling the gap.",
        ];
      }
      break;
  }

  // NO hand-rolled tag here. This string is handed to the generator's
  // object-form context under the `periodMismatch` key, which the runtime
  // wraps in its own `<period-mismatch>` tag (`aggregateContextEntries` +
  // `renderTaggedContext`, `packages/core`) AND escapes as a string leaf
  // (`<`/`>`/`&`) — a `<periodMismatch>` written here would render as inert,
  // escaped text (`&lt;periodMismatch&gt;`) beside the real, unescaped
  // `<period-mismatch>` tag the renderer emits. Confirmed by rendering, not
  // by reasoning: see the fixture round that found this.
  return [
    lead,
    `  income statement: ${disclosure.income ?? "no period stated"}`,
    `  balance sheet:    ${disclosure.balance ?? "no period stated"}`,
    `  cash flow:        ${disclosure.cashflow ?? "no period stated"}`,
    ...justification,
  ].join("\n");
}
