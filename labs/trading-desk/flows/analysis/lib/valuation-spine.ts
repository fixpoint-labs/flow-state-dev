/**
 * Valuation spine orchestrator — assembles the full spine from raw payloads
 * and exposes prompt formatters for capability injection.
 *
 * PERIOD COHERENCE IS AN INPUT CONTRACT, NOT A COMPUTATION (FIX-1113). When the
 * three statements cannot be placed at one period, every output that reads more
 * than one of them is withheld — the expected return, and therefore fair value,
 * the DCF, triangulation, the setup score and the RATING ENVELOPE, all of which
 * descend from it.
 *
 * WHY THE CHECK IS ON THE INPUTS AND NOT INSIDE `valuation.ts`. The expected
 * return takes all three statements, is computed FIRST, and does NOT pass
 * through `computeValuation` — so a guard placed there would withhold a multiple
 * and still publish a rating built on mixed periods. `valuation.ts` is not the
 * chokepoint for valuation; any future guard belonging to a SET OF INPUTS
 * (currency, staleness, restatement provenance) goes on the inputs for the same
 * reason.
 *
 * WITHHOLDING THE ENVELOPE IS FAIL-OPEN, AND THAT IS THE TRAP HERE. The envelope
 * only CLAMPS a rating the portfolio manager emits on its own as a required
 * field (`agents/portfolio-manager/writer.ts` — the clamp sits inside
 * `if (spine?.envelope)`). Withholding it removes the BOUND, not the rating: the
 * model's value publishes unconstrained. So "withhold more" is not automatically
 * "safer" — for this one output, absence is permission. `periodDisclosure` is
 * what carries the honesty instead, and the published rating is marked
 * unanchored from it. Check what the ABSENCE of a thing causes before withholding
 * it.
 *
 * AND THIS PARAGRAPH IS NOT THE MECHANISM. It named the trap and the call site
 * one directory over fell into a variant of it anyway: `capability.ts` guarded
 * the spine but not the envelope, so the withheld path threw a TypeError inside
 * `formatRatingEnvelope` instead of degrading — killing the very rating this
 * design exists to keep publishing. What actually holds the contract is
 * `test/valuation-spine-capability.spec.ts`, which runs the SHIPPED capability
 * preset against a withheld spine. Add a consumer of `envelope`, add an arm
 * there; do not rely on a reader having read this.
 */
import { z } from "zod";
import type {
  balanceSheetSchema,
  cashflowSchema,
  fundamentalsSchema,
  incomeStatementSchema,
} from "../tools/schemas";
import { periodsMutuallyAgree } from "@/lib/providers/financial-period";
import { computeExpectedReturn, type ExpectedReturn } from "./expected-return";
import { computeFairValue, isFinancialSector, type FairValue } from "./fair-value";
import { computeDcfValue, type DcfValue } from "./dcf";
import { computeTriangulation, type Triangulation } from "./triangulation";
import { computeSetupScore, type SetupScore } from "./setup-score";
import { modelImpliedRating, type RatingEnvelope } from "./rating-engine";
import type { DerivedValuation } from "./valuation";

type Fundamentals = z.infer<typeof fundamentalsSchema>;
type BalanceSheet = z.infer<typeof balanceSheetSchema>;
type IncomeStatement = z.infer<typeof incomeStatementSchema>;
type Cashflow = z.infer<typeof cashflowSchema>;

/**
 * Why the desk could not place the three statements at one period, and where
 * each of them landed — the disclosure the report carries and the marker the
 * run records. Null when the set IS coherent (the ordinary case).
 *
 * HAND-WRITTEN, NOT `z.infer<typeof periodDisclosureSchema>` (below), and
 * that was evaluated deliberately, not assumed (review round 5). The two
 * shapes are NOT the same: `observedNewest` and `anyUndatedWithFigures` are
 * OPTIONAL here — `statementSetDisclosure` omits the key entirely on a
 * reason that doesn't populate it, which is what lets a test assert
 * `not.toHaveProperty` / an exact `toEqual` without the field. The schema's
 * `.default(...)` fields are NEVER absent on `z.infer`'s output — parsing
 * fills them in, so deriving the type would force every disclosure to
 * always carry both keys (as `null`/`false`) and would change every
 * consumer and test that currently relies on the key being absent. If a
 * later change makes that trade-off worth it, make it deliberately; don't
 * let it happen as a side effect of chasing the schema.
 */
export type PeriodDisclosure = {
  reason: "settled-for-less-than-seen" | "periods-disagree" | "period-unstated";
  income: string | null;
  balance: string | null;
  cashflow: string | null;
  /** The newer period a resolution saw before settling for an older one.
   *  Populated only on `reason: "settled-for-less-than-seen"` — see
   *  `StatementSetVerdict.observedNewest`. */
  observedNewest?: string | null;
  /** True when a THIRD statement carries figures but states no period, even
   *  though a real clash between the other two won the `reason` slot.
   *  Populated only on `reason: "periods-disagree"` — see
   *  `StatementSetVerdict.anyUndatedWithFigures`. */
  anyUndatedWithFigures?: boolean;
};

/**
 * The ONE persisted shape of `PeriodDisclosure` — imported by all three
 * places that store one (`valuation-spine-resource.ts`, `resources.ts`'s PM
 * memo, `decision-snapshot-resource.ts`) instead of each hand-copying the
 * same five fields. They were byte-identical before this (FIX-1113 review);
 * a field added to `PeriodDisclosure` above and forgotten in a copy is
 * exactly the defect that shipped twice — `observedNewest`, then
 * `anyUndatedWithFigures` one commit later. A single export cannot fix
 * "forgotten here too" the next time a field is added, only "forgotten in
 * two of the three instead of one" — see this file's `PeriodDisclosure`
 * doc comment for why the type itself is not derived from this schema.
 *
 * Each consumer keeps its OWN wrapper (`.nullable().default(null)` at the
 * use site) — this schema is the inner shape only, not how a caller embeds
 * it as nullable state.
 */
export const periodDisclosureSchema = z.object({
  reason: z.enum(["settled-for-less-than-seen", "periods-disagree", "period-unstated"]),
  income: z.string().nullable(),
  balance: z.string().nullable(),
  cashflow: z.string().nullable(),
  // Only meaningful on `settled-for-less-than-seen` — see
  // `PeriodDisclosure.observedNewest` above. Nullable + defaulted so a record
  // persisted before this field existed still parses.
  observedNewest: z.string().nullable().default(null),
  // Only meaningful on `periods-disagree` — see
  // `PeriodDisclosure.anyUndatedWithFigures` above. A record persisted before
  // this field existed never recorded an undated third statement, and every
  // consumer branches on this being truthy to decide whether to hedge — so
  // absent must read as `false`, not as "unknown."
  anyUndatedWithFigures: z.boolean().default(false),
});

/**
 * The four ways a disclosure can look ON THE PAGE — computed once, here, and
 * read by every surface that renders one (`formatPeriodMismatch`,
 * `withheldReasonLine`, and the fundamentals analyst's prompt, which defers
 * to whichever of these fired rather than asserting anything itself).
 *
 * WHY THIS EXISTS. `reason` tells you WHETHER `isCoherentStatementSet` found
 * a problem — it is what the predicate actually failed on — but it does NOT
 * tell you what the three PRINTED periods look like. `settled-for-less-than-
 * seen` fires on the FIRST statement whose own resolution settled for less
 * than it saw (part a), before anyone checks whether the three RETURNED
 * periods agree with each other (part b) — so that one reason alone covers
 * BOTH a printed shape where the periods genuinely agree (uniform staleness)
 * and one where they do not (a stale statement diverging from its peers, an
 * outright three-way clash, or a peer that returned no period at all). Three
 * defects on this file were three different surfaces re-deriving "do these
 * agree" themselves and getting it wrong in three different ways — this
 * function is the one place that computation happens now.
 */
export type DisclosurePrintShape = "uniform-stale" | "divergent-stale" | "disagree" | "unstated";

export function disclosurePrintShape(disclosure: PeriodDisclosure): DisclosurePrintShape {
  if (disclosure.reason === "period-unstated") return "unstated";
  if (disclosure.reason === "periods-disagree") return "disagree";
  // `reason === "settled-for-less-than-seen"` — the one case `reason` alone
  // cannot resolve. `periodsMutuallyAgree` is the SAME check `isCoherent-
  // StatementSet` itself would run in part (b), applied to the periods as
  // actually printed.
  return periodsMutuallyAgree(disclosure.income, disclosure.balance, disclosure.cashflow)
    ? "uniform-stale"
    : "divergent-stale";
}

/**
 * True when at least one of the three PRINTED periods is unknown (`null`) —
 * either a genuinely ABSENT statement (no figures at all — e.g.
 * `statement-recovery.ts`'s `bestPartial() ?? empty()` path, which can still
 * have observed a real period before settling on nothing) or a populated
 * legacy record whose period was never stated. Both mean the same thing for
 * a renderer: there is no confirmed period to point to, so the statement
 * must not be called "stale" (a stale statement HAS a period, just an old
 * one). Read by every `"divergent-stale"` sentence so the ABSENT-vs-STALE
 * distinction cannot drift between surfaces either.
 */
export function disclosureHasUnknownPeriod(disclosure: PeriodDisclosure): boolean {
  return disclosure.income == null || disclosure.balance == null || disclosure.cashflow == null;
}

export interface ValuationSpine {
  ticker: string;
  asOf: string;
  /** Nullable from FIX-1113: withheld when the statements do not share a
   *  period. Every field below it descends from this one. */
  expectedReturn: ExpectedReturn | null;
  fairValue: FairValue | null;
  dcf: DcfValue | null;
  triangulation: Triangulation | null;
  setupScore: SetupScore | null;
  envelope: RatingEnvelope | null;
  valuationMethod: "ev-multiples" | "equity-multiples";
  evidenceBasis: "sufficient" | "thin";
  /** Non-null exactly when the cross-statement outputs above were withheld. */
  periodDisclosure: PeriodDisclosure | null;
}

export function buildValuationSpine(args: {
  ticker: string;
  asOf: string;
  fundamentals: Fundamentals;
  balanceSheet: BalanceSheet;
  incomeStatement: IncomeStatement;
  cashflow: Cashflow;
  sector: string | null;
  quantComposites: { piotroskiF?: number; altmanZone?: string } | null;
  factorRanks: { compositeFactorPercentile?: number } | null;
  // Nullable per field: a short history yields a real `sma50` with no `sma200`
  // and no `trend` (FIX-1063). Passed straight to `computeSetupScore`, which
  // treats a missing reading as no momentum component rather than a neutral
  // one — keep the two signatures in step.
  technicals: {
    trend?: string | null;
    sma50?: number | null;
    sma200?: number | null;
  } | null;
  valuation: DerivedValuation | null;
  /** Null when the statements share a period (the ordinary case). Non-null
   *  withholds every cross-statement output — see the file header. */
  periodDisclosure?: PeriodDisclosure | null;
}): ValuationSpine {
  const periodDisclosure = args.periodDisclosure ?? null;
  if (periodDisclosure != null) {
    // Withhold, and report the evidence as THIN. Leaving it `sufficient` while
    // the outputs it summarises were never computed is the same
    // signal-without-substance defect the honesty contract exists to stop — and
    // `thin` is what the always-on evidence gate reads to cap new exposure.
    return {
      ticker: args.ticker,
      asOf: args.asOf,
      expectedReturn: null,
      fairValue: null,
      dcf: null,
      triangulation: null,
      setupScore: null,
      envelope: null,
      valuationMethod: isFinancialSector(args.sector)
        ? "equity-multiples"
        : "ev-multiples",
      evidenceBasis: "thin",
      periodDisclosure,
    };
  }

  const er = computeExpectedReturn({
    fundamentals: args.fundamentals,
    incomeStatement: args.incomeStatement,
    cashflow: args.cashflow,
    balanceSheet: args.balanceSheet,
  });

  const fv = computeFairValue({
    fundamentals: args.fundamentals,
    incomeStatement: args.incomeStatement,
    expectedReturn: er,
    sector: args.sector,
  });

  const dcf = computeDcfValue({
    fundamentals: args.fundamentals,
    incomeStatement: args.incomeStatement,
    cashflow: args.cashflow,
    expectedReturn: er,
    valuation: args.valuation,
    sector: args.sector,
  });

  const triangulation = computeTriangulation({ fairValue: fv, dcf });

  const ss = computeSetupScore({
    expectedReturn: er,
    marginOfSafety: triangulation.marginOfSafety,
    quantComposites: args.quantComposites,
    factorRanks: args.factorRanks,
    technicals: args.technicals,
    valuation: args.valuation,
  });

  const envelope = modelImpliedRating({ expectedReturn: er, fairValue: fv, setupScore: ss, triangulation });

  const financial = isFinancialSector(args.sector);

  return {
    ticker: args.ticker,
    asOf: args.asOf,
    expectedReturn: er,
    fairValue: fv,
    dcf,
    triangulation,
    setupScore: ss,
    envelope,
    valuationMethod: financial ? "equity-multiples" : "ev-multiples",
    evidenceBasis: ss.evidenceBasis === "thin" || er.lowConfidence ? "thin" : "sufficient",
    periodDisclosure: null,
  };
}

function pct(v: number | null): string {
  return v != null ? `${(v * 100).toFixed(1)}%` : "n/a";
}

function num(v: number | null, decimals = 1): string {
  return v != null ? v.toFixed(decimals) : "n/a";
}

/** Whole-percent (15%) for growth-rate fields. */
function gpct(v: number | null): string {
  return v != null ? `${(v * 100).toFixed(0)}%` : "n/a";
}

/** Signed percentage-points (+55pp) for the expectations gap. */
function pp(v: number | null): string {
  if (v == null) return "n/a";
  const x = v * 100;
  return `${x >= 0 ? "+" : ""}${x.toFixed(0)}pp`;
}

/**
 * Spine shape the formatters accept. `dcf` / `triangulation` are nullable here
 * (not on `ValuationSpine`) because the capability injects the PARSED resource
 * state, and a session persisted before FIX-807 re-parses with both = null. The
 * formatters must degrade to n/a on that legacy shape, never throw.
 */
type FormattableSpine = Omit<
  ValuationSpine,
  "dcf" | "triangulation" | "periodDisclosure"
> & {
  dcf: DcfValue | null;
  triangulation: Triangulation | null;
  periodDisclosure?: PeriodDisclosure | null;
};

/** The DCF intrinsic-value line — n/a-safe (null legacy block or abstention). */
function formatDcfLine(dcf: DcfValue | null): string {
  if (dcf == null) return "Intrinsic value (DCF): n/a";
  if (!dcf.available) {
    return `Intrinsic value (DCF): n/a (${dcf.unavailableReason ?? "unavailable"})`;
  }
  const tvFlag = dcf.reliability === "tv-dominated" ? ", ⚠ terminal-value-dominated" : "";
  return (
    `Intrinsic value (DCF): $${num(dcf.intrinsicValue)}B | ` +
    `DCF margin of safety: ${pct(dcf.marginOfSafety)} ` +
    `(discount ${gpct(dcf.discountRate)}, stage-1 growth ${gpct(dcf.stage1Growth)}, ` +
    `terminal-value share ${gpct(dcf.terminalValueShare)}${tvFlag})`
  );
}

/** The reverse-DCF clause, rendered per status. Empty when null or no reading. */
function formatReverseDcfClause(dcf: DcfValue | null): string {
  switch (dcf?.reverseDcfStatus) {
    case "solved":
      return (
        ` | reverse-DCF implies ${gpct(dcf.impliedGrowth)} vs ${gpct(dcf.stage1Growth)} ` +
        `fundamentals-supported → expectations gap ${pp(dcf.expectationsGap)}`
      );
    case "above-bracket":
      return " | reverse-DCF: market prices in >100% near-term FCF growth";
    case "below-terminal":
      return " | reverse-DCF: market implies sub-terminal growth";
    default:
      return "";
  }
}

/** The triangulation line — n/a-safe (null legacy block or unavailable). */
function formatTriangulationLine(spine: FormattableSpine): string {
  const t = spine.triangulation;
  if (t == null || t.divergence === "unavailable") return "Triangulation: n/a";
  return (
    `Triangulation: ${t.divergence} | consensus margin of safety: ${pct(t.marginOfSafety)}` +
    formatReverseDcfClause(spine.dcf)
  );
}

/**
 * The single WITHHELD sentence the portfolio manager (and every other
 * `valuationSpine`-capability reader) sees in place of the spine's numbers.
 *
 * SAME `disclosurePrintShape` `formatPeriodMismatch` (`statement-set-
 * period.ts`) reads — computed once, in ONE place, and consulted here rather
 * than re-derived. Different AUDIENCE from that block (this one has no raw
 * statement data to reason about "within a single statement", so it says
 * nothing about that), but the same shape and the same truth standard: every
 * clause here must hold for the periods printed beside it.
 */
function withheldReasonLine(pd: PeriodDisclosure): string {
  const named = `(income ${pd.income ?? "none"}, balance sheet ${pd.balance ?? "none"}, cash flow ${pd.cashflow ?? "none"})`;
  const withheldOutputs =
    "Every figure spanning two statements — expected return, fair value, the cash-flow model, " +
    "triangulation, the setup score and the rating envelope —";
  const shape = disclosurePrintShape(pd);
  const seen = pd.observedNewest ?? "a newer period";

  switch (shape) {
    case "unstated":
      return (
        `WITHHELD: the desk CANNOT ESTABLISH that the three statements below describe the same ` +
        `fiscal period ${named} — at least one carries figures but states no period. ${withheldOutputs} ` +
        `is withheld, because a figure built across them could silently combine two different fiscal ` +
        `periods. Do NOT combine figures across these statements yourself.`
      );

    case "uniform-stale":
      return (
        `WITHHELD: the three statements below agree on a fiscal period ${named}, but the desk saw a ` +
        `more recent one (${seen}) and settled for this older one instead — the set is STALE, not in ` +
        `disagreement. ${withheldOutputs} is withheld because it would present a superseded figure as ` +
        `current, not because the periods conflict. Do NOT combine figures across these statements ` +
        `yourself.`
      );

    case "divergent-stale":
      // ABSENT-vs-STALE: a PM told "stale" re-pulls a number; told "missing"
      // waits for a filing — see `disclosureHasUnknownPeriod`'s own comment.
      if (disclosureHasUnknownPeriod(pd)) {
        return (
          `WITHHELD: at least one of the three statements below did not return a period at all, even ` +
          `though the desk's own resolution observed one (${seen}) while resolving it — that statement ` +
          `may be MISSING data rather than merely stale, and the three are NOT confirmed to all ` +
          `describe one shared fiscal period ${named}. ${withheldOutputs} is withheld. Do NOT combine ` +
          `figures across these statements yourself.`
        );
      }
      return (
        `WITHHELD: at least one of the three statements below is STALE — the desk saw a more recent ` +
        `period (${seen}) while resolving it than it actually returned, and the three are NOT confirmed ` +
        `to all describe one shared fiscal period ${named}. ${withheldOutputs} is withheld. Do NOT ` +
        `combine figures across these statements yourself.`
      );

    case "disagree":
      // A real, confirmed clash between at least two of the three returned
      // periods — "could not establish a single fiscal period" and "rather
      // than computed across periods" are both true here — UNLESS a third,
      // undated-but-figured statement rides along with that clash, in which
      // case its own period is merely unknown, not confirmed to conflict.
      if (pd.anyUndatedWithFigures) {
        return (
          `WITHHELD: at least two of the three statements below are CONFIRMED to describe different ` +
          `fiscal periods ${named}, and at least one other carries figures but states no period, so a ` +
          `figure built across it COULD ALSO combine two different fiscal periods with nobody able to ` +
          `tell. ${withheldOutputs} is withheld. Do NOT combine figures across these statements yourself.`
        );
      }
      return (
        `WITHHELD: the desk could not establish a single fiscal period across the three statements ` +
        `${named}. ${withheldOutputs} is withheld rather than computed across periods. Do NOT combine ` +
        `figures across these statements yourself.`
      );
  }
}

export function formatValuationSpine(spine: FormattableSpine): string {
  const er = spine.expectedReturn;
  const fv = spine.fairValue;
  const ss = spine.setupScore;

  // The withheld shape (FIX-1113). Say WHY and name the dates — a spine that
  // rendered every line as "n/a" would read as a data outage rather than as the
  // desk declining to combine figures from different years.
  const pd = spine.periodDisclosure;
  if (pd != null || er == null || fv == null || ss == null) {
    return [
      `<valuationSpine ticker="${spine.ticker}" asOf="${spine.asOf}">`,
      pd != null ? withheldReasonLine(pd) : "WITHHELD: the valuation spine was not computed.",
      `Valuation method: ${spine.valuationMethod} | Evidence: ${spine.evidenceBasis}`,
      `</valuationSpine>`,
    ].join("\n");
  }

  const lines = [
    `<valuationSpine ticker="${spine.ticker}" asOf="${spine.asOf}">`,
    `Expected return: ${pct(er.expectedReturn)} (basis: ${er.basis}, yield: ${pct(er.shareholderYield)}, growth: ${pct(er.sustainableGrowth)})`,
    `Excess return vs ${pct(er.hurdle)} hurdle: ${pct(er.excessReturn)}`,
    `Fair value (${fv.method}): ${fv.fairValue != null ? "$" + num(fv.fairValue) + "B" : "n/a"} | Margin of safety: ${pct(fv.marginOfSafety)}`,
    formatDcfLine(spine.dcf),
    formatTriangulationLine(spine),
    `Setup score: ${ss.score ?? "n/a"}/100 (value: ${ss.value ?? "n/a"}, quality: ${ss.quality ?? "n/a"}, factor: ${ss.factor ?? "n/a"}, momentum: ${ss.momentum ?? "n/a"})`,
    `Valuation method: ${spine.valuationMethod} | Evidence: ${spine.evidenceBasis}`,
    er.lowConfidence ? "⚠ Low confidence: both FCF and earnings are non-positive." : "",
    `</valuationSpine>`,
  ].filter(Boolean);

  return lines.join("\n");
}

export function formatRatingEnvelope(envelope: RatingEnvelope): string {
  return [
    `<ratingEnvelope>`,
    `Absolute rating (return-anchored): ${envelope.absoluteRating}`,
    `Relative rating (score-anchored): ${envelope.relativeRating}`,
    `Model-implied combined: ${envelope.implied}`,
    `Permitted band: ${envelope.floor} .. ${envelope.ceiling}`,
    `Rationale: ${envelope.rationale}`,
    `To choose outside the band, set ratingOverrideReason to one sentence naming what the model misses; otherwise your rating is clamped to the band.`,
    `</ratingEnvelope>`,
  ].join("\n");
}
