/**
 * Regression spec for OpenAI strict-mode compatibility on every generator
 * output schema in the trading-desk flow.
 *
 * `assertStrictCompatible()` (from `@flow-state-dev/core`) runs the framework's
 * strict transform and then fails if any construct OpenAI's strict
 * structured-output mode rejects survives (a reachable `z.record`, a non-literal
 * `z.union`). Generators already call it at definition; this spec asserts the
 * shipped schema constants directly so a constant drifting out of compatibility
 * fails with a named signal before it is wired to a generator. See BP-016.
 */
import { describe, expect, it } from "vitest";
import { assertStrictCompatible } from "@flow-state-dev/core";
import type { ZodTypeAny } from "zod";
import { thesisOutputSchema } from "../src/flows/analysis/agents/analysts/thesis-schema";
import { grokOutputSchema } from "../src/flows/analysis/tools/data/get_social_sentiment";
import {
  secFilingsSchema,
  analystEstimatesSchema,
  earningsTranscriptSchema,
  discoveryPayloadSchema,
} from "../src/flows/analysis/tools/schemas";
import {
  bearThesisOutputSchema,
  bullThesisOutputSchema,
  investmentThesisOutputSchema,
} from "../src/flows/analysis/agents/research/generators";
import { tradeProposalOutputSchema } from "../src/flows/analysis/agents/trader/trader";
import {
  personaCritiqueOutputSchema,
  riskAssessmentOutputSchema,
} from "../src/flows/analysis/agents/risk/schemas";
import { scenarioForecastOutputSchema } from "../src/flows/analysis/agents/scenario-forecaster/scenario-forecaster";
import { portfolioDecisionOutputSchema } from "../src/flows/analysis/agents/portfolio-manager/portfolio-manager";
import { thesisAlignmentOutputSchema } from "../src/flows/analysis/agents/thesis-validator/thesis-validator";
import { pdfExtractionSchema } from "../src/flows/portfolio/portfolio-pdf";
import { lensVerdictOutputSchema } from "../src/flows/analysis/agents/lenses/lens-verdict-schema";

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
    it(`${name} is strict-compatible`, () => {
      expect(() => assertStrictCompatible(schema, name)).not.toThrow();
    });
  }

  // The nested `portfolioFit` (Slice 5), `mandateFit` (FIX-752), and `policyFit`
  // (FIX-761) objects are auto-covered by the portfolioDecisionOutputSchema case
  // above, but assert the whole schema explicitly so a future change that loosens
  // a nested field (e.g. `.optional()` on `suggestedAccount`, or `z.record` on a
  // mandate/policy field) fails with a clear, named signal.
  it("Phase 5 portfolioDecisionOutputSchema (incl. nested portfolioFit + mandateFit + policyFit) is strict-compatible", () => {
    expect(() => assertStrictCompatible(portfolioDecisionOutputSchema)).not.toThrow();
  });
});
