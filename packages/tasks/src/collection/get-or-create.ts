/**
 * Factory: `getOrCreateTaskCollection({ backing, ... })`.
 *
 * One-call helper that builds a `TaskCollectionRef` against any of three
 * backings (sequencer-state, request-state, resource-collection) and
 * adapts the substrate's `onChange` callback to the framework's
 * component-item stream via `ctx.emitComponent`.
 *
 * Each lifecycle transition emits a `task-change` component item keyed by
 * `${collectionId}/${taskId}`. The `key` ensures latest-wins replacement
 * per task in the client UI — `<Plan />` and the devtool subscribe to
 * these items, filter by `data.collectionId`, and render the board.
 */
import type { JsonObject } from "@flow-state-dev/core";
import type { OutputItem } from "@flow-state-dev/core/items";
import type {
  BlockContext,
  RequestScopeHandle,
  ResourceCollectionRef,
  StateRef,
} from "@flow-state-dev/core/types";
import type { TaskCollectionRef } from "./types";
import type { TaskChangeEvent } from "./change-event";
import { createSequencerBackedTaskCollection } from "./sequencer-backed";
import { createResourceBackedTaskCollection } from "./resource-backed";

/** Component-item type emitted on every task lifecycle transition. */
export const TASK_CHANGE_COMPONENT_TYPE = "task-change";

/** Common options shared by both backings. */
interface CommonOptions {
  collectionId: string;
  /** Clock injection for tests. Default: `Date.now`. */
  now?: () => number;
}

/** Sequencer-state backing options. */
export interface SequencerBackingSpec extends CommonOptions {
  backing: "sequencer";
  /**
   * Sequencer state ref. Typically `ctx.sequencer`. The sequencer's
   * stateSchema must include a record at `[stateKey]` (default `"tasks"`)
   * shaped as `Record<string, Task>`.
   */
  sequencer: StateRef<Record<string, unknown>>;
  stateKey?: string;
}

/** Resource-collection backing options. */
export interface ResourceBackingSpec extends CommonOptions {
  backing: "resource";
  /** The parameterized resource collection ref. Pattern: `someTopic/{id}`. */
  collection: ResourceCollectionRef<JsonObject>;
}

/**
 * Request-state backing options (FIX-471).
 *
 * Tasks live on `ctx.request` — the same atomic-state surface a
 * sequencer state ref exposes — so the collection survives every block
 * boundary inside a single request. Use this backing when a board needs
 * to be re-entered from inside an outer loop (e.g. a replan loop wraps
 * the same `taskBoard.block` to drain freshly added tasks across
 * iterations); sequencer-backed collections don't survive across
 * sequencer invocations because each call creates a fresh state
 * container.
 *
 * Lifetime is the request, not the session. For cross-request boards,
 * use `backing: "resource"` with a session/user/org-scoped resource
 * collection.
 */
export interface RequestBackingSpec extends CommonOptions {
  backing: "request";
  /**
   * Top-level field on `ctx.request.state` that holds the
   * `Record<id, Task>`. Defaults to the `collectionId`, which keeps
   * multiple boards in the same request namespaced by default.
   */
  stateKey?: string;
}

export type GetOrCreateTaskCollectionOptions =
  | (SequencerBackingSpec & { ctx: BlockContext })
  | (RequestBackingSpec & { ctx: BlockContext })
  | (ResourceBackingSpec & { ctx: BlockContext });

/**
 * Build a TaskCollectionRef against the chosen backing. The factory does
 * not allocate the underlying storage — the caller is expected to have
 * declared it (sequencer state schema, resource collection definition).
 *
 * Example (sequencer-backed):
 * ```ts
 * const tasks = getOrCreateTaskCollection({
 *   ctx,
 *   backing: "sequencer",
 *   collectionId: "my-plan",
 *   sequencer: ctx.sequencer!,
 * });
 * ```
 */
export function getOrCreateTaskCollection<TInput = unknown, TOutput = unknown>(
  options: GetOrCreateTaskCollectionOptions
): TaskCollectionRef<TInput, TOutput> {
  // Item-log accessor for `TaskHandle.items()` (FIX-480). Duck-typed
  // against `ctx.response` — same access pattern as
  // `getEmitterItemCount` in `packages/core/src/blocks/generator.ts`.
  // Optional-chains the whole expression so a missing `response` (mock
  // contexts in tests) yields `[]` instead of throwing.
  const getItems = (): readonly OutputItem[] => {
    const r = options.ctx.response as
      | { getItems?: () => readonly OutputItem[] }
      | undefined;
    return r?.getItems?.() ?? [];
  };

  const onChange = (event: TaskChangeEvent): void => {
    options.ctx.emitComponent(
      TASK_CHANGE_COMPONENT_TYPE,
      {
        collectionId: event.collectionId,
        taskId: event.taskId,
        kind: event.kind,
        task: event.task,
        ...(event.prevStatus !== undefined ? { prevStatus: event.prevStatus } : {}),
      },
      { key: `${event.collectionId}/${event.taskId}` }
    );
  };

  if (options.backing === "sequencer") {
    return createSequencerBackedTaskCollection<TInput, TOutput>({
      collectionId: options.collectionId,
      sequencer: options.sequencer,
      stateKey: options.stateKey,
      onChange,
      getItems,
      now: options.now,
    });
  }

  if (options.backing === "request") {
    return createSequencerBackedTaskCollection<TInput, TOutput>({
      collectionId: options.collectionId,
      sequencer: requestStateRef(options.ctx.request),
      // Default to the collectionId — multiple boards in one request
      // each get an isolated top-level slot without manual namespacing.
      stateKey: options.stateKey ?? options.collectionId,
      onChange,
      getItems,
      now: options.now,
    });
  }

  return createResourceBackedTaskCollection<TInput, TOutput>({
    collectionId: options.collectionId,
    collection: options.collection,
    onChange,
    getItems,
    now: options.now,
  });
}

/**
 * Adapt `ctx.request` to the `StateRef` shape the sequencer-backed CAS
 * impl expects. Both surfaces expose the same `ScopeStateOps` mutators
 * (`atomicState`, `patchState`, etc.) so the only adaptation needed is a
 * live `state` getter and a stable name/instanceId pair. Keeping this in
 * one place lets request-backed and sequencer-backed share the same
 * mutation engine, retry semantics, and `onChange` emission path.
 */
function requestStateRef(
  request: RequestScopeHandle
): StateRef<Record<string, unknown>> {
  return {
    name: "request",
    instanceId: request.identity.id,
    // Live getter — the CAS read path inside createSequencerBackedTaskCollection
    // calls `sequencer.state` to peek at the current tasks map (e.g. inside
    // the retry-on-fail branch). A frozen snapshot would silently desync.
    get state() {
      return request.state as Record<string, unknown>;
    },
    input: undefined,
    patchState: request.patchState.bind(request),
    setState: request.setState.bind(request),
    incState: request.incState.bind(request),
    pushState: request.pushState.bind(request),
    setStateRecord: request.setStateRecord.bind(request),
    deleteStateRecord: request.deleteStateRecord.bind(request),
    atomicState: request.atomicState.bind(request),
  };
}
