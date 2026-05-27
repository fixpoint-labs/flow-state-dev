/**
 * Phase 4 approach preambles — three personas + the consolidator.
 *
 * Each generator streams a short fast-model free-text preview before
 * its structured counterpart runs. See
 * `lib/approach-generator.ts` for the shared shape.
 *
 * Capability presets are lean by design — the preamble needs to know
 * what's available to reference, not the full data depth:
 *   - Personas read `tradeProposal` + `investmentThesis`. They do NOT
 *     read prior-persona memos in their preamble; the round-robin
 *     order is encoded in the prompt's character framing instead.
 *     (Spec § Step 4, option 1.)
 *   - The consolidator reads `tradeProposal` + `riskCritiques` so its
 *     preamble can hint at synthesis across the three personas.
 */
import { PHASE_4_MEMO_KEYS } from "../agents";
import { tradingDesk } from "../capability";
import { createApproachGenerator } from "../lib/approach-generator";
import { loadPrompt } from "../lib/prompt";

const personaUses = [
  tradingDesk.presets({ tradeProposal: true, investmentThesis: true }),
] as const;

export const aggressiveApproachGenerator = createApproachGenerator({
  name: "aggressive-approach-generator",
  agentName: PHASE_4_MEMO_KEYS.aggressive.agentName,
  artifactName: "Aggressive Risk critique",
  prompt: loadPrompt("phase-4/prompts/aggressive-approach.prompt.md").prompt,
  uses: personaUses,
});

export const conservativeApproachGenerator = createApproachGenerator({
  name: "conservative-approach-generator",
  agentName: PHASE_4_MEMO_KEYS.conservative.agentName,
  artifactName: "Conservative Risk critique",
  prompt: loadPrompt("phase-4/prompts/conservative-approach.prompt.md")
    .prompt,
  uses: personaUses,
});

export const neutralApproachGenerator = createApproachGenerator({
  name: "neutral-approach-generator",
  agentName: PHASE_4_MEMO_KEYS.neutral.agentName,
  artifactName: "Neutral Risk critique",
  prompt: loadPrompt("phase-4/prompts/neutral-approach.prompt.md").prompt,
  uses: personaUses,
});

export const riskAssessmentApproachGenerator = createApproachGenerator({
  name: "risk-assessment-approach-generator",
  agentName: PHASE_4_MEMO_KEYS.riskAssessment.agentName,
  artifactName: "Risk Assessment",
  prompt: loadPrompt("phase-4/prompts/risk-assessment-approach.prompt.md")
    .prompt,
  uses: [
    tradingDesk.presets({ tradeProposal: true, riskCritiques: true }),
  ],
});
