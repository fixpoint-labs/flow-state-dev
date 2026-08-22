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

function observationFor(
  payload: PeriodBearing,
  recorded: PeriodObservation | undefined,
): PeriodObservation {
  return {
    observedNewest: recorded?.observedNewest ?? null,
    returned: recorded?.returned ?? declared(payload),
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
  };
}

/**
 * The same verdict from the fundamentals analyst's own tool payloads, which
 * arrive as generator input and never touch the spine resource.
 *
 * No observations are available at this site — the analyst holds the payloads,
 * not the ladder's trail — so only part (b) of the predicate can fire here.
 * That is a real asymmetry and it is why the spine check is not redundant: the
 * analyst catches outright disagreement, the spine additionally catches uniform
 * staleness.
 */
export function analystStatementDisclosure(payloads: {
  incomeStatement: PeriodBearing;
  balanceSheet: PeriodBearing;
  cashflow: PeriodBearing;
}): PeriodDisclosure | null {
  return statementSetDisclosure({
    incomeStatement: payloads.incomeStatement as FinancialsDataState["incomeStatement"],
    balanceSheet: payloads.balanceSheet as FinancialsDataState["balanceSheet"],
    cashflow: payloads.cashflow as FinancialsDataState["cashflow"],
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
  return [
    "<periodMismatch>",
    "The three financial statements below do NOT describe the same fiscal period:",
    `  income statement: ${disclosure.income ?? "no period stated"}`,
    `  balance sheet:    ${disclosure.balance ?? "no period stated"}`,
    `  cash flow:        ${disclosure.cashflow ?? "no period stated"}`,
    "Do NOT compute any ratio that divides a figure from one of these statements",
    "by a figure from another — it would mix fiscal periods. Figures WITHIN a",
    "single statement are fine. The desk has already withheld its own",
    "cross-statement figures for this reason; say so rather than filling the gap.",
    "</periodMismatch>",
  ].join("\n");
}
