/**
 * A sequencer's step and side-chain traces, read from the items its run
 * emitted. `testBlock` attaches them to a sequencer's result.
 */
import type { BlockTraceItem, OutputItem } from "@flow-state-dev/core/items";
import type { SequencerDefinition } from "@flow-state-dev/core";
import type { StepTrace, SideChainTrace, TestBlockResult } from "./types";

/** The fields a sequencer's result carries beyond every block's. */
type SequencerTraces = Pick<
  TestBlockResult<unknown, SequencerDefinition<any, any, any, any>>,
  "steps" | "sideChainResults" | "loopIterations"
>;

type StepAccumulator = {
  stepName: string;
  blockName: string;
  phase: "main" | "sideChain";
  items: Array<OutputItem | BlockTraceItem>;
  output: unknown;
  error: Error | null;
};

function buildStepTraces(items: Array<OutputItem | BlockTraceItem>): StepTrace[] {
  const map = new Map<string, StepAccumulator>();

  for (const item of items) {
    const stepIndex = item.provenance.stepIndex ?? -1;
    const blockName = item.provenance.blockName;
    const phase = item.provenance.phase;
    const key = `${phase}:${stepIndex}:${blockName}`;

    const current = map.get(key) ?? {
      stepName: stepIndex < 0 ? blockName : `step-${stepIndex}`,
      blockName,
      phase,
      items: [],
      output: undefined,
      error: null
    };

    current.items.push(item);

    if ((item as { type: string }).type === "block_trace") {
      const blockOutput = item as unknown as BlockTraceItem;
      current.output = blockOutput.output;
      if (blockOutput.error !== undefined) {
        current.error = new Error(blockOutput.error.message);
      }
    }

    map.set(key, current);
  }

  const traces: StepTrace[] = [];
  for (const entry of map.values()) {
    traces.push({
      stepName: entry.stepName,
      blockName: entry.blockName,
      input: undefined,
      output: entry.output,
      error: entry.error,
      items: entry.items,
      durationMs: 0,
      phase: entry.phase,
      skipped: false
    });
  }

  return traces;
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

function inferLoopIterations(items: Array<OutputItem | BlockTraceItem>): number {
  const maxStep = items.reduce((max, item) => {
    if (item.provenance.stepIndex === undefined) {
      return max;
    }

    return Math.max(max, item.provenance.stepIndex);
  }, -1);

  return maxStep < 0 ? 0 : maxStep + 1;
}

/** The step, side-chain and loop traces of a sequencer's items. */
export function sequencerTraces(items: Array<OutputItem | BlockTraceItem>): SequencerTraces {
  const steps = buildStepTraces(items);
  return {
    steps,
    sideChainResults: buildSideChainTraces(steps),
    loopIterations: inferLoopIterations(items)
  };
}
