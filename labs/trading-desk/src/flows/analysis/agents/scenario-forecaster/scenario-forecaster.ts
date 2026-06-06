/**
 * The Phase 5 scenario-forecaster generator and its output schema.
 *
 * Runs after the risk debate (Phase 4) and before the PM (Phase 5). Reads
 * the same upstream artifacts the PM reads — InvestmentThesis, TradeProposal,
 * RiskAssessment, and (on `full`) the Phase 1 analyst memos, debate
 * transcript, and persona critiques — and emits 3–5 named, probability-
 * weighted outcome scenarios for the ticker over the trade window.
 *
 * `itemVisibility: { client: true, history: true }` so the structured
 * `TxStruct` card renders in the transcript.
 *
 * The output schema lives inline here because only this generator emits the
 * shape; the Phase 5 writer imports the type back to project the commit.
 * `horizon` and `probabilitySum` are writer projections, not model output.
 */
import { generator, sequencer } from "@flow-state-dev/core";
import { definePromptFile } from "@flow-state-dev/core/prompt-file";
import { z } from "zod";
import { PHASE_5_MEMO_KEYS } from "../../registry";
import { tradingDesk } from "../../capability";
import { thesisSection } from "../../resources/memos";
import { sessionStateSchema } from "../../state";
import { loadPrompt } from "../../lib/prompt";
import { scenarioForecasterApproachGenerator } from "./approach";

const scenarioForecasterPrompt = loadPrompt(
  "agents/scenario-forecaster/prompts/scenario-forecaster.prompt.md",
);

const scenarioSchema = z.object({
  name: z.string(),
  probability: z.number().min(0).max(1),
  trigger: z.string(),
  triggerSource: z.enum([
    "investmentThesis",
    "tradeProposal",
    "riskAssessment",
    "phase1",
  ]),
  expectedOutcome: z.string(),
  tradeBehavior: z.string(),
});

export const scenarioForecastOutputSchema = z.object({
  label: z.string(),
  headline: z.string(),
  rating: z.string(),
  metrics: z.object({
    horizon: z.string(),
    distribution: z.string(),
    buckets: z.string(),
    evidence: z.string(),
  }),
  body: z.array(thesisSection),
  scenarios: z.array(scenarioSchema).min(3).max(5),
  distribution: z.enum(["concentrated", "balanced", "barbell", "long-tail"]),
  evidenceBasis: z.enum(["sufficient", "thin"]),
});

export type ScenarioForecastOutput = z.infer<typeof scenarioForecastOutputSchema>;

export const scenarioForecasterGenerator = generator({
  name: "scenario-forecaster-generator",
  itemVisibility: { client: true, history: true },
  agentName: PHASE_5_MEMO_KEYS.scenarioForecast.agentName,
  uses: [
    tradingDesk.presets({
      investmentThesis: true,
      tradeProposal: true,
      riskAssessment: true,
      valuationSpine: true,
      phase1MemosFull: true,
      phase2DebateFull: true,
      riskCritiquesFull: true,
      highReasoning: true,
    }),
  ],
  ...definePromptFile(scenarioForecasterPrompt),
  sessionStateSchema,
  outputSchema: scenarioForecastOutputSchema,
});

/**
 * The scenario-forecaster's portable pre-commit body: the fast-model approach
 * preamble streams its plan, then the structured `scenarioForecasterGenerator`
 * writes the typed scenario forecast. No memo writes — `defineMemoStep` wraps
 * this with the keyed `markWriting → … → commit → rescue(markError)` lifecycle
 * in `orchestration/stages.ts`.
 */
export const scenarioForecasterBody = sequencer({
  name: "scenario-forecaster-body",
})
  .step(scenarioForecasterApproachGenerator)
  .step(scenarioForecasterGenerator);
