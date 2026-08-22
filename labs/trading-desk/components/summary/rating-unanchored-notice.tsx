/**
 * RatingUnanchoredNotice — the report-surface disclosure for a rating the
 * desk published WITHOUT its usual model-implied bound (FIX-1113).
 *
 * WHY THIS EXISTS. The rating envelope is withheld — not the rating — when
 * the three financial statements could not be placed at one fiscal period
 * (`flows/analysis/lib/valuation-spine.ts`'s file header, "WITHHOLDING THE
 * ENVELOPE IS FAIL-OPEN"). Withholding removes the BOUND, so the rating
 * publishes unconstrained; the only honest option is to say so, on every
 * surface a reader sees the rating. Before this file, `ratingUnanchored` /
 * `periodDisclosure` reached the stored PM memo and the decision snapshot and
 * stopped there — a report reader saw an unclamped rating with no marker at
 * all.
 *
 * NOT `ReportProvenanceNotice`. That notice exists for a report that PREDATES
 * a correction; its shared copy deliberately asserts no cause because copy
 * naming a cause can serve exactly one entry in a list of reasons. An
 * unanchored rating is not a provenance fact — it is a property of THIS run,
 * current and by design — so filing it under that banner would either force
 * a false claim into the shared copy or misfile a current-run fact as a
 * legacy one. This is its own surface.
 *
 * REUSES `disclosurePrintShape` (`lib/valuation-spine.ts`) rather than
 * re-deriving "do these three printed periods actually agree". That
 * computation has already produced three separate defects across three
 * surfaces that each re-derived it slightly wrong; `ratingUnanchoredReason`
 * below is a fourth consumer of the ONE classifier, not a fourth derivation.
 * Held to the same standard as its siblings (`withheldReasonLine`,
 * `formatPeriodMismatch`): every branch must be true of the periods actually
 * PRINTED, not just true of what the `reason` enum name suggests.
 */
import type { ReactElement } from "react";
import {
  disclosureHasUnknownPeriod,
  disclosurePrintShape,
  type PeriodDisclosure,
} from "@/flows/analysis/lib/valuation-spine";
import { cn } from "@/lib/utils";

/**
 * One sentence naming why the rating is unanchored and which periods are
 * involved, for a report reader (not the analyst prompt audience `formatPeriod
 * Mismatch` writes for, and not the no-raw-statement-data audience
 * `withheldReasonLine` writes for — this one has neither and says nothing
 * about combining figures, only about the rating's missing bound).
 */
export function ratingUnanchoredReason(disclosure: PeriodDisclosure): string {
  const named = `income ${disclosure.income ?? "none"}, balance sheet ${disclosure.balance ?? "none"}, cash flow ${disclosure.cashflow ?? "none"}`;
  const seen = disclosure.observedNewest ?? "a newer period";
  const shape = disclosurePrintShape(disclosure);

  switch (shape) {
    case "unstated":
      return (
        `at least one financial statement carries figures but states no period ` +
        `(${named}), so the desk cannot confirm the three share a fiscal period`
      );

    case "uniform-stale":
      return (
        `the three financial statements agree on a fiscal period, but the desk ` +
        `saw a more recent one (${seen}) and settled for this older one instead ` +
        `(${named}) — the set is stale, not in disagreement`
      );

    case "divergent-stale":
      // ABSENT-vs-STALE: see `disclosureHasUnknownPeriod`'s own comment.
      return disclosureHasUnknownPeriod(disclosure)
        ? `at least one financial statement did not return a period at all, even ` +
            `though the desk's own resolution observed one (${seen}) while ` +
            `resolving it (${named})`
        : `at least one financial statement is stale — the desk saw a more recent ` +
            `period (${seen}) than it actually returned (${named})`;

    case "disagree":
      return (
        `the desk could not establish a single fiscal period across the three ` +
        `financial statements (${named})`
      );
  }
}

export type RatingUnanchoredNoticeProps = {
  disclosure: PeriodDisclosure;
};

/**
 * The report-surface banner. Mount wherever a rating renders alongside its
 * model-implied band (the Summary decision header, the PM's detailed memo) —
 * gated on `ratingUnanchored === true`, never inferred from `ratingClamped`
 * alone (a run with a real envelope can also be genuinely unclamped).
 */
export function RatingUnanchoredNotice({
  disclosure,
}: RatingUnanchoredNoticeProps): ReactElement {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-md border p-3",
        "border-[color:var(--c-warn)]/40 bg-[color:var(--c-warn)]/10",
      )}
      data-testid="rating-unanchored-notice"
    >
      <span className="font-mono text-[10.5px] uppercase tracking-wider text-[color:var(--c-warn)]">
        rating unanchored
      </span>
      <p className="text-[11.5px] text-[color:var(--c-fg-muted)]">
        This rating is not bounded by the desk's model-implied envelope
        because {ratingUnanchoredReason(disclosure)}.
      </p>
    </div>
  );
}
