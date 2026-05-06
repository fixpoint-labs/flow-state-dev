import type { BlockDefinition } from "@flow-state-dev/core/types";
import type { BlockOutputItem, OutputItem } from "@flow-state-dev/core/items";
import { testBlock } from "./testBlock";
import type {
  BlockInput,
  BlockOutput,
  StepTrace,
  TestBlockOptions,
  TestSequencerResult,
  WorkTrace
} from "./types";

type StepAccumulator = {
  stepName: string;
  blockName: string;
  phase: "main" | "work";
  items: Array<OutputItem | BlockOutputItem>;
  output: unknown;
  error: Error | null;
};

function buildStepTraces(items: Array<OutputItem | BlockOutputItem>): StepTrace[] {
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

    if ((item as { type: string }).type === "block_output") {
      current.output = (item as unknown as BlockOutputItem).output;
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

function buildWorkTraces(steps: StepTrace[]): WorkTrace[] {
  return steps
    .filter((step) => step.phase === "work")
    .map((step) => ({
      blockName: step.blockName,
      output: step.output,
      error: step.error,
      items: step.items
    }));
}

function inferLoopIterations(items: Array<OutputItem | BlockOutputItem>): number {
  const maxStep = items.reduce((max, item) => {
    if (item.provenance.stepIndex === undefined) {
      return max;
    }

    return Math.max(max, item.provenance.stepIndex);
  }, -1);

  return maxStep < 0 ? 0 : maxStep + 1;
}

/**
 * Executes a sequencer block and returns sequencer-focused traces.
 */
export async function testSequencer<TBlock extends BlockDefinition<any, any>>(
  sequencer: TBlock,
  options: TestBlockOptions<BlockInput<TBlock>>
): Promise<TestSequencerResult<BlockOutput<TBlock>>> {
  const base = await testBlock(sequencer, options);
  const items = base.items as Array<OutputItem | BlockOutputItem>;
  const steps = buildStepTraces(items);

  return {
    ...base,
    steps,
    workResults: buildWorkTraces(steps),
    loopIterations: inferLoopIterations(items)
  };
}
