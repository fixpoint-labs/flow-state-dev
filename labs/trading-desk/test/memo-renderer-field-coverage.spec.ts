/**
 * Field-coverage guard for the trader and risk memo renderers (FIX-1061).
 *
 * **Why a renderer needs one.** FIX-1061 exists because typed fields sat in
 * stored memo state that no surface read: a schema grew, the renderer did not,
 * and nothing failed. That is the hardest failure mode to notice, because
 * nothing breaks — a reader simply never learns something the desk computed.
 * This test makes it break.
 *
 * The paths are DERIVED from the schemas at test time, never transcribed, and
 * the walk recurses into nested objects and into array element shapes. A
 * top-level-only walk would pass while `criticalRisks[].raisedBy`,
 * `dismissedRisks[].dismissalCategory`, and `recommendedAdjustments.*.rationale`
 * went undrawn — and the attribution fields are most of what makes a critique
 * readable. A walker that misses them is a hand-maintained list wearing a
 * walker's clothes.
 *
 * Every leaf must be RENDERED or EXCLUDED **with a stated reason naming why the
 * report does not show it**. An exclusion without a reason is how the list
 * quietly degrades back into a hand-maintained one, one entry at a time — and
 * the reason is what keeps "we decided not to show this" distinguishable from
 * "nobody noticed this existed", which is the whole value of the mechanism.
 *
 * Note what is NOT excluded: `metrics`. Both cards draw it themselves, each
 * through its own filter, so it is covered rather than excluded.
 */
import { describe, expect, it } from "vitest";
import { z, type ZodTypeAny } from "zod";
import { tradeProposalOutputSchema } from "../flows/analysis/agents/trader/trader";
import {
  personaCritiqueOutputSchema,
  riskAssessmentOutputSchema,
} from "../flows/analysis/agents/risk/schemas";

/**
 * Every leaf path in a schema, in dotted form, with `[]` marking an array hop
 * (`criticalRisks[].raisedBy`). Unwraps the nullable / optional / default
 * wrappers so a `.nullable()` field is still walked into.
 */
function leafPaths(schema: ZodTypeAny, prefix = ""): string[] {
  const def = schema._def as { typeName?: string; innerType?: ZodTypeAny; type?: ZodTypeAny };

  if (
    def.typeName === z.ZodFirstPartyTypeKind.ZodNullable ||
    def.typeName === z.ZodFirstPartyTypeKind.ZodOptional ||
    def.typeName === z.ZodFirstPartyTypeKind.ZodDefault
  ) {
    return leafPaths(def.innerType as ZodTypeAny, prefix);
  }

  if (def.typeName === z.ZodFirstPartyTypeKind.ZodArray) {
    return leafPaths(def.type as ZodTypeAny, `${prefix}[]`);
  }

  if (def.typeName === z.ZodFirstPartyTypeKind.ZodObject) {
    const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
    return Object.entries(shape).flatMap(([key, value]) =>
      leafPaths(value as ZodTypeAny, prefix === "" ? key : `${prefix}.${key}`),
    );
  }

  return [prefix];
}

/** Leaves the shared header and body already draw for every memo renderer. */
const SHARED_CHROME: Record<string, string> = {
  label: "the shared ThesisHeader draws it as the memo's title",
  headline: "the shared ThesisHeader draws it under the title",
  "body[].h": "the shared ThesisBody draws each section heading",
  "body[].p": "the shared ThesisBody draws each section paragraph",
  "body[].items[]": "the shared ThesisBody draws each section's bullet list",
  "citations[].url": "the shared ThesisBody draws the Sources footer",
  "citations[].title": "the shared ThesisBody draws the Sources footer",
};

type Coverage = {
  /** Leaf paths the card renders. */
  rendered: string[];
  /** Leaf paths the card does not render, each with the reason it does not. */
  excluded: Record<string, string>;
};

const TRADER: Coverage = {
  rendered: [
    "direction",
    "sizePct",
    "stopPrice",
    "targetPrice",
    "reassessBelowPrice",
    "invalidateAbovePrice",
    "holdingPeriod",
    "invalidationCriteria[]",
    "dependsOn[]",
    "metrics.direction",
    "metrics.size",
    "metrics.conviction",
    ...Object.keys(SHARED_CHROME),
  ],
  excluded: {
    rating:
      "a SECOND stance enum beside the typed `direction`, with nothing forcing them to agree. The card shows the stance once, from `direction` — the field the price levels are named from — so a contradictory pair can never both appear.",
  },
};

const PERSONA: Coverage = {
  rendered: [
    "posture",
    "raisedRisks[].description",
    "raisedRisks[].severity",
    "proposedAdjustments.sizing",
    "proposedAdjustments.holdingPeriod",
    "proposedAdjustments.invalidation",
    "dismissedRisks[].description",
    "dismissedRisks[].reason",
    "dismissedRisks[].dismissalCategory",
    "metrics.stance",
    "metrics.structuralChange",
    "metrics.scopeChange",
    "metrics.exitDiscipline",
    "metrics.stopMechanics",
    "metrics.followOn",
    ...Object.keys(SHARED_CHROME),
  ],
  excluded: {
    rating:
      "a free-form string beside the typed verdicts this card draws structurally, with nothing forcing them to agree. The persona prompts pin it unconditionally — conservative to \"size correct\" while asking for `sizing: smaller`, aggressive to \"upsize\" while allowing `unchanged` — so the header contradicted the memo on the typical path. The card shows the verdict once, from the structured fields.",
  },
};

const ASSESSMENT: Coverage = {
  rendered: [
    "criticalRisks[].description",
    "criticalRisks[].severity",
    "criticalRisks[].raisedBy",
    "dismissedRisks[].description",
    "dismissedRisks[].reason",
    "dismissedRisks[].dismissalCategory",
    "recommendedAdjustments.sizing.direction",
    "recommendedAdjustments.sizing.rationale",
    "recommendedAdjustments.sizing.attributedTo",
    "recommendedAdjustments.holdingPeriod.direction",
    "recommendedAdjustments.holdingPeriod.rationale",
    "recommendedAdjustments.holdingPeriod.attributedTo",
    "recommendedAdjustments.invalidation.direction",
    "recommendedAdjustments.invalidation.rationale",
    "recommendedAdjustments.invalidation.attributedTo",
    "confidenceCalibration",
    "calibrationRationale",
    ...Object.keys(SHARED_CHROME),
  ],
  excluded: {
    rating:
      "a free-form string independent of both the typed `confidenceCalibration` enum and the `recommendedAdjustments` this card draws structurally. Nothing forces it to agree with either, so the header's rating chip is suppressed and the verdict renders once, from the typed fields.",
    "metrics.calibration":
      "the free-form copy of the typed `confidenceCalibration` this card draws structurally. `ASSESSMENT_STRUCTURED_METRIC_KEYS` denylists it so the calibration verdict renders once, from the typed enum, rather than twice from two sources nothing forces to agree.",
    "metrics.sizing":
      "the free-form copy of `recommendedAdjustments.sizing.direction`, which the Wants section draws structurally with its rationale and attribution. Denylisted so the axis renders once, from the typed field.",
    "metrics.invalidation":
      "the free-form copy of `recommendedAdjustments.invalidation.direction`, which the Wants section draws structurally with its rationale and attribution. Denylisted so the axis renders once, from the typed field.",
    "metrics.holdingPeriod":
      "the free-form copy of `recommendedAdjustments.holdingPeriod.direction`, which the Wants section draws structurally with its rationale and attribution. Denylisted so the axis renders once, from the typed field.",
  },
};

const cases: Array<[string, ZodTypeAny, Coverage]> = [
  ["trader (TraderProposalCard)", tradeProposalOutputSchema, TRADER],
  ["risk persona (RiskCritiqueCard)", personaCritiqueOutputSchema, PERSONA],
  ["risk assessment (RiskCritiqueCard)", riskAssessmentOutputSchema, ASSESSMENT],
];

describe("every stored memo field is rendered or excluded with a reason", () => {
  for (const [name, schema, coverage] of cases) {
    it(`${name} draws every leaf its schema carries`, () => {
      const accounted = new Set([
        ...coverage.rendered,
        ...Object.keys(coverage.excluded),
      ]);
      const unaccounted = leafPaths(schema).filter((p) => !accounted.has(p));
      // A field added to the schema later lands here until someone renders it
      // or excludes it WITH a reason. That is the whole point: a silent drop
      // is what produced this issue.
      expect(unaccounted).toEqual([]);
    });

    it(`${name} claims no field its schema does not carry`, () => {
      // The other direction: a rendered/excluded entry for a path that no
      // longer exists means the list has drifted from the schema and is no
      // longer evidence of anything.
      const actual = new Set(leafPaths(schema));
      const stale = [
        ...coverage.rendered,
        ...Object.keys(coverage.excluded),
      ].filter((p) => !actual.has(p));
      expect(stale).toEqual([]);
    });

    it(`${name} states a reason for every exclusion`, () => {
      for (const [path, reason] of Object.entries(coverage.excluded)) {
        // Not a placeholder: the reason has to name why the report does not
        // show the field, or the exclusion list degrades into a rubber stamp.
        expect(reason.length, `exclusion for ${path}`).toBeGreaterThan(40);
      }
    });
  }
});
