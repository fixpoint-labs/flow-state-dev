import type { BlockDefinition } from "@flow-state-dev/core/types";
import { sequencer } from "@flow-state-dev/core";
import { executeBlock } from "@flow-state-dev/engine";
import type { BlockTraceItem, OutputItem, StateChangeItem } from "@flow-state-dev/core/items";
import { z } from "zod";
import { asRecord } from "../internal/json-helpers";
import { createTestContext } from "../runtime/createTestContext";
import { sequencerTraces } from "./sequencerTraces";
import type {
  BlockInput,
  BlockOutput,
  TestBlockOptions,
  TestBlockResult
} from "./types";


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
 * The route a router chose in this run, read from the `router_decision` item
 * the engine emits for it. Each run reads its own items, so concurrent runs of
 * one router definition never see each other's choice. Matched by the
 * router's name, which `connectInput` keeps. The last match wins: a router
 * that retries decides once per attempt, and the last attempt is the one
 * that produced the result.
 */
function selectedRouteOf(router: BlockDefinition<any, any>, items: ReadonlyArray<{ type: string }>): string | undefined {
  let selected: string | undefined;
  for (const item of items) {
    if (item.type !== "router_decision") continue;
    const decision = item as { routerName?: string; selectedRoute?: string };
    if (decision.routerName === router.name) selected = decision.selectedRoute;
  }
  return selected;
}

/**
 * Executes one block with seeded scope state and returns deterministic test artifacts.
 *
 * Types are inferred from the block's Zod schema parameters:
 * - Input type is derived from the block's `inputSchema` property
 * - Output type is derived from the block's `outputSchema` property
 *
 * The result depends on the block's kind: a sequencer's also carries its
 * `steps`, `sideChainResults` and `loopIterations`; a router's names the
 * route it chose in `selectedRoute`.
 */
export async function testBlock<TBlock extends BlockDefinition<any, any>>(
  block: TBlock,
  options: TestBlockOptions<BlockInput<TBlock>>
): Promise<TestBlockResult<BlockOutput<TBlock>, TBlock>> {
  const base = await runBlock(block, options);
  const selectedRoute = block.kind === "router" ? selectedRouteOf(block, base.items) : undefined;
  const kindFields =
    block.kind === "sequencer"
      ? sequencerTraces(base.items as Array<OutputItem | BlockTraceItem>)
      : selectedRoute !== undefined
        ? { selectedRoute }
        : {};
  return { ...base, ...kindFields } as TestBlockResult<BlockOutput<TBlock>, TBlock>;
}

async function runBlock<TBlock extends BlockDefinition<any, any>>(
  block: TBlock,
  options: TestBlockOptions<BlockInput<TBlock>>
): Promise<TestBlockResult<BlockOutput<TBlock>>> {
  const startedAt = Date.now();
  const runtime = await createTestContext({
    flow: options.flow,
    flowConfig: options.flowConfig,
    request: options.request,
    session: options.session,
    user: options.user,
    org: options.org,
    targets: options.targets,
    tools: options.tools,
    generators: options.generators,
    models: options.models,
    unmockedGeneratorPolicy: options.unmockedGeneratorPolicy,
    modelResolver: options.modelResolver,
    unmockedDefault: options.unmockedDefault,
    actionName: `test:${block.name}`,
    sessionId: "test-session",
    sequencerName: block.name,
    // Wire the block's declared resources (bubbled up from descendants) into the
    // synthetic flow so `ctx.resources.X` exists for blocks that declare a
    // `resources:` slot — matching production's flow.resources registration.
    declaredResources: block.declaredResources
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
    // The registry the run actually wrote through, not a copy — a test asserting
    // on written rows reads them here instead of hand-rolling a context and
    // dispatching `execute` directly, which would skip `executeBlock` above.
    resources: (runtime.ctx.resources ?? {}) as Record<string, unknown>,
    meta: {
      durationMs: Date.now() - startedAt,
      blockName: block.name,
      retryAttempts: Math.max(1, block.config.retry?.maxAttempts ?? 1)
    }
  };
}
