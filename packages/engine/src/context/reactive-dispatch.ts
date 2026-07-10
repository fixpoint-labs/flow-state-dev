/**
 * Per-scope reactive-block dispatch (FIX-751 PR2).
 *
 * A resource/collection mutation fires `onResourceChanged` (see
 * `resource-registry.ts`); for resources that declare `reactTo`, this module
 * resolves the bound block for the change kind, builds the {@link ResourceChange}
 * payload, gates it through the optional `when` predicate and the per-request
 * cascade controller, validates it against the block's `inputSchema`, and runs
 * the block **in-session** — awaited inline as part of the mutating turn so its
 * emitted items land in the same stream, ordered within the turn. A throw from
 * the reactive block propagates out (atomic with the mutating call).
 *
 * Cascade safety: a reactive block may itself mutate a resource, re-entering
 * this dispatcher. The shared {@link CascadeController} caps recursion depth and
 * total fan-out; on breach it emits a `reactive_cascade_exceeded` diagnostic
 * (a failed `error` item) and returns without running the block.
 */
import type {
  BlockDefinition,
  JsonObject,
  ResourceConfig,
  ResourceCollectionConfig,
} from "@flow-state-dev/core/types";
import type { RuntimeLogger } from "../execution/logging";
import { matchesPattern, getPatternPrefix } from "@flow-state-dev/core/types";
import {
  normalizeReactiveBinding,
  buildBlockInstanceId,
  type ResourceChange,
  type ResourceContentChange,
  type ReactiveBindingKind,
} from "@flow-state-dev/core";
import type { ErrorItem } from "@flow-state-dev/core/items";
import {
  isCollectionConfig,
  type ResourceChangeDelta,
  type ResourceSeamChangeType,
} from "./resource-registry";
import { resourceStorageKeys } from "../resources/storage-keys";
import type { ExecutionContext } from "./types";
import { executeBlock } from "../execution/executeBlock";
import { getResponseItemCount } from "../execution/internal/response";

/** Per-turn cascade caps. Hard-coded — not author-configurable. */
const MAX_CASCADE_DEPTH = 8;
const MAX_CASCADE_FANOUT = 1000;

/**
 * Per-request cascade budget, shared across all three scope dispatchers. `depth`
 * tracks the current re-entrancy depth (a reactive block mutating a resource
 * that has its own reactive block); `fanout` is the cumulative count of
 * dispatched reactive blocks for the whole turn.
 */
export interface CascadeController {
  depth: number;
  fanout: number;
}

/** Create a fresh per-request cascade controller. */
export function createCascadeController(): CascadeController {
  return { depth: 0, fanout: 0 };
}

/** Dependencies the dispatcher closes over for one scope. */
export interface ReactiveDispatcherDeps {
  /** This scope's resource configs, keyed by accessor name. */
  configs: Record<string, ResourceConfig | ResourceCollectionConfig>;
  /** Resolver for the live execution context (populated after root ctx exists). */
  ctxRef: { current: ExecutionContext | undefined };
  /** Shared per-request cascade budget. */
  controller: CascadeController;
  /**
   * Instance id of the block currently executing — the one that performed the
   * mutation. Read from the runtime's attribution frame at dispatch time so the
   * reactive block nests under its trigger in the trace instead of at the root.
   * `undefined` when the mutation happens outside any block scope.
   */
  getTriggerInstanceId: () => string | undefined;
  /**
   * Run `fn` inside the reactive block's own attribution frame (keyed by its
   * instance id) so a mutation it performs attributes its reactive children
   * under this block (cascade nesting), and its resource loads attribute here.
   */
  runAttributed: <T>(instanceId: string, fn: () => T) => T;
  /**
   * The request's configured logger, forwarded to `executeBlock` so reactive
   * blocks respect the caller's log level instead of falling back to
   * `DEFAULT_RUNTIME_LOGGER`'s console-based debug/info output (which writes
   * to stdout and corrupts NDJSON/chat output).
   */
  logger?: RuntimeLogger;
}

/**
 * Resolve the config (and, for collections, the bare instance key) that owns a
 * changed `resourcePath`. Single resources match on their resolved storage key;
 * collections on `matchesPattern`. Returns `undefined` when no config owns it.
 *
 * First-match-wins over the scope's configs. A single resource is never a
 * collection config, so the two branches only collide if a single's storage key
 * also satisfies a co-scoped collection's pattern (a pre-existing structural
 * overlap in the resource model, pathological in practice). For parameterized
 * patterns (e.g. `[topic]/observations`) there is no leading prefix to strip, so
 * `key` is the full `resourcePath` — the block re-derives params from `ref`.
 */
function resolveConfigFor(
  resourcePath: string,
  configs: Record<string, ResourceConfig | ResourceCollectionConfig>,
  storageKeys: Record<string, string>
): { config: ResourceConfig | ResourceCollectionConfig; key: string } | undefined {
  for (const [accessor, config] of Object.entries(configs)) {
    if (isCollectionConfig(config)) {
      if (matchesPattern(config.pattern, resourcePath)) {
        const prefix = getPatternPrefix(config.pattern);
        const key =
          prefix.length > 0 && resourcePath.startsWith(`${prefix}/`)
            ? resourcePath.slice(prefix.length + 1)
            : resourcePath;
        return { config, key };
      }
    } else {
      const storageKey = storageKeys[accessor] ?? accessor;
      if (storageKey === resourcePath) {
        // Single resource: `key` is the ref name (its storage key).
        return { config, key: storageKey };
      }
    }
  }
  return undefined;
}

/**
 * Emit a reactive-dispatch diagnostic as a failed `error` item, reusing the
 * response emitter's `emitItemAdded`/`emitItemDone` path (same item shape as
 * `runAction`'s terminal error). Best-effort: no-ops when the context has no
 * streaming emitter (the reactive-only path with no client), so a missing
 * stream degrades the diagnostic without affecting the reactive block run.
 * Callers compose the `code` (`reactive_cascade_exceeded` /
 * `reactive_input_invalid`) and human-readable `message`.
 */
async function emitReactiveError(
  ctx: ExecutionContext,
  code: string,
  message: string
): Promise<void> {
  const response = ctx.response as unknown as {
    emitItemAdded?: (item: ErrorItem) => Promise<unknown>;
    emitItemDone?: (item: ErrorItem) => Promise<unknown>;
  };
  if (
    typeof response !== "object" ||
    response === null ||
    typeof response.emitItemAdded !== "function" ||
    typeof response.emitItemDone !== "function"
  ) {
    return;
  }
  const item: ErrorItem = {
    id: `item_error_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    type: "error",
    status: "failed",
    requestId: ctx.requestRuntime.requestId,
    itemIndex: getResponseItemCount(ctx.response),
    provenance: { blockName: "runtime", blockInstanceId: "runtime", phase: "main" },
    ts: Date.now(),
    message,
    code,
  };
  await response.emitItemAdded(item);
  await response.emitItemDone(item);
}

/** Monotonic counter so concurrent reactive dispatches get distinct block paths. */
let reactiveDispatchSeq = 0;

/**
 * Build the per-scope reactive dispatcher. The returned function is wired as the
 * scope's `onResourceChanged` reactive arm; it resolves and runs the bound
 * block for the change, awaited inline.
 */
export function createReactiveDispatcher(
  deps: ReactiveDispatcherDeps
): (resourcePath: string, changeType: ResourceSeamChangeType, change: ResourceChangeDelta | undefined) => Promise<void> {
  const { configs, ctxRef, controller } = deps;
  // Storage-key alias map is fixed for the dispatcher's lifetime — compute once.
  const storageKeys = resourceStorageKeys(configs);

  return async (resourcePath, changeType, change) => {
    const resolved = resolveConfigFor(resourcePath, configs, storageKeys);
    if (resolved === undefined) return;
    const { config, key } = resolved;
    const reactTo = config.reactTo;
    if (reactTo === undefined) return;

    // Every mutation seam threads a change descriptor: state mutations a full
    // delta, content writes a `{ contentWrite: true }` marker (FIX-843). A bare
    // fire with no descriptor carries nothing to react to — skip defensively.
    if (change === undefined) return;

    // Map the internal seam vocabulary to the author-facing reactive kind. Only
    // an "updated" seam splits by axis: a content write carries a `contentWrite`
    // marker and routes to `contentUpdated`, otherwise to `stateUpdated`.
    // `created` / `deleted` are existence events — they never carry the marker
    // and keep their names. Gating the split on `"updated"` keeps the routing
    // correct even if a future create/delete path ever threaded the marker.
    const reactiveKind: ReactiveBindingKind =
      changeType === "updated"
        ? change.contentWrite === true
          ? "contentUpdated"
          : "stateUpdated"
        : changeType;

    const binding = reactTo[reactiveKind];
    if (binding === undefined) return;

    const ctx = ctxRef.current;
    if (ctx === undefined) return;

    // A content reaction gets a minimal identity payload (it `readContent()`s the
    // fresh body); a state reaction gets the post/pre state from the delta.
    const payload: ResourceChange | ResourceContentChange =
      reactiveKind === "contentUpdated"
        ? { key, ref: resourcePath, kind: "contentUpdated" }
        : {
            key,
            ref: resourcePath,
            kind: reactiveKind,
            state: (change.state as JsonObject | undefined) ?? null,
            prevState: (change.prevState as JsonObject | undefined) ?? null,
            evicted: change.evicted ?? false,
          };

    // Cast through the normalized binding shape so `when` accepts either payload
    // union member (the runtime block/gate is the same regardless of kind).
    const { block, when } = normalizeReactiveBinding(
      binding as unknown as {
        block: BlockDefinition<any, any>;
        when?: (c: ResourceChange | ResourceContentChange) => boolean;
      }
    );
    if (when !== undefined && !when(payload)) return;

    // Cascade budget: check before running. On breach emit a diagnostic and
    // return without running (and without incrementing the budget).
    if (controller.depth >= MAX_CASCADE_DEPTH) {
      await emitReactiveError(
        ctx,
        "reactive_cascade_exceeded",
        `Reactive cascade exceeded max depth (${MAX_CASCADE_DEPTH}) dispatching "${block.name}"`
      );
      return;
    }
    if (controller.fanout >= MAX_CASCADE_FANOUT) {
      await emitReactiveError(
        ctx,
        "reactive_cascade_exceeded",
        `Reactive cascade exceeded max fan-out (${MAX_CASCADE_FANOUT}) dispatching "${block.name}"`
      );
      return;
    }

    // Validate the payload against the block's input schema before running,
    // mirroring the action dispatch path. A malformed payload is a wiring bug;
    // emit a diagnostic and skip rather than feeding the block bad input.
    let runInput: unknown = payload;
    const inputSchema = (block as BlockDefinition<any, any>).inputSchema;
    if (inputSchema !== undefined) {
      const parsed = inputSchema.safeParse(payload);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const path = issue?.path?.join(".") ?? "";
        const suffix = path.length > 0 ? ` at "${path}"` : "";
        await emitReactiveError(
          ctx,
          "reactive_input_invalid",
          `Reactive block "${block.name}" input validation failed: ${issue?.message ?? "schema validation failed"}${suffix}`
        );
        return;
      }
      runInput = parsed.data;
    }

    controller.depth += 1;
    controller.fanout += 1;
    // Self-describing path: which resource + reactive kind drove this dispatch.
    const blockPath = `__reactive__/${resourcePath}/${reactiveKind}#${reactiveDispatchSeq++}`;
    // Parent the reactive block under the block that performed the mutation, so
    // it nests in the trace beneath its trigger instead of at the request root.
    const parentBlockInstanceId = deps.getTriggerInstanceId();
    const reactiveInstanceId = buildBlockInstanceId(ctx.requestRuntime.requestId, blockPath, 0);
    try {
      // Run inside the reactive block's attribution frame so a mutation it makes
      // nests its own reactive children under this block (cascade nesting).
      const result = await deps.runAttributed(reactiveInstanceId, () =>
        executeBlock({
          block,
          input: runInput,
          ctx,
          metadata: { scope: "block", blockPath, parentBlockInstanceId },
          logger: deps.logger,
        })
      );
      // A reactive block failure propagates to the mutating call (atomic).
      if (result.error !== undefined) {
        throw result.error;
      }
    } finally {
      controller.depth -= 1;
    }
  };
}
