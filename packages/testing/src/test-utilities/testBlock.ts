import type { BlockDefinition } from "@flow-state-dev/core/types";
import { sequencer } from "@flow-state-dev/core";
import { executeBlock } from "@flow-state-dev/server";
import type { OutputItem, StateChangeItem } from "@flow-state-dev/core/items";
import { z } from "zod";
import { createTestContext } from "../runtime/createTestContext";
import type {
  BlockInput,
  BlockOutput,
  TestBlockOptions,
  TestBlockResult
} from "./types";

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}


function inferSequencerStateFromChanges(stateChanges: Array<{ scope: string; resultingState: Record<string, unknown> }>): Record<string, unknown> {
  const latest = [...stateChanges]
    .reverse()
    .find((change) => change.scope === "block_instance");

  return latest?.resultingState ?? {};
}

function toTrackedStateChanges(items: OutputItem[]): Array<{
  scope: "block_instance";
  operation: "patchState" | "setState" | "incState" | "pushState" | "setStateRecord" | "deleteStateRecord" | "atomicState";
  args: unknown[];
  resultingState: Record<string, unknown>;
  targetInstanceId?: string;
}> {
  return items
    .filter((item): item is StateChangeItem => item.type === "state_change" && item.scope === "block_instance")
    .map((item) => ({
      scope: "block_instance",
      operation:
        item.operation === "patch"
          ? "patchState"
          : item.operation === "set"
            ? "setState"
            : item.operation === "increment"
              ? "incState"
              : item.operation === "push"
                ? "pushState"
                : item.operation === "delete_key"
                  ? "deleteStateRecord"
                  : "atomicState",
      args: [],
      resultingState: {},
      targetName: item.provenance.blockName,
      targetInstanceId: item.blockInstanceId
    }));
}
/**
 * Executes one block with seeded scope state and returns deterministic test artifacts.
 *
 * Types are inferred from the block's Zod schema parameters:
 * - Input type is derived from the block's `inputSchema` property
 * - Output type is derived from the block's `outputSchema` property
 */
export async function testBlock<TBlock extends BlockDefinition<any, any>>(
  block: TBlock,
  options: TestBlockOptions<BlockInput<TBlock>>
): Promise<TestBlockResult<BlockOutput<TBlock>>> {
  const startedAt = Date.now();
  const runtime = await createTestContext({
    flow: options.flow,
    request: options.request,
    session: options.session,
    user: options.user,
    org: options.org,
    targets: options.targets,
    tools: options.tools,
    generators: options.generators,
    models: options.models,
    unmockedGeneratorPolicy: options.unmockedGeneratorPolicy,
    actionName: `test:${block.name}`,
    sessionId: "test-session",
    sequencerName: block.name
  });

  const blockUnderTest =
    options.sequencer !== undefined && block.kind !== "sequencer"
      ? sequencer({
          name: options.sequencer.name ?? `${block.name}-sequencer`,
          inputSchema: z.any(),
          stateSchema: z.record(z.string(), z.unknown())
        }).step(block)
      : block;

  const result = await executeBlock({
    block: blockUnderTest,
    input: options.input,
    ctx: runtime.ctx
  });

  const items = runtime.getItems();
  const itemStateChanges = toTrackedStateChanges(items);

  return {
    output: result.output as BlockOutput<TBlock>,
    error: result.error ?? null,
    items,
    state: {
      request: asRecord(runtime.ctx.request.state),
      session: asRecord(runtime.ctx.session.state),
      user: asRecord(runtime.ctx.user.state),
      org: asRecord(runtime.ctx.org?.state),
      sequencer:
        options.sequencer === undefined
          ? asRecord(runtime.ctx.sequencer?.state)
          : inferSequencerStateFromChanges(runtime.stateChanges)
    },
    stateChanges: [...runtime.stateChanges, ...itemStateChanges],
    meta: {
      durationMs: Date.now() - startedAt,
      blockName: block.name,
      retryAttempts: Math.max(1, block.config.retry?.maxAttempts ?? 1)
    }
  };
}
