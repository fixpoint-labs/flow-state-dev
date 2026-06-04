/**
 * `phase2bPipeline` — the investor-lens pack (Slice 5).
 *
 * Runs AFTER Phase 2 and BEFORE Phase 3 in `analyzePipeline` (BUILD_PLAN §7:
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
 * whole phase is COST-GATED at the call site in `flow.ts`: it runs only on
 * `costPreset === "full"` (RISK-F3).
 */
import { sequencer } from "@flow-state-dev/core";
import { LENS_PACK } from "../lib/lenses";
import { defineLensStep } from "./lens-step";
import { setupLensMemos } from "./setup";
import { computeAndStoreConvergence } from "./writer";

/** One independent lens sub-sequencer per pack entry, chained SEQUENTIALLY (see
 *  the file header — each lens is blind to the others regardless). */
const lensSteps = LENS_PACK.map((lens) => defineLensStep(lens));

export const phase2bPipeline = lensSteps
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
