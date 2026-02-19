import type { OutputItem } from "@flow-state-dev/core/items";
import type { StepTrace } from "../test-utilities/types";

export type SnapshotTrace = {
  requestId: string;
  flowKind?: string;
  actionName?: string;
  steps: Array<{
    blockName: string;
    blockKind: "handler" | "generator" | "sequencer" | "router";
    phase: "main" | "work";
    inputSummary: unknown;
    outputSummary: unknown;
    error?: string;
    durationMs: number;
  }>;
  items: Array<{
    itemIndex: number;
    type: OutputItem["type"];
    status: OutputItem["status"];
    blockName: string;
    phase: "main" | "work";
  }>;
};

function inferBlockKind(stepName: string): "handler" | "generator" | "sequencer" | "router" {
  const lowered = stepName.toLowerCase();

  if (lowered.includes("router")) {
    return "router";
  }

  if (lowered.includes("generator")) {
    return "generator";
  }

  if (lowered.includes("sequencer") || lowered.includes("step")) {
    return "sequencer";
  }

  return "handler";
}

/**
 * Produces a stable trace summary shape for snapshot assertions.
 */
export function snapshotTrace(result: {
  items: OutputItem[];
  steps?: StepTrace[];
  requestId?: string;
  actionName?: string;
  flowKind?: string;
}): SnapshotTrace {
  const sortedItems = [...result.items].sort((left, right) => left.itemIndex - right.itemIndex);

  return {
    requestId: result.requestId ?? sortedItems[0]?.requestId ?? "unknown-request",
    flowKind: result.flowKind,
    actionName: result.actionName,
    steps: (result.steps ?? []).map((step) => ({
      blockName: step.blockName,
      blockKind: inferBlockKind(step.stepName || step.blockName),
      phase: step.phase,
      inputSummary: step.input,
      outputSummary: step.output,
      error: step.error?.message,
      durationMs: step.durationMs
    })),
    items: sortedItems.map((item) => ({
      itemIndex: item.itemIndex,
      type: item.type,
      status: item.status,
      blockName: item.provenance.blockName,
      phase: item.provenance.phase
    }))
  };
}
