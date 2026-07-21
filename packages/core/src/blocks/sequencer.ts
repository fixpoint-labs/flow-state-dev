import { z, type ZodTypeAny } from "zod";
import type { BlockContext, BlockDefinition, BlockOutputHint, ConnectorFn, RescueHandlerSpec } from "../types/block";
import { asRuntime } from "../types/block";
import type { BlockValue, BlockValueInternal, OutputItem, StructureShape } from "../items/types";
import { SuspensionError } from "../errors/suspension-error";
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
import { findBlockTraceIdByInstance } from "./internal/find-block-trace";
import type { ReplayLog } from "./internal/replay-log";
import { isInlineConfig, resolveCallShape } from "./internal/arg-shapes";
import { runBackground, runChild } from "./internal/sequencer-kernel";
import type { DeclaredResources } from "../types/block";
import { getEmitterItemCount, isBlockDefinition, matchesRescueHandler, toError, withTimeout } from "./internal/utils";
import {
  blockPathBranch,
  blockPathIteration,
  blockPathLoop,
  blockPathRescue,
  blockPathSegment,
  buildBlockInstanceId,
  extendBlockPath,
  ROOT_BLOCK_PATH
} from "./internal/block-instance-id";
import { resolveTracingLevel, type TracingLevel } from "../helpers/tracing-level";
import { getRequestWorkPool } from "../execution/request-work-pool";
import { getTransientKeys, stripTransientKeys } from "../helpers/transient-slot";
import { compareZodSchemasStructurally } from "../helpers/zod-introspect";
import { mapLimit } from "../helpers/concurrency";

const DEFAULT_MAX_LOOP_GUARD = 250;

/**
 * Resume state injected by runAction when re-invoking a durable action. Carried
 * on `ctx._resumeState` so a re-entered durable sequencer restores its
 * accumulator state from the saved checkpoint before running children.
 *
 * Step skipping is NOT positional anymore (FIX-811): completed blocks are
 * injected per-logical-path via `ctx._replayLog` in `executeBlock`, so this
 * carries only the restored `state`. Both the same-request continuation path
 * and the legacy two-request resume path populate it for the state restore.
 */
export type ResumeState = {
  state?: Record<string, unknown>;
};

/** Output schema for `.waitForCondition` — a single boolean `timedOut` flag. */
const waitForConditionOutputSchema = z.object({ timedOut: z.boolean() });

let inlineBlockCounter = 0;
let sequencerScopeCounter = 0;

function autoInlineName(): string {
  inlineBlockCounter += 1;
  return `inline-${inlineBlockCounter}`;
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
   *   `.stepIf`).
   * - Set: replaces the running descriptor. `.step` produces a ref to the
   *   child item, `.map` produces inline, `.stepAll` produces structure.
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
 * Build a `ref` descriptor pointing at the child invoked at a given path. Falls
 * back to `{ kind: "inline" }` if the child did not emit a trace (e.g., when a
 * sequencer runs without a response emitter in a unit test).
 */
export function refDescriptorForPath(ctx: BlockContext, path: string): BlockOutputHint {
  const instanceId = buildBlockInstanceId(ctx.request.identity.id, path, 0);
  const itemId = findBlockTraceIdByInstance(ctx, instanceId);
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
 * Compute the `input.source` descriptor for an aggregator step (`.stepAll`,
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
export function stashInputHint(ctx: BlockContext, hint: BlockValueInternal<unknown>): void {
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
export function sequentialInputHint(
  ctx: BlockContext,
  runtime: SequencerRuntimeState
): BlockValueInternal<unknown> {
  if (runtime.lastChildInputHint !== undefined) return runtime.lastChildInputHint;
  return inputDescriptorFromPrevPath(ctx, runtime.lastChildPath);
}

/**
 * Record a single child's path as the chain's running producer so the next op
 * can chain its input source from it. Clears any aggregator-set
 * `lastChildInputHint` (a single child supersedes a prior fan-out structure).
 *
 * The input-hint stash is handled by `runChild` at dispatch time; this is the
 * post-dispatch bookkeeping for the sequential single-child ops (`.step`,
 * `.stepIf`, `.branch`).
 */
function recordSequentialChild(
  runtime: SequencerRuntimeState,
  childPath: string
): void {
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

  // Trace types (`state_snapshot`) are resolved to `{false,false}` by
  // `resolveItemVisibility` via `item.type` — no stamp needed.
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
 *
 * When a `loopBack` jump is active (`runtime.activeLoopGeneration > 0`), a
 * `loop[N]` segment is inserted *before* the op segment so the whole
 * re-executed pass groups under one iteration scope and each pass yields a
 * distinct `blockInstanceId` (FIX-643). Generation 0 inserts nothing.
 */
function childBlockPath(
  ctx: BlockContext,
  runtime: SequencerRuntimeState,
  op: string,
  stepIndex: number,
  iteration?: number
): string {
  let path = currentPath(ctx);
  if (runtime.activeLoopGeneration > 0) {
    path = extendBlockPath(path, blockPathLoop(runtime.activeLoopGeneration));
  }
  path = extendBlockPath(path, blockPathSegment(op, stepIndex));
  if (iteration !== undefined) {
    path = extendBlockPath(path, blockPathIteration(iteration));
  }
  return path;
}

/**
 * Run a single child block at a caller-derived `path` with full execution-scope
 * wiring. Forwards the input descriptor stashed by the calling op (FIX-573),
 * intercepts generator model usage, and — when the server installed
 * `ctx._withExecutionScope` — opens a scoped child context that drives the
 * unified trace lifecycle; otherwise it runs the block directly (unit-test
 * contexts). The `options.phase`/`signalOverride` thread background dispatch
 * (`"work"` phase, FIX-663 signal) into the descendant scope. The kernel
 * primitives (`runChild`/`runBackground`) and the loop/aggregator/rescue paths
 * all dispatch through here; it is the one place a child block is invoked.
 */
export async function executeBlock(
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

  // Resume replay (FIX-811): when a request continues under its own id, a block
  // whose logical path already produced a committed output on a prior run is
  // injected rather than re-executed. Returning here skips the block body
  // entirely — no model call, no `emit`, no state mutation — and emits no
  // duplicate trace, because the recorded output IS the canonical one. Keyed on
  // the attempt-independent logical id (`${requestId}:${path}`). Inert when no
  // ReplayLog is present (the normal, non-resume path), which the server only
  // builds at re-entry (Step 3). Placed AFTER the one-shot `_pendingChildInputHint`
  // read+clear so a replayed child never leaks the stashed hint to a later
  // sibling. (Wiring replayed blocks into the sibling registry for
  // `ctx.getBlockOutput()` is owned by the Step 3 server re-entry path.)
  const replayLog = (ctx as { _replayLog?: ReplayLog })._replayLog;
  if (replayLog !== undefined) {
    const cached = replayLog.getCompletedOutput(`${requestId}:${path}`);
    if (cached !== undefined && cached.kind === "inline") {
      // `buildReplayLog` materialises recorded outputs to `inline`, so the
      // value is read directly with no live item lookup.
      //
      // Register a completed sibling entry so a later sibling can still read
      // this block's output via `ctx.getBlockOutput()` — the short-circuit
      // returns before `_withExecutionScope`, which is the only other path that
      // populates the sibling registry. The descriptor mirrors the one
      // `_withExecutionScope` builds below (name/kind/instanceId/path/transient);
      // `getBlockOutput` keys on `parent.name`. No-op in unit contexts.
      const registerReplayed = (ctx as {
        _registerReplayedChild?: (p: import("../types/block").ExecutionParent, o: unknown) => void;
      })._registerReplayedChild;
      registerReplayed?.(
        {
          name: block.name,
          kind: block.kind,
          instanceId,
          path,
          transient: block.transient || undefined
        },
        cached.value
      );
      return cached.value;
    }
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
      scopedCtx._runtimeHooks?.onBlockError?.(block.name, block.kind, error, Date.now() - startedAt, block.transient, scopedCtx);

      // FIX-573: forward partial modelUsage on the failure path too. The
      // `output` phase in `_withExecutionScope` reads it and patches the
      // shared block_trace row before emitting item.done.
      if (block.kind === "generator" && modelUsage !== undefined) {
        (scopedCtx as { _generatorModelUsage?: GeneratorModelUsageMeta })._generatorModelUsage = modelUsage;
      }

      // FIX-742: block-level rescue for scoped (in-flow) child invocations — run
      // the first matching handler with this block's scoped context and return
      // its output, so the enclosing chain / fan-out / branch continues. The
      // `_withExecutionScope !== undefined` gate makes this seam mutually
      // exclusive with build-block's scope-less seam, so a throwing rescue
      // handler in a unit harness is not "rescued" twice. `SuspensionError` is
      // control flow and is never rescued; sequencers handle chain-level rescue
      // in their operation loop and are excluded to avoid double-handling.
      const rescueHandlers =
        ctx._withExecutionScope !== undefined && block.kind !== "sequencer"
          ? block.config.rescue
          : undefined;
      if (rescueHandlers !== undefined && rescueHandlers.length > 0 && !(error instanceof SuspensionError)) {
        const rescued = await runRescue(execCtx, rescueHandlers, toError(error), path);
        if (rescued !== undefined) {
          // Stamp the recovery on the SCOPED ctx (not `execCtx`, which is a
          // spread copy for generators) so `_withExecutionScope` records
          // `result.rescued` for `ctx.wasRescued(...)`.
          (scopedCtx as { _didRescue?: boolean })._didRescue = true;
          if (rescued.descriptor.kind !== "inline") {
            (scopedCtx as { _blockOutputHint?: BlockOutputHint })._blockOutputHint = rescued.descriptor;
          }
          // The block errored then recovered: `onBlockError` above records the
          // underlying failure (matching chain-level rescue precedent), and this
          // fires `onBlockComplete` so the runtime hook stream matches the
          // `completed + rescued` trace `_withExecutionScope` will record.
          scopedCtx._runtimeHooks?.onBlockComplete?.(block.name, block.kind, rescued.value, Date.now() - startedAt, block.transient);
          return rescued.value;
        }
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
      // FIX-914: any block with an own `stateSchema` gets a container now,
      // not just sequencers.
      stateSchema: block.config.stateSchema,
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

/**
 * Run the first rescue handler whose `when` matches `error`, at a rescue path
 * under `basePath`, using `ctx` (the block's scoped context — so the handler can
 * read sequencer state, per FIX-742). Returns the handler's output and a
 * BlockValue descriptor for it, or `undefined` when nothing matched (the caller
 * must then re-throw the original error).
 *
 * Setting the out-of-band `_didRescue` flag is left to the caller, which knows
 * the scope-relevant context to stamp (the sequencer ctx in the op-loop path;
 * the scoped ctx in the block-execution path, which may differ from `ctx` for a
 * generator's spread copy). NEVER call this for a `SuspensionError` — the caller
 * must re-throw that first, since suspension is control flow, not a failure.
 *
 * Exported so the server's top-level `executeBlock` can honor `config.rescue`
 * on a bare action-root block (in-flow children are handled by the core
 * `executeBlock` seam below); `server` may depend on `core`, never the reverse.
 */
export async function runRescue(
  ctx: BlockContext,
  handlers: RescueHandlerSpec[],
  error: Error,
  basePath: string
): Promise<{ value: unknown; descriptor: BlockOutputHint; name: string } | undefined> {
  for (let i = 0; i < handlers.length; i += 1) {
    const handler = handlers[i];
    if (!matchesRescueHandler(error, handler)) {
      continue;
    }
    const rescuePath = extendBlockPath(basePath, blockPathRescue(i));
    // Rescue receives the thrown error inline — no upstream item to ref.
    stashInputHint(ctx, { kind: "inline", value: undefined });
    const value = await executeBlock(handler.block, error, ctx, rescuePath);
    const descriptor = refDescriptorForPath(ctx, rescuePath);
    return { value, descriptor, name: handler.block.config.name ?? "rescue" };
  }
  return undefined;
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
    lastChildInputHint: undefined,
    activeLoopGeneration: 0
  };
}

/**
 * Build the context for a background `.work()` / `.workIf()` /
 * `.forEachBackground()` task. FIX-663: when the request executor supplied a
 * `_requestBackgroundSignal`, substitute it for `ctx.signal` so the task tree
 * survives transport teardown and aborts only on explicit user cancellation.
 * Returns the parent ctx unchanged in unit-test contexts (no background
 * signal), preserving pre-FIX-663 behavior. The returned `signalOverride` is
 * threaded into `executeBlock` so descendant scopes inherit the same signal.
 */
export function backgroundTaskCtx(ctx: BlockContext): {
  taskCtx: BlockContext;
  signalOverride: AbortSignal | undefined;
} {
  const bgSignal = ctx._requestBackgroundSignal;
  if (bgSignal === undefined) {
    return { taskCtx: ctx, signalOverride: undefined };
  }
  return { taskCtx: { ...ctx, signal: bgSignal }, signalOverride: bgSignal };
}

/**
 * Dispatch a background work task. When the request-scoped pool is present
 * (server runtime), push to it tagged with the sequencer's scopeId. When
 * absent (unit-test contexts), fall back to the per-sequencer work list so
 * the inner-sequencer auto-await path keeps working unchanged. Consumed by the
 * `runBackground` kernel primitive and `.forEachBackground`'s batch dispatch.
 */
export function dispatchWorkTask(
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
    let currentStepIndex = -1;

    // Resume mode: when `_resumeState` is present on ctx, restore this
    // sequencer's accumulator state from the saved checkpoint before running
    // children. Step skipping is driven per-logical-path by `ctx._replayLog` in
    // `executeBlock` (FIX-811), not positionally here.
    const resumeState = (ctx as { _resumeState?: ResumeState })._resumeState;

    // Log-as-source-of-truth resume (FIX-811): under same-request continuation
    // the requestId and blockInstanceId are unchanged, so a durable baseline
    // snapshot carrying the sequencer's default/empty accumulator state would
    // clobber the saved checkpoint (the checkpoint store is latest-only, not
    // version-gated) before the resume runtime restores from it. Suppress the
    // durable baseline emit on re-entry; per-step snapshots after restore still
    // write normally.
    const replayMode = (ctx as { _replayLog?: ReplayLog })._replayLog !== undefined;

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
          durable && !replayMode,
          snapshotVersion,
          stateSchema
        );

        // In resume mode, restore sequencer state from the checkpoint.
        if (resumeState !== undefined && resumeState.state !== undefined && ctx.sequencer !== undefined) {
          ctx.sequencer.setState(resumeState.state as any);
        }

        for (let index = 0; index < operations.length; index += 1) {
          const operation = operations[index];
          runtime.stepHistory.push(operation.name);
          currentStepIndex = index;

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
          ctx.emit.status(undefined, { blocked: false, backgroundTasks: remaining });

          await Promise.all(pending.map((t) =>
            t.promise.then(async (result) => {
              remaining--;
              if (result.status === "rejected") {
                console.error(`[sequencer] Background work "${result.name}" failed:`, result.reason?.message ?? result.reason);
              }
              ctx.emit.status(undefined, { blocked: false, backgroundTasks: remaining });
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
        // SuspensionError is a control-flow signal, not a block failure.
        // Rescue handlers must NOT fire for it — propagate directly to runAction.
        // Stamp step context so runAction can build a correct SuspensionRecord
        // and the resume runtime can skip-and-inject up to this point.
        if (error instanceof SuspensionError) {
          error._stepIndex = currentStepIndex;
          error._currentValue = currentValue;
          error._sequencerState = ctx.sequencer !== undefined
            ? (typeof ctx.sequencer.state === "object" ? { ...ctx.sequencer.state as Record<string, unknown> } : undefined)
            : undefined;
          // Stamp the nearest enclosing (this) sequencer's checkpoint key on the
          // first catch only, so resume loads the right accumulator checkpoint
          // (FIX-811). Only durable sequencers checkpoint, so gate on it; the
          // first sequencer to catch is the innermost, which owns the state.
          if (durable && error._sequencerInstanceId === undefined && ctx._blockIdentity?.blockInstanceId !== undefined) {
            error._sequencerInstanceId = ctx._blockIdentity.blockInstanceId;
          }
          throw error;
        }
        const normalizedError = toError(error);
        const rescued = await runRescue(ctx, rescueHandlers, normalizedError, currentPath(ctx));
        if (rescued !== undefined) {
          // A rescue branch passes through to the handler block's output.
          if (rescued.descriptor.kind !== "inline") {
            (ctx as { _blockOutputHint?: BlockOutputHint })._blockOutputHint = rescued.descriptor;
          }
          // Record the recovery out-of-band so a downstream block can ask
          // `ctx.wasRescued(...)` without the rescued value carrying a marker.
          // Read post-execution by `_withExecutionScope` to stamp this block's
          // sibling-registry result.
          (ctx as { _didRescue?: boolean })._didRescue = true;
          return { value: rescued.value, lastStepName: rescued.name };
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


function createSequencer<TInput, TOutput, TStateSchema extends ZodTypeAny | undefined = undefined>(
  config: SequencerConfig<any>,
  operations: SequencerOperation[],
  rescueHandlers: RescueHandlerSpec[],
  lastOutputSchema?: ZodTypeAny,
  resolvedInputSchema?: ZodTypeAny,
  accumulatedResources?: DeclaredResources,
  capabilityRefs?: import("../capability/types").CapabilityRef[],
  accumulatedRequiresOrg?: boolean,
  // The sequencer's OWN declared resources — only its capability-injected
  // resources (a sequencer has no direct `resources` config field). Captured
  // once at the `sequencer()` entry point, before any child resources merge
  // into `accumulatedResources`, and threaded unchanged through every rebuild.
  // Surfaced as `BlockDefinition.ownDeclaredResources` for the block-dispatch
  // prefetch hook (FIX-688), which must load this block's own declarations
  // without re-loading descendants'.
  ownDeclaredResources?: DeclaredResources
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
    ownDeclaredResources,
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
    createSequencer<TInput, TNext, TStateSchema>(config, [...operations, operation], rescueHandlers, newOutputSchema, newInputSchema ?? resolvedInputSchema, newResources ?? accumulatedResources, capabilityRefs, newRequiresOrg ?? accumulatedRequiresOrg, ownDeclaredResources);

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
    step<TStepIn, TNext>(
      arg1: BlockDefinition<any, any> | ConnectorFn<TOutput, TStepIn> | InlineBlockFactory,
      arg2?: BlockDefinition<any, any> | Record<string, unknown>
    ): SequencerDefinition<TInput, TNext, TStateSchema> {
      // Shapes: step(block) | step(connector, block) | step(factory, inlineConfig).
      const shape = resolveCallShape([arg1, arg2], "child");
      const block = shape.block ?? buildInlineBlock(shape.factory!, shape.inlineConfig!, lastOutputSchema);
      const connector = shape.connector as ConnectorFn<TOutput, TStepIn> | undefined;
      const capturedInput = inferFirstBlockInput(block);

      return extend<TNext>(
        {
          name: block.name,
          run: async (value, ctx, runtime, stepIndex) => {
            const path = childBlockPath(ctx, runtime, "step", stepIndex);
            const result = await runChild(ctx, { block, connector }, path, value, sequentialInputHint(ctx, runtime));
            recordSequentialChild(runtime, path);
            return result;
          }
        },
        block.config.outputSchema,
        capturedInput,
        mergeFrom(block),
        mergeRequiresOrgFrom(block)
      );
    },

    stepIf<TStepIn, TNext>(
      condition: (input: TOutput, ctx: BlockContext) => boolean | Promise<boolean>,
      arg2: BlockDefinition<any, any> | ConnectorFn<TOutput, TStepIn> | InlineBlockFactory,
      arg3?: BlockDefinition<any, any> | Record<string, unknown>
    ): SequencerDefinition<TInput, TOutput | TNext, TStateSchema> {
      // Shapes: stepIf(cond, block) | stepIf(cond, connector, block) |
      // stepIf(cond, factory, inlineConfig). The condition is stripped before
      // resolving and re-applied as a runtime gate below.
      const shape = resolveCallShape([arg2, arg3], "child");
      const block = shape.block ?? buildInlineBlock(shape.factory!, shape.inlineConfig!, lastOutputSchema);
      const connector = shape.connector as ConnectorFn<TOutput, TStepIn> | undefined;

      return extend<TOutput | TNext>(
        {
          name: `if:${block.name}`,
          run: async (value, ctx, runtime, stepIndex) => {
            const matches = await condition(value as TOutput, ctx);
            if (!matches) {
              // Condition not matched: carry running descriptor forward.
              return { value };
            }

            const path = childBlockPath(ctx, runtime, "stepIf", stepIndex);
            const result = await runChild(ctx, { block, connector }, path, value, sequentialInputHint(ctx, runtime));
            recordSequentialChild(runtime, path);
            return result;
          }
        },
        block.config.outputSchema,
        undefined,
        mergeFrom(block),
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
            const parallelPath = childBlockPath(ctx, runtime, "parallel", stepIndex);
            const branchPaths: string[] = [];
            // Each branch sees the same upstream input — capture the shared
            // hint once before dispatching so every branch stamps the same
            // input source (FIX-573 §3.3 fan-out).
            const branchInputHint = sequentialInputHint(ctx, runtime);
            const outputs = await mapLimit(
              entries,
              options?.maxConcurrency,
              async ([, step], branchIndex): Promise<unknown> => {
                const branchPath = extendBlockPath(parallelPath, blockPathSegment("branch", branchIndex));
                branchPaths[branchIndex] = branchPath;
                const block = isBlockDefinition(step) ? (step as BlockDefinition<any, any>) : step.block;
                const connector = isBlockDefinition(step) ? undefined : step.connector;
                return (await runChild(ctx, { block, connector }, branchPath, value, branchInputHint)).value;
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
      // Shapes: forEach(block|factory) | forEach(connector, block|factory),
      // each with optional trailing concurrency options.
      const shape = resolveCallShape([arg1, arg2, arg3], "iterating");
      const connector = shape.connector as ConnectorFn<TOutput, TStepIn[]> | undefined;
      const blockOrFactory = shape.blockOrFactory as
        | BlockDefinition<any, any>
        | ((item: TStepIn, index: number, ctx: BlockContext) => BlockDefinition<any, any>);
      const options = shape.options as { maxConcurrency?: number } | undefined;

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
            const outputs = await mapLimit(items, options?.maxConcurrency, async (item, index) => {
              const block =
                typeof blockOrFactory === "function" && !isBlockDefinition(blockOrFactory)
                  ? blockOrFactory(item, index, ctx)
                  : (blockOrFactory as BlockDefinition<any, any>);

              const path = childBlockPath(ctx, runtime, "forEach", stepIndex, index);
              iterationPaths[index] = path;
              // Each iteration's child sees the element inline (FIX-573 §5).
              return (await runChild(ctx, { block }, path, item, { kind: "inline", value: item })).value;
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
      // Shapes mirror forEach(); the trailing options carry `concurrency`.
      const shape = resolveCallShape([arg1, arg2, arg3], "iterating");
      const connector = shape.connector as ConnectorFn<TOutput, TStepIn[]> | undefined;
      const blockOrFactory = shape.blockOrFactory as
        | BlockDefinition<any, any>
        | ((item: TStepIn, index: number, ctx: BlockContext) => BlockDefinition<any, any>);
      const options = shape.options as { concurrency?: number } | undefined;

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
                const path = childBlockPath(ctx, runtime, "forEachBackground", stepIndex, currentIndex);
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
              const path = childBlockPath(ctx, runtime, "doUntil", stepIndex, iteration);
              // Connector already applied once to the initial value; each
              // iteration dispatches the bare block with the prior output.
              const { value: output, descriptor } = await runChild(ctx, { block }, path, nextInput, pendingHint);
              const done = await condition(output as TNext, ctx);
              if (done) {
                recordSequentialChild(runtime, path);
                // Pass-through to the final iteration's item.
                return { value: output, descriptor };
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
            let lastPath = childBlockPath(ctx, runtime, "doWhile", stepIndex, iteration);
            // Connector already applied once to the initial value; each
            // iteration dispatches the bare block with the prior output.
            let { value: output, descriptor } = await runChild(ctx, { block }, lastPath, nextInput, sequentialInputHint(ctx, runtime));
            let guard = 0;

            while (await condition(output as TNext, ctx)) {
              guard += 1;
              if (guard > DEFAULT_MAX_LOOP_GUARD) {
                throw new Error(`doWhile exceeded max loop guard (${DEFAULT_MAX_LOOP_GUARD})`);
              }

              iteration += 1;
              nextInput = output;
              const prevPath = lastPath;
              lastPath = childBlockPath(ctx, runtime, "doWhile", stepIndex, iteration);
              ({ value: output, descriptor } = await runChild(ctx, { block }, lastPath, nextInput, inputDescriptorFromPrevPath(ctx, prevPath)));
            }

            recordSequentialChild(runtime, lastPath);
            // Pass-through to the final iteration's item.
            return { value: output, descriptor };
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
              // Loop exits: steps after this op run unsegmented (FIX-643).
              runtime.activeLoopGeneration = 0;
              return { value };
            }

            const key = `${targetStepName}:${stepIndex}`;
            const currentCount = runtime.loopCounts.get(key) ?? 0;
            if (currentCount >= options.maxIterations) {
              runtime.activeLoopGeneration = 0;
              return { value };
            }

            // The upcoming re-execution is generation `currentCount + 1`; carry
            // it on runtime so re-run children get a distinct `loop[N]` prefix.
            const nextGeneration = currentCount + 1;
            runtime.loopCounts.set(key, nextGeneration);
            runtime.activeLoopGeneration = nextGeneration;
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
      // Shapes: work(block) | work(connector, block) | work(block, options) |
      // work(connector, block, options).
      const shape = resolveCallShape([arg1, arg2, arg3], "background");
      const block = shape.block;
      const connector = shape.connector as ConnectorFn<TOutput, TStepIn> | undefined;
      const options = shape.options as WorkOptions | undefined;

      return extend<TOutput>(
        {
          name: options?.name ?? `work:${block.name}`,
          run: async (value, ctx, runtime, stepIndex) => {
            // Dispatched in the "work" phase so nested generators apply the
            // trace default; the work block's input is the parent step's
            // output (FIX-573 §5). runBackground passes the value through.
            const path = childBlockPath(ctx, runtime, "work", stepIndex);
            return runBackground(ctx, runtime, { block, connector }, path, value, options?.name ?? block.name);
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
      // Shapes mirror work(), prefixed by a boolean/predicate condition.
      const shape = resolveCallShape([arg2, arg3, arg4], "background");
      const block = shape.block;
      const connector = shape.connector as ConnectorFn<TOutput, TStepIn> | undefined;
      const options = shape.options as WorkOptions | undefined;

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

            // workIf() dispatches run in the "work" phase, matching work().
            const path = childBlockPath(ctx, runtime, "workIf", stepIndex);
            return runBackground(ctx, runtime, { block, connector }, path, value, options?.name ?? block.name);
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
              const path = childBlockPath(ctx, runtime, "tap", stepIndex);
              // .tap is a side-effect — its child runs and emits, but the
              // sequencer's running output and chain pointer are unchanged
              // (no recordSequentialChild), so subsequent ops still chain from
              // the prior producer. The child's descriptor is discarded.
              await runChild(ctx, { block }, path, value, sequentialInputHint(ctx, runtime));
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
            const path = childBlockPath(ctx, runtime, "tap", stepIndex);
            // Block target: dispatch via the kernel (side-effect; descriptor and
            // chain pointer untouched). Function target: invoke directly — a
            // plain side-effect function never pairs with a connector.
            if (tapBlock !== undefined) {
              await runChild(ctx, { block: tapBlock, connector }, path, value, sequentialInputHint(ctx, runtime));
            } else {
              await (tapTarget as (value: TOutput, ctx: BlockContext) => void | Promise<void>)(
                value as TOutput,
                ctx
              );
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

            const path = childBlockPath(ctx, runtime, "tapIf", stepIndex);
            if (tapIfBlock !== undefined) {
              await runChild(ctx, { block: tapIfBlock, connector }, path, value, sequentialInputHint(ctx, runtime));
            } else {
              await (tapTarget as (value: TOutput, ctx: BlockContext) => void | Promise<void>)(
                value as TOutput,
                ctx
              );
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
      return createSequencer<TInput, TOutput, TStateSchema>(config, operations, handlers, lastOutputSchema, resolvedInputSchema, rescueResources, capabilityRefs, rescueRequiresOrg, ownDeclaredResources);
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
            const basePath = childBlockPath(ctx, runtime, "branch", stepIndex);
            const branchHint = sequentialInputHint(ctx, runtime);
            for (const key of Object.keys(branches) as Array<keyof TBranches>) {
              const [connector, condition, block] = branches[key];
              const connectedInput = await connector(value as TOutput, ctx);
              const matches = await condition(connectedInput, ctx);
              if (!matches) {
                continue;
              }

              const branchPath = extendBlockPath(basePath, blockPathBranch(String(key)));
              // The per-arm connector already produced `connectedInput`; the
              // child sees the captured branch hint as its input source.
              const result = await runChild(ctx, { block }, branchPath, connectedInput, branchHint);
              recordSequentialChild(runtime, branchPath);
              // Pass-through from the selected branch's item.
              return result;
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

    stepAll<TSteps extends Array<ParallelStep<TOutput>>>(
      steps: [...TSteps],
      options?: { maxConcurrency?: number }
    ): SequencerDefinition<TInput, { [K in keyof TSteps]: ParallelStepOutput<TSteps[K]> }, TStateSchema> {
      const stepBlocks: BlockDefinition<any, any>[] = steps.map((step) =>
        isBlockDefinition(step) ? (step as BlockDefinition<any, any>) : (step as { block: BlockDefinition<any, any> }).block
      );

      return extend<{ [K in keyof TSteps]: ParallelStepOutput<TSteps[K]> }>(
        {
          name: "stepAll",
          run: async (value, ctx, runtime, stepIndex) => {
            const basePath = childBlockPath(ctx, runtime, "stepAll", stepIndex);
            const branchPaths: string[] = [];
            const branchInputHint = sequentialInputHint(ctx, runtime);
            const outputs = await mapLimit(
              steps,
              options?.maxConcurrency,
              async (step, branchIndex): Promise<unknown> => {
                const branchPath = extendBlockPath(basePath, blockPathSegment("branch", branchIndex));
                branchPaths[branchIndex] = branchPath;
                const block = isBlockDefinition(step) ? (step as BlockDefinition<any, any>) : step.block;
                const connector = isBlockDefinition(step) ? undefined : step.connector;
                return (await runChild(ctx, { block, connector }, branchPath, value, branchInputHint)).value;
              }
            );

            // `.stepAll` aggregates an array of existing branch outputs.
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

    stepAny(
      blocks: BlockDefinition<any, any>[]
    ): SequencerDefinition<TInput, unknown, TStateSchema> {
      return extend<unknown>(
        {
          name: "stepAny",
          run: async (value, ctx, runtime, stepIndex) => {
            if (blocks.length === 0) {
              throw new AggregateError([], "stepAny called with no blocks");
            }

            // Try each block sequentially; return the first that succeeds.
            const basePath = childBlockPath(ctx, runtime, "stepAny", stepIndex);
            const errors: Error[] = [];
            const branchInputHint = sequentialInputHint(ctx, runtime);

            for (let branchIndex = 0; branchIndex < blocks.length; branchIndex += 1) {
              const block = blocks[branchIndex];
              try {
                const branchPath = extendBlockPath(basePath, blockPathSegment("branch", branchIndex));
                // Each attempt stamps the same captured hint; runChild leaves the
                // chain pointer untouched so a failed candidate doesn't corrupt
                // the next attempt's input source.
                const { value: output, descriptor } = await runChild(ctx, { block }, branchPath, value, branchInputHint);
                recordSequentialChild(runtime, branchPath);
                return { value: output, descriptor };
              } catch (error) {
                errors.push(toError(error));
              }
            }

            throw new AggregateError(errors, "All blocks in stepAny failed");
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

            const basePath = childBlockPath(ctx, runtime, "race", stepIndex);
            const branchInputHint = sequentialInputHint(ctx, runtime);

            if (blocks.length === 1) {
              const singlePath = extendBlockPath(basePath, blockPathSegment("branch", 0));
              const { value: output, descriptor } = await runChild(ctx, { block: blocks[0] }, singlePath, value, branchInputHint);
              recordSequentialChild(runtime, singlePath);
              return { value: output, descriptor };
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
        accumulatedResources,
        // Preserve the prior implicit positional defaults for capabilityRefs /
        // accumulatedRequiresOrg; forward only the constant own-resources set.
        undefined,
        undefined,
        ownDeclaredResources
      );
    },

    validate() {
      // No-op when there's nothing to compare: schema-less sequencers, or
      // chains whose tail erased the tracked schema (stepAny/race/stepAll/branch).
      if (config.outputSchema === undefined || lastOutputSchema === undefined) {
        return;
      }
      // Same schema instance → trivially compatible.
      if (config.outputSchema === lastOutputSchema) {
        return;
      }
      const mismatch = compareZodSchemasStructurally(config.outputSchema, lastOutputSchema);
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
  const { declaredResources, resolvedCapabilities, stateSchema } = resolveCapabilities(config, "sequencer");

  // FIX-914 PR2: `resolveCapabilities` already merged any capability-
  // contributed own state (`ctx.self` / `ctx.sequencer`) with the
  // sequencer's own `stateSchema` declaration. Runtime-only — sequencer
  // capabilities aren't statically typed (see `SequencerCtx`'s hardcoded
  // `TCapabilities = {}`), so this doesn't affect the `TStateSchema` generic.
  const effectiveConfig = { ...config, stateSchema };

  // A sequencer has no direct `resources` config field — its OWN declarations
  // are exactly its capability-injected resources, which `resolveCapabilities`
  // returns here before any child resources merge in. Capture this as the
  // sequencer's `ownDeclaredResources` (FIX-688): identical to the initial
  // accumulator, but it stays fixed as children bubble into the accumulator.
  return createSequencer<TInput, TInput, TStateSchema>(
    effectiveConfig as SequencerConfig<any>,
    [],
    [],
    config.inputSchema,
    config.inputSchema,
    declaredResources,
    resolvedCapabilities,
    undefined,
    declaredResources
  );
}
