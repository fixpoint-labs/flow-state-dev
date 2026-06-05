/**
 * The per-phase stage assemblies for the trading-desk pipeline.
 *
 * Each exported `const` is one stage of the analysis sequence — the literal
 * relocation of what used to live in a `phase-N` index file. A stage taps its
 * group's `setup*Memos` (precreating that group's memos in `pending`), then
 * runs the group's bundled participant steps (the fan-out `.parallel`, the
 * research round-robin + writers, the fixed risk chain, etc.). The bundled
 * steps and the `setup*Memos` / `writer.ts` lifecycle live with their agent
 * group under `agents/<group>/`; this file only decides ORDER and assembles
 * them into the per-phase containers.
 *
 * The container `component` ("phase-..." / "analyst-phase") strings are LOAD
 * BEARING: the DevTool TranscriptPane keys its phase-divider beats on them.
 * They are preserved verbatim from the old phase indexes. "Phase" dies as
 * code structure but lives on as the user-visible render-time sequence.
 *
 * Import direction is one-way: orchestration imports agents; agents never
 * import orchestration (BP-019 — keep the graph acyclic).
 */
import { sequencer } from "@flow-state-dev/core";
import {
  companyProfileAnalyst,
  disclosureAnalyst,
  fundamentalsAnalyst,
  macroAnalyst,
  marketAnalyst,
  newsAnalyst,
  quantAnalyst,
  sentimentAnalyst,
  technicalAnalyst,
} from "../agents/analysts/analysts";
import { setupPhase1Memos } from "../agents/analysts/setup";
import {
  consolidateBearMemo,
  consolidateBullMemo,
  researchManagerGenerator,
} from "../agents/research/generators";
import {
  deriveDebateGoal,
  phase2RoundRobin,
} from "../agents/research/round-robin";
import { setupPhase2Memos } from "../agents/research/setup";
import { validateCitations } from "../agents/research/validate-citations";
import {
  commitBearMemo,
  commitBullMemo,
  commitResearchManagerMemo,
} from "../agents/research/writer";
import { LENS_PACK } from "../agents/lenses/lenses";
import { defineLensGenerator } from "../agents/lenses/lens-generator";
import { setupLensMemos } from "../agents/lenses/setup";
import { commitLensVerdict, computeAndStoreConvergence } from "../agents/lenses/writer";
import { defineMemoStep } from "../agents/_recipe/memo-writer";
import type { LensId } from "../registry";
import { setupPhase3Memos } from "../agents/trader/setup";
import { traderBody } from "../agents/trader/trader";
import { commitTraderMemo } from "../agents/trader/writer";
import { riskAssessmentBody } from "../agents/risk/consolidator";
import {
  aggressiveBody,
  conservativeBody,
  neutralBody,
} from "../agents/risk/personas";
import { setupPhase4Memos } from "../agents/risk/setup";
import {
  commitPersonaMemo,
  commitRiskAssessmentMemo,
} from "../agents/risk/writer";
import { portfolioManagerBody } from "../agents/portfolio-manager/portfolio-manager";
import { scenarioForecasterBody } from "../agents/scenario-forecaster/scenario-forecaster";
import { setupPhase5Memos } from "../agents/portfolio-manager/setup";
import { setupScenarioForecastMemos } from "../agents/scenario-forecaster/setup";
import { commitPortfolioManagerMemo } from "../agents/portfolio-manager/writer";
import { commitScenarioForecastMemo } from "../agents/scenario-forecaster/writer";
import { thesisValidatorBody } from "../agents/thesis-validator/thesis-validator";
import { setupPhase6Memos } from "../agents/thesis-validator/setup";
import { commitThesisAlignmentMemo } from "../agents/thesis-validator/writer";

/**
 * `analystFanOut` — the Phase 1 stage.
 *
 * Pre-creates the nine memo slots, then runs the nine analyst sub-sequencers
 * in parallel. The container `component: "analyst-phase"` is what the
 * transcript pane keys on to render the "Phase 1 — Analyst Fan-out begins"
 * divider; the `label` matches the canonical Design Reference string
 * verbatim so the divider copy is consistent across runs.
 */
export const analystFanOut = sequencer({
  name: "phase-1-analysts",
  container: {
    component: "analyst-phase",
    label: "Phase 1 — Analyst Fan-out begins. 9 analysts dispatched (6 concurrent).",
  },
})
  .tap(setupPhase1Memos)
  .parallel(
    {
      fundamentals: fundamentalsAnalyst,
      sentiment: sentimentAnalyst,
      news: newsAnalyst,
      technical: technicalAnalyst,
      companyProfile: companyProfileAnalyst,
      market: marketAnalyst,
      macro: macroAnalyst,
      quant: quantAnalyst,
      disclosure: disclosureAnalyst,
    },
    { maxConcurrency: 6 },
  );

/**
 * `researchStage` — the Phase 2 stage.
 *
 * Runs after Phase 1: pre-creates three p2 memos in `pending`, derives the
 * debate goal from session state, runs the bull/bear `roundRobin()` (one
 * instance with `terminateWhen` driving rounds from session state and
 * `uses: [tradingDesk]` resolving the model from `costPreset`), then writes
 * bull, bear, and research-manager memos in sequence — each wrapped in its
 * own sub-sequencer with a per-step rescue. Mirrors Phase 1's
 * `defineAnalyst` idiom: if one generator throws, only that memo flips to
 * `error` (with a captured `errorMessage`); the remaining steps still run.
 *
 * Why per-step rescue, not pipeline-level: a single outer `.rescue([...])`
 * over a multi-step chain is undiagnosable — you can't tell which step
 * failed without scanning state, and downstream steps never run. Per-step
 * rescue surfaces the failing memo's identity directly and keeps the
 * pipeline producing whatever artifacts it still can.
 *
 * The round-robin shares `phase2Contributions` (registered on the flow's
 * resources map) with the three post-loop consolidation generators, which
 * read the running transcript via `ctx.resources` rather than threading it
 * through the sub-sequencer's state.
 */
const bullStep = defineMemoStep(consolidateBullMemo, {
  key: "bull",
  commit: commitBullMemo,
});

const bearStep = defineMemoStep(consolidateBearMemo, {
  key: "bear",
  commit: commitBearMemo,
});

const researchManagerStep = defineMemoStep(researchManagerGenerator, {
  key: "researchManager",
  commit: commitResearchManagerMemo,
});

export const researchStage = sequencer({
  name: "phase-2-research-debate",
  container: {
    component: "phase-2-debate",
    label:
      "Phase 2 — Research Debate begins. Bull and Bear take turns; Research Manager synthesizes.",
  },
})
  .tap(setupPhase2Memos)
  .step(deriveDebateGoal)
  .step(phase2RoundRobin)
  .tap(validateCitations)
  .step(bullStep)
  .step(bearStep)
  .step(researchManagerStep);

/**
 * `lensStage` — the investor-lens pack (Slice 5).
 *
 * Runs AFTER Phase 2 and BEFORE Phase 3 in `analyze.ts` (BUILD_PLAN §7:
 * pre-decision placement, so convergence is a CONTEXT INPUT the PM reasons with,
 * not a post-hoc cap). It is its own phase container so the transcript renders a
 * divider.
 *
 * Shape:
 *   .tap(setupLensMemos)              // pre-create N lens memos in `pending`
 *   .step(lensStep) × N (SEQUENTIAL)  // one independent lens per step
 *   .tap(computeAndStoreConvergence)  // DETERMINISTIC convergence → resource
 *
 * INDEPENDENCE, NOT PARALLELISM, is the honesty guarantee (FIX-655). The lenses
 * run SEQUENTIALLY — but each lens reads ONLY the shared post-Phase-2 bundle
 * (investmentThesis + phase1Memos + valuationSpine) via `defineLensGenerator`,
 * NEVER another lens's memo, so they are still blind to each other. This is NOT
 * a staged debate; it is N independent reads of the same evidence, exactly as
 * spec 07 §13 endorses ("sequential-with-shared-state still isolates each
 * generation's context to its own persona + the bundle").
 *
 * Why sequential and not parallel: this runtime does not merge ALL parallel
 * branches' collection writes back into the continuation's resource cache — only
 * the last branch's writes survive, so a convergence tap after a parallel
 * fan-out reads a stale view (3 of 4 lens memos still `pending`) even though the
 * durable store has them all. A sequential chain commits each lens memo before
 * the next runs, so the convergence tap sees all N. Each lens generator is still
 * blind, so the honesty contract holds. (Phase 4 runs its personas as a
 * sequential chain for the analogous reason — structured per-memo reads.)
 *
 * Convergence is computed arithmetic, never an LLM narrative (FIX-655). The
 * whole phase is COST-GATED at the call site in `analyze.ts`: it runs only on
 * `costPreset === "full"` (RISK-F3).
 */
/** One independent lens sub-sequencer per pack entry, chained SEQUENTIALLY (see
 *  the file header — each lens is blind to the others regardless). Each lens is
 *  placed via the shared `defineMemoStep` apparatus: its generator is the body,
 *  the per-lens commit is `commitLensVerdict`, and the keyed memo lifecycle
 *  (`markWriting → … → rescue(markError)`) is resolved from the registry. */
const lensSteps = LENS_PACK.map((lens) => {
  const lensId = lens.id as LensId;
  return defineMemoStep(defineLensGenerator(lens), {
    key: lensId,
    commit: commitLensVerdict(lensId),
  });
});

export const lensStage = lensSteps
  .reduce(
    (chain, step) => chain.step(step),
    sequencer({
      name: "phase-2b-lenses",
      container: {
        component: "phase-2b-lenses",
        label: "Lens Pack — Independent verdicts (not a debate).",
      },
    }).tap(setupLensMemos),
  )
  .tap(computeAndStoreConvergence);

/**
 * `traderStage` — the Phase 3 stage.
 *
 * Runs after Phase 2: pre-creates the trader memo in `pending`, then the
 * trader step pre-marks the memo `writing`, runs the trader body (approach
 * preamble → structured generator), and commits on success. A per-step rescue
 * flips the memo to `error` on generator failure — same shape as Phase 2's
 * per-step rescues. Placed via the shared `defineMemoStep` apparatus: the
 * `traderBody` is the body, `commitTraderMemo` is the commit, and the keyed
 * memo lifecycle is resolved from the registry.
 *
 * Container `component` must start with `"phase-"` so the TranscriptPane
 * phase-divider predicate fires. `label` matches the Claude Design handoff
 * verbatim.
 */
const traderStep = defineMemoStep(traderBody, {
  key: "trader",
  commit: commitTraderMemo,
});

export const traderStage = sequencer({
  name: "phase-3-trader",
  container: {
    component: "phase-3-trader",
    label: "Phase 3 — Trader Synthesis.",
  },
})
  .tap(setupPhase3Memos)
  .step(traderStep);

/**
 * `riskStage` — the Phase 4 stage.
 *
 * Runs after Phase 3: pre-creates four P4 memos in `pending`, then runs
 * three persona steps in fixed order (aggressive → conservative → neutral)
 * as a plain `.step()` chain, then runs the consolidation
 * `riskAssessmentGenerator` as a final step.
 *
 * Each persona step is placed via the shared `defineMemoStep` apparatus: the
 * persona body (approach preamble → structured generator) is the body, the
 * per-persona commit is `commitPersonaMemo(shortName)`, and the keyed memo
 * lifecycle (`markWriting → … → rescue(markError)`) is resolved from the
 * registry — so a single persona's failure flips only that memo to `error`
 * while the rest run. Downstream personas read prior persona memos via
 * memo-backed `context` entries on their generator definitions (see
 * `personas.ts`) — Phase 4 does not use the `roundRobin()` pattern because
 * none of its distinguishing features (multi-round debate, referee,
 * homogeneous roster, shared transcript readback) apply here. Phase 2's
 * bull/bear debate is the canonical `roundRobin()` demo in this example; see
 * the round-robin section of `labs/trading-desk/CLAUDE.md`.
 *
 * Container `component` starts with `"phase-"` so the TranscriptPane
 * phase-divider predicate fires. `label` matches the design comment
 * verbatim ("Phase 4 — Risk Round-Robin. 3 risk officers, round-robin
 * order.").
 */
const aggressiveStep = defineMemoStep(aggressiveBody, {
  key: "aggressive",
  commit: commitPersonaMemo("aggressive"),
});

const conservativeStep = defineMemoStep(conservativeBody, {
  key: "conservative",
  commit: commitPersonaMemo("conservative"),
});

const neutralStep = defineMemoStep(neutralBody, {
  key: "neutral",
  commit: commitPersonaMemo("neutral"),
});

const riskAssessmentStep = defineMemoStep(riskAssessmentBody, {
  key: "riskAssessment",
  commit: commitRiskAssessmentMemo,
});

export const riskStage = sequencer({
  name: "phase-4-risk-debate",
  container: {
    component: "phase-4-risk-debate",
    label: "Phase 4 — Risk Round-Robin. 3 risk officers, round-robin order.",
  },
})
  .tap(setupPhase4Memos)
  .step(aggressiveStep)
  .step(conservativeStep)
  .step(neutralStep)
  .step(riskAssessmentStep);

/**
 * `forecastStage` + `portfolioStage` — the two Phase 5 stages. Phase 5 runs
 * two stages in order — the scenario forecaster, then the portfolio manager —
 * each its own top-level phase-divider container (composed sequentially in
 * `analyze.ts`).
 *
 *   - `forecastStage` — pre-creates the scenario-forecaster memo, then the
 *     forecaster step pre-marks it `writing`, runs the forecaster body
 *     (approach preamble → structured generator), and commits on success.
 *   - `portfolioStage` — pre-creates the portfolio-manager memo, then the PM
 *     step pre-marks it `writing`, runs the PM body (approach preamble →
 *     structured generator), and commits on success.
 *
 * Both steps are placed via the shared `defineMemoStep` apparatus: the
 * participant body is the body, the per-participant commit is the commit, and
 * the keyed memo lifecycle (`markWriting → … → rescue(markError)`) is resolved
 * from the registry. Each step's per-step rescue flips its memo to `error` on
 * generator failure or a writer integrity throw (`probability-violation` for
 * the forecaster, `lineage-violation` for the PM) — same shape as Phase 3's
 * single-step rescue.
 *
 * Container `component` must start with `"phase-"` so the TranscriptPane
 * phase-divider predicate fires. `label` matches the design reference's
 * Phase 5 divider lines.
 */
const scenarioForecasterStep = defineMemoStep(scenarioForecasterBody, {
  key: "scenarioForecast",
  commit: commitScenarioForecastMemo,
});

export const forecastStage = sequencer({
  name: "phase-5-scenario-forecaster",
  container: {
    component: "phase-5-scenario-forecaster",
    label: "Phase 5 — Scenario Forecaster.",
  },
})
  .tap(setupScenarioForecastMemos)
  .step(scenarioForecasterStep);

const portfolioManagerStep = defineMemoStep(portfolioManagerBody, {
  key: "portfolioManager",
  commit: commitPortfolioManagerMemo,
});

export const portfolioStage = sequencer({
  name: "phase-5-portfolio-manager",
  container: {
    component: "phase-5-portfolio-manager",
    label: "Phase 5 — Portfolio Manager decision.",
  },
})
  .tap(setupPhase5Memos)
  .step(portfolioManagerStep);

/**
 * `thesisAuditStage` — the Phase 6 stage (post-decision thesis audit).
 *
 * Runs after Phase 5, gated on a non-null `userThesis` (see `analyze.ts`). It
 * pre-creates the thesis-alignment memo in `pending`, then the validator step
 * pre-marks the memo `writing`, runs the validator body (approach preamble →
 * structured generator), and commits on success. Placed via the shared
 * `defineMemoStep` apparatus: `thesisValidatorBody` is the body,
 * `commitThesisAlignmentMemo` is the commit, and the keyed memo lifecycle
 * (`markWriting → … → rescue(markError)`) is resolved from the registry — so a
 * generator failure or an anti-yes-man enforcement throw flips the memo to
 * `error`, same shape as Phase 5's single-step rescue.
 *
 * Like Phases 3–5, a fast-model approach preamble streams before the
 * structured generator so the transcript shows a "Phase 6 Approach" beat —
 * it only appears when Phase 6 runs (a user thesis was provided).
 *
 * Container `component` must start with `"phase-"` so the TranscriptPane
 * phase-divider predicate fires.
 */
const validatorStep = defineMemoStep(thesisValidatorBody, {
  key: "thesisAlignment",
  commit: commitThesisAlignmentMemo,
});

export const thesisAuditStage = sequencer({
  name: "phase-6-thesis-audit",
  container: {
    component: "phase-6-thesis-audit",
    label: "Phase 6 — Thesis Audit.",
  },
})
  .tap(setupPhase6Memos)
  .step(validatorStep);
