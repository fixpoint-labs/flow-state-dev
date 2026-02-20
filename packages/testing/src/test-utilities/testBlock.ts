import { executeBlock } from "@flow-state-dev/server";
import { createTestContext } from "../runtime/createTestContext";
import type {
  TestBlockOptions,
  TestBlockResult,
  TestableBlock
} from "./types";

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

/**
 * Executes one block with seeded scope state and returns deterministic test artifacts.
 */
export async function testBlock<TInput, TOutput>(
  block: TestableBlock<TInput, TOutput>,
  options: TestBlockOptions<TInput>
): Promise<TestBlockResult<TOutput>> {
  const startedAt = Date.now();
  const runtime = await createTestContext<TInput>({
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
    output: result.output as TOutput,
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
