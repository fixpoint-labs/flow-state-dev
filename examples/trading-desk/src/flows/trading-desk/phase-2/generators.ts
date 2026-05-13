/**
 * The three Phase 2 generators that run after the round-robin loop:
 *   - `consolidateBullMemo` — consolidates bull-side contributions plus
 *     analyst memos into a `BullThesis`.
 *   - `consolidateBearMemo` — symmetric for the bear side.
 *   - `researchManagerGenerator` — synthesizes both consolidated memos,
 *     all four analyst memos, and the full debate transcript into an
 *     `InvestmentThesis` with explicit unresolved disagreements.
 *
 * Model selection, ticker/date context, analyst memos, and debate
 * transcripts are provided by the `tradingDesk` capability. Each
 * generator opts into the presets it needs via `tradingDesk.presets({...})`.
 */
import { generator } from "@flow-state-dev/core";
import { PHASE_2_MEMO_KEYS } from "../agents";
import { sessionStateSchema } from "../state";
import { tradingDesk } from "../services/trading-desk-capability";
import {
  bearThesisOutputSchema,
  bullThesisOutputSchema,
  investmentThesisOutputSchema,
} from "./thesis-schemas";
import {
  BEAR_CONSOLIDATION_PROMPT,
  BULL_CONSOLIDATION_PROMPT,
  RESEARCH_MANAGER_PROMPT,
} from "./prompts";

export const consolidateBullMemo = generator({
  name: "consolidate-bull-memo",
  agentType: "sub",
  agentName: PHASE_2_MEMO_KEYS.bull.agentName,
  uses: [
    tradingDesk.presets({
      phase1Memos: true,
      bullContributions: true,
      bearContributions: true,
    }),
  ],
  prompt: BULL_CONSOLIDATION_PROMPT,
  user: "Now write the published Bull memo.",
  sessionStateSchema,
  outputSchema: bullThesisOutputSchema,
});

export const consolidateBearMemo = generator({
  name: "consolidate-bear-memo",
  agentType: "sub",
  agentName: PHASE_2_MEMO_KEYS.bear.agentName,
  uses: [
    tradingDesk.presets({
      phase1Memos: true,
      bullContributions: true,
      bearContributions: true,
    }),
  ],
  prompt: BEAR_CONSOLIDATION_PROMPT,
  user: "Now write the published Bear memo.",
  sessionStateSchema,
  outputSchema: bearThesisOutputSchema,
});

/**
 * Research manager — `agentType: "primary"` because per the design, RM
 * emits the InvestmentThesis structured row in the transcript and is
 * treated as a primary identity (not a sub-agent like the consolidators).
 */
export const researchManagerGenerator = generator({
  name: "research-manager-generator",
  agentType: "primary",
  agentName: PHASE_2_MEMO_KEYS.researchManager.agentName,
  uses: [
    tradingDesk.presets({
      phase1Memos: true,
      bullThesis: true,
      bearThesis: true,
      phase2Debate: true,
    }),
  ],
  prompt: RESEARCH_MANAGER_PROMPT,
  user:
    "Synthesize the InvestmentThesis. Enumerate `unresolvedDisagreements` " +
    "explicitly. Empty is acceptable only if the debate genuinely converged " +
    'and you justify that in the "Resolution of the debate" body section.',
  sessionStateSchema,
  outputSchema: investmentThesisOutputSchema,
});
