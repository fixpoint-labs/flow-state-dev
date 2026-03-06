/**
 * Action-level orchestration runtime for request lifecycle, observers, persistence, and terminal errors.
 */
import type { ErrorItem, ItemProvenance, MessageItem } from "@flow-state-dev/core/items";
import type {
  ActionConfig,
  BlockDefinition,
  FlowInstance
} from "@flow-state-dev/core/types";
import { createExecutionContext } from "../context/createExecutionContext";
import {
  createExecutionLogContext,
  DEFAULT_RUNTIME_LOGGER,
  logRuntimeEvent,
  summarizeForLog
} from "./logging";
import type { ExecutionContext } from "../context/types";
import type { FlowError } from "../errors/flow-error";
import { ValidationError } from "../errors/flow-error";
import { normalizeError } from "../errors/normalize-error";
import type { RequestRecord, StoreRegistry } from "../stores/types";
import { createInternalResponseEmitter } from "../streaming/response-emitter";
import { executeBlock } from "./executeBlock";
import { getResponseItems } from "./internal/response";
import {
  applyNormalizedErrorSeam,
  emitActionLifecycleSeam,
  NOOP_INTERNAL_EXECUTION_SEAMS,
  type InternalExecutionSeams
} from "./internal/seams";
import type {
  ExecutionResult,
  RunActionOptions
} from "./types";
import { createExecutionMetadata } from "./types";
import { createTTSEmitterHook, type TTSEmitterHook } from "../voice/tts-emitter-hook";

type RunActionInternalOptions<
  TFlow extends FlowInstance = FlowInstance,
  TActionName extends keyof TFlow["actions"] & string = keyof TFlow["actions"] & string
> = RunActionOptions<TFlow, TActionName> & {
  internalSeams?: InternalExecutionSeams;
};

const RUNTIME_PROVENANCE: ItemProvenance = {
  blockName: "runtime",
  blockInstanceId: "runtime",
  phase: "main"
};

/**
 * Creates a request id when the caller does not provide one.
 */
function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

/**
 * Resolves an action definition from a flow and validates that it exists.
 */
function resolveAction<
  TFlow extends FlowInstance,
  TActionName extends keyof TFlow["actions"] & string
>(
  flow: TFlow,
  actionName: TActionName
): ActionConfig {
  const action = flow.actions[actionName];
  if (action === undefined) {
    throw new ValidationError(
      `Flow "${flow.kind}" does not define action "${actionName}"`
    );
  }

  return action as ActionConfig;
}

/**
 * Validates and parses action input using the action's schema.
 */
function parseActionInput(action: ActionConfig, input: unknown): unknown {
  const parsed = action.inputSchema.safeParse(input);
  if (parsed.success) {
    return parsed.data;
  }

  const firstIssue = parsed.error.issues[0];
  const path = firstIssue?.path?.join(".") ?? "";
  const suffix = path.length > 0 ? ` at "${path}"` : "";
  const message = firstIssue?.message ?? "schema validation failed";
  throw new ValidationError(
    `Action input validation failed${suffix}: ${message}`,
    {
      scope: "request"
    }
  );
}

/**
 * Applies a partial request-record update when a record exists.
 */
async function patchRequestRecord(
  stores: StoreRegistry,
  requestId: string,
  patch: Partial<RequestRecord>
): Promise<void> {
  const current = await stores.request.get(requestId);
  if (current === undefined) {
    return;
  }

  await stores.request.set(requestId, {
    ...current,
    ...patch,
    updatedAt: Date.now()
  });
}

/**
 * Executes observer blocks and propagates observer failures to the caller.
 */
async function runObserver(
  observer: BlockDefinition<any, any> | undefined,
  input: unknown,
  ctx: ExecutionContext,
  options: {
    internalSeams: InternalExecutionSeams;
  }
): Promise<void> {
  if (observer === undefined) {
    return;
  }

  const result = await executeBlock({
    block: observer,
    input,
    ctx,
    internalSeams: options.internalSeams,
    metadata: {
      scope: "request"
    }
  });

  if (result.error !== undefined) {
    throw result.error;
  }
}

/**
 * Executes observer blocks while swallowing observer failures.
 */
async function runObserverSafely(
  observer: BlockDefinition<any, any> | undefined,
  input: unknown,
  ctx: ExecutionContext,
  options: {
    internalSeams: InternalExecutionSeams;
  }
): Promise<void> {
  if (observer === undefined) {
    return;
  }

  try {
    await runObserver(observer, input, ctx, options);
  } catch {
    // Preserve primary request failure and avoid masking it with observer failures.
  }
}

/**
 * Emits an internal terminal error item when the response emitter supports item events.
 */
async function emitTerminalError(
  ctx: ExecutionContext,
  error: FlowError
): Promise<void> {
  if (
    typeof ctx.response !== "object" ||
    ctx.response === null ||
    typeof (ctx.response as { emitItemAdded?: unknown }).emitItemAdded !== "function" ||
    typeof (ctx.response as { emitItemDone?: unknown }).emitItemDone !== "function"
  ) {
    return;
  }

  const response = ctx.response as unknown as {
    emitItemAdded: (item: ErrorItem) => Promise<unknown>;
    emitItemDone: (item: ErrorItem) => Promise<unknown>;
  };

  const item: ErrorItem = {
    id: `item_error_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    type: "error",
    status: "failed",
    transient: true,
    requestId: ctx.requestRuntime.requestId,
    itemIndex: getResponseItems(ctx.response).length,
    provenance: RUNTIME_PROVENANCE,
    ts: Date.now(),
    message: error.message,
    code: error.code
  };

  await response.emitItemAdded(item);
  await response.emitItemDone(item);
}

/**
 * Public action execution API using default internal seams.
 */
export async function runAction<
  TFlow extends FlowInstance = FlowInstance,
  TActionName extends keyof TFlow["actions"] & string = keyof TFlow["actions"] & string
>(
  options: RunActionOptions<TFlow, TActionName>
): Promise<ExecutionResult> {
  return runActionInternal({
    ...options,
    internalSeams: NOOP_INTERNAL_EXECUTION_SEAMS
  });
}

/**
 * Internal action execution entrypoint with injectable seams for instrumentation/testing.
 */
export async function runActionInternal<
  TFlow extends FlowInstance = FlowInstance,
  TActionName extends keyof TFlow["actions"] & string = keyof TFlow["actions"] & string
>(
  options: RunActionInternalOptions<TFlow, TActionName>
): Promise<ExecutionResult> {
  const startedAt = Date.now();
  const action = resolveAction(options.flow, options.actionName);
  const requestId = options.requestId ?? generateRequestId();
  const internalSeams = options.internalSeams ?? NOOP_INTERNAL_EXECUTION_SEAMS;
  const response = options.responseEmitter ?? createInternalResponseEmitter({
    requestId,
    internalSeams: undefined
  });
  const logger = options.logger ?? DEFAULT_RUNTIME_LOGGER;

  response.setLogCallback((eventType, detail) => {
    logRuntimeEvent(logger, "debug", `[flow-state] ${eventType}`, {
      requestId,
      actionName: options.actionName,
      flowKind: options.flow.kind,
      ...detail
    });
  });

  // Set up TTS pipeline if the flow has voice.tts configured
  let ttsHook: TTSEmitterHook | undefined;
  const voiceConfig = options.flow.voice;
  if (voiceConfig?.tts !== undefined) {
    ttsHook = createTTSEmitterHook({
      config: voiceConfig.tts,
      speechResolver: options.speechResolver,
      emitter: response
    });
    response.addEventObserver((event) => ttsHook!.onEvent(event));
  }

  const ctx = await createExecutionContext({
    flow: options.flow,
    actionName: options.actionName,
    requestId,
    userId: options.userId,
    sessionId: options.sessionId,
    projectId: options.projectId,
    metadata: options.metadata,
    input: options.input,
    signal: options.signal,
    modelResolver: options.modelResolver,
    response,
    stores: options.stores,
    logger
  });

  const metadata = createExecutionMetadata(ctx, {
    scope: "request"
  });

  logRuntimeEvent(logger, "info", "[flow-state] action execution started", {
    ...createExecutionLogContext(metadata),
    input: summarizeForLog(options.input)
  });

  await emitActionLifecycleSeam(internalSeams, "started", metadata);
  await response.emitRequestCreated();
  await response.emitRequestStatus("in_progress");

  await runObserver(options.flow.request?.onStarted, {
    requestId,
    actionName: options.actionName
  }, ctx, { internalSeams });

  try {
    const parsedInput = parseActionInput(action, options.input);

    // Emit user message item when the action defines a userMessage extractor.
    if (action.userMessage !== undefined) {
      const text = action.userMessage(parsedInput);
      const userItem: MessageItem = {
        id: `item_msg_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        type: "message",
        role: "user",
        status: "completed",
        transient: false,
        requestId,
        itemIndex: response.getItems().length,
        provenance: RUNTIME_PROVENANCE,
        ts: Date.now(),
        content: [{ type: "output_text", text }]
      };
      await response.emitItemAdded(userItem);
      await response.emitItemDone(userItem);
    }

    const result = await executeBlock({
      block: action.block,
      input: parsedInput,
      ctx,
      retry: options.retry,
      internalSeams,
      metadata: {
        scope: "request"
      },
      logger
    });

    if (result.error !== undefined) {
      throw result.error;
    }

    await runObserver(action.onCompleted, {
      requestId,
      actionName: options.actionName,
      output: result.output
    }, ctx, { internalSeams });

    await runObserver(options.flow.request?.onCompleted, {
      requestId,
      actionName: options.actionName,
      output: result.output
    }, ctx, { internalSeams });

    // Flush and drain TTS pipeline before marking request as completed
    if (ttsHook !== undefined) {
      await ttsHook.finalize();
    }

    const completedAt = Date.now();
    const items = response.getItems();
    await patchRequestRecord(options.stores, requestId, {
      status: "completed",
      completedAtMs: completedAt,
      items
    });

    ctx.requestRuntime.status = "completed";
    ctx.requestRuntime.completedAtMs = completedAt;

    await response.emitRequestStatus("completed");
    await emitActionLifecycleSeam(internalSeams, "completed", metadata);

    logRuntimeEvent(logger, "info", "[flow-state] action execution completed", {
      ...createExecutionLogContext(metadata),
      durationMs: Date.now() - startedAt,
      output: summarizeForLog(result.output)
    });

    await runObserver(options.flow.request?.onFinished, {
      requestId,
      actionName: options.actionName,
      status: "completed",
      output: result.output
    }, ctx, { internalSeams });
    await emitActionLifecycleSeam(internalSeams, "finished", metadata);

    return {
      output: result.output,
      items: response.getItems(),
      durationMs: Date.now() - startedAt
    };
  } catch (error) {
    const normalized = applyNormalizedErrorSeam(
      internalSeams,
      normalizeError(error, {
        scope: "request",
        blockName: action.block.name
      }),
      metadata
    );

    await emitTerminalError(ctx, normalized);
    await response.emitRequestStatus("failed");

    const failedAt = Date.now();
    await patchRequestRecord(options.stores, requestId, {
      status: "failed",
      failedAtMs: failedAt,
      items: response.getItems()
    });

    ctx.requestRuntime.status = "failed";
    ctx.requestRuntime.failedAtMs = failedAt;

    await runObserverSafely(action.onErrored, {
      requestId,
      actionName: options.actionName,
      error: normalized
    }, ctx, { internalSeams });

    await runObserverSafely(options.flow.request?.onErrored, {
      requestId,
      actionName: options.actionName,
      error: normalized
    }, ctx, { internalSeams });
    await emitActionLifecycleSeam(internalSeams, "errored", metadata);

    await runObserverSafely(options.flow.request?.onFinished, {
      requestId,
      actionName: options.actionName,
      status: "failed",
      error: normalized
    }, ctx, { internalSeams });
    await emitActionLifecycleSeam(internalSeams, "finished", metadata);

    logRuntimeEvent(logger, "error", "[flow-state] action execution failed", {
      ...createExecutionLogContext(metadata),
      durationMs: Date.now() - startedAt,
      error: summarizeForLog(normalized)
    });

    return {
      output: undefined,
      items: response.getItems(),
      durationMs: Date.now() - startedAt,
      error: normalized
    };
  }
}
