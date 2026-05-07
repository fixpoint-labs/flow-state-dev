/**
 * Central block execution entrypoint: dispatch, seam interception, retry, and error normalization.
 */
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

/**
 * Dispatches block execution to the runtime for each supported block kind.
 *
 * Observability hooks (`onBlockTraceCapture`) are installed on the shared
 * `_runtimeHooks` inside `createExecutionContext`. They're visible to every
 * context (root and nested) via the same shared reference, so this function
 * no longer wires them per-block.
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
      // their ctx to signal a ref-to-message `block_trace.output`. The spread
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

      const executeCore = async (): Promise<unknown> => {
        if (options.ctx._withExecutionScope === undefined) {
          const result = await executeByKind(
            options.block,
            interceptedInput,
            options.ctx,
            {
              internalSeams: seams,
              metadata: attemptMetadata,
            }
          );
          scopedExecutionResult = result;
          return result.output;
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
            // executeByKind returns `{ output, modelUsage }`; unwrap so
            // _withExecutionScope sees the raw block output. modelUsage is
            // forwarded to the caller via the closure-captured slot below.
            const result = await executeByKind(
              options.block,
              interceptedInput,
              scopedCtx as ExecuteBlockContext,
              {
                internalSeams: seams,
                metadata: attemptMetadata,
              }
            );
            scopedExecutionResult = result;
            // Stash modelUsage on the scoped ctx so the unified `output`
            // phase capture in createExecutionContext picks it up when
            // patching the block_trace row.
            if (result.modelUsage !== undefined) {
              (scopedCtx as { _generatorModelUsage?: GeneratorModelUsageMeta })._generatorModelUsage = result.modelUsage;
            }
            return result.output;
          }
        );
      };

      let scopedExecutionResult: { output: unknown; modelUsage?: GeneratorModelUsageMeta } | undefined;

      // Run middleware chain around block execution.
      // Middleware wraps the output only; modelUsage is captured internally.
      const executionResult = await runMiddleware(
        middlewareContext,
        async () => {
          // executeCore returns the raw output via the _withExecutionScope
          // path (unwraps via scopedExecutionResult). The non-scope test path
          // also returns the unwrapped output here.
          const out = await executeCore();
          return out;
        }
      ).then((output) => ({
        output,
        modelUsage: scopedExecutionResult?.modelUsage
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

    // FIX-573: root block_trace emission is handled by the `output` phase of
    // `onBlockTraceCapture`, fired from `_withExecutionScope`'s post-execute
    // path. Clear any leftover hint so a retry or re-entry starts fresh.
    const capturedHint = (options.ctx as { _blockOutputHint?: BlockOutputHint })._blockOutputHint;
    if (capturedHint !== undefined) {
      (options.ctx as { _blockOutputHint?: BlockOutputHint })._blockOutputHint = undefined;
    }
    void attempt;

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

    // FIX-573: root failure trace is handled by `_withExecutionScope`'s
    // catch-path firing the `output` phase of `onBlockTraceCapture`.
    void terminalInstanceId;

    return {
      output: undefined,
      items: getResponseItems(options.ctx.response),
      durationMs: Date.now() - startedAt,
      error: applyNormalizedErrorSeam(seams, normalized, metadata)
    };
  }
}
