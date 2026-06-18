/**
 * Action-level orchestration runtime for request lifecycle, observers, persistence, and terminal errors.
 */
import type { ErrorItem, ItemProvenance, MessageItem, OutputItem, StatusItem } from "@flow-state-dev/core/items";
import { isEphemeralContent } from "@flow-state-dev/core/items";
import type {
  ActionConfig,
  BlockDefinition,
  FlowInstance,
  Middleware,
  SuspensionRecord
} from "@flow-state-dev/core/types";
import { SuspensionError, errorDetailsWithCause, buildReplayLog } from "@flow-state-dev/core";
import type { ReplayLog } from "@flow-state-dev/core";
import type { SuspensionItem, SuspensionResumeItem } from "@flow-state-dev/core/items";
import type { RuntimeItem } from "@flow-state-dev/core/items/internal";
import type { ResumeContext } from "@flow-state-dev/core/types";
import { mergeMiddlewareStacks } from "../middleware/compose";
import { createExecutionContext } from "../context/createExecutionContext";
import { resolveSessionStorageKey, tenantMatches } from "../stores/scope-keys";
import { canSpeak, canSpeakStream, getRequestWorkPool } from "@flow-state-dev/core";
import {
  createExecutionLogContext,
  DEFAULT_RUNTIME_LOGGER,
  logRuntimeEvent,
  summarizeForLog
} from "./logging";
import type { ExecutionContext } from "../context/types";
import type { FlowError } from "../errors/flow-error";
import { ValidationError } from "../errors/flow-error";
import { normalizeError, displayCause } from "../errors/normalize-error";
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
 * Union prior persisted items with this run's items by `id`, last-write-wins
 * per id, preserving order (prior items first in their original order, then
 * any new ids in re-entry order). Used for the terminal write of a same-request
 * continuation (FIX-811), where the re-entry emitter holds only post-resume
 * items but a GET must return the full pause→continue history. A backstop for
 * stores whose `persistItems` already merges (sqlite); load-bearing for the
 * in-memory store whose `persistItems` is a no-op.
 */
function mergeItemsById(
  prior: readonly OutputItem[],
  reentry: readonly OutputItem[]
): OutputItem[] {
  const byId = new Map<string, OutputItem>();
  const order: string[] = [];
  for (const item of prior) {
    if (!byId.has(item.id)) order.push(item.id);
    byId.set(item.id, item);
  }
  for (const item of reentry) {
    if (!byId.has(item.id)) order.push(item.id);
    byId.set(item.id, item);
  }
  return order.map((id) => byId.get(id)!);
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

  // Fold the error cause chain into details so intermediate failures aren't
  // swallowed on the terminal error item. `displayCause` unwraps the synthetic
  // layer normalizeError adds for plain throws, matching the tool-output seam.
  const details = errorDetailsWithCause({
    details: error.details,
    cause: displayCause(error),
  });
  const item: ErrorItem = {
    id: `item_error_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    type: "error",
    status: "failed",
    requestId: ctx.requestRuntime.requestId,
    itemIndex: getResponseItemCount(ctx.response),
    provenance: RUNTIME_PROVENANCE,
    ts: Date.now(),
    message: error.message,
    code: error.code,
    ...(details ? { details } : {})
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
    internalSeams: undefined,
    startSequenceNumber: options.startSequenceNumber
  });

  // Same-request continuation (FIX-811): the re-entry emitter holds only
  // post-resume items, but every persist — incremental AND terminal — must
  // write the FULL pause→continue log so a replace-style store (e.g.
  // filesystem) never truncates the pre-suspension history mid-run, and a crash
  // between resume and completion keeps the whole log. Assigned once replay mode
  // is determined below; until then `itemsToPersist()` is the live items as-is.
  let isReplayMode = false;
  let priorItemsForMerge: readonly OutputItem[] = [];
  const itemsToPersist = (): OutputItem[] =>
    isReplayMode ? mergeItemsById(priorItemsForMerge, response.getItems()) : response.getItems();

  if (options.onItem !== undefined) {
    // Fan every item to the caller's listener, transient ones included (they
    // are live-only and absent from the persisted log). subscribeToItems
    // returns an unsubscribe fn; the emitter is scoped to this run and
    // discarded once it completes, so no manual teardown is needed.
    response.subscribeToItems(options.onItem);
  }

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
  // TTS hook is constructed later (after `composedSignal` exists) so the
  // request-level abort signal can be threaded into provider calls. The
  // observer must still be registered before action execution emits content
  // deltas; `composedSignal` is created well before that point.
  let ttsHook: TTSEmitterHook | undefined;
  const voiceConfig = options.flow.voice;
  const voiceMeta = options.metadata?.voice as
    | { ttsEnabled?: boolean; inputModality?: string }
    | undefined;
  const ttsEnabled = voiceMeta?.ttsEnabled === true;

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
    // Carry the tenant so recovery re-dispatches the retry in-tenant (FIX-682).
    tenantId: options.tenantId,
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
    // Tenant-namespaced key (FIX-682) so this lands on the same record the
    // execution context reads/writes; a bare key would miss a tenant session.
    const sessionKey = resolveSessionStorageKey(options.sessionId, options.tenantId);
    const session = await options.stores.session.get(sessionKey);
    // Tenant-binding guard (FIX-682): this write runs before
    // createExecutionContext's binding check, so without it a no-tenant caller
    // passing `sessionId = "${tenant}:${id}"` would overwrite another tenant's
    // latestRequestId (an auto-resume hijack) even though the run then fails.
    if (session !== undefined && tenantMatches(session.tenantId, options.tenantId)) {
      await options.stores.session.set(
        sessionKey,
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
  // Set whenever a durable state_snapshot frame is seen — the precise signal
  // that this request exercised durable execution (a `sequencer({ durable })`
  // step ran). Used by the terminal-completion cleanup wire (FIX-141) to
  // decide whether to clean up this request's own durability artifacts.
  let sawDurableFrame = false;
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
          sawDurableFrame = true;
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
      options.stores.request.persistItems(requestId, itemsToPersist());
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
      options.stores.request.persistItems(requestId, itemsToPersist());
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

  // Construct the TTS pipeline now that the request-level signal exists.
  // Gated on a provider that actually advertises `speak`; if the flow asks
  // for TTS but the provider can't synthesize, log a warning and continue
  // text-only rather than constructing a pipeline that would always fail.
  if (voiceConfig?.tts !== undefined && ttsEnabled) {
    const provider = options.runtimeConfig.voiceProvider;
    if (provider !== undefined && (canSpeak(provider) || canSpeakStream(provider))) {
      // Either batch (`speak`) or streaming (`speakStream`) is enough — the
      // pipeline branches on `canSpeakStream` per sentence.
      ttsHook = createTTSEmitterHook({
        config: voiceConfig.tts,
        provider,
        emitter: response,
        signal: composedSignal
      });
      response.addEventObserver((event) => ttsHook!.onEvent(event));
    } else if (provider !== undefined) {
      logRuntimeEvent(
        logger,
        "warn",
        "[flow-state] flow requested TTS but the voice provider supports neither speak nor speakStream; continuing text-only",
        { requestId, provider: provider.providerName }
      );
    }
  }

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

  // --- Same-request continuation: replay mode (FIX-811) ---
  // A suspended/interrupted request that re-enters under its OWN id replays
  // already-completed blocks from its durable item log instead of re-running
  // them. Detection: an explicit `replayMode` flag (set by continueRequest), or
  // — for callers that just thread a resumeContext at the same id — a present
  // resumeContext with the existing record still `suspended`.
  //
  // Built BEFORE createExecutionContext so the augmented `resumeContext`
  // (carrying `pendingBlockLogicalId`) is the one the execution context's
  // `ctx.suspend()` closes over, and so the ReplayLog can be assigned to the
  // context the moment it exists. A flow-resolve / ReplayLog-build failure here
  // is BEFORE the point-of-no-return: the record stays `suspended` and the run
  // never transitions it.
  const resumeContextRaw = options.metadata?.resumeContext as ResumeContext | undefined;
  let priorRecord: RequestRecord | undefined;
  if (resumeContextRaw !== undefined || options.replayMode === true) {
    priorRecord = await options.stores.request.get(requestId).catch(() => undefined);
  }
  isReplayMode =
    resumeContextRaw !== undefined &&
    (options.replayMode === true || priorRecord?.status === "suspended");

  let replayLog: ReplayLog | undefined;
  let effectiveMetadata = options.metadata;
  if (isReplayMode && priorRecord !== undefined) {
    const priorItems = (priorRecord.items ?? []) as RuntimeItem[];
    // The full prior log (pre-suspension items + the `suspension` item) that
    // every persist must preserve under the merge — assigned before any item
    // is emitted so incremental persists never truncate it.
    priorItemsForMerge = priorItems as readonly OutputItem[];
    replayLog = buildReplayLog(priorItems);
    const pendingBlockLogicalId = replayLog.pendingSuspension()?.blockLogicalId;
    // Thread the resolving gate's logical id so ctx.suspend() returns the
    // resume payload at exactly that gate and re-suspends at any other.
    effectiveMetadata = {
      ...options.metadata,
      resumeContext: { ...resumeContextRaw, pendingBlockLogicalId }
    };
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
      metadata: effectiveMetadata,
      input: options.input,
      signal: composedSignal,
      backgroundSignal: backgroundController.signal,
      modelResolver: options.runtimeConfig.modelResolver,
      settings: options.runtimeConfig.settings,
      response,
      stores: options.stores,
      logger,
      tracingLevel: options.runtimeConfig.tracingLevel,
      durabilityEnabled: options.runtimeConfig.durabilityProvider !== undefined,
      errorCapture: options.runtimeConfig.errorCapture
    });
  } catch (setupError) {
    deregisterAbortController(requestId);
    if (heartbeatTimer !== undefined) clearInterval(heartbeatTimer);
    throw setupError;
  }

  // Resume mode: load the suspension record + checkpoint to restore the durable
  // sequencer's accumulator state. `resumeOf` (legacy two-request path) reads
  // from the ORIGINAL request id; same-request replay (FIX-811) reads from this
  // request's own id. Step skipping is no longer positional — completed blocks
  // are injected per-logical-path via `ctx._replayLog` (set below in replay
  // mode); this only restores sequencer state.
  const resumeOf = options.metadata?.resumeOf as string | undefined;
  const resumeContext = effectiveMetadata?.resumeContext as ResumeContext | undefined;
  const checkpointSourceId = isReplayMode ? requestId : resumeOf;
  if (checkpointSourceId !== undefined && resumeContext !== undefined) {
    const provider = options.runtimeConfig.durabilityProvider;
    if (provider !== undefined) {
      const suspension = await provider.loadSuspension(
        checkpointSourceId,
        resumeContext.suspensionId
      );
      if (suspension !== null && suspension.stepIndex >= 0) {
        // The suspension's `blockInstanceId` is the durable sequencer's
        // checkpoint key. In replay mode the request id is unchanged, so the
        // checkpoint lives under this same id.
        const checkpoint = await options.stores.checkpoints.latest(
          checkpointSourceId,
          suspension.blockInstanceId
        );
        (ctx as any)._resumeState = {
          state: checkpoint?.state as Record<string, unknown> | undefined
        };
      }
    }
  }

  // Replay mode: assign the ReplayLog so the core executor injects completed
  // blocks, transition the record across the point-of-no-return, and emit the
  // `suspension_resume` audit item. Everything above this point (flow resolve,
  // ReplayLog build, heartbeat re-register, checkpoint restore) can fail while
  // leaving the record `suspended`; once we emit `in_progress` below, any later
  // failure is a durable terminal `failed`.
  if (isReplayMode && replayLog !== undefined && resumeContext !== undefined) {
    (ctx as any)._replayLog = replayLog;

    // Point of no return: suspended → in_progress.
    await patchRequestRecord(options.stores, requestId, { status: "in_progress" });
    ctx.requestRuntime.status = "in_progress";
    await response.emitRequestStatus("in_progress");

    // Audit item, positioned immediately after the `suspension` it resolves
    // (it is the first item appended to the re-entry emitter).
    const resumeItem: SuspensionResumeItem = {
      id: `item_suspension_resume_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      type: "suspension_resume",
      status: "completed",
      suspensionId: resumeContext.suspensionId,
      resolution: resumeContext.action === "approve" ? "approved" : "rejected",
      resolvedBy: resumeContext.resumedBy,
      resumeData: resumeContext.data,
      resolvedAt: Date.now(),
      requestId,
      itemIndex: getResponseItemCount(response),
      provenance: RUNTIME_PROVENANCE,
      ts: Date.now()
    };
    await response.emitItemAdded(resumeItem);
    await response.emitItemDone(resumeItem);
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

    let result;
    try {
      result = await executeBlock({
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
    } catch (suspendError) {
      if (suspendError instanceof SuspensionError) {
        const provider = options.runtimeConfig.durabilityProvider;
        // The suspending block's identity is stamped on the error at the
        // innermost scope (FIX-811); the outer ctx usually has no
        // `_blockIdentity` for a nested suspension. Used for the resume audit
        // item only — NOT for the SuspensionRecord, whose `blockInstanceId` is
        // the durable sequencer's checkpoint key consumed by the positional
        // resume path below (`stores.checkpoints.latest`). Overloading that
        // field with the leaf id would break checkpoint restore.
        const suspendingBlockInstanceId =
          suspendError._blockInstanceId ?? ctx._blockIdentity?.blockInstanceId ?? "unknown";
        if (provider !== undefined) {
          const stepIndex = suspendError._stepIndex ?? -1;
          const record: SuspensionRecord = {
            suspensionId: suspendError.suspensionId,
            requestId,
            flowKind: options.flow.kind,
            actionName: options.actionName,
            sessionId: options.sessionId,
            userId: options.userId,
            reason: suspendError.reason,
            message: suspendError.message,
            data: suspendError.data,
            resumeSchema: suspendError.resumeSchema,
            render: suspendError.render,
            status: "pending",
            // The durable sequencer's checkpoint key (FIX-811). Stamped on the
            // error by the suspending sequencer's catch, where its identity is
            // known — the outer ctx has no `_blockIdentity` for a nested
            // suspension, which is why the prior `"unknown"` fallback silently
            // broke checkpoint restore. Resume loads `checkpoints.latest(id,
            // this)`.
            blockInstanceId:
              suspendError._sequencerInstanceId ?? ctx._blockIdentity?.blockInstanceId ?? "unknown",
            stepIndex,
            stepInput: suspendError._currentValue,
            createdAt: Date.now(),
            expiresAt: suspendError.timeoutMs
              ? Date.now() + suspendError.timeoutMs
              : undefined
          };
          await provider.suspend(record);
        }

        const suspItem: SuspensionItem = {
          id: `item_suspension_${Date.now()}_${Math.random().toString(16).slice(2)}`,
          type: "suspension",
          status: "completed",
          suspensionId: suspendError.suspensionId,
          suspensionStatus: "pending",
          reason: suspendError.reason,
          message: suspendError.message,
          data: suspendError.data,
          resumeSchema: suspendError.resumeSchema,
          render: suspendError.render,
          // Carry the suspending (leaf) block's identity into the log so the
          // resume runtime can recover its logical path (FIX-811). This is the
          // ReplayLog's source — distinct from the SuspensionRecord's
          // checkpoint key above.
          blockInstanceId: suspendingBlockInstanceId,
          requestId,
          itemIndex: getResponseItemCount(response),
          provenance: RUNTIME_PROVENANCE,
          ts: Date.now()
        };
        await response.emitItemAdded(suspItem);
        await response.emitItemDone(suspItem);

        if (heartbeatTimer !== undefined) clearInterval(heartbeatTimer);
        await options.stores.request.flushItems(requestId);
        await options.stores.request.flushEvents(requestId);
        await flushCheckpoints();
        await flushTraces();

        await patchRequestRecord(options.stores, requestId, {
          status: "suspended",
          items: itemsToPersist()
        });
        ctx.requestRuntime.status = "suspended";
        await response.emitRequestStatus("suspended");
        await options.stores.request.flushEvents(requestId);

        logRuntimeEvent(logger, "info", "[flow-state] action execution suspended", {
          ...createExecutionLogContext(metadata),
          suspensionId: suspendError.suspensionId,
          reason: suspendError.reason,
          durationMs: Date.now() - startedAt
        });

        deregisterAbortController(requestId);
        await registry.deregister(requestId).catch(() => {});
        if (eventsRateInterval !== undefined) clearInterval(eventsRateInterval);

        // Release the resumeOf lease so the original request can be resumed
        // again (targeting this new suspension).
        if (resumeOf !== undefined) {
          try {
            const lease = await options.stores.leases.get(resumeOf);
            if (lease !== null) {
              await options.stores.leases.release(resumeOf, lease.leaseId);
            }
          } catch (err) {
            logRuntimeEvent(logger, "warn", "[flow-state] lease release failed on re-suspend", {
              requestId, resumeOf, error: String(err)
            });
          }
        }

        return {
          output: undefined,
          items: response.getItems(),
          durationMs: Date.now() - startedAt,
          requestId
        };
      }
      throw suspendError;
    }

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
    const items = itemsToPersist();
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

    if (resumeOf !== undefined && options.runtimeConfig.durabilityProvider !== undefined) {
      try {
        if (terminalStatus === "completed") {
          await options.runtimeConfig.durabilityProvider.cleanup(resumeOf);
        } else {
          // On failure/abort, only release the lease — preserve suspension
          // records so the operator can retry via the resume endpoint.
          const lease = await options.stores.leases.get(resumeOf);
          if (lease !== null) {
            await options.stores.leases.release(resumeOf, lease.leaseId);
          }
        }
      } catch (err) {
        logRuntimeEvent(logger, "warn", "[flow-state] durability cleanup failed", {
          requestId, resumeOf, error: String(err)
        });
      }
    }

    // Non-resumed durable completion: clean up THIS request's own durability
    // artifacts (suspension records + lease) when it completes on the first
    // run (never suspended/resumed). The `resumeOf` block above already cleans
    // the original request on the resume path, so this branch is mutually
    // exclusive with it (guarded by `resumeOf === undefined`) — no double-clean.
    //
    // "Durable" here means the request actually exercised durability:
    // `action.durable` is the documented action-level opt-in (it's what makes
    // ctx.suspend() / crash recovery available and is the reliable signal even
    // for this in-process path). `sawDurableFrame` additionally covers the
    // route/streaming path where a `sequencer({ durable: true })` emits durable
    // state_snapshot frames through the checkpoint hook. Gating on real durable
    // activity avoids touching the stores for purely transient requests, where
    // `cleanup` would be a no-op anyway.
    //
    // Checkpoints are removed only when the flow opts into
    // `cleanupCheckpointsOnTerminal` (per-instance terminal deletes during the
    // run already handle the common case; this is the catch-up for any survivors).
    const usedDurability = action.durable === true || sawDurableFrame;
    if (
      resumeOf === undefined &&
      usedDurability &&
      terminalStatus === "completed" &&
      options.runtimeConfig.durabilityProvider !== undefined
    ) {
      try {
        await options.runtimeConfig.durabilityProvider.cleanup(requestId);
        if (cleanupCheckpointsOnTerminal) {
          await options.runtimeConfig.durabilityProvider.cleanupCheckpoints(requestId);
        }
      } catch (err) {
        logRuntimeEvent(logger, "warn", "[flow-state] durability cleanup failed", {
          requestId, error: String(err)
        });
      }
    }

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
            completedAt,
            options.tenantId
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
      durationMs: Date.now() - startedAt,
      requestId
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
          items: itemsToPersist()
        });

        ctx.requestRuntime.status = "aborted";

        // Abandon in-flight TTS synthesis: the client is gone, so don't run
        // provider calls to completion against a closed connection.
        if (ttsHook !== undefined) await ttsHook.cancel();

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
          items: itemsToPersist()
        });

        ctx.requestRuntime.status = "interrupted" as typeof ctx.requestRuntime.status;

        if (ttsHook !== undefined) await ttsHook.cancel();

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
        items: itemsToPersist()
      });

      ctx.requestRuntime.status = "failed";
      ctx.requestRuntime.failedAtMs = failedAt;

      if (ttsHook !== undefined) await ttsHook.cancel();

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
      requestId,
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
