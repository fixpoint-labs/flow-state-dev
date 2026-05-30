/**
 * Action-level orchestration runtime for request lifecycle, observers, persistence, and terminal errors.
 */
import type { ErrorItem, ItemProvenance, MessageItem, OutputItem, StatusItem } from "@flow-state-dev/core/items";
import { isEphemeralContent } from "@flow-state-dev/core/items";
import type {
  ActionConfig,
  BlockDefinition,
  FlowInstance,
  Middleware
} from "@flow-state-dev/core/types";
import { mergeMiddlewareStacks } from "../middleware/compose";
import { createExecutionContext } from "../context/createExecutionContext";
import { getRequestWorkPool } from "@flow-state-dev/core";
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
import { getResponseItems, getResponseItemCount } from "./internal/response";
import {
  applyNormalizedErrorSeam,
  emitActionLifecycleSeam,
  NOOP_INTERNAL_EXECUTION_SEAMS,
  type InternalExecutionSeams
} from "./internal/seams";
import { applyRetentionPolicy, resolveRetentionPolicy } from "./retention";
import type {
  ExecutionResult,
  RunActionOptions
} from "./types";
import { createExecutionMetadata } from "./types";
import { createTTSEmitterHook, type TTSEmitterHook } from "../voice/tts-emitter-hook";
import { generateId } from "../utils/generate-id";
import {
  registerAbortController,
  deregisterAbortController
} from "./abort-registry";

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
 * Renders an `AbortSignal.reason` into a log-safe string. Reasons are
 * usually a `DOMException`/`Error`, but may be any thrown value, so this
 * never throws. Used by the FIX-663 abort diagnostics.
 */
function serializeAbortReason(reason: unknown): string {
  if (reason === undefined) {
    return "undefined";
  }
  if (reason instanceof Error) {
    return `${reason.name}: ${reason.message}`;
  }
  try {
    return String(reason);
  } catch {
    return "<unserializable reason>";
  }
}

/**
 * Drains the request-scoped background work pool. Emits `backgroundTasks: N`
 * status updates as tasks settle (parity with the legacy per-sequencer
 * auto-await), logs failures via console.error, and emits a final
 * `backgroundTasks: 0` status before the caller proceeds to terminal status.
 *
 * Best-effort: emit failures must never throw out of this helper, since the
 * response emitter may have torn down on abort. Skipped entirely on the
 * abort/disconnect/error paths — see callers in runActionInternal.
 */
async function drainRequestWorkPool(
  ctx: ExecutionContext,
  signal?: AbortSignal
): Promise<void> {
  const pool = getRequestWorkPool(ctx);
  if (pool === undefined) {
    return;
  }
  // No early-return on pendingCount === 0: tasks may have already settled
  // by the time we reach this point, but their entries remain in the pool
  // until drainAll removes them. Settled-but-undrained tasks still need
  // their failures logged. drainAll is a cheap no-op when there are no
  // entries left.

  const safeEmit = (count: number): void => {
    try {
      ctx.emit.status(undefined, { blocked: false, backgroundTasks: count });
    } catch {
      // Emitter teardown race; non-fatal.
    }
  };

  const result = await pool.drainAll({ signal, onPendingChange: safeEmit });
  for (const f of result.failed) {
    // eslint-disable-next-line no-console
    console.error(
      `[runAction] Background work "${f.meta.name}" failed:`,
      (f.reason as { message?: string } | undefined)?.message ?? f.reason
    );
  }

  // Emit terminal `backgroundTasks: 0` only when we actually drained
  // something, so requests that never queued work don't emit a spurious
  // status item.
  if (result.completed.length + result.failed.length > 0) {
    safeEmit(0);
  }
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
  const schema = action.inputSchema ?? action.block.inputSchema;
  const parsed = schema.safeParse(input);
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
 * Strips ephemeral content parts (e.g. output_audio) from items before
 * persistence. Ephemeral content is streamed to the client in real time
 * but should not be stored, since it may contain large binary payloads.
 */
function stripEphemeralContent(items: OutputItem[]): OutputItem[] {
  return items.map((item) => {
    if (item.type !== "message") {
      return item;
    }

    const message = item as MessageItem;
    if (message.content === undefined) {
      return item;
    }

    const filtered = message.content.filter((c) => !isEphemeralContent(c));
    if (filtered.length === message.content.length) {
      return item;
    }

    return { ...message, content: filtered };
  });
}

/**
 * Applies a partial request-record update when a record exists.
 * Strips ephemeral content from items before writing to the store.
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

  const sanitized = patch.items !== undefined
    ? { ...patch, items: stripEphemeralContent(patch.items.filter(item => item.transient !== true)) }
    : patch;

  // Request-record patches (items, status, timestamps) are written outside
  // the state CAS path — the state field is never patched here. Using "any"
  // preserves last-write-wins for these framework-internal updates.
  await stores.request.set(
    requestId,
    { ...current, ...sanitized, updatedAt: Date.now() },
    "any"
  );
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
    requestId: ctx.requestRuntime.requestId,
    itemIndex: getResponseItemCount(ctx.response),
    provenance: RUNTIME_PROVENANCE,
    ts: Date.now(),
    message: error.message,
    code: error.code
  };

  await response.emitItemAdded(item);
  await response.emitItemDone(item);
}


function getActionTokenBudget(action: ActionConfig): {
  maxTotalTokens: number;
  warnAt?: number;
  onExceeded: "error" | "stop" | "warn";
} | undefined {
  if (action.tokenBudget === undefined) {
    return undefined;
  }

  return {
    maxTotalTokens: action.tokenBudget.maxTotalTokens,
    warnAt: action.tokenBudget.warnAt,
    onExceeded: action.tokenBudget.onExceeded ?? "error"
  };
}

async function emitBudgetWarning(
  ctx: ExecutionContext,
  message: string
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
    emitItemAdded: (item: any) => Promise<unknown>;
    emitItemDone: (item: any) => Promise<unknown>;
  };

  const item = {
    id: `item_status_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    type: "status",
    status: "completed",
    transient: true,
    requestId: ctx.requestRuntime.requestId,
    itemIndex: getResponseItemCount(ctx.response),
    provenance: RUNTIME_PROVENANCE,
    ts: Date.now(),
    message,
    detail: { code: "system.token_budget_warning" }
  };

  await response.emitItemAdded(item);
  await response.emitItemDone(item);
}

/**
 * Emits a persistent status item indicating the request was stopped by the user.
 */
async function emitAbortedMessage(
  ctx: ExecutionContext
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
    emitItemAdded: (item: StatusItem) => Promise<unknown>;
    emitItemDone: (item: StatusItem) => Promise<unknown>;
  };

  const item: StatusItem = {
    id: `item_status_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    type: "status",
    status: "completed",
    requestId: ctx.requestRuntime.requestId,
    itemIndex: getResponseItemCount(ctx.response),
    provenance: RUNTIME_PROVENANCE,
    ts: Date.now(),
    message: "Request was stopped.",
    detail: { code: "system.request_aborted" }
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
  const requestId = options.requestId ?? generateId("req");
  const internalSeams = options.internalSeams ?? NOOP_INTERNAL_EXECUTION_SEAMS;
  const response = options.responseEmitter ?? createInternalResponseEmitter({
    requestId,
    internalSeams: undefined
  });
  const logger = options.runtimeConfig.logger ?? DEFAULT_RUNTIME_LOGGER;
  const resolvedRetention = resolveRetentionPolicy(options.flow.session?.retention);

  response.setLogCallback((eventType, detail) => {
    logRuntimeEvent(logger, "debug", `[flow-state] ${eventType}`, {
      requestId,
      actionName: options.actionName,
      flowKind: options.flow.kind,
      ...detail
    });
  });

  // FSDEV_DEBUG_EVENTS_RATE_MS=<ms> turns on a periodic stderr log that
  // summarises events-per-second by (transient, type) bucket. Useful when
  // the on-disk events log grows fast and the operator wants to see how
  // much is real work vs. polling noise. Off when the env var is unset.
  let eventsRateInterval: ReturnType<typeof setInterval> | undefined;
  const eventsRateMsRaw = typeof process !== "undefined" ? process.env?.FSDEV_DEBUG_EVENTS_RATE_MS : undefined;
  const eventsRateMs = eventsRateMsRaw !== undefined ? Number(eventsRateMsRaw) : 0;
  if (Number.isFinite(eventsRateMs) && eventsRateMs > 0) {
    const counts = new Map<string, number>();
    response.addEventObserver((event) => {
      const itemType =
        event.type === "item.added" || event.type === "item.done"
          ? `(${(event.item as { type?: string }).type ?? "?"})`
          : "";
      const key = `${event.type}${itemType}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    let lastTick = Date.now();
    eventsRateInterval = setInterval(() => {
      const now = Date.now();
      const windowMs = now - lastTick;
      lastTick = now;
      if (counts.size === 0) return;
      const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
      const summary = ranked
        .map(([key, n]) => `${key}=${n} (${Math.round((n / windowMs) * 1000)}/s)`)
        .join(" ");
      counts.clear();
      // eslint-disable-next-line no-console
      console.error(`[fsd-events] window=${windowMs}ms req=${requestId} ${summary}`);
    }, eventsRateMs);
    // Don't keep the event loop alive solely for this diagnostic.
    eventsRateInterval.unref?.();
  }

  // Set up TTS pipeline if the flow has voice.tts configured AND the client
  // explicitly opted in (ttsEnabled: true). TTS is off by default — we don't
  // want to synthesize audio unless the client specifically asks for it.
  let ttsHook: TTSEmitterHook | undefined;
  const voiceConfig = options.flow.voice;
  const voiceMeta = options.metadata?.voice as
    | { ttsEnabled?: boolean; inputModality?: string }
    | undefined;
  const ttsEnabled = voiceMeta?.ttsEnabled === true;

  if (voiceConfig?.tts !== undefined && ttsEnabled) {
    ttsHook = createTTSEmitterHook({
      config: voiceConfig.tts,
      speechResolver: options.runtimeConfig.speechResolver,
      emitter: response
    });
    response.addEventObserver((event) => ttsHook!.onEvent(event));
  }

  // --- Abort controller: register so the abort endpoint can signal cancellation ---
  // Register just before `createExecutionContext` to minimize the leak window
  // if setup (registry register, session update, initial emits) throws before
  // the main try/catch. Registration must happen before createExecutionContext
  // because composedSignal is consumed by it.
  const registry = options.stores.activeRequests;
  const source = options.source ?? "http";
  await registry.register({
    requestId,
    flowKind: options.flow.kind,
    actionName: options.actionName as string,
    sessionId: options.sessionId,
    userId: options.userId,
    orgId: options.orgId,
    source,
    input: options.input,
    metadata: options.metadata,
    startedAt: Date.now(),
    lastHeartbeatAt: Date.now()
  });

  const heartbeatIntervalMs = options.flow.request?.heartbeatIntervalMs ?? 10_000;
  const heartbeatTimer = heartbeatIntervalMs > 0
    ? setInterval(() => {
        registry.heartbeat(requestId).catch((err) => {
          logRuntimeEvent(logger, "warn", "[flow-state] heartbeat write failed", {
            requestId, error: String(err)
          });
        });
      }, heartbeatIntervalMs)
    : undefined;

  // --- Update session's latestRequestId for auto-resume discovery ---
  if (options.sessionId !== undefined) {
    const session = await options.stores.session.get(options.sessionId);
    if (session !== undefined) {
      await options.stores.session.set(
        options.sessionId,
        { ...session, latestRequestId: requestId, updatedAt: Date.now() },
        "any"
      );
    }
  }

  // --- Incremental item persistence + sequencer checkpoint durability ---
  // `state_snapshot` items are emitted by sequencers at every step boundary
  // with a `key` (the sequencer's blockInstanceId) and a `durable` flag.
  // Durable frames write a fresh checkpoint; terminal frames (final emission
  // for a sequencer's run — success/error/cancel) optionally trigger a
  // cleanup delete based on `flow.request.cleanupCheckpointsOnTerminal`
  // (default `false` — checkpoints are retained for post-mortem inspection).
  //
  // Operations are serialized per `(requestId, blockInstanceId)` so a slow
  // write can't lose its race with a faster terminal delete (when cleanup
  // is enabled) and leave an orphan checkpoint. A flush awaited at request
  // termination ensures the last write/delete completes before the action
  // returns. (FIX-401)
  const cleanupCheckpointsOnTerminal = options.flow.request?.cleanupCheckpointsOnTerminal === true;
  const checkpointChains = new Map<string, Promise<void>>();
  const checkpointKey = (id: string) => `${requestId}:${id}`;
  function chainCheckpoint(blockInstanceId: string, op: () => Promise<void>): void {
    const k = checkpointKey(blockInstanceId);
    const prior = checkpointChains.get(k) ?? Promise.resolve();
    const next = prior.then(op, op);
    checkpointChains.set(k, next);
  }
  async function flushCheckpoints(): Promise<void> {
    if (checkpointChains.size === 0) return;
    await Promise.allSettled(checkpointChains.values());
  }

  /**
   * Best-effort flush of the per-request TraceStore. Sits alongside the
   * checkpoint flush in every terminal path so adapters with batched I/O
   * (in-memory ring buffer; future SQLite WAL) reach durability before the
   * request completes. Failure here must not affect the action's outcome —
   * trace data is observability, not correctness.
   */
  async function flushTraces(): Promise<void> {
    try {
      await options.stores.traces.flush(requestId);
    } catch (err) {
      logRuntimeEvent(logger, "warn", "[flow-state] trace flush failed", {
        requestId,
        error: String(err)
      });
    }
  }

  response.setItemHooks({
    onItemDone: (item) => {
      if (item.type === "state_snapshot") {
        if (item.durable) {
          const requestIdForCheckpoint = item.requestId;
          const blockInstanceId = item.provenance.blockInstanceId;
          const parentBlockInstanceId = item.provenance.parentBlockInstanceId ?? null;
          if (item.terminal === true) {
            // Default: retain the final checkpoint after terminal completion.
            // Operators that want eager GC opt in via
            // `flow.request.cleanupCheckpointsOnTerminal: true`.
            if (cleanupCheckpointsOnTerminal) {
              chainCheckpoint(blockInstanceId, () =>
                options.stores.checkpoints.delete(requestIdForCheckpoint, blockInstanceId).catch((err) => {
                  logRuntimeEvent(logger, "error", "[flow-state] checkpoint delete failed", {
                    requestId: requestIdForCheckpoint,
                    blockInstanceId,
                    error: String(err)
                  });
                })
              );
            }
          } else {
            chainCheckpoint(blockInstanceId, () =>
              options.stores.checkpoints.write({
                requestId: requestIdForCheckpoint,
                blockInstanceId,
                parentBlockInstanceId,
                stepIndex: item.stepIndex,
                state: item.state,
                version: item.version,
                createdAt: item.ts
              }).catch((err) => {
                logRuntimeEvent(logger, "error", "[flow-state] checkpoint write failed", {
                  requestId: requestIdForCheckpoint,
                  blockInstanceId,
                  error: String(err)
                });
              })
            );
          }
        }
        // state_snapshot items are transient by design — no items-log persist.
        return;
      }
      if (item.transient === true) return;
      options.stores.request.persistItems(requestId, response.getItems());
    },
    // FIX-479: incremental items-snapshot checkpoint while streaming text.
    // content.delta events no longer enter the persisted events log; the
    // running text is captured by mutating MessageItem.content / Reasoning-
    // Item.summary in-place inside the emitter, then flushed here at the
    // store's natural cadence. persistItems is already coalesced via the
    // FilesystemRequestStore's itemWriteQueued sentinel — high-frequency
    // delta callers do not amplify disk I/O.
    onItemUpdate: (item) => {
      if (item.type === "state_snapshot") return;
      if (item.transient === true) return;
      options.stores.request.persistItems(requestId, response.getItems());
    }
  });

  // --- Incremental event persistence ---
  // The emitter awaits flushEvents before publishing each replayable event
  // to the wire (FIX-399), closing the durability gap where a process crash
  // between wire-send and persist-completion would leave the client with a
  // sequence number the persisted log can't reproduce. onPersistError lets
  // store failures surface instead of being swallowed.
  response.setEventHooks({
    onEvent: (events) => {
      options.stores.request.persistEvents(requestId, events);
    },
    flushEvents: () => options.stores.request.flushEvents(requestId),
    onPersistError: (err) => {
      logRuntimeEvent(logger, "error", "[flow-state] event persistence failed", {
        requestId,
        error: err.message
      });
    }
  });

  // Emit initial status events early — before the potentially expensive
  // createExecutionContext call. This ensures the SSE stream starts delivering
  // events as fast as possible.
  await response.emitRequestCreated();
  await response.emitRequestStatus("in_progress");

  // Parse input and emit user message early too. If parsing fails, we still
  // need the execution context for proper error handling, so we defer the
  // throw until after context creation.
  let parsedInput: unknown;
  let parseError: unknown;
  try {
    parsedInput = parseActionInput(action, options.input);

    if (action.userMessage !== undefined) {
      const text = action.userMessage(parsedInput);
      const userItem: MessageItem = {
        id: `item_msg_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        type: "message",
        role: "user",
        status: "completed",
        transient: false,
        requestId,
        itemIndex: getResponseItemCount(response),
        provenance: RUNTIME_PROVENANCE,
        ts: Date.now(),
        content: [{ type: "output_text", text }]
      };
      await response.emitItemAdded(userItem);
      await response.emitItemDone(userItem);
    }
  } catch (error) {
    parseError = error;
  }

  // Register the abort controller just before we consume its signal.
  // If anything above threw, the controller would never be registered.
  // If anything between here and the main try block throws, the outer
  // try/catch below cleans it up.
  const abortController = registerAbortController(requestId);
  const composedSignal = options.signal
    ? AbortSignal.any([options.signal, abortController.signal])
    : abortController.signal;

  // FIX-663: a separate controller for fire-and-forget `.work()` tasks. It
  // fires ONLY when the abort-registry controller fires (the explicit
  // `/abort` endpoint / `session.abortRequest()`). Transport-level signals
  // composed into `composedSignal` via `AbortSignal.any` do NOT propagate
  // here because we listen on `abortController.signal` directly — so a client
  // disconnect or SSE close leaves background work to settle.
  const backgroundController = new AbortController();
  const fireBackground = (): void => {
    // Guard against the TOCTOU window where both the abort listener and the
    // defensive already-aborted branch below call this: the abort is
    // idempotent, but skipping here avoids a duplicate diagnostic log.
    if (backgroundController.signal.aborted) return;
    backgroundController.abort(abortController.signal.reason);
    logRuntimeEvent(logger, "warn", "[flow-state] [abort] background signal fired", {
      requestId,
      reason: serializeAbortReason(abortController.signal.reason)
    });
  };
  // `{ once: true }` so the listener auto-removes after firing, avoiding
  // listener accumulation per nodejs/node#46525.
  abortController.signal.addEventListener("abort", () => {
    // Diagnostic: log every request-signal fire with a stack trace so the
    // next regression of this shape is debuggable from server logs alone.
    logRuntimeEvent(logger, "warn", "[flow-state] [abort] request signal fired", {
      requestId,
      reason: serializeAbortReason(abortController.signal.reason),
      stack: new Error("abort fire site").stack
    });
    fireBackground();
  }, { once: true });
  // Defensive: addEventListener does NOT fire for an already-aborted signal.
  // Covers the (microsecond) TOCTOU window between registerAbortController
  // and this listener install. In practice abortController only fires from
  // the /abort endpoint (a network round-trip), so this branch is exercised
  // only if registration races abort — but the guard is free.
  if (abortController.signal.aborted) {
    fireBackground();
  }

  let ctx: ExecutionContext;
  try {
    ctx = await createExecutionContext({
      flow: options.flow,
      actionName: options.actionName,
      requestId,
      userId: options.userId,
      sessionId: options.sessionId,
      orgId: options.orgId,
      tenantId: options.tenantId,
      source,
      metadata: options.metadata,
      input: options.input,
      signal: composedSignal,
      backgroundSignal: backgroundController.signal,
      modelResolver: options.runtimeConfig.modelResolver,
      settings: options.runtimeConfig.settings,
      response,
      stores: options.stores,
      logger,
      tracingLevel: options.runtimeConfig.tracingLevel
    });
  } catch (setupError) {
    deregisterAbortController(requestId);
    if (heartbeatTimer !== undefined) clearInterval(heartbeatTimer);
    throw setupError;
  }

  const metadata = createExecutionMetadata(ctx, {
    scope: "request"
  });

  logRuntimeEvent(logger, "info", "[flow-state] action execution started", {
    ...createExecutionLogContext(metadata),
    input: summarizeForLog(options.input)
  });

  await emitActionLifecycleSeam(internalSeams, "started", metadata);

  await runObserver(options.flow.request?.onStarted, {
    requestId,
    actionName: options.actionName
  }, ctx, { internalSeams });

  try {
    // Re-throw deferred parse error now that we have ctx for error handling.
    if (parseError !== undefined) {
      throw parseError;
    }

    // Compose middleware: global (from caller) → flow-level.
    // Block-level middleware is added inside executeBlock from block.config.
    const actionMiddleware = mergeMiddlewareStacks(
      options.runtimeConfig.middleware,
      options.flow.middleware
    );

    const result = await executeBlock({
      block: action.block,
      input: parsedInput,
      ctx,
      retry: options.retry,
      middleware: actionMiddleware.length > 0 ? actionMiddleware : undefined,
      internalSeams,
      metadata: {
        scope: "request"
      },
      logger
    });

    if (result.error !== undefined) {
      throw result.error;
    }

    const tokenBudget = getActionTokenBudget(action);
    let terminalStatus: "completed" | "incomplete" = "completed";
    if (tokenBudget !== undefined) {
      const consumed = ctx.request.tokenUsage.totalConsumed;
      const warningThreshold = tokenBudget.warnAt === undefined
        ? undefined
        : tokenBudget.maxTotalTokens * tokenBudget.warnAt;

      if (consumed > tokenBudget.maxTotalTokens) {
        if (tokenBudget.onExceeded === "error") {
          throw new ValidationError(
            `Token budget exceeded: consumed ${consumed} > ${tokenBudget.maxTotalTokens}`,
            { scope: "request" }
          );
        }

        await emitBudgetWarning(
          ctx,
          `Token budget exceeded: consumed ${consumed} of ${tokenBudget.maxTotalTokens}`
        );

        if (tokenBudget.onExceeded === "stop") {
          terminalStatus = "incomplete";
        }
      } else if (warningThreshold !== undefined && consumed >= warningThreshold) {
        await emitBudgetWarning(
          ctx,
          `Token budget warning: consumed ${consumed} of ${tokenBudget.maxTotalTokens}`
        );
      }
    }

    if (terminalStatus === "completed") {
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
    }

    // Drain the request-scoped background work pool before terminal status.
    // Inner sequencers no longer auto-await their `.work()` tasks (FIX-554) —
    // the pool consolidates them and we wait once here. Skipped on the
    // abort/disconnect/error paths below: in-flight tasks see ctx.signal and
    // either short-circuit or run to completion in the void; either way the
    // request must not block on them.
    // FIX-663: drain unconditionally on the success path. Background work is
    // decoupled from the request signal now, so the drain must not early-abort
    // on a transport-level `composedSignal` fire. If an explicit `/abort`
    // arrives mid-drain, in-flight tasks self-cancel via their own
    // `ctx.signal` (the background signal) and settle as rejections — drain
    // still resolves.
    await drainRequestWorkPool(ctx);

    // Clear heartbeat
    if (heartbeatTimer !== undefined) clearInterval(heartbeatTimer);

    // Flush pending item, event, and checkpoint writes before terminal status.
    // Checkpoints are fire-and-forget at emit time but must complete before
    // the action returns so terminal deletes win their race against any
    // straggling step writes (FIX-401).
    await options.stores.request.flushItems(requestId);
    await options.stores.request.flushEvents(requestId);
    await flushCheckpoints();
    await flushTraces();

    const completedAt = Date.now();
    const items = response.getItems();
    await patchRequestRecord(options.stores, requestId, {
      status: terminalStatus,
      completedAtMs: completedAt,
      items
    });

    ctx.requestRuntime.status = terminalStatus;
    ctx.requestRuntime.completedAtMs = completedAt;

    await response.emitRequestStatus(terminalStatus);

    // Persist the final event list (includes terminal status event)
    await options.stores.request.flushEvents(requestId);

    if (terminalStatus === "completed") {
      await emitActionLifecycleSeam(internalSeams, "completed", metadata);

      // Retention eviction: remove old request records if session exceeds limits
      if (options.sessionId !== undefined && resolvedRetention !== undefined) {
        try {
          await applyRetentionPolicy(
            options.stores,
            options.sessionId,
            requestId,
            resolvedRetention,
            completedAt
          );
        } catch (err) {
          logRuntimeEvent(logger, "warn", "[flow-state] retention eviction failed", {
            requestId, sessionId: options.sessionId, error: String(err)
          });
        }
      }
    }

    logRuntimeEvent(logger, "info", "[flow-state] action execution completed", {
      ...createExecutionLogContext(metadata),
      durationMs: Date.now() - startedAt,
      output: summarizeForLog(result.output)
    });

    await runObserver(options.flow.request?.onFinished, {
      requestId,
      actionName: options.actionName,
      status: terminalStatus,
      output: result.output
    }, ctx, { internalSeams });
    await emitActionLifecycleSeam(internalSeams, "finished", metadata);

    // Deregister abort controller and active registry
    deregisterAbortController(requestId);
    await registry.deregister(requestId).catch((err) => {
      logRuntimeEvent(logger, "warn", "[flow-state] registry deregister failed", {
        requestId, error: String(err)
      });
    });
    if (eventsRateInterval !== undefined) clearInterval(eventsRateInterval);

    return {
      output: result.output,
      items: response.getItems(),
      durationMs: Date.now() - startedAt
    };
  } catch (error) {
    // Clear heartbeat
    if (heartbeatTimer !== undefined) clearInterval(heartbeatTimer);

    // The composed signal fires when the abort endpoint calls
    // abortController.abort() or when the client disconnects (browser
    // reload, network drop, tab close). Check the persistent
    // abortRequested flag to distinguish intentional abort from
    // accidental disconnect.
    const signalAborted = composedSignal.aborted;

    if (signalAborted) {
      const record = await options.stores.request.get(requestId).catch(() => undefined);
      const wasIntentionalAbort = record?.abortRequested === true;

      if (wasIntentionalAbort) {
        // --- Abort path: user explicitly stopped the request ---
        await emitAbortedMessage(ctx);
        await response.emitRequestStatus("aborted");

        await options.stores.request.flushItems(requestId);
        await options.stores.request.flushEvents(requestId);
        await flushCheckpoints();
        await flushTraces();

        const abortedAt = Date.now();
        await patchRequestRecord(options.stores, requestId, {
          status: "aborted",
          abortedAt,
          items: response.getItems()
        });

        ctx.requestRuntime.status = "aborted";

        await runObserverSafely(options.flow.request?.onFinished, {
          requestId,
          actionName: options.actionName,
          status: "aborted"
        }, ctx, { internalSeams });
        await emitActionLifecycleSeam(internalSeams, "finished", metadata);

        logRuntimeEvent(logger, "info", "[flow-state] action execution aborted", {
          ...createExecutionLogContext(metadata),
          durationMs: Date.now() - startedAt
        });
      } else {
        // --- Disconnect path: client went away without explicit abort ---
        await response.emitRequestStatus("interrupted");

        await options.stores.request.flushItems(requestId);
        await options.stores.request.flushEvents(requestId);
        await flushCheckpoints();
        await flushTraces();

        await patchRequestRecord(options.stores, requestId, {
          status: "interrupted",
          interruptedAt: Date.now(),
          items: response.getItems()
        });

        ctx.requestRuntime.status = "interrupted" as typeof ctx.requestRuntime.status;

        await runObserverSafely(options.flow.request?.onFinished, {
          requestId,
          actionName: options.actionName,
          status: "interrupted"
        }, ctx, { internalSeams });
        await emitActionLifecycleSeam(internalSeams, "finished", metadata);

        logRuntimeEvent(logger, "info", "[flow-state] action execution interrupted (client disconnect)", {
          ...createExecutionLogContext(metadata),
          durationMs: Date.now() - startedAt
        });
      }
    } else {
      // --- Failure path: execution error ---
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

      await options.stores.request.flushItems(requestId);
      await options.stores.request.flushEvents(requestId);
      await flushCheckpoints();
      await flushTraces();

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
    }

    // Deregister abort controller and active registry
    deregisterAbortController(requestId);
    await registry.deregister(requestId).catch((err) => {
      logRuntimeEvent(logger, "warn", "[flow-state] registry deregister failed", {
        requestId, error: String(err)
      });
    });
    if (eventsRateInterval !== undefined) clearInterval(eventsRateInterval);

    return {
      output: undefined,
      items: response.getItems(),
      durationMs: Date.now() - startedAt,
      error: signalAborted ? undefined : applyNormalizedErrorSeam(
        internalSeams,
        normalizeError(error, {
          scope: "request",
          blockName: action.block.name
        }),
        metadata
      )
    };
  }
}
