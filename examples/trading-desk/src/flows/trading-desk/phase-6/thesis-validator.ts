/**
 * The Phase 6 thesis-validator generator and its output schema.
 *
 * Phase 6 is the post-decision audit: the pipeline (P1–P5) ran blind to the
 * user's per-run thesis, and this validator now compares that thesis against
 * the independent chain of memos. It reads the InvestmentThesis, TradeProposal,
 * RiskAssessment, and the PortfolioDecision (always), plus the four Phase 1
 * analyst memos on the `full` preset, and the user's thesis via the
 * `userThesis` preset — the only generator in the flow that opts into it.
 *
 * `agentType: "primary"` so the structured `TxStruct` card renders in the
 * transcript (the navigator's `PRIMARY_STRUCT_AGENTS` set includes
 * `thesisValidator`).
 *
 * The output schema lives inline here because only this generator emits the
 * shape; the Phase 6 writer imports the type back to project the commit. The
 * anti-yes-man rule (no `alignment: "aligned"` unless `supportingEvidence`
 * has ≥ 2 entries and `contradictingEvidence` is empty) is enforced in the
 * writer, not the schema — a Zod refinement would wrap the schema in
 * `ZodEffects` and break OpenAI strict structured output. `blindSpots.min(1)`
 * IS schema-enforced because a plain array minimum stays strict-compatible.
 */
import { generator } from "@flow-state-dev/core";
import { definePromptFile } from "@flow-state-dev/core/prompt-file";
import { z } from "zod";
import { PHASE_6_MEMO_KEYS } from "../agents";
import { tradingDesk } from "../capability";
import { thesisSection } from "../resources";
import { sessionStateSchema } from "../state";
import { loadPrompt } from "../lib/prompt";

const thesisValidatorPrompt = loadPrompt(
  "phase-6/prompts/thesis-validator.prompt.md",
);

const evidenceEntrySchema = z.object({
  source: z.string(),
  claim: z.string(),
});

export const thesisAlignmentOutputSchema = z.object({
  label: z.string(),
  headline: z.string(),
  rating: z.string(),
  metrics: z.object({
    alignment: z.string(),
    confidence: z.string(),
    supporting: z.string(),
    contradicting: z.string(),
    blindSpots: z.string(),
  }),
  body: z.array(thesisSection),
  alignment: z.enum([
    "aligned",
    "partially-aligned",
    "contradicted",
    "orthogonal",
  ]),
  alignmentConfidence: z.number().min(0).max(1),
  supportingEvidence: z.array(evidenceEntrySchema),
  contradictingEvidence: z.array(evidenceEntrySchema),
  // At least one blind spot is always required: the independent pipeline
  // always surfaces something the user did not name, and forcing the field
  // is the structural floor against a yes-man audit.
  blindSpots: z.array(z.string()).min(1),
  // Null only when `alignment === "aligned"`; the writer enforces that pairing.
  proposedRevision: z.string().nullable(),
});

export type ThesisAlignmentOutput = z.infer<typeof thesisAlignmentOutputSchema>;

export const thesisValidatorGenerator = generator({
  name: "thesis-validator-generator",
  agentType: "primary",
  agentName: PHASE_6_MEMO_KEYS.thesisAlignment.agentName,
  uses: [
    tradingDesk.presets({
      investmentThesis: true,
      tradeProposal: true,
      riskAssessment: true,
      portfolioDecision: true,
      userThesis: true,
      phase1MemosFull: true,
      highReasoning: true,
    }),
  ],
  ...definePromptFile(thesisValidatorPrompt),
  sessionStateSchema,
  outputSchema: thesisAlignmentOutputSchema,
});
