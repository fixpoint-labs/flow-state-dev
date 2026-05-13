/**
 * The three Phase 4 persona generators — aggressive, conservative, neutral.
 *
 * Each runs as a round-robin roster slot override (see
 * `phase-4/round-robin.ts`). Single-shot structured critique that reads:
 *   - the Phase 3 trade proposal + Phase 2 investment thesis (always),
 *   - prior persona memos in fixed round-robin order, and
 *   - on the `full` cost preset, the four Phase 1 analyst memos plus the
 *     full bull/bear debate transcript.
 *
 * Personas read prior persona memos via per-generator `context` entries
 * because the round-robin order matters — aggressive sees no priors,
 * conservative sees aggressive, neutral sees both. The shared
 * `tradeProposal` + `investmentThesis` presets from `tradingDesk` cover
 * the static surface; dynamic `uses` adds the full-preset extras.
 *
 * `agentType: "sub"` — per the design, P4 personas emit speak rows only
 * (no structured-output card in the transcript). The memo on the right
 * pane is the persona's structured artifact.
 */
import { generator } from "@flow-state-dev/core";
import { PHASE_4_MEMO_KEYS } from "../agents";
import { sessionStateSchema } from "../state";
import {
  formatPersonaCritique,
  tradingDesk,
} from "../services/trading-desk-capability";
import {
  AGGRESSIVE_PROMPT,
  CONSERVATIVE_PROMPT,
  NEUTRAL_PROMPT,
} from "./prompts";
import {
  neutralCritiqueOutputSchema,
  personaCritiqueOutputSchema,
} from "./schemas";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function memoState(ctx: any, collectionKey: string): unknown {
  return ctx.resources.memos?.getOptional(collectionKey)?.state;
}

/** Dynamic uses entry: enable phase1Memos + phase2Debate context only on the
 *  `full` cost preset. p2Contributions resource is declared on each
 *  generator's `resources:` slot below (dynamic uses contribute context
 *  only — resources must come from the static path). */
const fullPresetExtras = (ctx: {
  session: { state: { costPreset?: string } };
}) =>
  ctx.session.state.costPreset === "full"
    ? ([tradingDesk.presets({ phase1Memos: true, phase2Debate: true })] as const)
    : ([] as const);

const baseUses = [
  tradingDesk.presets({ tradeProposal: true, investmentThesis: true }),
  fullPresetExtras,
] as const;

import { memosCollection } from "../resources";
import { phase2Contributions } from "../phase-2/round-robin";

const sharedResources = {
  memos: memosCollection,
  p2Contributions: phase2Contributions,
} as const;

export const aggressiveRiskGenerator = generator({
  name: "aggressive-risk-generator",
  agentType: "sub",
  agentName: PHASE_4_MEMO_KEYS.aggressive.agentName,
  uses: baseUses,
  resources: sharedResources,
  prompt: AGGRESSIVE_PROMPT,
  user:
    "You are the first persona to speak in the round-robin. " +
    "Now write the published Aggressive Risk critique.",
  sessionStateSchema,
  outputSchema: personaCritiqueOutputSchema,
});

export const conservativeRiskGenerator = generator({
  name: "conservative-risk-generator",
  agentType: "sub",
  agentName: PHASE_4_MEMO_KEYS.conservative.agentName,
  uses: baseUses,
  resources: sharedResources,
  prompt: CONSERVATIVE_PROMPT,
  context: {
    aggressiveCritique: (_input, ctx) =>
      formatPersonaCritique(
        "Aggressive Risk critique",
        memoState(ctx, PHASE_4_MEMO_KEYS.aggressive.collectionKey),
      ),
  },
  user: "Now write the published Conservative Risk critique.",
  sessionStateSchema,
  outputSchema: personaCritiqueOutputSchema,
});

export const neutralRiskGenerator = generator({
  name: "neutral-risk-generator",
  agentType: "sub",
  agentName: PHASE_4_MEMO_KEYS.neutral.agentName,
  uses: baseUses,
  resources: sharedResources,
  prompt: NEUTRAL_PROMPT,
  context: {
    aggressiveCritique: (_input, ctx) =>
      formatPersonaCritique(
        "Aggressive Risk critique",
        memoState(ctx, PHASE_4_MEMO_KEYS.aggressive.collectionKey),
      ),
    conservativeCritique: (_input, ctx) =>
      formatPersonaCritique(
        "Conservative Risk critique",
        memoState(ctx, PHASE_4_MEMO_KEYS.conservative.collectionKey),
      ),
  },
  user:
    "Now write the published Neutral Risk critique. Remember: your job is " +
    "to filter, not to win. Populate `dismissedRisks` with the load-bearing " +
    "call on what does not warrant action.",
  sessionStateSchema,
  outputSchema: neutralCritiqueOutputSchema,
});
