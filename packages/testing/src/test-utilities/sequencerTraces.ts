/**
 * A sequencer's step and side-chain traces, read from the items its run
 * emitted. `testBlock` attaches them to a sequencer's result.
 */
import type { RuntimeItem } from "@flow-state-dev/core/items";
import type { SequencerDefinition } from "@flow-state-dev/core";
import type { StepTrace, SideChainTrace, TestBlockResult } from "./types";

/** The fields a sequencer's result carries beyond every block's. */
type SequencerTraces = Pick<
  TestBlockResult<unknown, SequencerDefinition<any, any, any, any>>,
  "steps" | "sideChainResults" | "loopIterations"
>;

function buildStepTraces(items: RuntimeItem[]): StepTrace[] {
  const map = new Map<string, StepTrace>();

  for (const item of items) {
    const stepIndex = item.provenance.stepIndex ?? -1;
    const blockName = item.provenance.blockName;
    const phase = item.provenance.phase;
    const key = `${phase}:${stepIndex}:${blockName}`;

    const current: StepTrace = map.get(key) ?? {
      stepName: stepIndex < 0 ? blockName : `step-${stepIndex}`,
      blockName,
      input: undefined,
      output: undefined,
      error: null,
      items: [],
      durationMs: 0,
      phase,
      skipped: false
    };

    current.items.push(item);

    if (item.type === "block_trace") {
      current.output = item.output;
      if (item.error !== undefined) {
        current.error = new Error(item.error.message);
      }
    }

    map.set(key, current);
  }

  return Array.from(map.values());
}

function buildSideChainTraces(steps: StepTrace[]): SideChainTrace[] {
  return steps
    .filter((step) => step.phase === "sideChain")
    .map((step) => ({
      blockName: step.blockName,
      output: step.output,
      error: step.error,
      items: step.items
    }));
}

function inferLoopIterations(items: RuntimeItem[]): number {
  const maxStep = items.reduce((max, item) => {
    if (item.provenance.stepIndex === undefined) {
      return max;
    }

    return Math.max(max, item.provenance.stepIndex);
  }, -1);

  return maxStep < 0 ? 0 : maxStep + 1;
}

/** The step, side-chain and loop traces of a sequencer's items. */
export function sequencerTraces(items: RuntimeItem[]): SequencerTraces {
  const steps = buildStepTraces(items);
  return {
    steps,
    sideChainResults: buildSideChainTraces(steps),
    loopIterations: inferLoopIterations(items)
  };
}
