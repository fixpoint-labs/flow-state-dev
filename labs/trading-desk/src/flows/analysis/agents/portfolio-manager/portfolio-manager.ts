/**
 * The Phase 5 portfolio-manager generator and its output schema.
 *
 * Reads the always-on upstream artifacts — Phase 2 InvestmentThesis,
 * Phase 3 TradeProposal, Phase 4 RiskAssessment — and writes a typed
 * `PortfolioDecision`. On the `full` preset it also reads the four
 * analyst memos, the bull/bear debate transcript, and the three persona
 * risk critiques. The cost-preset gating lives inside the `*Full`
 * presets, not at the call site.
 *
 * `itemVisibility: { client: true, history: true }` so the structured
 * `TxStruct` card renders in the transcript automatically (the navigator's
 * `PRIMARY_STRUCT_AGENTS` set already includes `portfolioManager`).
 *
 * The output schema lives inline here because only one generator emits
 * the shape; the Phase 5 writer imports the type back to project the
 * commit. `upstreamReferences` and `agreesWithTrader` are NOT in this
 * schema — they're derived at commit time from canonical key maps and
 * the trader memo's `direction` field. Making the LLM emit them would
 * add hallucination surface for fields we can compute deterministically.
 */
import { generator, sequencer } from "@flow-state-dev/core";
import { definePromptFile } from "@flow-state-dev/core/prompt-file";
import { z } from "zod";
import { PHASE_5_MEMO_KEYS } from "../../registry";
import { tradingDesk } from "../../capability";
import { thesisSection } from "../../resources";
import { sessionStateSchema } from "../../state";
import { loadPrompt } from "../../lib/prompt";
import { portfolioManagerApproachGenerator } from "./approach";

const portfolioManagerPrompt = loadPrompt(
  "agents/portfolio-manager/prompts/portfolio-manager.prompt.md"
);

const adjustmentDecisionSchema = z.object({
  applied: z.boolean(),
  reasoning: z.string(),
});

export const portfolioDecisionOutputSchema = z.object({
  label: z.string(),
  headline: z.string(),
  rating: z.string(),
  metrics: z.object({
    rating: z.string(),
    ticker: z.string(),
    window: z.string(),
    size: z.string(),
    stop: z.string(),
    target: z.string(),
  }),
  body: z.array(thesisSection),
  finalRating: z.enum(["Sell", "Underweight", "Hold", "Overweight", "Buy"]),
  decisionSummary: z.string(),
  decisionConfidence: z.number().min(0).max(1),
  acceptedAdjustments: z.object({
    sizing: adjustmentDecisionSchema,
    holdingPeriod: adjustmentDecisionSchema,
    invalidation: adjustmentDecisionSchema,
  }),
  keyDependencies: z.array(z.string()),
  // Buy/Overweight decision predicates. Required string fields; empty
  // string for Hold/Sell/Underweight. The Buy/Overweight non-empty
  // requirement is enforced by the prompt, not the schema (BP-016 keeps
  // every field required, so empty string is the optional-when-Hold
  // pattern rather than `.optional()`).
  asymmetricEdge: z.string(),
  nearTermCatalyst: z.string(),
  invalidationTrigger: z.string(),
  // One disposition per trader dependency, referenced by its position
  // ([0], [1], …) in `trader.dependsOn` as rendered to the PM. The Phase 5
  // writer requires every trader-dependency index to appear here exactly
  // once: `carried` keeps it as a live contestable judgment, `dropped`
  // sets it aside with a one-sentence reason in `note`. Referencing by
  // index rather than re-typing the dependency text is what makes the
  // lineage check robust — the PM can paraphrase freely in
  // `keyDependencies` without orphaning a judgment.
  traderDependencyDispositions: z.array(
    z.object({
      index: z.number().int(),
      status: z.enum(["carried", "dropped"]),
      note: z.string(),
    }),
  ),
  // The scenario bucket this decision underwrites. Empty string when the
  // forecast is unavailable or the PM disagrees with all buckets.
  primaryScenario: z.string(),
  // Override reason: non-empty when the PM chooses a rating outside the
  // model-implied band. Empty string when staying within the band.
  ratingOverrideReason: z.string(),
  // Portfolio-fit verdict (Slice 5). STRICT per BP-016: an object of primitives
  // + one enum-of-literals (`action`); no record/optional/default/union, empty
  // string for the no-account case (the `asymmetricEdge` pattern). The PM is the
  // SOLE portfolio-fit arbiter. `suggestedAccount` is the account LABEL the LLM
  // reasons toward — the commit handler validates it against the real account
  // list (a hallucinated/absent label resolves to ""). The derived echo fields
  // (currentWeightPct / weightDeltaPct / hasPortfolioContext) are computed in the
  // commit, NOT emitted here.
  portfolioFit: z.object({
    action: z.enum(["initiate", "add", "trim", "exit", "hold"]),
    // Target weight as % of total NAV, post-trade. 0 for exit; current weight
    // for hold. When no portfolio was supplied, a weight relative to a notional
    // NAV (the prompt says to say so).
    targetWeightPct: z.number(),
    // Why this size, referencing existing position / cash / concentration / tax
    // account suitability. Non-empty always (the prompt instructs a
    // "no portfolio supplied" sentence when none).
    sizingRationale: z.string(),
    // One-line concentration read (sector/factor/overlap). Empty string only
    // when no portfolio context was available.
    concentrationRisk: z.string(),
    // The account LABEL the PM reasons toward (tax-suitability aware). Empty
    // string when no account is selected/available — the commit handler resolves
    // and validates this against the real account list.
    suggestedAccount: z.string(),
    // How lens convergence shaped the size. Required — forces the PM to state
    // the conviction→size link explicitly, framed as robustness not truth.
    // References <lensConvergence>; empty string only when the lens pack did not
    // run (fast preset).
    convictionBasis: z.string(),
  }),
  // FIX-752 — the PM's interpretive reading of the scenario-derived reward-to-risk
  // figure against the active risk mandate. NARRATIVE ONLY (BP-016 strict: three
  // required strings). The bright-line verdict and the size gate are DERIVED at
  // commit from the figure + the frozen mandate (the agreesWithTrader precedent),
  // so the model cannot assert its way past the standard. All "" on a
  // mandate-blind run.
  mandateFit: z.object({
    // How the derived reward-to-risk figure reads against the mandate's bar.
    rewardToRiskRead: z.string(),
    // How the mandate's appetite (kellyFraction) shaped the size you chose.
    sizeStance: z.string(),
    // Non-empty ONLY to lift the soft worth-it size cap when the mandate is NOT
    // cleared — you must name what the figure misses. "" otherwise and on a
    // mandate-blind run. Never lifts the hard capacity veto.
    mandateOverrideReason: z.string(),
  }),
});

export type PortfolioDecisionOutput = z.infer<typeof portfolioDecisionOutputSchema>;

export const portfolioManagerGenerator = generator({
  name: "portfolio-manager-generator",
  itemVisibility: { client: true, history: true },
  agentName: PHASE_5_MEMO_KEYS.portfolioManager.agentName,
  uses: [
    tradingDesk.presets({
      investmentThesis: true,
      tradeProposal: true,
      riskAssessment: true,
      scenarioForecast: true,
      valuationSpine: true,
      phase1MemosFull: true,
      phase2DebateFull: true,
      riskCritiquesFull: true,
      highReasoning: true,
      // Slice 5 — the PM sees the live portfolio and the lens-convergence read,
      // and reasons convergence -> conviction -> size to emit `portfolioFit`.
      portfolioContext: true,
      lensConvergence: true,
      // FIX-752 — the worth-it axis: the scenario-derived reward-to-risk figure
      // and the active risk-appetite mandate it is judged against.
      rewardToRisk: true,
      riskMandate: true,
      // FIX-760 — the PM weighs the user's STANDING thesis for a held name (their
      // durable "why" + invalidation conditions) when deciding and sizing the
      // portfolio-fit verdict. Thesis-blind when none is recorded.
      standingThesis: true,
    }),
  ],
  ...definePromptFile(portfolioManagerPrompt),
  sessionStateSchema,
  outputSchema: portfolioDecisionOutputSchema,
});

/**
 * The portfolio-manager's portable pre-commit body: the fast-model approach
 * preamble streams its plan, then the structured `portfolioManagerGenerator`
 * writes the typed `PortfolioDecision`. No memo writes — `defineMemoStep`
 * wraps this with the keyed `markWriting → … → commit → rescue(markError)`
 * lifecycle in `orchestration/stages.ts`.
 */
export const portfolioManagerBody = sequencer({
  name: "portfolio-manager-body",
})
  .step(portfolioManagerApproachGenerator)
  .step(portfolioManagerGenerator);
