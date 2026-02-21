import type { BlockDefinition } from "@flow-state-dev/core/types";
import { executeBlock } from "@flow-state-dev/server";
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
    request: options.request,
    session: options.session,
    user: options.user,
    project: options.project,
    targets: options.targets,
    tools: options.tools,
    generators: options.generators,
    models: options.models,
    unmockedGeneratorPolicy: options.unmockedGeneratorPolicy,
    actionName: `test:${block.name}`,
    sessionId: options.session === undefined ? undefined : "test-session"
  });

  const result = await executeBlock({
    block,
    input: options.input,
    ctx: runtime.ctx
  });

  return {
    output: result.output as BlockOutput<TBlock>,
    error: result.error ?? null,
    items: runtime.getItems(),
    state: {
      request: asRecord(runtime.ctx.request.state),
      session: asRecord(runtime.ctx.session?.state),
      user: asRecord(runtime.ctx.user.state),
      project: asRecord(runtime.ctx.project?.state)
    },
    stateChanges: runtime.stateChanges,
    meta: {
      durationMs: Date.now() - startedAt,
      blockName: block.name,
      retryAttempts: Math.max(1, block.config.retry?.maxAttempts ?? 1)
    }
  };
}
