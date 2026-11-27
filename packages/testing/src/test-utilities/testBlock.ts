import type { BlockDefinition, StateRef } from "@flow-state-dev/core/types";
import { cloneValue } from "@flow-state-dev/core/helpers";
import { mergeFlowScopeStateSchemas, walkBlockGraph } from "@flow-state-dev/core/internal";
import { sequencer } from "@flow-state-dev/core";
import { executeBlock } from "@flow-state-dev/engine";
import type { OutputItem, RuntimeItem, StateChangeItem } from "@flow-state-dev/core/items";
import { z } from "zod";
import { createTestContext, createTestFlow } from "../runtime/createTestContext";
import { sequencerTraces } from "./sequencerTraces";
import type {
  BlockInput,
  BlockOutput,
  TestBlockOptions,
  TestBlockResult
} from "./types";


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
function selectedRouteOf(router: BlockDefinition<any, any>, items: readonly RuntimeItem[]): string | undefined {
  let selected: string | undefined;
  for (const item of items) {
    if (item.type === "router_decision" && item.routerName === router.name) selected = item.selectedRoute;
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
      ? sequencerTraces(base.items)
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
  let flow = options.flow ?? createTestFlow({ ...options, declaredResources: block.declaredResources });
  if (flow.scopeStateSchemas === undefined) {
    // Hand-built and stand-alone flows have yet to collect their block declarations.
    flow = { ...flow, scopeStateSchemas: mergeFlowScopeStateSchemas(flow.kind, flow, walkBlockGraph([block])) };
  }
  const runtime = await createTestContext({
    flow,
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
    signal: options.signal,
    actionName: `test:${block.name}`,
    sessionId: "test-session"
  });

  let seededSequencer: StateRef | undefined;
  const seed = options.sequencer;
  const enterRootScope = runtime.ctx._withExecutionScope;
  if (block.kind === "sequencer" && seed !== undefined && enterRootScope !== undefined) {
    const requirement = (block.config as { sequencerStateSchema?: z.ZodTypeAny }).sequencerStateSchema;
    const fixtureSchema = z.object({}).passthrough().default(() => cloneValue(seed.state));

    // Open the real root scope so its steps share the fixture and keep their original paths.
    runtime.ctx._withExecutionScope = (scope, execute, signal, sideChainSignal) => {
      const declaredSchema = scope.stateSchema ?? requirement;
      return enterRootScope(
        { ...scope, stateSchema: declaredSchema ?? fixtureSchema },
        async (ctx) => {
          const state = ctx.self!;
          seededSequencer = state;
          if (declaredSchema !== undefined) {
            const initial = { ...state.state, ...cloneValue(seed.state) };
            const parsed = declaredSchema.safeParse(initial);
            const normalized = parsed.success && parsed.data !== null && typeof parsed.data === "object" && !Array.isArray(parsed.data)
              ? parsed.data
              : {};
            await state.setState({ ...initial, ...normalized });
          }
          return execute(ctx);
        },
        signal,
        sideChainSignal
      );
    };
  }

  const blockUnderTest =
    options.sequencer !== undefined && block.kind !== "sequencer"
      ? sequencer({
          name: options.sequencer.name ?? `${block.name}-sequencer`,
          inputSchema: z.any(),
          stateSchema: z.object({}).passthrough().default(cloneValue(options.sequencer.state))
        }).step((input, ctx) => {
          seededSequencer = ctx.sequencer;
          return input;
        }, block)
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
      request: runtime.ctx.request.state,
      session: runtime.ctx.session.state,
      user: runtime.ctx.user.state,
      org: runtime.ctx.org?.state ?? {},
      sequencer: seededSequencer?.state ?? {}
    },
    stateChanges: [...runtime.stateChanges, ...itemStateChanges],
    // The registry the run actually wrote through, not a copy — a test asserting
    // on written rows reads them here instead of hand-rolling a context and
    // dispatching `execute` directly, which would skip `executeBlock` above.
    resources: runtime.ctx.resources,
    meta: {
      durationMs: Date.now() - startedAt,
      blockName: block.name,
      retryAttempts: Math.max(1, block.config.retry?.maxAttempts ?? 1)
    }
  };
}
