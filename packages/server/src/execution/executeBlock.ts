/**
 * Central block execution entrypoint: dispatch, seam interception, retry, and error normalization.
 */
import type { BlockOutputItem, BlockValue, ItemProvenance, OutputItem } from "@flow-state-dev/core/items";
import type { BlockContext, BlockDefinition, BlockOutputHint } from "@flow-state-dev/core/types";
import { asRuntime } from "@flow-state-dev/core/types";
import type { CapabilityRef } from "@flow-state-dev/core";
import { getBaseCapability, resolveActiveStatusMessage } from "@flow-state-dev/core";
import { composeMiddleware, mergeMiddlewareStacks } from "../middleware/compose";
import type { BlockMiddlewareContext } from "../middleware/types";
import { buildBlockInstanceId, ROOT_BLOCK_PATH } from "@flow-state-dev/core";
import { normalizeError } from "../errors/normalize-error";
import { getResponseItems } from "./internal/response";
import {
  applyBlockInputSeam,
  applyBlockOutputSeam,
  applyNormalizedErrorSeam,
  emitGeneratorLifecycleSeam,
  NOOP_INTERNAL_EXECUTION_SEAMS,
  type InternalExecutionSeams
} from "./internal/seams";
import {
  DEFAULT_RUNTIME_LOGGER,
  createExecutionLogContext,
  logRuntimeEvent,
  summarizeForLog
} from "./logging";
import { mergeRetryPolicy, retryWithPolicy } from "./retry";
import type {
  ExecuteBlockContext,
  ExecuteBlockOptions,
  ExecuteBlockResult,
  ExecutionMetadata
} from "./types";
import { createExecutionMetadata } from "./types";

type ExecuteDispatcherOptions = {
  internalSeams: InternalExecutionSeams;
  metadata: ExecutionMetadata;
};

type GeneratorModelUsageMeta = {
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  providerMetadata?: Record<string, Record<string, unknown>>;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
};

function hasItemEmitter(response: unknown): response is {
  emitItemAdded: (item: BlockOutputItem) => Promise<unknown>;
  emitItemDone: (item: BlockOutputItem) => Promise<unknown>;
} {
  return (
    typeof response === "object" &&
    response !== null &&
    typeof (response as { emitItemAdded?: unknown }).emitItemAdded === "function" &&
    typeof (response as { emitItemDone?: unknown }).emitItemDone === "function"
  );
}

function createBlockOutputProvenance(
  metadata: ExecutionMetadata,
  blockName: string
): ItemProvenance {
  return {
    blockName,
    blockInstanceId: metadata.blockInstanceId!,
    parentBlockInstanceId: metadata.parentBlockInstanceId,
    phase: metadata.scope === "work" ? "work" : "main",
    stepIndex: metadata.stepIndex,
    workGroupId: metadata.workGroupId,
    attempt: metadata.attempt
  };
}



/**
 * Builds a BlockValue from the raw output and a caller-supplied hint (FIX-413).
 * Performs flatten-at-emit for refs: if the target item's own output is also
 * a ref, takes that inner sourceItemId instead so every emitted ref is one hop
 * from a content-bearing item.
 */
function buildBlockValueForEmit(
  output: unknown,
  hint: BlockOutputHint | undefined,
  items: OutputItem[]
): BlockValue<unknown> {
  if (hint === undefined || hint.kind === "inline") {
    return { kind: "inline", value: output };
  }
  if (hint.kind === "structure") {
    return { kind: "structure", shape: hint.shape };
  }
  // ref — flatten one hop if the target's own output is itself a ref.
  let sourceItemId = hint.sourceItemId;
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (item.type === "block_output" && item.id === sourceItemId) {
      const targetValue = (item as BlockOutputItem).output;
      if (targetValue !== undefined && typeof targetValue === "object" && "kind" in targetValue && targetValue.kind === "ref") {
        sourceItemId = targetValue.sourceItemId;
      }
      break;
    }
  }
  return { kind: "ref", sourceItemId };
}

async function emitBlockOutputItem(
  options: {
    block: BlockDefinition<any, any>;
    output: unknown;
    ctx: ExecuteBlockContext;
    metadata: ExecutionMetadata;
    startedAt: number;
    modelUsage?: GeneratorModelUsageMeta;
    status?: "completed" | "failed";
    error?: { message: string; code?: string };
    hint?: BlockOutputHint;
  }
): Promise<void> {
  if (!hasItemEmitter(options.ctx.response)) {
    return;
  }

  const completedAt = Date.now();
  const items = getResponseItems(options.ctx.response);
  const itemIndex = items.length;
  const blockValue = options.status === "failed"
    ? ({ kind: "inline", value: undefined } as BlockValue<unknown>)
    : buildBlockValueForEmit(options.output, options.hint, items);
  // Root block_output items carry lifecycle timing and are marked for trace.
  // Items with toolCall (generator tool results) are emitted separately and
  // do NOT pass through this function — they retain their existing LLM audience.
  const item: BlockOutputItem = {
    id: `item_block_output_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    type: "block_output",
    status: options.status ?? "completed",
    transient: options.block.transient || undefined,
    requestId: options.metadata.requestId,
    itemIndex,
    provenance: createBlockOutputProvenance(options.metadata, options.block.name),
    ts: completedAt,
    blockName: options.block.name,
    blockKind: options.block.kind,
    output: blockValue,
    error: options.error,
    startedAt: options.startedAt,
    completedAt,
    duration: completedAt - options.startedAt,
    modelUsage: options.modelUsage
  };

  await options.ctx.response.emitItemAdded(item);
  await options.ctx.response.emitItemDone(item);
}

/**
 * Dispatches block execution to the runtime for each supported block kind.
 *
 * Note: observability hooks (`onBlockDebugCapture`, `onConnectedInput`) are
 * installed on the shared `_runtimeHooks` inside `createExecutionContext`.
 * They're visible to every context (root and nested) via the same shared
 * reference, so this function no longer wires them per-block.
 */
async function executeByKind(
  block: BlockDefinition,
  input: unknown,
  ctx: ExecuteBlockContext,
  options: ExecuteDispatcherOptions
): Promise<{ output: unknown; modelUsage?: GeneratorModelUsageMeta }> {
  // Declarative activeStatusMessage → emitStatus. Fires before the block
  // actually runs so the in-flight indicator updates as soon as each block
  // enters execution. Nested sequencer/router children trigger their own
  // resolution via the core sequencer/router code paths.
  resolveActiveStatusMessage(block, input, ctx);
  if (block.kind === "generator") {
    const seams = options.internalSeams;
    let modelUsage: GeneratorModelUsageMeta | undefined;
    const runtimeHooks = {
      ...ctx._runtimeHooks,
      onGeneratorModelResult: (payload: {
        model: string;
        usage?: {
          promptTokens: number;
          completionTokens: number;
          totalTokens: number;
          cacheReadInputTokens?: number;
          cacheCreationInputTokens?: number;
        };
        providerMetadata?: Record<string, Record<string, unknown>>;
      }) => {
        if (payload.usage !== undefined) {
          const anthropic = payload.providerMetadata?.anthropic ?? {};
          // Prefer adapter-normalised cache fields; fall back to raw
          // Anthropic provider metadata for older call paths.
          const readTokens =
            payload.usage.cacheReadInputTokens ??
            (typeof anthropic.cacheReadInputTokens === "number"
              ? anthropic.cacheReadInputTokens : undefined);
          const creationTokens =
            payload.usage.cacheCreationInputTokens ??
            (typeof anthropic.cacheCreationInputTokens === "number"
              ? anthropic.cacheCreationInputTokens : undefined);
          modelUsage = {
            model: payload.model,
            promptTokens: payload.usage.promptTokens,
            completionTokens: payload.usage.completionTokens,
            totalTokens: payload.usage.totalTokens,
            providerMetadata: payload.providerMetadata,
            cacheReadTokens: readTokens,
            cacheCreationTokens: creationTokens
          };
        }
        ctx._runtimeHooks?.onGeneratorModelResult?.(payload);
      },
    };
    const generatorCtx = {
      ...ctx,
      _runtimeHooks: runtimeHooks
    };
    await emitGeneratorLifecycleSeam(seams, "before_execute", options.metadata);
    try {
      const output = await asRuntime(block).run(input, generatorCtx as any);
      await emitGeneratorLifecycleSeam(seams, "after_execute", options.metadata);

      // FIX-480: streaming-text generators write `_blockOutputHint` on
      // their ctx to signal a ref-to-message block_output. The spread
      // above creates a new object, so the hint write doesn't propagate
      // naturally — forward it back to the outer ctx so executeBlock's
      // hint capture path picks it up.
      const generatorHint = (generatorCtx as { _blockOutputHint?: BlockOutputHint })._blockOutputHint;
      if (generatorHint !== undefined) {
        (ctx as { _blockOutputHint?: BlockOutputHint })._blockOutputHint = generatorHint;
      }

      return { output, modelUsage };
    } catch (error) {
      await emitGeneratorLifecycleSeam(seams, "errored", options.metadata);
      throw error;
    }
  }

  if (
    block.kind === "handler" ||
    block.kind === "sequencer" ||
    block.kind === "router"
  ) {
    return { output: await asRuntime(block).run(input, ctx as any) };
  }

  throw new Error(`Unknown block kind "${String(block.kind)}"`);
}

export type ExecuteBlockInternalOptions =
  ExecuteBlockOptions & {
    internalSeams?: InternalExecutionSeams;
  };

/**
 * Build the ctx.cap object from a block's resolved capabilities.
 * Each capability with a fns factory gets its helpers evaluated eagerly.
 */
function buildCapObject(
  blockConfig: { __resolvedCapabilities?: CapabilityRef[] },
  ctx: BlockContext
): Record<string, Record<string, unknown>> {
  const caps = blockConfig.__resolvedCapabilities;
  if (!caps || caps.length === 0) return {};

  const capObj: Record<string, Record<string, unknown>> = {};

  for (const cap of caps) {
    const base = getBaseCapability(cap);
    if (base.fns) {
      capObj[base.name] = base.fns(ctx);
    }
  }

  return capObj;
}

/**
 * Executes a block and always returns a structured execution result.
 */
export async function executeBlock(
  options: ExecuteBlockInternalOptions
): Promise<ExecuteBlockResult> {
  const startedAt = Date.now();
  const seams = options.internalSeams ?? NOOP_INTERNAL_EXECUTION_SEAMS;
  // Resolve the request and structural path. For the root block this falls
  // back to ROOT_BLOCK_PATH; nested blocks inherit their parent's path via
  // `_blockIdentity.blockPath`.
  const identity = (options.ctx as { _blockIdentity?: { blockPath?: string } })._blockIdentity;
  const requestId =
    options.metadata?.requestId ?? options.ctx.requestRuntime.requestId;
  const blockPath =
    options.metadata?.blockPath ?? identity?.blockPath ?? ROOT_BLOCK_PATH;
  const metadata = createExecutionMetadata(options.ctx, {
    ...options.metadata,
    blockName: options.block.name,
    blockKind: options.block.kind,
    blockPath,
    scope: options.metadata?.scope ?? "block"
  });
  const logger = options.logger ?? DEFAULT_RUNTIME_LOGGER;
  // 0-indexed attempt counter. Initial execution is attempt 0; each retry
  // increments it. buildBlockInstanceId(requestId, blockPath, attempt) gives
  // a deterministic ID per (request, path, attempt) tuple.
  let attempt = -1;

  try {
    const run = async (): Promise<{ output: unknown; modelUsage?: GeneratorModelUsageMeta }> => {
      attempt += 1;
      const currentInstanceId = buildBlockInstanceId(requestId, blockPath, attempt);
      const attemptMetadata = {
        ...metadata,
        attempt,
        blockInstanceId: currentInstanceId
      };
      // Expose attempt counter on ctx so handlers (e.g. FIX-402 runOnce) can
      // read it without reaching into `_blockIdentity`.
      (options.ctx as { attempt?: number }).attempt = attempt;

      logRuntimeEvent(
        logger,
        "debug",
        "[flow-state] block execution started",
        {
          ...createExecutionLogContext(attemptMetadata),
          input: summarizeForLog(options.input)
        }
      );

      const interceptedInput = applyBlockInputSeam(
        seams,
        options.input,
        attemptMetadata
      );

      const containerConfig =
        options.block.kind === "sequencer" || options.block.kind === "router"
          ? (options.block.config as {
              container?: {
                component?: string;
                label?: string | ((input: unknown) => string);
                metadata?: Record<string, unknown> | ((input: unknown) => Record<string, unknown>);
              };
            }).container
          : undefined;

      // Build middleware chain: caller-provided (global + flow) + block-level.
      const middlewareStack = mergeMiddlewareStacks(
        options.middleware,
        options.block.config.middleware
      );
      const blockInfo = { name: options.block.name, kind: options.block.kind };
      const runMiddleware = composeMiddleware(middlewareStack, blockInfo);

      const middlewareContext: BlockMiddlewareContext = {
        block: blockInfo,
        input: interceptedInput,
        metadata: attemptMetadata,
        blockContext: options.ctx
      };

      // Populate ctx.cap from the block's resolved capabilities.
      const blockCaps = (options.block.config as any).__resolvedCapabilities;
      if (blockCaps && blockCaps.length > 0) {
        (options.ctx as any).cap = buildCapObject(
          options.block.config as any,
          options.ctx as BlockContext
        );
      }

      const executeCore = async (): Promise<{ output: unknown; modelUsage?: GeneratorModelUsageMeta }> => {
        if (options.ctx._withExecutionScope === undefined) {
          return executeByKind(
            options.block,
            interceptedInput,
            options.ctx,
            {
              internalSeams: seams,
              metadata: attemptMetadata,
            }
          );
        }
        return options.ctx._withExecutionScope(
          {
            name: options.block.name,
            kind: options.block.kind,
            instanceId: currentInstanceId,
            transient: options.block.transient || undefined,
            stateSchema: options.block.kind === "sequencer" ? options.block.config.stateSchema : undefined,
            parentInstanceId: attemptMetadata.parentBlockInstanceId,
            path: blockPath,
            phase: attemptMetadata.scope === "work" ? "work" : "main",
            container:
              containerConfig === undefined
                ? undefined
                : {
                    component: containerConfig.component,
                    label:
                      typeof containerConfig.label === "function"
                        ? containerConfig.label(interceptedInput)
                        : containerConfig.label,
                    metadata:
                      typeof containerConfig.metadata === "function"
                        ? containerConfig.metadata(interceptedInput)
                        : containerConfig.metadata
                  }
          },
          async (scopedCtx) => {
            // Mirror the attempt counter onto the scoped context so
            // handler code reading `ctx.attempt` sees the current retry.
            (scopedCtx as { attempt?: number }).attempt = attempt;
            const childIdentity = (scopedCtx as { _blockIdentity?: { attempt?: number } })
              ._blockIdentity;
            if (childIdentity !== undefined) {
              childIdentity.attempt = attempt;
            }
            return executeByKind(
              options.block,
              interceptedInput,
              scopedCtx as ExecuteBlockContext,
              {
                internalSeams: seams,
                metadata: attemptMetadata,
              }
            );
          }
        );
      };

      // Run middleware chain around block execution.
      // Middleware wraps the output only; modelUsage is captured internally.
      let capturedModelUsage: GeneratorModelUsageMeta | undefined;
      const executionResult = await runMiddleware(
        middlewareContext,
        async () => {
          const result = await executeCore();
          capturedModelUsage = result.modelUsage;
          return result.output;
        }
      ).then((output) => ({
        output,
        modelUsage: capturedModelUsage
      }));

      const interceptedOutput = applyBlockOutputSeam(seams, executionResult.output, attemptMetadata);

      logRuntimeEvent(
        logger,
        "debug",
        "[flow-state] block execution completed",
        {
          ...createExecutionLogContext(attemptMetadata),
          durationMs: Date.now() - startedAt,
          output: summarizeForLog(interceptedOutput)
        }
      );

      return {
        output: interceptedOutput,
        modelUsage: executionResult.modelUsage
      };
    };

    const retryPolicy = mergeRetryPolicy(
      options.block.config.retry,
      options.retry
    );
    const executionResult =
      retryPolicy === undefined
        ? await run()
        : await retryWithPolicy(run, retryPolicy, {
            signal: options.ctx.signal,
            onRetry: (retryAttempt, error) => {
              // retry.ts's onRetry fires with a 1-indexed "attempt that just
              // failed"; report it 0-indexed to stay consistent with the
              // deterministic-ID attempt suffix.
              logRuntimeEvent(
                logger,
                "warn",
                "[flow-state] block execution retry scheduled",
                {
                  ...createExecutionLogContext({
                    ...metadata,
                    attempt: retryAttempt - 1
                  }),
                  maxAttempts: retryPolicy.maxAttempts,
                  delayMs: Math.min(
                    retryPolicy.maxDelayMs,
                    retryPolicy.baseDelayMs * Math.pow(2, retryAttempt - 1)
                  ),
                  error: summarizeForLog(error)
                }
              );
            }
          });

    // Sequencer / router execute functions set `_blockOutputHint` on ctx
    // before returning (FIX-413). Pick it up, then clear so a retry or
    // re-entry starts fresh.
    const capturedHint = (options.ctx as { _blockOutputHint?: BlockOutputHint })._blockOutputHint;
    if (capturedHint !== undefined) {
      (options.ctx as { _blockOutputHint?: BlockOutputHint })._blockOutputHint = undefined;
    }

    await emitBlockOutputItem({
      block: options.block,
      output: executionResult.output,
      ctx: options.ctx,
      metadata: {
        ...metadata,
        attempt,
        blockInstanceId: buildBlockInstanceId(requestId, blockPath, attempt)
      },
      startedAt,
      modelUsage: executionResult.modelUsage,
      hint: capturedHint
    });

    return {
      output: executionResult.output,
      items: getResponseItems(options.ctx.response),
      durationMs: Date.now() - startedAt
    };
  } catch (error) {
    const normalized = normalizeError(error, {
      blockName: options.block.name,
      scope: "block"
    });

    // `attempt` may be -1 if we never entered `run()` (e.g. ctx setup threw
    // before the retry loop started). Fall back to the incoming metadata's
    // attempt in that case.
    const terminalAttempt = attempt >= 0 ? attempt : metadata.attempt ?? 0;
    const terminalInstanceId = buildBlockInstanceId(requestId, blockPath, terminalAttempt);

    logRuntimeEvent(
      logger,
      "error",
      "[flow-state] block execution failed",
      {
        ...createExecutionLogContext({
          ...metadata,
          attempt: terminalAttempt,
          blockInstanceId: terminalInstanceId
        }),
        durationMs: Date.now() - startedAt,
        error: summarizeForLog(normalized)
      }
    );

    await emitBlockOutputItem({
      block: options.block,
      output: undefined,
      ctx: options.ctx,
      metadata: {
        ...metadata,
        attempt: terminalAttempt,
        blockInstanceId: terminalInstanceId
      },
      startedAt,
      status: "failed",
      error: {
        message: normalized.message,
        code: normalized.code
      }
    });

    return {
      output: undefined,
      items: getResponseItems(options.ctx.response),
      durationMs: Date.now() - startedAt,
      error: applyNormalizedErrorSeam(seams, normalized, metadata)
    };
  }
}
