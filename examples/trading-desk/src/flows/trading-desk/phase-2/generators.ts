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
 *
 * Output schemas live inline next to each generator. Each is consumed by
 * one generator + one commit handler; keeping the schema adjacent to the
 * generator that defines it makes the file read top-to-bottom. The Phase 2
 * writer imports the schemas back from here to project its commits.
 */
import { generator } from "@flow-state-dev/core";
import { definePromptFile } from "@flow-state-dev/core/prompt-file";
import { z } from "zod";
import { PHASE_2_MEMO_KEYS } from "../agents";
import { tradingDesk } from "../capability";
import { loadPrompt } from "../lib/prompt";
import { thesisSection } from "../resources";
import { sessionStateSchema } from "../state";

const bullConsolidationPrompt = loadPrompt(
  "phase-2/prompts/bull-consolidation.prompt.md"
);
const bearConsolidationPrompt = loadPrompt(
  "phase-2/prompts/bear-consolidation.prompt.md"
);
const researchManagerPrompt = loadPrompt(
  "phase-2/prompts/research-manager.prompt.md"
);

// ---------------------------------------------------------------------------
// Bull
// ---------------------------------------------------------------------------

/** Bull researcher consolidation output. Rating is fixed `"buy"`. */
export const bullThesisOutputSchema = z.object({
  label: z.string(),
  headline: z.string(),
  rating: z.literal("buy"),
  metrics: z.object({
    conviction: z.string(),
    horizon: z.string(),
    target: z.string(),
    stop: z.string(),
  }),
  body: z.array(thesisSection),
});

export type BullThesisOutput = z.infer<typeof bullThesisOutputSchema>;

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
  ...definePromptFile(bullConsolidationPrompt),
  sessionStateSchema,
  outputSchema: bullThesisOutputSchema,
});

// ---------------------------------------------------------------------------
// Bear
// ---------------------------------------------------------------------------

/** Bear researcher consolidation output. Rating is fixed `"underweight"`. */
export const bearThesisOutputSchema = z.object({
  label: z.string(),
  headline: z.string(),
  rating: z.literal("underweight"),
  metrics: z.object({
    conviction: z.string(),
    horizon: z.string(),
    downside: z.string(),
    trigger: z.string(),
  }),
  body: z.array(thesisSection),
});

export type BearThesisOutput = z.infer<typeof bearThesisOutputSchema>;

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
  ...definePromptFile(bearConsolidationPrompt),
  sessionStateSchema,
  outputSchema: bearThesisOutputSchema,
});

// ---------------------------------------------------------------------------
// Research Manager
//
// `agentType: "primary"` because per the design, RM emits the
// InvestmentThesis structured row in the transcript and is treated as a
// primary identity (not a sub-agent like the consolidators).
// ---------------------------------------------------------------------------

/**
 * Research manager output. Combines the design's `Thesis` shape with the
 * five InvestmentThesis extension fields. `unresolvedDisagreements` is the
 * intentional design choice that keeps the phase honest — empty is
 * acceptable but should be the exception on a non-trivial trade.
 */
export const investmentThesisOutputSchema = z.object({
  label: z.string(),
  headline: z.string(),
  rating: z.enum(["constructive", "neutral", "cautious"]),
  metrics: z.object({
    conviction: z.string(),
    horizon: z.string(),
    stance: z.string(),
    outOfScope: z.string(),
  }),
  body: z.array(thesisSection),
  // Extension fields — populated only on the research-manager memo.
  stance: z.enum(["bullish", "bearish", "neutral"]),
  convictionScore: z.number().min(0).max(1),
  keyRisks: z.array(z.string()),
  keyOpportunities: z.array(z.string()),
  unresolvedDisagreements: z.array(z.string()),
});

export type InvestmentThesisOutput = z.infer<typeof investmentThesisOutputSchema>;

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
      citationIntegrity: true,
      reasoning: true,
    }),
  ],
  ...definePromptFile(researchManagerPrompt),
  sessionStateSchema,
  outputSchema: investmentThesisOutputSchema,
});
