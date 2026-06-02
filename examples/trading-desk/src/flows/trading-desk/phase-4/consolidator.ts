/**
 * The Phase 4 `riskAssessmentGenerator` — single-shot consolidation step.
 *
 * Reads the three Phase 4 persona memos with their structured fields, the
 * Phase 3 trade proposal, and the Phase 2 investment thesis. On the
 * `full` cost preset, also reads the four Phase 1 analyst memos and the
 * Phase 2 bull/bear debate transcript.
 *
 * Emits a typed `RiskAssessment` — what Phase 5 (the portfolio manager)
 * actually consumes. The three persona memos remain as the audit trail.
 *
 * `itemVisibility: { client: true, history: false }` — no structured-output
 * card in the transcript; the memo on the right pane is the artifact.
 */
import { generator } from "@flow-state-dev/core";
import { definePromptFile } from "@flow-state-dev/core/prompt-file";
import { PHASE_4_MEMO_KEYS } from "../agents";
import { sessionStateSchema } from "../state";
import { tradingDesk } from "../capability";
import { loadPrompt } from "../lib/prompt";
import { riskAssessmentOutputSchema } from "./schemas";

const riskAssessmentPrompt = loadPrompt(
  "phase-4/prompts/risk-assessment.prompt.md"
);

export const riskAssessmentGenerator = generator({
  name: "risk-assessment-generator",
  itemVisibility: { client: true, history: false },
  agentName: PHASE_4_MEMO_KEYS.riskAssessment.agentName,
  uses: [
    tradingDesk.presets({
      tradeProposal: true,
      investmentThesis: true,
      riskCritiques: true,
      phase1MemosFull: true,
      phase2DebateFull: true,
      highReasoning: true,
    }),
  ],
  ...definePromptFile(riskAssessmentPrompt),
  sessionStateSchema,
  outputSchema: riskAssessmentOutputSchema,
});
