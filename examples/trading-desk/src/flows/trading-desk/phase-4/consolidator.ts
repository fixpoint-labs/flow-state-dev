/**
 * The Phase 4 `riskAssessmentGenerator` — single-shot consolidation step.
 *
 * Reads the three Phase 4 persona memos with their structured fields, the
 * Phase 3 trade proposal, the Phase 2 investment thesis, and the Phase 4
 * round-robin transcript. On the `full` cost preset, also reads the four
 * Phase 1 analyst memos and the Phase 2 bull/bear debate transcript.
 *
 * Emits a typed `RiskAssessment` — what Phase 5 (the portfolio manager)
 * actually consumes. The three persona memos remain as the audit trail.
 *
 * `agentType: "sub"` — no structured-output card in the transcript; the
 * memo on the right pane is the artifact.
 */
import { generator } from "@flow-state-dev/core";
import { PHASE_4_MEMO_KEYS } from "../agents";
import { sessionStateSchema } from "../state";
import { tradingDesk } from "../services/trading-desk-capability";
import { RISK_ASSESSMENT_PROMPT } from "./prompts";
import { riskAssessmentOutputSchema } from "./schemas";

export const riskAssessmentGenerator = generator({
  name: "risk-assessment-generator",
  agentType: "sub",
  agentName: PHASE_4_MEMO_KEYS.riskAssessment.agentName,
  uses: [
    tradingDesk.presets({
      tradeProposal: true,
      investmentThesis: true,
      riskCritiques: true,
      phase4Debate: true,
      phase1MemosFull: true,
      phase2DebateFull: true,
    }),
  ],
  prompt: RISK_ASSESSMENT_PROMPT,
  user: "Now write the published RiskAssessment.",
  sessionStateSchema,
  outputSchema: riskAssessmentOutputSchema,
});
