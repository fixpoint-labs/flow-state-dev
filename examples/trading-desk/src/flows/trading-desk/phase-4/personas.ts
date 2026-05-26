/**
 * The three Phase 4 persona generators — aggressive, conservative, neutral.
 *
 * Each runs as a step in the plain sequencer chain in `phase-4/index.ts`.
 * Single-shot structured critique that reads:
 *   - the Phase 3 trade proposal + Phase 2 investment thesis (always),
 *   - prior persona memos in fixed order (aggressive → conservative →
 *     neutral), and
 *   - on the `full` cost preset, the four Phase 1 analyst memos plus the
 *     full bull/bear debate transcript.
 *
 * Personas read prior persona memos via per-generator `context` entries
 * because order matters — aggressive sees no priors, conservative sees
 * aggressive, neutral sees both. The shared `tradeProposal` +
 * `investmentThesis` presets cover the static surface; `phase1MemosFull`
 * + `phase2DebateFull` are the cost-preset-gated variants that render
 * empty when `costPreset !== "full"`.
 *
 * `agentType: "sub"` — per the design, P4 personas emit speak rows only
 * (no structured-output card in the transcript). The memo on the right
 * pane is the persona's structured artifact.
 */
import { generator } from "@flow-state-dev/core";
import { definePromptFile } from "@flow-state-dev/core/prompt-file";
import { PHASE_4_MEMO_KEYS } from "../agents";
import { sessionStateSchema } from "../state";
import {
  formatPersonaCritique,
  tradingDesk,
} from "../capability";
import { loadDeskPrompt } from "../lib/prompt";
import { personaCritiqueOutputSchema } from "./schemas";

const aggressivePrompt = loadDeskPrompt("phase-4/prompts/aggressive.prompt.md");
const conservativePrompt = loadDeskPrompt(
  "phase-4/prompts/conservative.prompt.md"
);
const neutralPrompt = loadDeskPrompt("phase-4/prompts/neutral.prompt.md");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function memoState(ctx: any, collectionKey: string): unknown {
  return ctx.resources.memos?.getOptional(collectionKey)?.state;
}

const tradingMemos = (reasoning: boolean) => [
  tradingDesk.presets({
    tradeProposal: true,
    investmentThesis: true,
    phase1MemosFull: true,
    phase2DebateFull: true,
    reasoning: !!reasoning,
  }),
] as const;

export const aggressiveRiskGenerator = generator({
  name: "aggressive-risk-generator",
  agentType: "sub",
  agentName: PHASE_4_MEMO_KEYS.aggressive.agentName,
  uses: tradingMemos(false),
  ...definePromptFile(aggressivePrompt),
  sessionStateSchema,
  outputSchema: personaCritiqueOutputSchema,
});

export const conservativeRiskGenerator = generator({
  name: "conservative-risk-generator",
  agentType: "sub",
  agentName: PHASE_4_MEMO_KEYS.conservative.agentName,
  uses: tradingMemos(false),
  context: {
    aggressiveCritique: (_input, ctx) =>
      formatPersonaCritique(
        "Aggressive Risk critique",
        memoState(ctx, PHASE_4_MEMO_KEYS.aggressive.collectionKey),
      ),
  },
  ...definePromptFile(conservativePrompt),
  sessionStateSchema,
  outputSchema: personaCritiqueOutputSchema,
});

// Diverges from `baseUses` to opt into `reasoning` — Neutral filters the
// other two personas rather than arguing a fixed posture, so the shared
// array stays default and only this persona gets the upgrade.
export const neutralRiskGenerator = generator({
  name: "neutral-risk-generator",
  agentType: "sub",
  agentName: PHASE_4_MEMO_KEYS.neutral.agentName,
  uses: tradingMemos(true),
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
  ...definePromptFile(neutralPrompt),
  sessionStateSchema,
  outputSchema: personaCritiqueOutputSchema,
});
