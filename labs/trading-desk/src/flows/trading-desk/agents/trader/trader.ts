/**
 * The Phase 3 trader generator and its output schema.
 *
 * Reads the Phase 2 InvestmentThesis (plus the four analyst memos and the
 * full debate transcript on `full` preset) and writes a typed
 * `TradeProposal`. `itemVisibility: { client: true, history: true }` so the
 * structured `TxStruct` card renders in the transcript automatically.
 *
 * The output schema lives inline here because only one generator emits
 * the shape; the Phase 3 writer imports the type back from this file to
 * project the commit. BP-016: every field is required, `metrics` is a
 * fixed-shape object, `rating` / `direction` / `holdingPeriod` are enums
 * of literals, and `nullable` is never reached for output fields.
 */
import { generator } from "@flow-state-dev/core";
import { definePromptFile } from "@flow-state-dev/core/prompt-file";
import { z } from "zod";
import { PHASE_3_MEMO_KEYS } from "../../agents";
import { tradingDesk } from "../../capability";
import { loadPrompt } from "../../lib/prompt";
import { thesisSection } from "../../resources";
import { sessionStateSchema } from "../../state";

const traderPrompt = loadPrompt("agents/trader/prompts/trader.prompt.md");

export const tradeProposalOutputSchema = z.object({
  label: z.string(),
  headline: z.string(),
  rating: z.enum(["long", "short", "flat"]),
  metrics: z.object({
    direction: z.string(),
    size: z.string(),
    stop: z.string(),
    target: z.string(),
    conviction: z.string(),
  }),
  body: z.array(thesisSection),
  // Typed extension fields — machine-readable mirror of the display
  // `metrics` row, consumed by Phase 4 (risk) and Phase 5 (PM).
  direction: z.enum(["long", "short", "flat"]),
  sizePct: z.number().min(0).max(10),
  stopPrice: z.number().positive(),
  targetPrice: z.number().positive(),
  holdingPeriod: z.enum(["days", "weeks", "months", "quarters"]),
  invalidationCriteria: z.array(z.string()),
  dependsOn: z.array(z.string()),
});

export type TradeProposalOutput = z.infer<typeof tradeProposalOutputSchema>;

export const traderGenerator = generator({
  name: "trader-generator",
  itemVisibility: { client: true, history: true },
  agentName: PHASE_3_MEMO_KEYS.trader.agentName,
  uses: [
    tradingDesk.presets({
      investmentThesis: true,
      valuationSpine: true,
      phase1MemosFull: true,
      phase2DebateFull: true,
      reasoning: true,
      // Slice 5 — the trader sees the live portfolio for pre-trade sizing realism
      // (it treats `sizePct` as % of NAV). No trader output-schema change: the
      // portfolio-fit verdict lives solely on the PM (the final arbiter).
      portfolioContext: true,
    }),
  ],
  ...definePromptFile(traderPrompt),
  sessionStateSchema,
  outputSchema: tradeProposalOutputSchema,
});
