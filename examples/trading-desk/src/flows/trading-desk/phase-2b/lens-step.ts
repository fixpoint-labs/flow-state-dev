/**
 * `defineLensStep({ lens })` — per-lens sub-sequencer factory (BP-024).
 *
 * Mirrors `defineAnalyst`'s recipe: each lens step is
 *   .tap(markWriting) → .step(lensGenerator) → .tap(commitLensVerdict)
 * wrapped in a per-step `.rescue([markError])` so one lens failing flips only
 * that lens's memo to `error` (with a captured message) — the remaining lenses
 * still run and the convergence tap simply omits the errored lens.
 *
 * These steps are chained SEQUENTIALLY in `index.ts` (see that file's header for
 * why), but each lens is still BLIND to the others — the persona is closed over
 * in `defineLensGenerator` and the generator's `uses` reads only the shared
 * post-Phase-2 bundle, never another lens's memo. Independence, not parallelism,
 * is the honesty contract (FIX-655).
 */
import { sequencer, type BlockDefinition } from "@flow-state-dev/core";
import type { LensId } from "../agents";
import type { InvestorLens } from "../lib/lenses";
import { defineLensGenerator } from "./lens-generator";
import { commitLensVerdict, markErrorP2b, markWritingP2b } from "./writer";

/** Build one lens sub-sequencer ready to drop into the phase-2b `.parallel`. */
export function defineLensStep(lens: InvestorLens): BlockDefinition {
  const lensId = lens.id as LensId;
  return sequencer({ name: `phase-2b-lens-${lensId}-step` })
    .tap(markWritingP2b(lensId))
    .step(defineLensGenerator(lens))
    .tap(commitLensVerdict(lensId))
    .rescue([{ block: markErrorP2b(lensId) }]);
}
