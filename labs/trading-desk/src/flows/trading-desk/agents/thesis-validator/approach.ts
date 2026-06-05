/**
 * Phase 6 thesis-validator approach preamble.
 *
 * A fast-model free-text generator that streams the auditor's plan in plain
 * English before the structured `thesisValidatorGenerator` runs — so the
 * transcript shows a "Phase 6 Approach" beat whenever the audit is relevant
 * (Phase 6 only runs when a user thesis was provided). See
 * `lib/approach-generator.ts` for the shared shape.
 *
 * Capability presets: `userThesis` (the thing being audited), plus
 * `investmentThesis` and `portfolioDecision` (the independent findings it
 * will weigh the thesis against). It does NOT pull the heavier analyst-memo
 * block or the `verify` search tools — the preamble describes method, it
 * doesn't do the verification.
 */
import { PHASE_6_MEMO_KEYS } from "../../registry";
import { tradingDesk } from "../../capability";
import { createApproachGenerator } from "../_recipe/approach-generator";
import { loadPrompt } from "../../lib/prompt";

const thesisValidatorApproachPrompt = loadPrompt(
  "agents/thesis-validator/prompts/thesis-validator-approach.prompt.md",
);

export const thesisValidatorApproachGenerator = createApproachGenerator({
  name: "thesis-validator-approach-generator",
  agentName: PHASE_6_MEMO_KEYS.thesisAlignment.agentName,
  artifactName: "ThesisAlignment",
  prompt: thesisValidatorApproachPrompt.prompt,
  uses: [
    tradingDesk.presets({
      userThesis: true,
      investmentThesis: true,
      portfolioDecision: true,
    }),
  ],
});
