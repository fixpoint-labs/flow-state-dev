/**
 * Per-tool execute-closure factory for the generator block. Owns the
 * decorator stack that wraps every tool invocation: cache lookup, retry,
 * status-guard, lifecycle observers, execution-scope, and the
 * `tool_output` envelope. Extracted from `compileToolsWithExecute` so
 * each concern is testable without a live AI SDK model.
 */
import type {
  BlockCacheableConfig,
  BlockContext,
  BlockDefinition,
  RetryPolicy,
} from "../../types/block";
import { asRuntime } from "../../types/block";
import type { ItemVisibility } from "../../items/types";
import type { ModelIdentity } from "../../types/model";
import type { ToolLifecycleEvent, ToolsConfig } from "../../types/flow";
import type { GeneratorTool } from "../generator";
import { toError, withTimeout } from "./utils";
import { emitToolOutputAround } from "./emit-tool-output";
import {
  buildCacheKey,
  getInFlightMap,
  isFresh,
  normalizeCacheable,
  resolveCacheSourceTask,
  resolveToolCacheStore,
  writeToolObservation,
  type ToolCacheStore,
} from "./cache-tool-call";
import {
  blockPathTool,
  buildBlockInstanceId,
  extendBlockPath,
  ROOT_BLOCK_PATH,
} from "./block-instance-id";

type MaybePromise<TValue> = TValue | Promise<TValue>;

export interface ToolExecutorConfig {
  flowTools: ToolsConfig | undefined;
  generatorBlockName: string;
  itemVisibility: ItemVisibility | undefined;
  agentName: string | undefined;
  statusGuard: { active: number; saved: string };
}

/**
 * Build an execute closure for a single tool. The closure handles
 * cache, retry, status-guard, observers, execution-scope, and the
 * `tool_output` envelope — the full decorator stack that
 * `compileToolsWithExecute` used to own inline.
 */
export function buildToolExecutor(
  tool: GeneratorTool,
  config: ToolExecutorConfig,
  ctx: BlockContext,
): (args: unknown, options?: { toolCallId?: string }) => Promise<unknown> {
  const { flowTools, generatorBlockName, itemVisibility, agentName, statusGuard } = config;
  const timeoutMs = flowTools?.defaults?.timeoutMs;
  const retry = flowTools?.defaults?.retry;

  return async (args: unknown, options?: { toolCallId?: string }) => {
    const cacheable = tool.config.cacheable;
    let cacheMiss: { key: string; cfg: BlockCacheableConfig; store: ToolCacheStore } | undefined;
    if (cacheable !== undefined) {
      const cacheResult = await tryServeFromCache(
        tool,
        args,
        ctx,
        flowTools,
        generatorBlockName,
        itemVisibility,
        agentName,
        options?.toolCallId,
      );
      if (cacheResult.kind === "hit") return cacheResult.output;
      if (cacheResult.kind === "in-flight") return cacheResult.promise;
      if (
        cacheResult.kind === "miss" &&
        cacheResult.key !== undefined &&
        cacheResult.cfg !== undefined &&
        cacheResult.store !== undefined
      ) {
        cacheMiss = {
          key: cacheResult.key,
          cfg: cacheResult.cfg,
          store: cacheResult.store,
        };
      }
    }

    const callTool = async (scopedCtx: BlockContext): Promise<unknown> => {
      if (statusGuard.active === 0) {
        statusGuard.saved = scopedCtx._peekStatus?.() ?? "";
      }
      statusGuard.active++;
      scopedCtx.emit.status(`Using ${tool.name}…`);
      const debugTools = typeof process !== "undefined" && process.env?.FSDEV_DEBUG_TOOLS === "1";
      const toolStartedAt = debugTools ? Date.now() : 0;
      if (debugTools) {
        // eslint-disable-next-line no-console
        console.error(`[fsd-tool] start ${tool.name} callId=${options?.toolCallId ?? "-"}`);
      }
      try {
        await runToolObserver(flowTools?.onToolStarted, { toolName: tool.name, input: args }, scopedCtx);
        const output = await runWithRetry(
          () => withTimeout(Promise.resolve(asRuntime(tool).run(args, scopedCtx)), timeoutMs, `tool:${tool.name}`),
          retry,
        );
        await runToolObserver(flowTools?.onToolCompleted, { toolName: tool.name, input: args, output }, scopedCtx);
        if (debugTools) {
          // eslint-disable-next-line no-console
          console.error(`[fsd-tool] done  ${tool.name} callId=${options?.toolCallId ?? "-"} dur=${Date.now() - toolStartedAt}ms`);
        }
        return output;
      } catch (err) {
        if (debugTools) {
          const msg = err instanceof Error ? err.message : String(err);
          // eslint-disable-next-line no-console
          console.error(`[fsd-tool] fail  ${tool.name} callId=${options?.toolCallId ?? "-"} dur=${Date.now() - toolStartedAt}ms err=${msg}`);
        }
        throw err;
      } finally {
        statusGuard.active--;
        if (statusGuard.active === 0) {
          scopedCtx.emit.status(statusGuard.saved);
        }
      }
    };

    const withScope = (run: (scopedCtx: BlockContext) => Promise<unknown>): Promise<unknown> => {
      if (ctx._withExecutionScope === undefined) return run(ctx);
      const parentPath = ctx._blockIdentity?.blockPath ?? ROOT_BLOCK_PATH;
      const toolPath = extendBlockPath(parentPath, blockPathTool(tool.name, options?.toolCallId ?? "0"));
      const instanceId = buildBlockInstanceId(ctx.request.identity.id, toolPath, 0);
      return ctx._withExecutionScope(
        { name: tool.name, kind: tool.kind, instanceId, path: toolPath, input: args },
        run,
      );
    };

    const callToolWithErrorObserver = async (scopedCtx: BlockContext): Promise<unknown> => {
      try {
        return await callTool(scopedCtx);
      } catch (error) {
        const err = toError(error);
        await runToolObserver(flowTools?.onToolErrored, { toolName: tool.name, input: args, error: err }, scopedCtx);
        throw err;
      }
    };

    const runAndRecord = async (runOnce: () => Promise<unknown>): Promise<unknown> => {
      const inFlightMap = cacheMiss !== undefined ? getInFlightMap(ctx) : undefined;
      const execute = runOnce();
      if (inFlightMap !== undefined && cacheMiss !== undefined) {
        inFlightMap.set(cacheMiss.key, execute);
      }
      try {
        const output = await execute;
        if (cacheMiss !== undefined) {
          maybeWriteCache(tool, args, output, ctx, cacheMiss);
        }
        writeToolObservation(ctx, {
          toolName: tool.name,
          args,
          result: output,
          cached: false,
        });
        return output;
      } catch (err) {
        writeToolObservation(ctx, {
          toolName: tool.name,
          args,
          error: err instanceof Error ? err.message : String(err),
          cached: false,
        });
        throw err;
      } finally {
        if (inFlightMap !== undefined && cacheMiss !== undefined) {
          inFlightMap.delete(cacheMiss.key);
        }
      }
    };

    if (options?.toolCallId === undefined) {
      return await runAndRecord(() => withScope(callToolWithErrorObserver));
    }
    const attribution = {
      callId: options.toolCallId,
      generatorBlock: generatorBlockName,
      itemVisibility,
      agentName,
      model: (ctx as { _currentModelIdentity?: ModelIdentity })._currentModelIdentity,
    };
    return await runAndRecord(() =>
      emitToolOutputAround(tool, ctx, args, attribution, (_outerCtx, toolOutputId) =>
        withScope((scopedCtx) => {
          (scopedCtx as { _blockOutputHint?: { kind: "ref"; sourceItemId: string } })
            ._blockOutputHint = { kind: "ref", sourceItemId: toolOutputId };
          return callToolWithErrorObserver(scopedCtx);
        }),
      ),
    );
  };
}

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

async function tryServeFromCache(
  tool: GeneratorTool,
  args: unknown,
  ctx: BlockContext,
  flowTools: ToolsConfig | undefined,
  generatorBlockName: string,
  itemVisibility: ItemVisibility | undefined,
  agentName: string | undefined,
  toolCallId: string | undefined,
): Promise<
  | { kind: "hit"; output: unknown }
  | { kind: "in-flight"; promise: Promise<unknown> }
  | { kind: "miss"; key?: string; cfg?: BlockCacheableConfig; store?: ToolCacheStore }
> {
  const cacheable = tool.config.cacheable;
  if (cacheable === undefined) return { kind: "miss" };
  const store = resolveToolCacheStore(ctx);
  if (store === undefined) return { kind: "miss" };

  const cfg = normalizeCacheable(cacheable);
  let key: string;
  try {
    key = buildCacheKey(tool.name, args, ctx, cfg, store);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn((err as Error).message);
    return { kind: "miss" };
  }

  const inFlightMap = getInFlightMap(ctx);
  const inFlight = inFlightMap.get(key);
  if (inFlight !== undefined) return { kind: "in-flight", promise: inFlight };

  const entry = store.get(key);
  if (entry !== undefined && isFresh(entry, cfg, store)) {
    const ageMs = Date.now() - entry.storedAt;
    await runToolObserver(
      flowTools?.onToolStarted,
      { toolName: tool.name, input: args, cached: true },
      ctx,
    );
    await runToolObserver(
      flowTools?.onToolCompleted,
      { toolName: tool.name, input: args, output: entry.output, cached: true },
      ctx,
    );

    if (toolCallId !== undefined) {
      const attribution = {
        callId: toolCallId,
        generatorBlock: generatorBlockName,
        itemVisibility,
        agentName,
        model: (ctx as { _currentModelIdentity?: ModelIdentity })._currentModelIdentity,
        cached: {
          ageMs,
          ...(entry.sourceTask !== undefined ? { sourceTask: entry.sourceTask } : {}),
        },
      };
      await emitToolOutputAround(
        tool,
        ctx,
        args,
        attribution,
        async () => entry.output,
      );
    }

    writeToolObservation(ctx, {
      toolName: tool.name,
      args,
      result: entry.output,
      cached: true,
    });

    return { kind: "hit", output: entry.output };
  }

  return { kind: "miss", key, cfg, store };
}

function maybeWriteCache(
  tool: GeneratorTool,
  args: unknown,
  output: unknown,
  ctx: BlockContext,
  miss: { key: string; cfg: BlockCacheableConfig; store: ToolCacheStore },
): void {
  const shouldCache = miss.cfg.cacheIf === undefined ? true : miss.cfg.cacheIf(output, args);
  if (!shouldCache) return;
  const ttl = miss.cfg.ttl ?? miss.store.defaultTtl;
  const sourceTask = resolveCacheSourceTask(ctx);
  miss.store.set(miss.key, {
    output,
    storedAt: Date.now(),
    ...(ttl !== undefined ? { ttl } : {}),
    toolName: tool.name,
    ...(sourceTask !== undefined ? { sourceTask } : {}),
  });
}

// ---------------------------------------------------------------------------
// Observer / retry helpers
// ---------------------------------------------------------------------------

function isBlockObserver(
  observer: ToolsConfig["onToolStarted"],
): observer is BlockDefinition<any, any> {
  return (
    typeof observer === "object" &&
    observer !== null &&
    "run" in observer &&
    typeof (observer as { run?: unknown }).run === "function"
  );
}

export async function runToolObserver(
  observer: ToolsConfig["onToolStarted"] | ToolsConfig["onToolCompleted"] | ToolsConfig["onToolErrored"] | undefined,
  event: ToolLifecycleEvent,
  ctx: BlockContext,
): Promise<void> {
  if (observer === undefined) {
    return;
  }

  if (isBlockObserver(observer as ToolsConfig["onToolStarted"])) {
    await asRuntime(observer as BlockDefinition<any, any>).run(event, ctx);
    return;
  }

  await (observer as (input: ToolLifecycleEvent, ctx: BlockContext) => MaybePromise<void>)(event, ctx);
}

export async function runWithRetry<TValue>(
  run: () => Promise<TValue>,
  retry: RetryPolicy | undefined,
): Promise<TValue> {
  if (retry === undefined) {
    return run();
  }

  const maxAttempts = Math.max(1, retry.maxAttempts ?? 1);
  const baseDelayMs = Math.max(0, retry.baseDelayMs ?? 0);
  const maxDelayMs = Math.max(baseDelayMs, retry.maxDelayMs ?? Number.POSITIVE_INFINITY);
  let attempt = 0;

  while (attempt < maxAttempts) {
    attempt += 1;

    try {
      return await run();
    } catch (error) {
      const normalizedError = toError(error);
      if (attempt >= maxAttempts) {
        throw normalizedError;
      }

      if (retry.retryableErrors !== undefined && retry.retryableErrors.length > 0) {
        const isRetryable = retry.retryableErrors.some((ErrorType) => normalizedError instanceof ErrorType);
        if (!isRetryable) {
          throw normalizedError;
        }
      }

      const delayMs = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt - 1));
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw new Error("Tool retry loop exited unexpectedly");
}
