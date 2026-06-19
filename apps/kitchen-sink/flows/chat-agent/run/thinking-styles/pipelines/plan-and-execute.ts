/**
 * Plan-and-execute pipeline — decomposes the request into steps, executes them,
 * and synthesizes a result. Replanning is enabled.
 */
import { planAndExecute } from "@flow-state-dev/patterns/plan-and-execute";
import type { PipelineConfig } from "./config";

/** Build the `pae-thinking` pipeline from the resolved router config. */
export function createPaePipeline(config: PipelineConfig) {
  return planAndExecute({
    name: "pae-thinking",
    model: config.modelId as any,
    instructions: config.instructions,
    context: config.context,
    history: config.history,
    search: true,
    uses: config.uses,
    enableReplanning: true,
  });
}
