import { z, type ZodTypeAny } from "zod";
import type { BlockContext, BlockDefinition, BlockOutputHint, ConnectorFn, RescueHandlerSpec } from "../types/block";
import { asRuntime } from "../types/block";
import type { BlockValue, BlockValueInternal, OutputItem, StructureShape } from "../items/types";
import type {
  BranchStep,
  BranchStepOutput,
  InlineBlockFactory,
  ParallelStep,
  ParallelStepOutput,
  SequencerConfig,
  SequencerDefinition,
  SequencerRuntimeState,
  WorkResult
} from "./sequencer-methods";
import { buildBlock, mergeDeclaredResources } from "./internal/build-block";
import { SequencerOutputSchemaError, SequencerSchemaMismatchError } from "../errors/sequencer-output-schema-error";
import { resolveCapabilities } from "./internal/resolve-capabilities";
import { resolveActiveStatusMessage } from "./internal/resolve-active-status-message";
import type { DeclaredResources } from "../types/block";
import { getEmitterItemCount, isBlockDefinition, toError, withTimeout } from "./internal/utils";
import {
  blockPathBranch,
  blockPathIteration,
  blockPathRescue,
  blockPathSegment,
  buildBlockInstanceId,
  extendBlockPath,
  ROOT_BLOCK_PATH
} from "./internal/block-instance-id";
import { resolveTracingLevel, type TracingLevel } from "../helpers/tracing-level";
import { getRequestWorkPool } from "../execution/request-work-pool";
import { getTransientKeys, stripTransientKeys } from "../helpers/transient-slot";

const DEFAULT_MAX_LOOP_GUARD = 250;

/** Output schema for `.waitForCondition` — a single boolean `timedOut` flag. */
const waitForConditionOutputSchema = z.object({ timedOut: z.boolean() });

let inlineBlockCounter = 0;
let sequencerScopeCounter = 0;

function autoInlineName(): string {
  inlineBlockCounter += 1;
  return `inline-${inlineBlockCounter}`;
}

/**
 * Detects inline config objects passed to sequencer DSL methods.
 * Primary discriminator: outputSchema (a Zod type with _def property).
 * Secondary discriminator: execute function (for tap where outputSchema is optional).
 * Rejects BlockDefinition objects (which also have properties but are identified by kind/name/config).
 */
function isInlineConfig(value: unknown): boolean {
  if (typeof value !== "object" || value === null || isBlockDefinition(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;

  // Primary: has a Zod outputSchema
  if (
    record.outputSchema !== undefined &&
    typeof record.outputSchema === "object" &&
    record.outputSchema !== null &&
    (record.outputSchema as Record<string, unknown>)._def !== undefined
  ) {
    return true;
  }

  // Secondary: has execute function (for tap where outputSchema is optional)
  return typeof record.execute === "function";
}

/**
 * Builds a BlockDefinition from a factory function and inline config,
 * injecting inputSchema from the previous step's output schema.
 */
function buildInlineBlock(
  factory: InlineBlockFactory,
  inlineConfig: Record<string, unknown>,
  lastOutputSchema: ZodTypeAny | undefined
): BlockDefinition<any, any> {
  const name = (inlineConfig.name as string | undefined) ?? autoInlineName();
  return factory({
    ...inlineConfig,
    name,
    inputSchema: lastOutputSchema ?? z.any()
  });
}

type SequencerOpResult = {
  value: unknown;
  jumpTo?: string;
  exit?: boolean;
  /**
   * BlockValue hint for the sequencer's output after this op runs (FIX-413).
   * - Unset: op did not change the sequencer's output kind. The running
   *   descriptor from prior ops carries over (e.g., `.tap`, `.work`, no-op
   *   `.thenIf`).
   * - Set: replaces the running descriptor. `.then` produces a ref to the
   *   child item, `.map` produces inline, `.thenAll` produces structure.
   */
  descriptor?: BlockOutputHint;
};

type SequencerOperation = {
  name: string;
  run: (
    value: unknown,
    ctx: BlockContext,
    runtime: SequencerRuntimeState,
    stepIndex: number
  ) => Promise<SequencerOpResult>;
};

/**
 * Looks up the id of the most recently emitted `block_trace` item whose
 * provenance matches a given block instance. Used by sequencer ops to build
 * `ref` descriptors pointing at their child's emitted item (FIX-413).
 *
 * Returns undefined if no item emitter is installed (unit tests, non-tracing
 * harnesses) or no matching item was found. Callers fall back to `inline`.
 *
 * Safe under concurrency because each parallel branch is invoked at a unique
 * path and therefore has a unique `blockInstanceId`.
 */
function findEmittedBlockTraceId(
  ctx: BlockContext,
  childInstanceId: string
): string | undefined {
  if (ctx.response === undefined) return undefined;
  // Defensive: some legacy test fixtures construct partial `ctx.response`
  // mocks without `getItems`. Returning undefined falls back to inline refs.
  if (typeof ctx.response.getItems !== "function") return undefined;
  const items = ctx.response.getItems();
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i] as { id: string; type: string; provenance?: { blockInstanceId?: string } };
    if (item.type === "block_trace" && item.provenance?.blockInstanceId === childInstanceId) {
      return item.id;
    }
  }
  return undefined;
}

/**
 * Build a `ref` descriptor pointing at the child invoked at a given path. Falls
 * back to `{ kind: "inline" }` if the child did not emit a trace (e.g., when a
 * sequencer runs without a response emitter in a unit test).
 */
function refDescriptorForPath(ctx: BlockContext, path: string): BlockOutputHint {
  const instanceId = buildBlockInstanceId(ctx.request.identity.id, path, 0);
  const itemId = findEmittedBlockTraceId(ctx, instanceId);
  if (itemId === undefined) return { kind: "inline" };
  return { kind: "ref", sourceItemId: itemId };
}

/**
 * Compute the `input.source` descriptor for a child block invocation by
 * looking up the previous step's emitted block_trace item. Returns an
 * inline-undefined when no prior step exists (sequencer head) so the
 * server-side handler stamps `{ kind: "inline", value: rawInput }` from the
 * raw input itself.
 */
function inputDescriptorFromPrevPath(
  ctx: BlockContext,
  prevPath: string | undefined
): BlockValueInternal<unknown> {
  if (prevPath === undefined) return { kind: "inline", value: undefined };
  const ref = refDescriptorForPath(ctx, prevPath);
  return ref.kind === "ref"
    ? { kind: "ref", sourceItemId: ref.sourceItemId }
    : { kind: "inline", value: undefined };
}

/**
 * Compute the `input.source` descriptor for an aggregator step (`.thenAll`,
 * `.parallel`, `.forEach`) whose input is structurally composed from a set of
 * branch paths. Each entry is a ref to the matching branch trace when present,
 * falling back to inline-undefined otherwise.
 */
function inputDescriptorFromBranches(
  ctx: BlockContext,
  branches: Array<{ key?: string; path: string }>,
  container: "array" | "object"
): BlockValueInternal<unknown> {
  if (container === "array") {
    const entries: BlockValueInternal<unknown>[] = branches.map((b) => {
      const ref = refDescriptorForPath(ctx, b.path);
      return ref.kind === "ref"
        ? { kind: "ref", sourceItemId: ref.sourceItemId }
        : { kind: "inline", value: undefined };
    });
    return { kind: "structure", shape: { container: "array", entries } };
  }
  const entries: Record<string, BlockValueInternal<unknown>> = {};
  for (const b of branches) {
    if (b.key === undefined) continue;
    const ref = refDescriptorForPath(ctx, b.path);
    entries[b.key] =
      ref.kind === "ref"
        ? { kind: "ref", sourceItemId: ref.sourceItemId }
        : { kind: "inline", value: undefined };
  }
  return { kind: "structure", shape: { container: "object", entries } };
}

/**
 * Stash an input descriptor on a temporary scope key so the next invocation of
 * `executeBlock` propagates it onto the scoped child ctx via the
 * `_blockInputHint` field. Cleared by `executeBlock`'s scope wrapper after
 * forwarding to the child run.
 */
function stashInputHint(ctx: BlockContext, hint: BlockValueInternal<unknown>): void {
  (ctx as { _pendingChildInputHint?: BlockValueInternal<unknown> })._pendingChildInputHint = hint;
}

/**
 * Compute the sequential input hint for a child block invoked by an op that
 * receives the upstream sequencer value. Prefers an explicit
 * `runtime.lastChildInputHint` (set by aggregator ops to carry a structure)
 * and falls back to `runtime.lastChildPath` for single-child predecessors.
 * Returns `inline` for the sequencer head so the server-side handler stamps
 * the raw input value.
 */
function sequentialInputHint(
  ctx: BlockContext,
  runtime: SequencerRuntimeState
): BlockValueInternal<unknown> {
  if (runtime.lastChildInputHint !== undefined) return runtime.lastChildInputHint;
  return inputDescriptorFromPrevPath(ctx, runtime.lastChildPath);
}

/**
 * Stash a sequential input hint and record the child's path on runtime state
 * so the next op can chain. Centralises the bookkeeping for ops that dispatch
 * a single child block (`.then`, `.thenIf`, `.tap`, `.tapIf`, `.branch`, etc.).
 * Clears any aggregator-set `lastChildInputHint` after consuming it.
 */
function prepareSequentialChild(
  ctx: BlockContext,
  runtime: SequencerRuntimeState,
  childPath: string
): void {
  stashInputHint(ctx, sequentialInputHint(ctx, runtime));
  runtime.lastChildPath = childPath;
  runtime.lastChildInputHint = undefined;
}

type WorkOptions = {
  name?: string;
};

type WaitForWorkOptions = {
  failOnError?: boolean;
  timeoutMs?: number;
};

function isConcurrencyOptions(value: unknown): value is { maxConcurrency?: number } {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  if (isBlockDefinition(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return "maxConcurrency" in record || "concurrency" in record || Object.keys(record).length === 0;
}

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
 * Emits a state_snapshot item at sequencer step boundaries (FIX-401).
 *
 * One logical snapshot per sequencer instance, keyed by `blockInstanceId`.
 * Each emission overwrites the prior frame on the wire (clients dedupe on
 * `key`) and — when `durable` is true — overwrites the prior record in
 * `stores.checkpoints` via the server-side durability hook.
 *
 * Skips emission when state hasn't changed since the last snapshot to keep
 * idle steps from cutting needless events. The first call (`lastStateJson`
 * undefined) always emits so the durability writer sees a baseline frame.
 *
 * Non-durable sequencers gate on the effective `tracingLevel` (FIX-406 6H) —
 * there's no consumer for the snapshot in production unless the operator opted
 * in. Durable sequencers always emit because the snapshot drives the
 * persistence write; gating it would silently break checkpointing.
 *
 * `terminal: true` signals the final emission for this sequencer's run
 * (success / error / cancellation). The durability hook treats terminal
 * frames as a delete signal.
 */
async function emitStateSnapshot(
  ctx: BlockContext,
  stepName: string,
  stepIndex: number,
  lastStateJson: string | undefined,
  durable: boolean,
  version: number,
  stateSchema: ZodTypeAny | undefined,
  terminal: boolean = false
): Promise<string | undefined> {
  // Non-durable snapshots are observability-only and gated by tracingLevel
  // (FIX-406 6H). Durable snapshots must always emit — they're the crash-resume
  // checkpoint path, independent of tracing verbosity.
  //   - minimal: suppress all observability snapshots
  //   - normal:  block boundaries only (initial + terminal), skip per-step
  //   - verbose: emit everything
  if (!durable) {
    const level = resolveTracingLevel(
      (ctx as { _tracingLevel?: TracingLevel })._tracingLevel
    );
    if (level === "minimal") return lastStateJson;
    const isPerStep = !terminal && stepIndex >= 0;
    if (level === "normal" && isPerStep) return lastStateJson;
  }

  const seqRef = ctx.sequencer;
  if (seqRef === undefined) return lastStateJson;

  // Strip transient slots before serialization. Transient values stay on
  // `seqRef.state` for in-memory reads but never enter the snapshot payload,
  // so durable checkpoints are clean and on-resume the slot resets to its
  // schema default. Both sides of the dedup compare run on the stripped form
  // so the saved `lastStateJson` is comparable across calls.
  const transientKeys = getTransientKeys(stateSchema);
  const visibleState = stripTransientKeys(
    seqRef.state as Record<string, unknown>,
    transientKeys
  );

  const currentStateJson = JSON.stringify(visibleState);

  // Skip step-boundary emissions when state hasn't changed. Terminal frames
  // always emit so the durability hook sees the delete signal even when the
  // last step left state untouched.
  if (!terminal && lastStateJson !== undefined && currentStateJson === lastStateJson) {
    return lastStateJson;
  }

  // Schema validation at the durability boundary (FIX-401 acceptance #1).
  // A handler that mutated state into a shape the schema rejects would
  // otherwise persist garbage that the future resume runtime (FIX-141)
  // can't restore. Downgrade to a non-durable emission so the devtool still
  // sees the bad state for debugging, but the checkpoint store stays clean.
  // Terminal frames always stay durable when configured so the delete
  // signal still fires.
  let effectiveDurable = durable;
  if (durable && !terminal && stateSchema !== undefined) {
    const parsed = stateSchema.safeParse(seqRef.state);
    if (!parsed.success) {
      effectiveDurable = false;
      // eslint-disable-next-line no-console
      console.warn(
        `[flow-state] sequencer "${seqRef.name}" state failed stateSchema validation; ` +
        `checkpoint write skipped for blockInstanceId=${seqRef.instanceId}. ` +
        `Issues: ${parsed.error.issues.map((i) => i.path.join(".") + ": " + i.message).join("; ")}`
      );
    }
  }

  const item = {
    id: `item_state_snap_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    type: "state_snapshot" as const,
    status: "completed" as const,
    transient: true,
    requestId: ctx.request.identity.id,
    itemIndex: getEmitterItemCount(ctx.response),
    provenance: {
      blockName: seqRef.name,
      blockInstanceId: seqRef.instanceId,
      parentBlockInstanceId: ctx._blockIdentity?.parentBlockInstanceId,
      phase: ctx._blockIdentity?.phase ?? "main",
      stepIndex,
    },
    ts: Date.now(),
    key: seqRef.instanceId,
    stepName,
    stepIndex,
    state: structuredClone(visibleState),
    version,
    durable: effectiveDurable,
    terminal
  };

  // Route through the trace channel so item.added/item.done are stamped
  // `agentType: "trace"` and persisted via the TraceStore. The durable-
  // checkpoint side-channel (in runAction's setItemHooks.onItemDone) is
  // unaffected — it observes the same items as before. Stamp the item
  // and await the emit pair sequentially here (rather than via the
  // fire-and-forget `ctx.emit.trace.stateSnapshot`) so consecutive calls
  // from the step loop emit item.done in order — onItemDone is the
  // checkpoint-write trigger and its sequencing matters.
  const stamped = item as typeof item & { agentType?: "trace" };
  if (stamped.agentType === undefined) {
    stamped.agentType = "trace";
  }
  await ctx.response.emit({ type: "item.added", item });
  await ctx.response.emit({ type: "item.done", item });

  return currentStateJson;
}

// FIX-573: emitGeneratorBlockOutput is gone. The generator's output phase
// is fired by `_withExecutionScope`'s post-execute path along with all
// other block kinds; modelUsage flows via `_generatorModelUsage` on the
// scoped ctx (set in executeBlock above) so the unified hook handler picks
// it up when patching the trace row.

/**
 * Returns the current sequencer's path from ctx. Defaults to the root path
 * for standalone invocations where no execution scope is active.
 */
function currentPath(ctx: BlockContext): string {
  return ctx._blockIdentity?.blockPath ?? ROOT_BLOCK_PATH;
}

/**
 * Builds the child path for a block invoked by a sequencer operation.
 * The op segment identifies the structural position; an optional iteration
 * segment distinguishes individual iterations of an iterative op.
 */
function childBlockPath(
  ctx: BlockContext,
  op: string,
  stepIndex: number,
  iteration?: number
): string {
  let path = extendBlockPath(currentPath(ctx), blockPathSegment(op, stepIndex));
  if (iteration !== undefined) {
    path = extendBlockPath(path, blockPathIteration(iteration));
  }
  return path;
}

async function executeBlock(
  block: BlockDefinition<any, any>,
  input: unknown,
  ctx: BlockContext,
  path: string,
  options?: { phase?: "main" | "work"; signalOverride?: AbortSignal }
): Promise<unknown> {
  const startedAt = Date.now();
  const requestId = ctx.request.identity.id;
  const instanceId = buildBlockInstanceId(requestId, path, 0);
  // Pull the input descriptor stashed by the calling op (FIX-573). Forwarded
  // onto the scoped child ctx as `_blockInputHint` so build-block.ts's
  // `added`-phase capture can stamp the right BlockValue source. Cleared
  // after one read so it can't leak across siblings.
  const pendingInputHint =
    (ctx as { _pendingChildInputHint?: BlockValueInternal<unknown> })._pendingChildInputHint;
  if (pendingInputHint !== undefined) {
    (ctx as { _pendingChildInputHint?: BlockValueInternal<unknown> })._pendingChildInputHint = undefined;
  }
  const run = async (scopedCtx: BlockContext): Promise<unknown> => {
    if (pendingInputHint !== undefined) {
      (scopedCtx as { _blockInputHint?: BlockValueInternal<unknown> })._blockInputHint = pendingInputHint;
    }
    scopedCtx._runtimeHooks?.onBlockStart?.(block.name, block.kind, input, block.transient);
    resolveActiveStatusMessage(block, input, scopedCtx);

    // For generator blocks, intercept onGeneratorModelResult to capture token usage.
    let modelUsage: GeneratorModelUsageMeta | undefined;
    const execCtx = block.kind === "generator"
      ? {
          ...scopedCtx,
          _runtimeHooks: {
            ...scopedCtx._runtimeHooks,
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
              if (payload.usage) {
                const anthropic = payload.providerMetadata?.anthropic ?? {};
                // Prefer the adapter-normalised usage fields; fall back to
                // provider metadata so older call paths keep working.
                const cacheReadTokens =
                  payload.usage.cacheReadInputTokens ??
                  (typeof anthropic.cacheReadInputTokens === "number"
                    ? anthropic.cacheReadInputTokens : undefined);
                const cacheCreationTokens =
                  payload.usage.cacheCreationInputTokens ??
                  (typeof anthropic.cacheCreationInputTokens === "number"
                    ? anthropic.cacheCreationInputTokens : undefined);
                modelUsage = {
                  model: payload.model,
                  promptTokens: payload.usage.promptTokens,
                  completionTokens: payload.usage.completionTokens,
                  totalTokens: payload.usage.totalTokens,
                  providerMetadata: payload.providerMetadata,
                  cacheReadTokens,
                  cacheCreationTokens,
                };
              }
              // Chain to original hook
              scopedCtx._runtimeHooks?.onGeneratorModelResult?.(payload);
            },
          },
        } as BlockContext
      : scopedCtx;

    // FIX-573: nested-block trace emission is driven entirely by
    // `onBlockTraceCapture` firing the `added` phase from build-block.ts.
    try {
      const output = await asRuntime(block).run(input, execCtx);
      scopedCtx._runtimeHooks?.onBlockComplete?.(block.name, block.kind, output, Date.now() - startedAt, block.transient);

      // FIX-573: stash captured generator modelUsage on the scoped ctx so
      // `_withExecutionScope`'s `output` phase capture picks it up. The
      // unified trace lifecycle uses one row per block; the prior split
      // (sequencer.ts emit + _withExecutionScope skip) is gone. Also forward
      // the FIX-480 ref hint that streaming-text generators set on their own
      // (separate) ctx up to the scoped ctx so the output phase reads it.
      if (block.kind === "generator") {
        if (modelUsage !== undefined) {
          (scopedCtx as { _generatorModelUsage?: GeneratorModelUsageMeta })._generatorModelUsage = modelUsage;
        }
        const generatorHint = (execCtx as { _blockOutputHint?: BlockOutputHint })._blockOutputHint;
        if (generatorHint !== undefined) {
          (scopedCtx as { _blockOutputHint?: BlockOutputHint })._blockOutputHint = generatorHint;
        }
      }

      return output;
    } catch (error) {
      scopedCtx._runtimeHooks?.onBlockError?.(block.name, block.kind, error, Date.now() - startedAt, block.transient);

      // FIX-573: forward partial modelUsage on the failure path too. The
      // `output` phase in `_withExecutionScope` reads it and patches the
      // shared block_trace row before emitting item.done.
      if (block.kind === "generator" && modelUsage !== undefined) {
        (scopedCtx as { _generatorModelUsage?: GeneratorModelUsageMeta })._generatorModelUsage = modelUsage;
      }

      throw error;
    }
  };

  if (ctx._withExecutionScope === undefined) {
    // No server scope hook (unit-test context). `ctx.signal` was already
    // substituted by the caller's `taskCtx` spread when dispatching `.work()`,
    // so the override is implicit here. Nothing more to thread.
    return run(ctx);
  }

  const containerConfig =
    block.kind === "sequencer" || block.kind === "router"
      ? (block.config as { container?: { component?: string; label?: string | ((input: unknown) => string); metadata?: Record<string, unknown> | ((input: unknown) => Record<string, unknown>); } }).container
      : undefined;

  return ctx._withExecutionScope(
    {
      name: block.name,
      kind: block.kind,
      instanceId,
      path,
      transient: block.transient || undefined,
      stateSchema: block.kind === "sequencer" ? block.config.stateSchema : undefined,
      input,
      phase: options?.phase ?? ctx._blockIdentity?.phase,
      container:
        containerConfig === undefined
          ? undefined
          : {
              component: containerConfig.component,
              label:
                typeof containerConfig.label === "function"
                  ? containerConfig.label(input as any)
                  : containerConfig.label,
              metadata:
                typeof containerConfig.metadata === "function"
                  ? containerConfig.metadata(input as any)
                  : containerConfig.metadata
            }
    },
    run,
    // FIX-663: thread the background signal override (set at `.work()`
    // dispatch) into the child scope so the entire descendant tree sees it.
    options?.signalOverride
  );
}

async function mapWithConcurrency<TInput, TOutput>(
  values: readonly TInput[],
  maxConcurrency: number | undefined,
  mapper: (value: TInput, index: number) => Promise<TOutput>
): Promise<TOutput[]> {
  if (values.length === 0) {
    return [];
  }

  const limit = Math.max(1, maxConcurrency ?? values.length);
  const results: TOutput[] = new Array<TOutput>(values.length);
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(values[currentIndex], currentIndex);
    }
  };

  const workers: Promise<void>[] = [];
  for (let index = 0; index < Math.min(limit, values.length); index += 1) {
    workers.push(worker());
  }

  await Promise.all(workers);
  return results;
}

function matchesRescueHandler(error: Error, handler: RescueHandlerSpec): boolean {
  if (handler.when === undefined || handler.when.length === 0) {
    return true;
  }

  for (const ErrorType of handler.when) {
    if (error instanceof ErrorType) {
      return true;
    }
  }

  return false;
}

function createRuntimeState(): SequencerRuntimeState {
  sequencerScopeCounter += 1;
  return {
    stepHistory: [],
    loopCounts: new Map<string, number>(),
    workTasks: [],
    stateVersion: 0,
    scopeId: `seq_scope_${sequencerScopeCounter}`,
    lastChildPath: undefined,
    lastChildInputHint: undefined
  };
}

/**
 * Dispatch a background work task. When the request-scoped pool is present
 * (server runtime), push to it tagged with the sequencer's scopeId. When
 * absent (unit-test contexts), fall back to the per-sequencer work list so
 * the inner-sequencer auto-await path keeps working unchanged.
 */
/**
 * Build the context for a background `.work()` / `.workIf()` /
 * `.forEachBackground()` task. FIX-663: when the request executor supplied a
 * `_requestBackgroundSignal`, substitute it for `ctx.signal` so the task tree
 * survives transport teardown and aborts only on explicit user cancellation.
 * Returns the parent ctx unchanged in unit-test contexts (no background
 * signal), preserving pre-FIX-663 behavior. The returned `signalOverride` is
 * threaded into `executeBlock` so descendant scopes inherit the same signal.
 */
function backgroundTaskCtx(ctx: BlockContext): {
  taskCtx: BlockContext;
  signalOverride: AbortSignal | undefined;
} {
  const bgSignal = ctx._requestBackgroundSignal;
  if (bgSignal === undefined) {
    return { taskCtx: ctx, signalOverride: undefined };
  }
  return { taskCtx: { ...ctx, signal: bgSignal }, signalOverride: bgSignal };
}

function dispatchWorkTask(
  ctx: BlockContext,
  runtime: SequencerRuntimeState,
  name: string,
  rawPromise: Promise<unknown>
): void {
  const pool = getRequestWorkPool(ctx);
  if (pool !== undefined) {
    pool.addTask({ promise: rawPromise, meta: { name, scopeId: runtime.scopeId } });
    return;
  }

  // Fallback: per-sequencer auto-await path (unit-test contexts).
  const wrapped = rawPromise
    .then((result): WorkResult => ({ name, status: "fulfilled", value: result }))
    .catch((error): WorkResult => ({ name, status: "rejected", reason: toError(error) }));
  runtime.workTasks.push({ name, promise: wrapped });
}

/**
 * Result of running a sequencer's operation chain. Carries the computed value
 * alongside the last state-mutating step's name, so the output-validation
 * wrapper can attribute a failure without re-deriving it.
 */
type SequencerInnerResult = { value: unknown; lastStepName: string | undefined };

function runSequencerOperations(
  operations: SequencerOperation[],
  rescueHandlers: RescueHandlerSpec[],
  durable: boolean,
  stateSchema: ZodTypeAny | undefined
): (input: unknown, ctx: BlockContext) => Promise<SequencerInnerResult> {
  return async (input: unknown, ctx: BlockContext): Promise<SequencerInnerResult> => {
    const runtime = createRuntimeState();
    let currentValue: unknown = input;
    // Running BlockValue descriptor for the sequencer's output (FIX-413).
    // Starts as inline because the sequencer's initial value is its input,
    // which is not itself a persisted item to ref. Each op can override this.
    let lastDescriptor: BlockOutputHint = { kind: "inline" };

    // Monotonic write counter for the (requestId, blockInstanceId) checkpoint —
    // increments on each emission so durability middleware can disambiguate
    // overwrites and clients can render version progress.
    let snapshotVersion = 0;
    let lastStepName = "__initial__";
    let lastStepIndex = -1;
    let lastStateJson: string | undefined;

    try {
      try {
        // Emit initial state snapshot before any steps execute. For durable
        // sequencers this also writes a baseline checkpoint so a crash before
        // the first step still leaves a resumable record.
        lastStateJson = await emitStateSnapshot(
          ctx,
          lastStepName,
          lastStepIndex,
          undefined,
          durable,
          snapshotVersion,
          stateSchema
        );

        for (let index = 0; index < operations.length; index += 1) {
          const operation = operations[index];
          runtime.stepHistory.push(operation.name);
          const result = await operation.run(currentValue, ctx, runtime, index);
          currentValue = result.value;
          if (result.descriptor !== undefined) {
            lastDescriptor = result.descriptor;
          }

          // Emit state snapshot only if state changed since last snapshot.
          const prevStateJson = lastStateJson;
          snapshotVersion += 1;
          lastStateJson = await emitStateSnapshot(
            ctx,
            operation.name,
            index,
            lastStateJson,
            durable,
            snapshotVersion,
            stateSchema
          );
          // Roll back the version bump when the snapshot was suppressed (state
          // unchanged) so version stays a true write counter.
          if (lastStateJson === prevStateJson) {
            snapshotVersion -= 1;
          } else {
            lastStepName = operation.name;
            lastStepIndex = index;
          }

          if (result.exit === true) {
            break;
          }

          if (result.jumpTo !== undefined) {
            const jumpIndex = operations.findIndex((candidate) => candidate.name === result.jumpTo);
            if (jumpIndex < 0) {
              throw new Error(`loopBack target "${result.jumpTo}" was not found in sequencer "${runtime.stepHistory[0]}"`);
            }

            index = jumpIndex - 1;
          }
        }

        // Per-sequencer auto-await fallback. Runs only when the request
        // executor's `_requestWorkPool` is absent (unit-test contexts). Under
        // the request-scoped pool model, inner sequencers do not block on
        // their own background work — the request executor drains the pool
        // exactly once before terminal status. See FIX-554.
        const hasRequestPool = getRequestWorkPool(ctx) !== undefined;
        if (!hasRequestPool && runtime.workTasks.length > 0) {
          const pending = runtime.workTasks.splice(0, runtime.workTasks.length);
          let remaining = pending.length;
          ctx.emitStatus(undefined, { blocked: false, backgroundTasks: remaining });

          await Promise.all(pending.map((t) =>
            t.promise.then(async (result) => {
              remaining--;
              if (result.status === "rejected") {
                console.error(`[sequencer] Background work "${result.name}" failed:`, result.reason?.message ?? result.reason);
              }
              ctx.emitStatus(undefined, { blocked: false, backgroundTasks: remaining });
            })
          ));
        }

        // Expose the running descriptor to the outer emitter so the sequencer's
        // own block_output carries a ref/structure instead of duplicating the
        // child's content (FIX-413). `inline` is the emitter default and needs
        // no hint — leaves it carried as the raw value.
        if (lastDescriptor.kind !== "inline") {
          (ctx as { _blockOutputHint?: BlockOutputHint })._blockOutputHint = lastDescriptor;
        }

        return { value: currentValue, lastStepName };
      } catch (error) {
        const normalizedError = toError(error);
        for (let i = 0; i < rescueHandlers.length; i += 1) {
          const handler = rescueHandlers[i];
          if (!matchesRescueHandler(normalizedError, handler)) {
            continue;
          }

          const rescuePath = extendBlockPath(currentPath(ctx), blockPathRescue(i));
          // Rescue receives the thrown error inline — no upstream item to ref.
          stashInputHint(ctx, { kind: "inline", value: undefined });
          const rescued = await executeBlock(handler.block, normalizedError, ctx, rescuePath);
          // A rescue branch passes through to the handler block's output.
          const rescueDescriptor = refDescriptorForPath(ctx, rescuePath);
          if (rescueDescriptor.kind !== "inline") {
            (ctx as { _blockOutputHint?: BlockOutputHint })._blockOutputHint = rescueDescriptor;
          }
          // Record the recovery out-of-band so a downstream block can ask
          // `ctx.wasRescued(...)` without the rescued value carrying a marker.
          // Read post-execution by `_withExecutionScope` to stamp this block's
          // sibling-registry result.
          (ctx as { _didRescue?: boolean })._didRescue = true;
          return { value: rescued, lastStepName: handler.block.config.name ?? "rescue" };
        }

        throw normalizedError;
      }
    } finally {
      // Always emit a terminal snapshot — success, error, or cancellation.
      // The server-side durability hook treats `terminal: true` as a delete
      // signal, so each sequencer (root or nested) cleans up its own
      // checkpoint without a separate enumeration pass at request termination.
      // Errors during emit shouldn't mask the underlying execution outcome,
      // so failures here are swallowed.
      try {
        snapshotVersion += 1;
        await emitStateSnapshot(
          ctx,
          lastStepName,
          lastStepIndex,
          lastStateJson,
          durable,
          snapshotVersion,
          stateSchema,
          true
        );
      } catch (terminalEmitError) {
        // Don't mask the underlying execution outcome, but surface this
        // for diagnostics — a broken emitter signature would otherwise
        // ship silently and leave checkpoints uncleaned.
        // eslint-disable-next-line no-console
        console.error("[flow-state] terminal state_snapshot emit failed:", terminalEmitError);
      }
    }
  };
}

/**
 * Single-chokepoint runtime gate for a sequencer's declared `outputSchema`.
 *
 * Unwraps the inner `{ value, lastStepName }` result unconditionally — every
 * exit path (natural tail, `exitIf`, `rescue`) flows through here, so the
 * unwrap must happen even when no schema is declared, or `buildBlock` would
 * receive the tuple as the block's output. When `outputSchema` is set the
 * value is validated; on failure a `SequencerOutputSchemaError` is thrown,
 * on success the (possibly `.transform()`-ed) parsed value is returned.
 *
 * Uses `safeParseAsync` — the wrapper is already async, so this costs nothing
 * extra and correctly runs async refinements (`.refineAsync`, async
 * `superRefine`) that `safeParse` would silently skip.
 */
function wrapWithOutputValidation(
  inner: (input: unknown, ctx: BlockContext) => Promise<SequencerInnerResult>,
  outputSchema: ZodTypeAny | undefined,
  sequencerName: string
): (input: unknown, ctx: BlockContext) => Promise<unknown> {
  return async (input, ctx) => {
    const { value, lastStepName } = await inner(input, ctx);
    if (outputSchema === undefined) {
      return value;
    }
    const result = await outputSchema.safeParseAsync(value);
    if (result.success) {
      return result.data;
    }
    const issue = result.error.issues[0];
    const path = issue?.path?.join(".") ?? "";
    const suffix = path.length > 0 ? ` at "${path}"` : "";
    const message = issue?.message ?? "schema validation failed";
    throw new SequencerOutputSchemaError(
      `Sequencer "${sequencerName}" output validation failed${suffix}: ${message}`,
      {
        sequencerName,
        lastStepName,
        rawOutput: value,
        issues: result.error.issues
      },
      result.error
    );
  };
}

/** Read a zod schema's discriminating `_def.typeName` (e.g. `"ZodObject"`). */
function getZodTypeName(schema: ZodTypeAny): string | undefined {
  return (schema as any)._def?.typeName;
}

/**
 * Conservative one-level structural comparison between a sequencer's declared
 * `outputSchema` and the schema its chain infers. Returns the first
 * incompatibility (with the specific kinds that differ at the point of the
 * mismatch), or `null` when structurally compatible.
 *
 * `declaredKind`/`inferredKind` report the kinds at the level where the
 * mismatch was found: the value kinds for an object-value mismatch, the element
 * kinds for an array mismatch, otherwise the top-level kinds. For a key-set
 * mismatch the kinds are equal (both objects); `reason` carries the key detail.
 *
 * Checks: top-level kind, object key sets, one level of object value kinds, and
 * array element kind. Deliberately does NOT recurse into nested shapes,
 * refinements, brands, or union variants — see `.validate()`'s JSDoc.
 */
function compareSchemasStructurally(
  declared: ZodTypeAny,
  inferred: ZodTypeAny
): { reason: string; declaredKind: string | undefined; inferredKind: string | undefined } | null {
  const dKind = getZodTypeName(declared);
  const iKind = getZodTypeName(inferred);
  if (dKind !== iKind) {
    return { reason: `declared ${dKind} but chain produces ${iKind}`, declaredKind: dKind, inferredKind: iKind };
  }
  if (dKind === "ZodObject") {
    const dShape = (declared as any)._def.shape() as Record<string, ZodTypeAny>;
    const iShape = (inferred as any)._def.shape() as Record<string, ZodTypeAny>;
    const dKeys = Object.keys(dShape).sort();
    const iKeys = Object.keys(iShape).sort();
    if (dKeys.length !== iKeys.length || dKeys.some((k, idx) => k !== iKeys[idx])) {
      return {
        reason: `object key sets differ — declared [${dKeys.join(", ")}] vs chain [${iKeys.join(", ")}]`,
        declaredKind: dKind,
        inferredKind: iKind
      };
    }
    for (const k of dKeys) {
      const dvKind = getZodTypeName(dShape[k]);
      const ivKind = getZodTypeName(iShape[k]);
      if (dvKind !== ivKind) {
        return {
          reason: `object value kind differs at "${k}" — declared ${dvKind} vs chain ${ivKind}`,
          declaredKind: dvKind,
          inferredKind: ivKind
        };
      }
    }
  }
  if (dKind === "ZodArray") {
    const dElemKind = getZodTypeName((declared as any)._def.type);
    const iElemKind = getZodTypeName((inferred as any)._def.type);
    if (dElemKind !== iElemKind) {
      return {
        reason: `array element kind differs — declared ${dElemKind} vs chain ${iElemKind}`,
        declaredKind: dElemKind,
        inferredKind: iElemKind
      };
    }
  }
  return null;
}

function createSequencer<TInput, TOutput, TStateSchema extends ZodTypeAny | undefined = undefined>(
  config: SequencerConfig<any>,
  operations: SequencerOperation[],
  rescueHandlers: RescueHandlerSpec[],
  lastOutputSchema?: ZodTypeAny,
  resolvedInputSchema?: ZodTypeAny,
  accumulatedResources?: DeclaredResources,
  capabilityRefs?: import("../capability/types").CapabilityRef[],
  accumulatedRequiresOrg?: boolean
): SequencerDefinition<TInput, TOutput, TStateSchema> {
  // The tracked output schema reflects the chain's last step (informational for devtools/composition).
  // We pass undefined to buildBlock's outputSchema so the sequencer itself doesn't validate output —
  // individual blocks in the chain already validate their own outputs.
  const trackedOutputSchema = lastOutputSchema ?? config.outputSchema;

  // Default `durable: true` (FIX-401). Always-on under latest-only checkpoint
  // semantics is cheap (constant storage per sequencer); explicit `false` is
  // the opt-out for tests and ephemeral fanouts.
  const durable = config.durable ?? true;
  const baseBlock = buildBlock({
    kind: "sequencer",
    config: {
      name: config.name,
      description: config.description,
      transient: config.transient,
      inputSchema: resolvedInputSchema ?? config.inputSchema,
      outputSchema: undefined,
      stateSchema: config.stateSchema,
      container: config.container,
      activeStatusMessage: config.activeStatusMessage
    },
    execute: wrapWithOutputValidation(
      runSequencerOperations(operations, rescueHandlers, durable, config.stateSchema),
      config.outputSchema,
      config.name
    ),
    declaredResources: accumulatedResources,
    resolvedCapabilities: capabilityRefs,
    requiresOrg: accumulatedRequiresOrg,
  });

  // Override the informational schema on the block definition so devtools and consumers
  // (parallel, forEach) see the real output type — without triggering validation.
  if (trackedOutputSchema !== undefined) {
    (baseBlock as any).outputSchema = trackedOutputSchema;
    (baseBlock as any).config = { ...baseBlock.config, outputSchema: trackedOutputSchema };
  }

  /** Merge a child block's declaredResources into the sequencer's accumulator. */
  const mergeFrom = (...blocks: Array<BlockDefinition<any, any> | undefined>): DeclaredResources | undefined => {
    let merged = accumulatedResources;
    for (const block of blocks) {
      if (block?.declaredResources !== undefined) {
        merged = mergeDeclaredResources(merged, block.declaredResources);
      }
    }
    return merged;
  };

  /** OR child blocks' `requiresOrg` flags into the sequencer's accumulator. */
  const mergeRequiresOrgFrom = (...blocks: Array<BlockDefinition<any, any> | undefined>): boolean => {
    let merged = accumulatedRequiresOrg ?? false;
    for (const block of blocks) {
      if (block?.requiresOrg) merged = true;
    }
    return merged;
  };

  const extend = <TNext>(
    operation: SequencerOperation,
    newOutputSchema?: ZodTypeAny,
    newInputSchema?: ZodTypeAny,
    newResources?: DeclaredResources,
    newRequiresOrg?: boolean
  ): SequencerDefinition<TInput, TNext, TStateSchema> =>
    createSequencer<TInput, TNext, TStateSchema>(config, [...operations, operation], rescueHandlers, newOutputSchema, newInputSchema ?? resolvedInputSchema, newResources ?? accumulatedResources, capabilityRefs, newRequiresOrg ?? accumulatedRequiresOrg);

  /**
   * On the first step (no operations yet) when neither config nor resolved input
   * schema is set, capture the block's inputSchema as the sequencer's inputSchema.
   * Returns the captured schema or undefined (meaning no override).
   */
  const inferFirstBlockInput = (block: BlockDefinition<any, any>): ZodTypeAny | undefined => {
    if (operations.length === 0 && resolvedInputSchema === undefined && config.inputSchema === undefined) {
      return block.config.inputSchema;
    }
    return undefined;
  };

  const definition = Object.assign(baseBlock, {
    then<TStepIn, TNext>(
      arg1: BlockDefinition<any, any> | ConnectorFn<TOutput, TStepIn> | InlineBlockFactory,
      arg2?: BlockDefinition<any, any> | Record<string, unknown>
    ): SequencerDefinition<TInput, TNext, TStateSchema> {
      // Path 1: then(factory, inlineConfig) — inline block definition
      if (typeof arg1 === "function" && !isBlockDefinition(arg1) && arg2 !== undefined && isInlineConfig(arg2)) {
        const block = buildInlineBlock(arg1 as InlineBlockFactory, arg2 as Record<string, unknown>, lastOutputSchema);
        const capturedInput = inferFirstBlockInput(block);
        return extend<TNext>(
          {
            name: block.name,
            run: async (value, ctx, runtime, stepIndex) => {
              const path = childBlockPath(ctx, "then", stepIndex);
              prepareSequentialChild(ctx, runtime, path);
              const output = await executeBlock(block, value, ctx, path);
              return { value: output, descriptor: refDescriptorForPath(ctx, path) };
            }
          },
          block.config.outputSchema,
          capturedInput,
          mergeFrom(block),
        mergeRequiresOrgFrom(block)
        );
      }

      // Path 2: then(block) — pre-defined block
      // Path 3: then(connector, block) — connector + pre-defined block
      const connector = arg2 === undefined ? undefined : (arg1 as ConnectorFn<TOutput, TStepIn>);
      const block = (arg2 ?? arg1) as BlockDefinition<any, any>;
      const capturedInput = inferFirstBlockInput(block);

      return extend<TNext>(
        {
          name: block.name,
          run: async (value, ctx, runtime, stepIndex) => {
            const nextInput = connector === undefined ? value : await connector(value as TOutput, ctx);
            const path = childBlockPath(ctx, "then", stepIndex);
            prepareSequentialChild(ctx, runtime, path);
            const output = await executeBlock(block, nextInput, ctx, path);
            return { value: output, descriptor: refDescriptorForPath(ctx, path) };
          }
        },
        block.config.outputSchema,
        capturedInput,
        mergeFrom(block),
        mergeRequiresOrgFrom(block)
      );
    },

    thenIf<TStepIn, TNext>(
      condition: (input: TOutput, ctx: BlockContext) => boolean | Promise<boolean>,
      arg2: BlockDefinition<any, any> | ConnectorFn<TOutput, TStepIn> | InlineBlockFactory,
      arg3?: BlockDefinition<any, any> | Record<string, unknown>
    ): SequencerDefinition<TInput, TOutput | TNext, TStateSchema> {
      // Path 1: thenIf(condition, factory, inlineConfig) — inline block definition
      if (typeof arg2 === "function" && !isBlockDefinition(arg2) && arg3 !== undefined && isInlineConfig(arg3)) {
        const block = buildInlineBlock(arg2 as InlineBlockFactory, arg3 as Record<string, unknown>, lastOutputSchema);
        return createSequencer<TInput, TOutput | TNext, TStateSchema>(
          config,
          [
            ...operations,
            {
              name: `if:${block.name}`,
              run: async (value, ctx, runtime, stepIndex) => {
                const matches = await condition(value as TOutput, ctx);
                if (!matches) {
                  // Condition not matched: carry running descriptor forward.
                  return { value };
                }

                const path = childBlockPath(ctx, "thenIf", stepIndex);
                prepareSequentialChild(ctx, runtime, path);
                const output = await executeBlock(block, value, ctx, path);
                return { value: output, descriptor: refDescriptorForPath(ctx, path) };
              }
            }
          ],
          rescueHandlers,
          block.config.outputSchema,
          resolvedInputSchema,
          mergeFrom(block),
          capabilityRefs,
          mergeRequiresOrgFrom(block)
        );
      }

      // Path 2: thenIf(condition, block) — pre-defined block
      // Path 3: thenIf(condition, connector, block) — connector + pre-defined block
      const connector = arg3 === undefined ? undefined : (arg2 as ConnectorFn<TOutput, TStepIn>);
      const block = (arg3 ?? arg2) as BlockDefinition<any, any>;

      return createSequencer<TInput, TOutput | TNext, TStateSchema>(
        config,
        [
          ...operations,
          {
            name: `if:${block.name}`,
            run: async (value, ctx, runtime, stepIndex) => {
              const matches = await condition(value as TOutput, ctx);
              if (!matches) {
                return { value };
              }

              const nextInput = connector === undefined ? value : await connector(value as TOutput, ctx);
              const path = childBlockPath(ctx, "thenIf", stepIndex);
              prepareSequentialChild(ctx, runtime, path);
              const output = await executeBlock(block, nextInput, ctx, path);
              return { value: output, descriptor: refDescriptorForPath(ctx, path) };
            }
          }
        ],
        rescueHandlers,
        block.config.outputSchema,
        resolvedInputSchema,
        mergeFrom(block),
        capabilityRefs,
        mergeRequiresOrgFrom(block)
      );
    },

    map<TNext>(mapper: (input: TOutput, ctx: BlockContext) => TNext | Promise<TNext>): SequencerDefinition<TInput, TNext, TStateSchema> {
      return extend<TNext>(
        {
          name: "map",
          // `.map` produces novel content — always inline (FIX-413).
          run: async (value, ctx) => ({
            value: await mapper(value as TOutput, ctx),
            descriptor: { kind: "inline" }
          })
        },
        undefined
      );
    },

    parallel<TSteps extends Record<string, ParallelStep<TOutput>>>(
      steps: TSteps,
      options?: { maxConcurrency?: number }
    ): SequencerDefinition<TInput, { [K in keyof TSteps]: ParallelStepOutput<TSteps[K]> }, TStateSchema> {
      // Build composite output schema: { key: step.outputSchema, ... }
      const schemaShape: Record<string, ZodTypeAny> = {};
      const stepBlocks: BlockDefinition<any, any>[] = [];
      for (const [key, step] of Object.entries(steps)) {
        const stepBlock = isBlockDefinition(step)
          ? (step as BlockDefinition<any, any>)
          : (step as { block: BlockDefinition<any, any> }).block;
        schemaShape[key] = stepBlock.config.outputSchema ?? z.any();
        stepBlocks.push(stepBlock);
      }
      const compositeSchema = z.object(schemaShape);

      return extend<{ [K in keyof TSteps]: ParallelStepOutput<TSteps[K]> }>(
        {
          name: "parallel",
          run: async (value, ctx, runtime, stepIndex) => {
            const entries = Object.entries(steps) as Array<[keyof TSteps, TSteps[keyof TSteps]]>;
            const parallelPath = childBlockPath(ctx, "parallel", stepIndex);
            const branchPaths: string[] = [];
            // Each branch sees the same upstream input — capture the shared
            // hint once before dispatching so every branch stamps the same
            // input source (FIX-573 §3.3 fan-out).
            const branchInputHint = sequentialInputHint(ctx, runtime);
            const outputs = await mapWithConcurrency(
              entries,
              options?.maxConcurrency,
              async ([, step], branchIndex): Promise<unknown> => {
                const branchPath = extendBlockPath(parallelPath, blockPathSegment("branch", branchIndex));
                branchPaths[branchIndex] = branchPath;
                if (isBlockDefinition(step)) {
                  stashInputHint(ctx, branchInputHint);
                  return executeBlock(step as BlockDefinition<any, any>, value, ctx, branchPath);
                }

                const connected = await step.connector(value as TOutput, ctx);
                stashInputHint(ctx, branchInputHint);
                return executeBlock(step.block, connected, ctx, branchPath);
              }
            );

            const result = {} as { [K in keyof TSteps]: ParallelStepOutput<TSteps[K]> };
            entries.forEach(([key], index) => {
              result[key] = outputs[index] as ParallelStepOutput<TSteps[typeof key]>;
            });

            // `.parallel` composes an object of existing branch outputs.
            // Emit a structure BlockValue whose entries point at each branch's
            // item (FIX-413). Branches whose item id can't be found fall back
            // to inline using the branch output itself.
            const shapeEntries: Record<string, BlockValueInternal<unknown>> = {};
            entries.forEach(([key], index) => {
              const branchPath = branchPaths[index];
              const ref = branchPath !== undefined ? refDescriptorForPath(ctx, branchPath) : { kind: "inline" as const };
              shapeEntries[String(key)] =
                ref.kind === "ref"
                  ? { kind: "ref", sourceItemId: ref.sourceItemId }
                  : { kind: "inline", value: outputs[index] };
            });

            // Downstream sequential ops should see this object as their input
            // source. `lastChildPath` is meaningless for an aggregator, so
            // record the structure as `lastChildInputHint` instead.
            const branchEntries: Array<{ key: string; path: string }> = entries.map(
              ([key], index) => ({ key: String(key), path: branchPaths[index] })
            );
            runtime.lastChildPath = undefined;
            runtime.lastChildInputHint = inputDescriptorFromBranches(ctx, branchEntries, "object");

            return {
              value: result,
              descriptor: { kind: "structure", shape: { container: "object", entries: shapeEntries } }
            };
          }
        },
        compositeSchema,
        undefined,
        mergeFrom(...stepBlocks),
        mergeRequiresOrgFrom(...stepBlocks)
      );
    },

    forEach<TItem, TStepIn, TStepOut>(
      arg1:
        | BlockDefinition<any, any>
        | ((item: TItem, index: number, ctx: BlockContext) => BlockDefinition<any, any>)
        | ConnectorFn<TOutput, TStepIn[]>,
      arg2?:
        | BlockDefinition<any, any>
        | ((item: TStepIn, index: number, ctx: BlockContext) => BlockDefinition<any, any>)
        | { maxConcurrency?: number },
      arg3?: { maxConcurrency?: number }
    ): SequencerDefinition<TInput, TStepOut[], TStateSchema> {
      const hasConnector =
        arg3 !== undefined || (arg2 !== undefined && !isConcurrencyOptions(arg2));
      const connector = hasConnector ? (arg1 as ConnectorFn<TOutput, TStepIn[]>) : undefined;
      const blockOrFactory = (hasConnector ? arg2 : arg1) as
        | BlockDefinition<any, any>
        | ((item: TStepIn, index: number, ctx: BlockContext) => BlockDefinition<any, any>);
      const options = (hasConnector ? arg3 : arg2) as { maxConcurrency?: number } | undefined;

      // Determine element output schema for z.array() propagation
      const elementBlock = isBlockDefinition(blockOrFactory)
        ? (blockOrFactory as BlockDefinition<any, any>)
        : undefined;
      const arraySchema = elementBlock?.config.outputSchema
        ? z.array(elementBlock.config.outputSchema)
        : undefined;

      return extend<TStepOut[]>(
        {
          name: "forEach",
          run: async (value, ctx, runtime, stepIndex) => {
            const items = (
              connector === undefined ? (value as unknown as TStepIn[]) : await connector(value as TOutput, ctx)
            ) ?? [];

            if (!Array.isArray(items)) {
              throw new Error("forEach expected an array input");
            }

            const iterationPaths: string[] = [];
            const outputs = await mapWithConcurrency(items, options?.maxConcurrency, async (item, index) => {
              const block =
                typeof blockOrFactory === "function" && !isBlockDefinition(blockOrFactory)
                  ? blockOrFactory(item, index, ctx)
                  : (blockOrFactory as BlockDefinition<any, any>);

              const path = childBlockPath(ctx, "forEach", stepIndex, index);
              iterationPaths[index] = path;
              // Each iteration's child sees the element inline (FIX-573 §5).
              stashInputHint(ctx, { kind: "inline", value: item });
              return executeBlock(block, item, ctx, path);
            });

            // `.forEach` aggregates an array of existing iteration outputs.
            // Emit a structure BlockValue whose entries ref each iteration.
            const entries: BlockValueInternal<unknown>[] = iterationPaths.map((path, i) => {
              const ref = refDescriptorForPath(ctx, path);
              return ref.kind === "ref"
                ? { kind: "ref", sourceItemId: ref.sourceItemId }
                : { kind: "inline", value: outputs[i] };
            });

            runtime.lastChildPath = undefined;
            runtime.lastChildInputHint = inputDescriptorFromBranches(
              ctx,
              iterationPaths.map((path) => ({ path })),
              "array"
            );

            return {
              value: outputs,
              descriptor: { kind: "structure", shape: { container: "array", entries } }
            };
          }
        },
        arraySchema,
        undefined,
        mergeFrom(elementBlock),
        mergeRequiresOrgFrom(elementBlock)
      );
    },

    forEachBackground<TItem, TStepIn>(
      arg1:
        | BlockDefinition<any, any>
        | ((item: TItem, index: number, ctx: BlockContext) => BlockDefinition<any, any>)
        | ConnectorFn<TOutput, TStepIn[]>,
      arg2?:
        | BlockDefinition<any, any>
        | ((item: TStepIn, index: number, ctx: BlockContext) => BlockDefinition<any, any>)
        | { concurrency?: number },
      arg3?: { concurrency?: number }
    ): SequencerDefinition<TInput, TOutput, TStateSchema> {
      const hasConnector =
        arg3 !== undefined || (arg2 !== undefined && !isConcurrencyOptions(arg2));
      const connector = hasConnector ? (arg1 as ConnectorFn<TOutput, TStepIn[]>) : undefined;
      const blockOrFactory = (hasConnector ? arg2 : arg1) as
        | BlockDefinition<any, any>
        | ((item: TStepIn, index: number, ctx: BlockContext) => BlockDefinition<any, any>);
      const options = (hasConnector ? arg3 : arg2) as { concurrency?: number } | undefined;

      const elementBlock = isBlockDefinition(blockOrFactory)
        ? (blockOrFactory as BlockDefinition<any, any>)
        : undefined;

      const DEFAULT_BACKGROUND_CONCURRENCY = 16;

      return extend<TOutput>(
        {
          name: "forEachBackground",
          run: async (value, ctx, runtime, stepIndex) => {
            const items = (
              connector === undefined ? (value as unknown as TStepIn[]) : await connector(value as TOutput, ctx)
            ) ?? [];

            if (!Array.isArray(items)) {
              throw new Error("forEachBackground expected an array input");
            }

            const concurrency = Math.max(1, options?.concurrency ?? DEFAULT_BACKGROUND_CONCURRENCY);

            // FIX-663: iterations are fire-and-forget, so substitute the
            // background signal. The per-iteration abort check below and each
            // executeBlock then break only on explicit user cancellation, not
            // on transport teardown — consistent with `.work()`.
            const { taskCtx, signalOverride } = backgroundTaskCtx(ctx);

            // Dispatch all iterations as background work with concurrency limiting.
            // Each iteration's failure is isolated — one failing doesn't stop others
            // or propagate to the parent sequencer.
            let nextIndex = 0;
            const iterationResults: WorkResult[] = [];
            const worker = async (): Promise<void> => {
              while (nextIndex < items.length) {
                if (taskCtx.signal?.aborted) break;
                const currentIndex = nextIndex;
                nextIndex += 1;
                const item = items[currentIndex];

                const block =
                  typeof blockOrFactory === "function" && !isBlockDefinition(blockOrFactory)
                    ? blockOrFactory(item, currentIndex, ctx)
                    : (blockOrFactory as BlockDefinition<any, any>);

                const iterName = `${block.name}[${currentIndex}]`;
                const path = childBlockPath(ctx, "forEachBackground", stepIndex, currentIndex);
                try {
                  // Background iterations run in the "work" phase; this flows
                  // into _blockIdentity.phase and drives the generator's
                  // position-based default role (work → "trace"). Element is
                  // the iteration's input — stamp it inline (FIX-573 §5).
                  stashInputHint(ctx, { kind: "inline", value: item });
                  const result = await executeBlock(block, item, taskCtx, path, { phase: "work", signalOverride });
                  iterationResults.push({ name: iterName, status: "fulfilled", value: result });
                } catch (error) {
                  iterationResults.push({ name: iterName, status: "rejected", reason: toError(error) });
                }
              }
            };

            const workerCount = Math.min(concurrency, items.length);
            const workers: Promise<void>[] = [];
            for (let i = 0; i < workerCount; i += 1) {
              workers.push(worker());
            }

            // Wrap the whole batch as a single work task. Pushed to the
            // request-scoped pool when present, otherwise the per-sequencer
            // fallback list (see dispatchWorkTask).
            const batchName = `forEachBackground[${items.length}]`;
            const rawBatchPromise = Promise.all(workers).then(() => {
              const failed = iterationResults.filter((r) => r.status === "rejected");
              if (failed.length > 0) {
                throw failed[0].reason ?? new Error(`forEachBackground batch failed`);
              }
              return undefined;
            });
            dispatchWorkTask(ctx, runtime, batchName, rawBatchPromise);
            return { value };
          }
        },
        lastOutputSchema,
        undefined,
        mergeFrom(elementBlock),
        mergeRequiresOrgFrom(elementBlock)
      );
    },

    doUntil<TStepIn, TNext>(
      condition: (value: TNext | TOutput, ctx: BlockContext) => boolean | Promise<boolean>,
      arg2: BlockDefinition<any, any> | ConnectorFn<TOutput, TStepIn>,
      arg3?: BlockDefinition<any, any>
    ): SequencerDefinition<TInput, TNext, TStateSchema> {
      const connector = arg3 === undefined ? undefined : (arg2 as ConnectorFn<TOutput, TStepIn>);
      const block = (arg3 ?? arg2) as BlockDefinition<any, any>;

      return extend<TNext>(
        {
          name: `doUntil:${block.name}`,
          run: async (value, ctx, runtime, stepIndex) => {
            let nextInput =
              connector === undefined ? value : await connector(value as TOutput, ctx);
            let guard = 0;
            let iteration = 0;
            // First iteration sees the upstream sequencer value; later
            // iterations see the prior iteration's emitted item (FIX-573 §5).
            let pendingHint: BlockValueInternal<unknown> = sequentialInputHint(ctx, runtime);

            while (true) {
              const path = childBlockPath(ctx, "doUntil", stepIndex, iteration);
              stashInputHint(ctx, pendingHint);
              const output = await executeBlock(block, nextInput, ctx, path);
              const done = await condition(output as TNext, ctx);
              if (done) {
                runtime.lastChildPath = path;
                runtime.lastChildInputHint = undefined;
                // Pass-through to the final iteration's item.
                return { value: output, descriptor: refDescriptorForPath(ctx, path) };
              }

              guard += 1;
              if (guard > DEFAULT_MAX_LOOP_GUARD) {
                throw new Error(`doUntil exceeded max loop guard (${DEFAULT_MAX_LOOP_GUARD})`);
              }

              nextInput = output;
              iteration += 1;
              pendingHint = inputDescriptorFromPrevPath(ctx, path);
            }
          }
        },
        block.config.outputSchema,
        undefined,
        mergeFrom(block),
        mergeRequiresOrgFrom(block)
      );
    },

    doWhile<TStepIn, TNext>(
      condition: (value: TNext | TOutput, ctx: BlockContext) => boolean | Promise<boolean>,
      arg2: BlockDefinition<any, any> | ConnectorFn<TOutput, TStepIn>,
      arg3?: BlockDefinition<any, any>
    ): SequencerDefinition<TInput, TNext, TStateSchema> {
      const connector = arg3 === undefined ? undefined : (arg2 as ConnectorFn<TOutput, TStepIn>);
      const block = (arg3 ?? arg2) as BlockDefinition<any, any>;

      return extend<TNext>(
        {
          name: `doWhile:${block.name}`,
          run: async (value, ctx, runtime, stepIndex) => {
            let nextInput =
              connector === undefined ? value : await connector(value as TOutput, ctx);
            let iteration = 0;
            let lastPath = childBlockPath(ctx, "doWhile", stepIndex, iteration);
            stashInputHint(ctx, sequentialInputHint(ctx, runtime));
            let output = await executeBlock(block, nextInput, ctx, lastPath);
            let guard = 0;

            while (await condition(output as TNext, ctx)) {
              guard += 1;
              if (guard > DEFAULT_MAX_LOOP_GUARD) {
                throw new Error(`doWhile exceeded max loop guard (${DEFAULT_MAX_LOOP_GUARD})`);
              }

              iteration += 1;
              nextInput = output;
              const prevPath = lastPath;
              lastPath = childBlockPath(ctx, "doWhile", stepIndex, iteration);
              stashInputHint(ctx, inputDescriptorFromPrevPath(ctx, prevPath));
              output = await executeBlock(block, nextInput, ctx, lastPath);
            }

            runtime.lastChildPath = lastPath;
            runtime.lastChildInputHint = undefined;
            // Pass-through to the final iteration's item.
            return { value: output, descriptor: refDescriptorForPath(ctx, lastPath) };
          }
        },
        block.config.outputSchema,
        undefined,
        mergeFrom(block),
        mergeRequiresOrgFrom(block)
      );
    },

    loopBack(
      targetStepName: string,
      options: {
        when?: (value: unknown, ctx: BlockContext) => boolean | Promise<boolean>;
        maxIterations: number;
      }
    ): SequencerDefinition<TInput, TOutput, TStateSchema> {
      return extend<TOutput>(
        {
          name: `loopBack:${targetStepName}`,
          run: async (value, ctx, runtime, stepIndex) => {
            const shouldLoop = options.when === undefined ? true : await options.when(value, ctx);
            if (!shouldLoop) {
              return { value };
            }

            const key = `${targetStepName}:${stepIndex}`;
            const currentCount = runtime.loopCounts.get(key) ?? 0;
            if (currentCount >= options.maxIterations) {
              return { value };
            }

            runtime.loopCounts.set(key, currentCount + 1);
            return { value, jumpTo: targetStepName };
          }
        },
        lastOutputSchema
      );
    },

    work<TStepIn>(
      arg1: BlockDefinition<any, any> | ConnectorFn<TOutput, TStepIn>,
      arg2?: BlockDefinition<any, any> | WorkOptions,
      arg3?: WorkOptions
    ): SequencerDefinition<TInput, TOutput, TStateSchema> {
      const hasConnector = isBlockDefinition(arg2);
      const connector = hasConnector ? (arg1 as ConnectorFn<TOutput, TStepIn>) : undefined;
      const block = (hasConnector ? arg2 : arg1) as BlockDefinition<any, any>;
      const options = (hasConnector ? arg3 : arg2) as WorkOptions | undefined;

      return extend<TOutput>(
        {
          name: options?.name ?? `work:${block.name}`,
          run: async (value, ctx, runtime, stepIndex) => {
            const name = options?.name ?? block.name;
            const input =
              connector === undefined ? value : await connector(value as TOutput, ctx);

            const path = childBlockPath(ctx, "work", stepIndex);
            // work() dispatches run in the "work" phase so nested generators
            // see phase === "work" and apply the trace default for emissions.
            // The work block's input is the parent step's output (FIX-573 §5).
            stashInputHint(ctx, sequentialInputHint(ctx, runtime));
            const { taskCtx, signalOverride } = backgroundTaskCtx(ctx);
            const rawPromise = executeBlock(block, input, taskCtx, path, { phase: "work", signalOverride });
            dispatchWorkTask(ctx, runtime, name, rawPromise);
            return { value };
          }
        },
        lastOutputSchema,
        undefined,
        mergeFrom(block),
        mergeRequiresOrgFrom(block)
      );
    },

    workIf<TStepIn>(
      condition:
        | boolean
        | ((value: TOutput, ctx: BlockContext) => boolean | Promise<boolean>),
      arg2: BlockDefinition<any, any> | ConnectorFn<TOutput, TStepIn>,
      arg3?: BlockDefinition<any, any> | WorkOptions,
      arg4?: WorkOptions
    ): SequencerDefinition<TInput, TOutput, TStateSchema> {
      const hasConnector = isBlockDefinition(arg3);
      const connector = hasConnector ? (arg2 as ConnectorFn<TOutput, TStepIn>) : undefined;
      const block = (hasConnector ? arg3 : arg2) as BlockDefinition<any, any>;
      const options = (hasConnector ? arg4 : arg3) as WorkOptions | undefined;

      return extend<TOutput>(
        {
          name: options?.name ?? `workIf:${block.name}`,
          run: async (value, ctx, runtime, stepIndex) => {
            const shouldDispatch =
              typeof condition === "function"
                ? await condition(value as TOutput, ctx)
                : condition;

            if (!shouldDispatch) {
              return { value };
            }

            const name = options?.name ?? block.name;
            const input =
              connector === undefined ? value : await connector(value as TOutput, ctx);

            const path = childBlockPath(ctx, "workIf", stepIndex);
            // workIf() dispatches run in the "work" phase, matching work().
            stashInputHint(ctx, sequentialInputHint(ctx, runtime));
            const { taskCtx, signalOverride } = backgroundTaskCtx(ctx);
            const rawPromise = executeBlock(block, input, taskCtx, path, { phase: "work", signalOverride });
            dispatchWorkTask(ctx, runtime, name, rawPromise);
            return { value };
          }
        },
        lastOutputSchema,
        undefined,
        mergeFrom(block),
        mergeRequiresOrgFrom(block)
      );
    },

    waitForWork(options?: WaitForWorkOptions): SequencerDefinition<TInput, TOutput, TStateSchema> {
      return extend<TOutput>(
        {
          name: "waitForWork",
          run: async (value, ctx, runtime) => {
            const pool = getRequestWorkPool(ctx);
            if (pool !== undefined) {
              // No early-return on hasPendingForScope: a task can settle
              // (resolve or reject) between dispatch and this barrier, but
              // settled-but-undrained entries still need to be drained so
              // their failures surface. drainScope is a no-op when no
              // entries match — let it handle the empty case.
              const result = await withTimeout(
                pool.drainScope(runtime.scopeId, { failOnError: options?.failOnError }),
                options?.timeoutMs,
                "waitForWork"
              );
              // drainScope already throws when failOnError is true and any
              // task failed. With failOnError off, log failures so they still
              // surface in diagnostics — matches the per-sequencer auto-await
              // log behavior so silent failures don't slip through.
              if (options?.failOnError !== true) {
                for (const f of result.failed) {
                  // eslint-disable-next-line no-console
                  console.error(`[sequencer] Background work "${f.meta.name}" failed:`, (f.reason as { message?: string } | undefined)?.message ?? f.reason);
                }
              }
              return { value };
            }

            // Per-sequencer fallback (unit-test path).
            if (runtime.workTasks.length === 0) {
              return { value };
            }

            const workTasks = runtime.workTasks.splice(0, runtime.workTasks.length);
            const results = await withTimeout(
              Promise.all(workTasks.map((task) => task.promise)),
              options?.timeoutMs,
              "waitForWork"
            );

            if (options?.failOnError === true) {
              const rejected = results.find((result) => result.status === "rejected");
              if (rejected !== undefined) {
                throw rejected.reason ?? new Error(`Background work "${rejected.name}" failed`);
              }
            }

            return { value };
          }
        },
        lastOutputSchema
      );
    },

    tap<TStepIn>(
      arg1:
        | BlockDefinition<any, any>
        | ((value: TOutput, ctx: BlockContext) => void | Promise<void>)
        | ConnectorFn<TOutput, TStepIn>
        | InlineBlockFactory,
      arg2?: BlockDefinition<any, any> | Record<string, unknown>
    ): SequencerDefinition<TInput, TOutput, TStateSchema> {
      // Path 1: tap(factory, inlineConfig) — inline block as side effect
      if (typeof arg1 === "function" && !isBlockDefinition(arg1) && arg2 !== undefined && isInlineConfig(arg2)) {
        const block = buildInlineBlock(arg1 as InlineBlockFactory, arg2 as Record<string, unknown>, lastOutputSchema);
        return extend<TOutput>(
          {
            name: `tap:${block.name}`,
            run: async (value, ctx, runtime, stepIndex) => {
              const path = childBlockPath(ctx, "tap", stepIndex);
              // .tap is a side-effect — its child sees the upstream sequencer
              // value, but the sequencer's running output is unchanged. Stash
              // the hint without rewriting `lastChildPath`/`lastChildInputHint`
              // so subsequent ops still chain from the prior producer.
              stashInputHint(ctx, sequentialInputHint(ctx, runtime));
              await executeBlock(block, value, ctx, path);
              return { value };
            }
          },
          lastOutputSchema,
          undefined,
          mergeFrom(block),
        mergeRequiresOrgFrom(block)
        );
      }

      // Path 2: tap(block | fn) — pre-defined block or function
      // Path 3: tap(connector, block) — connector + pre-defined block
      const connector = arg2 === undefined ? undefined : (arg1 as ConnectorFn<TOutput, TStepIn>);
      const tapTarget = (arg2 ?? arg1) as
        | BlockDefinition<any, any>
        | ((value: TOutput, ctx: BlockContext) => void | Promise<void>);

      // Only merge resources if tapTarget is a block (not a function)
      const tapBlock = isBlockDefinition(tapTarget) ? (tapTarget as BlockDefinition<any, any>) : undefined;

      return extend<TOutput>(
        {
          name: "tap",
          run: async (value, ctx, runtime, stepIndex) => {
            const path = childBlockPath(ctx, "tap", stepIndex);
            const tapHint = sequentialInputHint(ctx, runtime);
            if (connector === undefined) {
              if (isBlockDefinition(tapTarget)) {
                stashInputHint(ctx, tapHint);
                await executeBlock(tapTarget as BlockDefinition<any, any>, value, ctx, path);
              } else {
                await (tapTarget as (value: TOutput, ctx: BlockContext) => void | Promise<void>)(
                  value as TOutput,
                  ctx
                );
              }
            } else {
              const connectedInput = await connector(value as TOutput, ctx);
              stashInputHint(ctx, tapHint);
              await executeBlock(tapTarget as BlockDefinition<any, any>, connectedInput, ctx, path);
            }

            return { value };
          }
        },
        lastOutputSchema,
        undefined,
        mergeFrom(tapBlock),
        mergeRequiresOrgFrom(tapBlock)
      );
    },

    tapIf<TStepIn>(
      condition: (value: TOutput, ctx: BlockContext) => boolean | Promise<boolean>,
      arg2:
        | BlockDefinition<any, any>
        | ((value: TOutput, ctx: BlockContext) => void | Promise<void>)
        | ConnectorFn<TOutput, TStepIn>,
      arg3?: BlockDefinition<any, any>
    ): SequencerDefinition<TInput, TOutput, TStateSchema> {
      const connector = arg3 === undefined ? undefined : (arg2 as ConnectorFn<TOutput, TStepIn>);
      const tapTarget = (arg3 ?? arg2) as
        | BlockDefinition<any, any>
        | ((value: TOutput, ctx: BlockContext) => void | Promise<void>);

      const tapIfBlock = isBlockDefinition(tapTarget) ? (tapTarget as BlockDefinition<any, any>) : undefined;

      return extend<TOutput>(
        {
          name: "tapIf",
          run: async (value, ctx, runtime, stepIndex) => {
            const matches = await condition(value as TOutput, ctx);
            if (!matches) {
              return { value };
            }

            const path = childBlockPath(ctx, "tapIf", stepIndex);
            const tapHint = sequentialInputHint(ctx, runtime);
            if (connector === undefined) {
              if (isBlockDefinition(tapTarget)) {
                stashInputHint(ctx, tapHint);
                await executeBlock(tapTarget as BlockDefinition<any, any>, value, ctx, path);
              } else {
                await (tapTarget as (value: TOutput, ctx: BlockContext) => void | Promise<void>)(
                  value as TOutput,
                  ctx
                );
              }
            } else {
              const connectedInput = await connector(value as TOutput, ctx);
              stashInputHint(ctx, tapHint);
              await executeBlock(tapTarget as BlockDefinition<any, any>, connectedInput, ctx, path);
            }

            return { value };
          }
        },
        lastOutputSchema,
        undefined,
        mergeFrom(tapIfBlock),
        mergeRequiresOrgFrom(tapIfBlock)
      );
    },

    rescue(handlers: RescueHandlerSpec[]): SequencerDefinition<TInput, TOutput, TStateSchema> {
      // Collect resources from rescue handler blocks
      const rescueResources = handlers.reduce<DeclaredResources | undefined>(
        (acc, h) => mergeDeclaredResources(acc, h.block.declaredResources),
        accumulatedResources
      );
      // Bubble: a rescue handler block requiring org makes the whole sequencer require it.
      const rescueRequiresOrg = handlers.reduce(
        (acc, h) => acc || Boolean(h.block.requiresOrg),
        accumulatedRequiresOrg ?? false
      );
      return createSequencer<TInput, TOutput, TStateSchema>(config, operations, handlers, lastOutputSchema, resolvedInputSchema, rescueResources, capabilityRefs, rescueRequiresOrg);
    },

    branch<TBranches extends Record<string, BranchStep<TOutput>>>(
      branches: TBranches
    ): SequencerDefinition<TInput, BranchStepOutput<TBranches[keyof TBranches]>, TStateSchema> {
      // Branch output schema is ambiguous (depends on which branch matches at runtime),
      // so we take the first branch block's outputSchema as a best-effort propagation.
      const branchEntries = Object.values(branches) as Array<BranchStep<TOutput>>;
      const firstBranchSchema = branchEntries.length > 0
        ? branchEntries[0][2].config.outputSchema
        : undefined;

      // Collect resources from all branch blocks
      const branchBlocks = branchEntries.map((entry) => entry[2]);

      return extend<BranchStepOutput<TBranches[keyof TBranches]>>(
        {
          name: "branch",
          run: async (value, ctx, runtime, stepIndex) => {
            const basePath = childBlockPath(ctx, "branch", stepIndex);
            const branchHint = sequentialInputHint(ctx, runtime);
            for (const key of Object.keys(branches) as Array<keyof TBranches>) {
              const [connector, condition, block] = branches[key];
              const connectedInput = await connector(value as TOutput, ctx);
              const matches = await condition(connectedInput, ctx);
              if (!matches) {
                continue;
              }

              const branchPath = extendBlockPath(basePath, blockPathBranch(String(key)));
              prepareSequentialChild(ctx, runtime, branchPath);
              // prepareSequentialChild used the previous-op hint; reapply the
              // captured one to be explicit about branch input semantics.
              stashInputHint(ctx, branchHint);
              const output = await executeBlock(block, connectedInput, ctx, branchPath);
              // Pass-through from the selected branch's item.
              return { value: output, descriptor: refDescriptorForPath(ctx, branchPath) };
            }

            throw new Error("branch had no matching route");
          }
        },
        firstBranchSchema,
        undefined,
        mergeFrom(...branchBlocks),
        mergeRequiresOrgFrom(...branchBlocks)
      );
    },

    thenAll<TSteps extends Array<ParallelStep<TOutput>>>(
      steps: [...TSteps],
      options?: { maxConcurrency?: number }
    ): SequencerDefinition<TInput, { [K in keyof TSteps]: ParallelStepOutput<TSteps[K]> }, TStateSchema> {
      const stepBlocks: BlockDefinition<any, any>[] = steps.map((step) =>
        isBlockDefinition(step) ? (step as BlockDefinition<any, any>) : (step as { block: BlockDefinition<any, any> }).block
      );

      return extend<{ [K in keyof TSteps]: ParallelStepOutput<TSteps[K]> }>(
        {
          name: "thenAll",
          run: async (value, ctx, runtime, stepIndex) => {
            const basePath = childBlockPath(ctx, "thenAll", stepIndex);
            const branchPaths: string[] = [];
            const branchInputHint = sequentialInputHint(ctx, runtime);
            const outputs = await mapWithConcurrency(
              steps,
              options?.maxConcurrency,
              async (step, branchIndex): Promise<unknown> => {
                const branchPath = extendBlockPath(basePath, blockPathSegment("branch", branchIndex));
                branchPaths[branchIndex] = branchPath;
                if (isBlockDefinition(step)) {
                  stashInputHint(ctx, branchInputHint);
                  return executeBlock(step as BlockDefinition<any, any>, value, ctx, branchPath);
                }

                const connected = await step.connector(value as TOutput, ctx);
                stashInputHint(ctx, branchInputHint);
                return executeBlock(step.block, connected, ctx, branchPath);
              }
            );

            // `.thenAll` aggregates an array of existing branch outputs.
            // Emit a structure BlockValue whose entries ref each branch's item.
            const entries: BlockValueInternal<unknown>[] = branchPaths.map((path, i) => {
              const ref = refDescriptorForPath(ctx, path);
              return ref.kind === "ref"
                ? { kind: "ref", sourceItemId: ref.sourceItemId }
                : { kind: "inline", value: outputs[i] };
            });

            runtime.lastChildPath = undefined;
            runtime.lastChildInputHint = inputDescriptorFromBranches(
              ctx,
              branchPaths.map((path) => ({ path })),
              "array"
            );

            return {
              value: outputs,
              descriptor: { kind: "structure", shape: { container: "array", entries } }
            };
          }
        },
        undefined,
        undefined,
        mergeFrom(...stepBlocks),
        mergeRequiresOrgFrom(...stepBlocks)
      );
    },

    thenAny(
      blocks: BlockDefinition<any, any>[]
    ): SequencerDefinition<TInput, unknown, TStateSchema> {
      return extend<unknown>(
        {
          name: "thenAny",
          run: async (value, ctx, runtime, stepIndex) => {
            if (blocks.length === 0) {
              throw new AggregateError([], "thenAny called with no blocks");
            }

            // Try each block sequentially; return the first that succeeds.
            const basePath = childBlockPath(ctx, "thenAny", stepIndex);
            const errors: Error[] = [];
            const branchInputHint = sequentialInputHint(ctx, runtime);

            for (let branchIndex = 0; branchIndex < blocks.length; branchIndex += 1) {
              const block = blocks[branchIndex];
              try {
                const branchPath = extendBlockPath(basePath, blockPathSegment("branch", branchIndex));
                stashInputHint(ctx, branchInputHint);
                const output = await executeBlock(block, value, ctx, branchPath);
                runtime.lastChildPath = branchPath;
                runtime.lastChildInputHint = undefined;
                return { value: output, descriptor: refDescriptorForPath(ctx, branchPath) };
              } catch (error) {
                errors.push(toError(error));
              }
            }

            throw new AggregateError(errors, "All blocks in thenAny failed");
          }
        },
        undefined,
        undefined,
        mergeFrom(...blocks),
        mergeRequiresOrgFrom(...blocks)
      );
    },

    race(
      blocks: BlockDefinition<any, any>[],
      options?: { maxConcurrency?: number }
    ): SequencerDefinition<TInput, unknown, TStateSchema> {
      return extend<unknown>(
        {
          name: "race",
          run: async (value, ctx, runtime, stepIndex) => {
            if (blocks.length === 0) {
              throw new Error("race called with no blocks");
            }

            const basePath = childBlockPath(ctx, "race", stepIndex);
            const branchInputHint = sequentialInputHint(ctx, runtime);

            if (blocks.length === 1) {
              const singlePath = extendBlockPath(basePath, blockPathSegment("branch", 0));
              stashInputHint(ctx, branchInputHint);
              const output = await executeBlock(blocks[0], value, ctx, singlePath);
              runtime.lastChildPath = singlePath;
              runtime.lastChildInputHint = undefined;
              return { value: output, descriptor: refDescriptorForPath(ctx, singlePath) };
            }

            // Create a derived abort controller to cancel losers once a winner is found.
            const controller = new AbortController();
            const onParentAbort = (): void => { controller.abort(); };
            ctx.signal?.addEventListener("abort", onParentAbort);

            const derivedCtx = { ...ctx, signal: controller.signal } as BlockContext;

            const errors: Error[] = [];
            let resolved = false;
            let resolvedValue: unknown;
            let winnerPath: string | undefined;

            try {
              if (options?.maxConcurrency !== undefined) {
                // Worker-pool approach: concurrency-limited, first success wins.
                const limit = Math.max(1, options.maxConcurrency);
                let nextIndex = 0;

                const worker = async (): Promise<void> => {
                  while (nextIndex < blocks.length && !resolved) {
                    const currentIndex = nextIndex;
                    nextIndex += 1;
                    try {
                      const branchPath = extendBlockPath(basePath, blockPathSegment("branch", currentIndex));
                      stashInputHint(derivedCtx, branchInputHint);
                      const output = await executeBlock(blocks[currentIndex], value, derivedCtx, branchPath);
                      if (!resolved) {
                        resolved = true;
                        resolvedValue = output;
                        winnerPath = branchPath;
                        controller.abort();
                      }
                    } catch (error) {
                      errors.push(toError(error));
                    }
                  }
                };

                const workers: Promise<void>[] = [];
                for (let i = 0; i < Math.min(limit, blocks.length); i += 1) {
                  workers.push(worker());
                }
                await Promise.all(workers);
              } else {
                // Full parallelism — fire all, first success wins.
                await new Promise<void>((resolve) => {
                  let remaining = blocks.length;

                  for (let i = 0; i < blocks.length; i += 1) {
                    const block = blocks[i];
                    const branchPath = extendBlockPath(basePath, blockPathSegment("branch", i));
                    stashInputHint(derivedCtx, branchInputHint);
                    executeBlock(block, value, derivedCtx, branchPath).then(
                      (output) => {
                        if (!resolved) {
                          resolved = true;
                          resolvedValue = output;
                          winnerPath = branchPath;
                          controller.abort();
                        }
                        remaining -= 1;
                        if (remaining === 0) resolve();
                      },
                      (error) => {
                        errors.push(toError(error));
                        remaining -= 1;
                        if (remaining === 0) resolve();
                      }
                    );
                  }
                });
              }
            } finally {
              ctx.signal?.removeEventListener("abort", onParentAbort);
            }

            if (!resolved) {
              throw new AggregateError(errors, "All blocks in race failed");
            }

            if (winnerPath !== undefined) {
              runtime.lastChildPath = winnerPath;
              runtime.lastChildInputHint = undefined;
            }
            return {
              value: resolvedValue,
              descriptor: winnerPath !== undefined ? refDescriptorForPath(ctx, winnerPath) : { kind: "inline" }
            };
          }
        },
        undefined,
        undefined,
        mergeFrom(...blocks),
        mergeRequiresOrgFrom(...blocks)
      );
    },

    waitForCondition(
      predicate: (items: readonly OutputItem[]) => boolean,
      options: {
        timeoutMs: number;
        wakeOn?: (
          item: OutputItem,
          kind: "added" | "updated" | "done"
        ) => boolean;
      }
    ): SequencerDefinition<TInput, { timedOut: boolean }, TStateSchema> {
      return extend<{ timedOut: boolean }>(
        {
          name: "waitForCondition",
          run: async (_value, ctx) => {
            const response = ctx.response;
            if (response === undefined) {
              throw new Error("waitForCondition requires a response emitter on the context");
            }

            // Initial synchronous eval — if already satisfied, no subscription
            // and no timer. Predicate throws here propagate directly.
            if (predicate(response.getItems())) {
              return { value: { timedOut: false } };
            }

            // Derived abort controller so timer/parent abort can stop the wait
            // without abusing the parent signal.
            const controller = new AbortController();
            const onParentAbort = (): void => { controller.abort(); };
            ctx.signal?.addEventListener("abort", onParentAbort);
            // AbortSignal.addEventListener does not fire for listeners
            // registered after `aborted` already flipped true. Without this
            // sync check, an already-aborted parent would still cost a full
            // `timeoutMs` of waiting before the timer fired.
            if (ctx.signal?.aborted === true) controller.abort();

            let timedOut = false;
            let evaluationError: unknown = undefined;
            let unsubscribe: undefined | (() => void) = undefined;
            let timer: ReturnType<typeof setTimeout> | undefined = undefined;

            try {
              await new Promise<void>((resolve) => {
                // Resolve once on first satisfaction (predicate true / timeout / abort).
                let settled = false;
                const settle = (): void => {
                  if (settled) return;
                  settled = true;
                  resolve();
                };

                controller.signal.addEventListener("abort", settle);
                // Parent may have aborted synchronously above; in that
                // case the listener we just registered never fires because
                // `controller.signal.aborted` was already true. Settle now
                // and skip subscribing/timing.
                if (controller.signal.aborted) {
                  settle();
                  return;
                }

                timer = setTimeout(() => {
                  timedOut = true;
                  controller.abort();
                }, options.timeoutMs);

                unsubscribe = response.subscribeToItems(
                  (_item, _kind) => {
                    if (settled) return;
                    try {
                      if (predicate(response.getItems())) {
                        controller.abort();
                      }
                    } catch (error) {
                      evaluationError = error;
                      controller.abort();
                    }
                  },
                  options.wakeOn !== undefined ? { filter: options.wakeOn } : undefined
                );
              });
            } finally {
              ctx.signal?.removeEventListener("abort", onParentAbort);
              if (timer !== undefined) clearTimeout(timer);
              const unsub = unsubscribe as (() => void) | undefined;
              if (unsub !== undefined) unsub();
            }

            if (evaluationError !== undefined) throw evaluationError;
            return { value: { timedOut } };
          }
        },
        waitForConditionOutputSchema
      );
    },

    exitIf(
      condition: (value: TOutput, ctx: BlockContext) => boolean | Promise<boolean>
    ): SequencerDefinition<TInput, TOutput, TStateSchema> {
      return extend<TOutput>(
        {
          name: "exitIf",
          run: async (value, ctx) => {
            const shouldExit = await condition(value as TOutput, ctx);
            if (shouldExit) {
              return { value, exit: true };
            }
            return { value };
          }
        },
        lastOutputSchema
      );
    },

    throwIf(
      condition: (value: TOutput, ctx: BlockContext) => boolean | Promise<boolean>,
      error: Error | ((value: TOutput, ctx: BlockContext) => Error | Promise<Error>)
    ): SequencerDefinition<TInput, TOutput, TStateSchema> {
      return extend<TOutput>(
        {
          name: "throwIf",
          run: async (value, ctx) => {
            const shouldThrow = await condition(value as TOutput, ctx);
            if (shouldThrow) {
              throw typeof error === "function" ? await error(value as TOutput, ctx) : error;
            }
            return { value };
          }
        },
        lastOutputSchema
      );
    },

    connectInput<TFrom>(mapper: ConnectorFn<TFrom, TInput>): SequencerDefinition<TFrom, TOutput, TStateSchema> {
      const connectOp: SequencerOperation = {
        name: `${config.name}/connect-input`,
        run: async (value, ctx) => {
          // `connectInput` transforms input; the transform itself is not a
          // content-bearing item. Leave descriptor unset — downstream ops
          // emit the sequencer's real descriptor.
          const mapped = await mapper(value as TFrom, ctx);
          return { value: mapped };
        }
      };

      return createSequencer<TFrom, TOutput, TStateSchema>(
        { ...config, inputSchema: undefined },
        [connectOp, ...operations],
        rescueHandlers,
        lastOutputSchema,
        undefined,
        accumulatedResources
      );
    },

    validate() {
      // No-op when there's nothing to compare: schema-less sequencers, or
      // chains whose tail erased the tracked schema (thenAny/race/thenAll/branch).
      if (config.outputSchema === undefined || lastOutputSchema === undefined) {
        return;
      }
      // Same schema instance → trivially compatible.
      if (config.outputSchema === lastOutputSchema) {
        return;
      }
      const mismatch = compareSchemasStructurally(config.outputSchema, lastOutputSchema);
      if (mismatch !== null) {
        throw new SequencerSchemaMismatchError(
          `Sequencer "${config.name}" .validate() failed: ${mismatch.reason}`,
          {
            sequencerName: config.name,
            declaredKind: mismatch.declaredKind ?? "unknown",
            inferredKind: mismatch.inferredKind,
            reason: mismatch.reason
          }
        );
      }
    }
  });

  return definition as unknown as SequencerDefinition<TInput, TOutput, TStateSchema>;
}

export function sequencer<
  const TInputSchema extends ZodTypeAny = ZodTypeAny,
  const TStateSchema extends ZodTypeAny | undefined = undefined,
  TInput = z.infer<TInputSchema>,
>(
  config: SequencerConfig<TInputSchema, TInput, TStateSchema>
): SequencerDefinition<TInput, TInput, TStateSchema> {
  const { declaredResources, resolvedCapabilities } = resolveCapabilities(config, "sequencer");

  return createSequencer<TInput, TInput, TStateSchema>(
    config as SequencerConfig<any>,
    [],
    [],
    config.inputSchema,
    config.inputSchema,
    declaredResources,
    resolvedCapabilities
  );
}
