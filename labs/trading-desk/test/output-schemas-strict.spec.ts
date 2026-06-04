/**
 * Regression spec for OpenAI strict-mode compatibility on every generator
 * output schema in the trading-desk flow.
 *
 * The framework's `makeSchemaStrict()` strips `optional` / `default` /
 * `nullable` wrappers, but it does NOT transform `z.record()`, `z.union()`,
 * or other patterns OpenAI's strict structured-output mode rejects. This
 * spec walks each post-strict schema and fails if any of those patterns
 * survive — catching the class of bug that bit Phase 1 (and Phase 2 by
 * inheritance) repeatedly during initial development.
 *
 * See BP-016 for the rules these checks enforce.
 */
import { describe, expect, it } from "vitest";
import { makeSchemaStrict } from "@flow-state-dev/core";
import type { ZodTypeAny } from "zod";
import { thesisOutputSchema } from "../src/flows/trading-desk/agents/analysts/thesis-schema";
import { grokOutputSchema } from "../src/flows/trading-desk/tools/data/get_social_sentiment";
import {
  secFilingsSchema,
  analystEstimatesSchema,
  earningsTranscriptSchema,
  discoveryPayloadSchema,
} from "../src/flows/trading-desk/tools/schemas";
import {
  bearThesisOutputSchema,
  bullThesisOutputSchema,
  investmentThesisOutputSchema,
} from "../src/flows/trading-desk/agents/research/generators";
import { tradeProposalOutputSchema } from "../src/flows/trading-desk/agents/trader/trader";
import {
  personaCritiqueOutputSchema,
  riskAssessmentOutputSchema,
} from "../src/flows/trading-desk/agents/risk/schemas";
import { scenarioForecastOutputSchema } from "../src/flows/trading-desk/agents/scenario-forecaster/scenario-forecaster";
import { portfolioDecisionOutputSchema } from "../src/flows/trading-desk/phase-5/portfolio-manager";
import { thesisAlignmentOutputSchema } from "../src/flows/trading-desk/phase-6/thesis-validator";
import { pdfExtractionSchema } from "../src/flows/trading-desk/portfolio/portfolio-pdf";
import { lensVerdictOutputSchema } from "../src/flows/trading-desk/agents/lenses/lens-verdict-schema";

type Issue = { path: string; reason: string };

/**
 * Walk a Zod schema (already passed through `makeSchemaStrict`) and collect
 * any node that would cause OpenAI strict mode to reject the resulting JSON
 * schema. The walker covers the patterns that bit us in development:
 *
 *  - Object-shape properties wrapped in `ZodOptional` / `ZodDefault` (key is
 *    dropped from `required` → strict mode rejects).
 *  - `ZodRecord` anywhere (open-keyed map → `additionalProperties: true` →
 *    strict mode rejects).
 *  - `ZodUnion` that isn't an enum-style union of literals (ambiguous
 *    `required` set across variants → strict mode rejects). Discriminated
 *    unions have the same JSON-schema shape and would also fail this check;
 *    if we adopt them later, refine this rule.
 */
function findStrictViolations(schema: ZodTypeAny, path = "$"): Issue[] {
  const def = (schema as any)._def;
  const typeName = def?.typeName as string | undefined;
  const issues: Issue[] = [];

  switch (typeName) {
    case "ZodOptional":
    case "ZodDefault":
      issues.push({
        path,
        reason: `${typeName} survived makeSchemaStrict — would drop key from required`,
      });
      issues.push(...findStrictViolations(def.innerType, path));
      break;

    case "ZodNullable":
      issues.push(...findStrictViolations(def.innerType, path));
      break;

    case "ZodRecord":
      issues.push({
        path,
        reason: "ZodRecord becomes additionalProperties=true; OpenAI strict rejects open maps",
      });
      break;

    case "ZodUnion":
    case "ZodDiscriminatedUnion": {
      const options = (def.options ?? []) as ZodTypeAny[];
      const allLiterals = options.every(
        (o) => ((o as any)._def?.typeName as string | undefined) === "ZodLiteral",
      );
      if (!allLiterals) {
        issues.push({
          path,
          reason: `${typeName} of non-literal variants — strict mode requires uniform property set`,
        });
      }
      // Walk into each variant anyway so nested issues surface.
      options.forEach((opt, i) => {
        issues.push(...findStrictViolations(opt, `${path}|${i}`));
      });
      break;
    }

    case "ZodObject": {
      const shape = def.shape() as Record<string, ZodTypeAny>;
      for (const [key, value] of Object.entries(shape)) {
        issues.push(...findStrictViolations(value, `${path}.${key}`));
      }
      break;
    }

    case "ZodArray":
      issues.push(...findStrictViolations(def.type, `${path}[]`));
      break;

    case "ZodEffects":
      issues.push(...findStrictViolations(def.schema, path));
      break;

    // Primitives, enums, literals, etc. are always strict-mode safe.
    default:
      break;
  }

  return issues;
}

const cases: Array<[string, ZodTypeAny]> = [
  ["Phase 1 thesisOutputSchema", thesisOutputSchema],
  ["Phase 1 get_social_sentiment grokOutputSchema", grokOutputSchema],
  ["Phase 2 bullThesisOutputSchema", bullThesisOutputSchema],
  ["Phase 2 bearThesisOutputSchema", bearThesisOutputSchema],
  ["Phase 2 investmentThesisOutputSchema", investmentThesisOutputSchema],
  ["Phase 3 tradeProposalOutputSchema", tradeProposalOutputSchema],
  ["Phase 4 personaCritiqueOutputSchema", personaCritiqueOutputSchema],
  ["Phase 4 riskAssessmentOutputSchema", riskAssessmentOutputSchema],
  ["Phase 2b lensVerdictOutputSchema", lensVerdictOutputSchema],
  ["Phase 5 scenarioForecastOutputSchema", scenarioForecastOutputSchema],
  ["Phase 5 portfolioDecisionOutputSchema", portfolioDecisionOutputSchema],
  ["Phase 6 thesisAlignmentOutputSchema", thesisAlignmentOutputSchema],
  ["Tool get_sec_filings secFilingsSchema", secFilingsSchema],
  ["Tool get_analyst_estimates analystEstimatesSchema", analystEstimatesSchema],
  ["Tool get_earnings_transcript earningsTranscriptSchema", earningsTranscriptSchema],
  ["Tool discover_disclosure_context discoveryPayloadSchema", discoveryPayloadSchema],
  ["Portfolio PDF extraction pdfExtractionSchema", pdfExtractionSchema],
];

describe("Generator output schemas are OpenAI strict-mode compatible", () => {
  for (const [name, schema] of cases) {
    it(`${name} survives makeSchemaStrict + walker with no violations`, () => {
      const strict = makeSchemaStrict(schema);
      const issues = findStrictViolations(strict);
      if (issues.length > 0) {
        const formatted = issues
          .map((i) => `  ${i.path}: ${i.reason}`)
          .join("\n");
        throw new Error(
          `${name} would fail OpenAI strict mode:\n${formatted}`,
        );
      }
      expect(issues).toEqual([]);
    });
  }

  // The nested `portfolioFit` object (Slice 5) is auto-covered by the
  // portfolioDecisionOutputSchema case above, but assert it explicitly so a
  // future change that loosens a portfolioFit field (e.g. `.optional()` on
  // `suggestedAccount`) fails with a clear, named signal rather than buried in
  // the parent walk.
  it("Phase 5 portfolioFit nested object survives the walker with no violations", () => {
    const strict = makeSchemaStrict(portfolioDecisionOutputSchema);
    const issues = findStrictViolations(strict, "$");
    const portfolioFitIssues = issues.filter((i) => i.path.includes("portfolioFit"));
    expect(portfolioFitIssues).toEqual([]);
  });
});
