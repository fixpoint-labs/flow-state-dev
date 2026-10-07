/**
 * Factory: `getOrCreateTaskCollection({ backing, ... })`.
 *
 * One-call helper that builds a `TaskCollectionRef` against one of two
 * backings — atomic state (`"state"`: a state ref you pass, or the request
 * when you pass none) or a resource collection (`"resource"`) — and adapts
 * the substrate's `onChange` callback to the framework's component-item
 * stream via `ctx.emit.component`.
 *
 * Each lifecycle transition emits a `task-change` component item keyed by
 * `${collectionId}/${taskId}`. The `key` ensures latest-wins replacement
 * per task in the client UI — `<Plan />` and the devtool subscribe to
 * these items, filter by `data.collectionId`, and render the board.
 */
import type { JsonObject } from "@flow-state-dev/core";
import type { ItemVisibility, OutputItem } from "@flow-state-dev/core/items";
import type {
  BlockContext,
  RequestScopeHandle,
  ResourceCollectionRef,
  StateRef,
} from "@flow-state-dev/core/types";
import type { TaskCollectionRef } from "./types";
import type { TaskClaimIdentity } from "../schema/task";
import { toEmittedTask, type TaskChangeEvent } from "./change-event";
import { createStateBackedTaskCollection } from "./state-backed";
import { createResourceBackedTaskCollection } from "./resource-backed";
import { isDefinedTaskCollection } from "./define-task-collection";
import { partitionedResourceCollection } from "./partition";
import type { TaskCapOptions } from "./task-caps";

/** Component-item type emitted on every task lifecycle transition. */
export const TASK_CHANGE_COMPONENT_TYPE = "task-change";

/** Common options shared by both backings. */
interface CommonOptions {
  collectionId: string;
  /** Clock injection for tests. Default: `Date.now`. */
  now?: () => number;
  /**
   * Visibility stamped on the `task-change` component items emitted on every
   * lifecycle transition (FIX-918). Omit for the default (client + history).
   * A board that runs *inside* a tool-wrapped drain passes
   * `{ client: true, history: false }` so its O(tasks × transitions) change
   * stream still drives the live `<Plan />` UI but never re-enters the calling
   * generator's LLM history.
   */
  changeVisibility?: ItemVisibility;
}

/**
 * Atomic-state backing options.
 *
 * Tasks live as a `Record<id, Task>` on one atomic state, written through its
 * CAS-guarded `atomicState`. Which state, and the default slot, follow from
 * whether you pass `state`:
 *
 * - **`state` passed** (e.g. `ctx.sequencer`, or a generator's own state via
 *   `ctx.parent`) — tasks live at `[stateKey]`, default `"tasks"`, on that ref.
 *   Durability follows the ref: a sequencer's state is checkpointed and restored
 *   on resume; a generator's own state is not.
 * - **`state` omitted** — tasks live on the request (`ctx.request`), at
 *   `[stateKey]`, default the `collectionId`, so several boards in one request
 *   stay apart. The collection survives every block boundary within the request
 *   and ends with it; for cross-request boards use `backing: "resource"`.
 *
 * The caps are accepted here and not on {@link ResourceBackingSpec}: this arm
 * builds `createStateBackedTaskCollection`, where enforcement lives, and asking
 * for a cap on a backing that enforces nothing is a type error rather than a
 * silently ignored ceiling. (That backing still *counts* retries; see
 * `task-caps.ts` on why counting and enforcing are separate there.)
 */
export interface StateBackingSpec extends CommonOptions, TaskCapOptions {
  backing: "state";
  /**
   * The atomic state that holds the tasks. Omit it to keep them on the request.
   * A passed ref's state schema must include a record at `[stateKey]` shaped as
   * `Record<string, Task>`.
   */
  state?: StateRef<Record<string, unknown>>;
  /**
   * Top-level field holding the `Record<id, Task>`. Default: `"tasks"` on a
   * passed `state`; the `collectionId` on the request.
   */
  stateKey?: string;
}

/** Resource-collection backing options. */
export interface ResourceBackingSpec extends CommonOptions {
  backing: "resource";
  /** The parameterized resource collection ref. Pattern: `someTopic/{id}`. */
  collection: ResourceCollectionRef<JsonObject>;
  /**
   * Refuse `setAssignee` on an `in_progress` task in this collection (FIX-982,
   * narrowed by FIX-1780). Set by a task board with dispatcher seats, whose
   * child's routing key is derived from the assignee. Only this backing carries it — a handed-off board is refused at
   * construction on any other.
   */
  immutableAssignee?: boolean;
  /**
   * The partition to read and write, required when `collection` was declared
   * with `partitionBy` and refused otherwise. A board passes the value its
   * `partitionBy` returns, or the one a dispatch names; a task entry's
   * `taskLedgers` resolver passes the one it is handed.
   */
  partition?: string;
}

export type GetOrCreateTaskCollectionOptions =
  | (StateBackingSpec & { ctx: BlockContext })
  | (ResourceBackingSpec & { ctx: BlockContext });

/**
 * Build a TaskCollectionRef against the chosen backing. The factory does
 * not allocate the underlying storage — the caller is expected to have
 * declared it (sequencer state schema, resource collection definition).
 *
 * Example (on a sequencer's state):
 * ```ts
 * const tasks = await getOrCreateTaskCollection({
 *   ctx,
 *   backing: "state",
 *   state: ctx.sequencer!,
 *   collectionId: "my-plan",
 * });
 * ```
 *
 * Throws, before touching any storage, when `backing` is not `"state"` or
 * `"resource"` — including the removed `"sequencer"` and `"request"` spellings
 * an untyped caller may still send — or when `state` is present but empty.
 *
 * Async: the resource backing hydrates a sync read-mirror at construction
 * (see `createResourceBackedTaskCollection`). The state backing builds
 * synchronously, but the factory is uniformly `async` so
 * callers `await` it regardless of backing.
 */
export async function getOrCreateTaskCollection<TInput = unknown, TOutput = unknown>(
  options: GetOrCreateTaskCollectionOptions
): Promise<TaskCollectionRef<TInput, TOutput>> {
  assertKnownBacking(options);

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

  // Where a claim on this board runs (FIX-1005). Read once at construction
  // from the public `BlockContext` handles — a narrowed value, so the write
  // path never holds a context. Optional-chained because mock contexts in
  // tests wire neither handle; the field then stays absent.
  const claimIdentity = readClaimIdentity(options.ctx);
  // Who is adding tasks through this ref: the session owner, server-set.
  const createdBy = options.ctx.session?.identity?.userId;

  const onChange = (event: TaskChangeEvent): void => {
    options.ctx.emit.component(
      TASK_CHANGE_COMPONENT_TYPE,
      {
        collectionId: event.collectionId,
        taskId: event.taskId,
        kind: event.kind,
        // Server-only fields are omitted here and ONLY here — this is the one
        // boundary that spreads the whole row to a client (FIX-1005).
        task: toEmittedTask(event.task),
        ...(event.prevStatus !== undefined ? { prevStatus: event.prevStatus } : {}),
      },
      {
        key: `${event.collectionId}/${event.taskId}`,
        ...(options.changeVisibility !== undefined
          ? { itemVisibility: options.changeVisibility }
          : {}),
      }
    );
  };

  if (options.backing === "state") {
    const passed = options.state;
    return createStateBackedTaskCollection<TInput, TOutput>({
      collectionId: options.collectionId,
      state: passed ?? requestStateRef(options.ctx.request),
      // The two default slots are where stored tasks already live: `tasks` on
      // a passed ref, the collectionId on the request — so multiple boards in
      // one request each get an isolated top-level slot without namespacing.
      stateKey: options.stateKey ?? (passed ? "tasks" : options.collectionId),
      onChange,
      getItems,
      now: options.now,
      claimIdentity,
      ...(createdBy !== undefined ? { createdBy } : {}),
      maxTotalTasks: options.maxTotalTasks,
      maxEnqueuedTasks: options.maxEnqueuedTasks,
      maxTotalRetries: options.maxTotalRetries,
    });
  }

  const partition = checkedPartition(options);
  return await createResourceBackedTaskCollection<TInput, TOutput>({
    collectionId: options.collectionId,
    collection:
      partition === undefined
        ? options.collection
        : partitionedResourceCollection(options.collection, options.collectionId, partition),
    onChange,
    getItems,
    now: options.now,
    claimIdentity,
    ...(createdBy !== undefined ? { createdBy } : {}),
    immutableAssignee: options.immutableAssignee,
    ...(partition !== undefined ? { partition } : {}),
  });
}

/**
 * The partition a resource-backed resolution reads, checked against the
 * ledger's declaration: a partitioned ledger is never read whole, and an
 * unpartitioned one is never addressed by a partition.
 */
function checkedPartition(options: ResourceBackingSpec): string | undefined {
  const declared = options.collection.config as unknown;
  const partitioned =
    isDefinedTaskCollection(declared) && declared.__taskCollection.partitionBy !== undefined;
  const where = `[tasks] getOrCreateTaskCollection("${options.collectionId}")`;
  if (partitioned && options.partition === undefined) {
    throw new Error(
      `${where}: this ledger keeps its rows per partition (partitionBy), so it is resolved ` +
        `with a partition, never read whole.`
    );
  }
  if (!partitioned && options.partition !== undefined) {
    throw new Error(
      `${where}: a partition was named (${JSON.stringify(options.partition)}), but this ledger ` +
        `was not declared with partitionBy.`
    );
  }
  if (options.partition !== undefined && (typeof options.partition !== "string" || options.partition.length === 0)) {
    throw new Error(`${where}: partition must be a non-empty string`);
  }
  return options.partition;
}

/**
 * Reject a backing this factory does not build, before any storage or context
 * handle is read. Typed callers cannot get here; an untyped caller (plain JS,
 * a cast, a config loaded at runtime) still sending a removed spelling gets the
 * replacement named rather than a failure one step later.
 */
function assertKnownBacking(options: GetOrCreateTaskCollectionOptions): void {
  const raw = options as { backing?: unknown; collectionId?: unknown; state?: unknown };
  const where = `[tasks] getOrCreateTaskCollection("${String(raw.collectionId)}")`;
  if (raw.backing === "sequencer") {
    throw new Error(
      `${where}: backing "sequencer" was removed. Write backing: "state" and pass ` +
        "the ref as `state` (was `sequencer`). Valid backings: \"state\", \"resource\"."
    );
  }
  if (raw.backing === "request") {
    throw new Error(
      `${where}: backing "request" was removed. Write backing: "state" with no ` +
        "`state` field to keep tasks on the request. Valid backings: \"state\", \"resource\"."
    );
  }
  if (raw.backing !== "state" && raw.backing !== "resource") {
    throw new Error(
      `${where}: unknown backing ${JSON.stringify(raw.backing)}. ` +
        'Valid backings: "state", "resource".'
    );
  }
  // An explicit `state: undefined` must not quietly become "on the request":
  // that would put the board's tasks on a different state, at a different slot.
  if (raw.backing === "state" && "state" in raw && raw.state == null) {
    throw new Error(
      `${where}: \`state\` was passed but is ${String(raw.state)}. Pass a state ref, ` +
        "or leave `state` out to keep tasks on the request."
    );
  }
}

/**
 * Read the execution coordinate a claim on this board should record
 * (FIX-1005) — `{ sessionId, requestId, tenantId? }`.
 *
 * Sourced from `ctx.request` / `ctx.session`, which are plain public
 * `BlockContext` members carrying a `ScopeIdentity`. Nothing here reaches the
 * store registry or a request-host seam.
 *
 * Returns `undefined` when either handle is missing — a mock context in a unit
 * test. Absent is a supported state that means "no coordinate" (BP-030), so a
 * partial identity is never synthesized from one half.
 */
function readClaimIdentity(ctx: BlockContext): TaskClaimIdentity | undefined {
  const requestId = ctx.request?.identity?.id;
  const sessionId = ctx.session?.identity?.id;
  if (requestId === undefined || sessionId === undefined) return undefined;
  const tenantId = ctx.request.identity.tenantId;
  return {
    sessionId,
    requestId,
    ...(tenantId !== undefined ? { tenantId } : {}),
  };
}

/**
 * Adapt `ctx.request` to the `StateRef` shape the state-backed CAS impl
 * expects — the omitted-`state` case of `backing: "state"`. Both surfaces
 * expose the same `ScopeStateOps` mutators (`atomicState`, `patchState`,
 * etc.) so the only adaptation needed is a live `state` getter and a stable
 * name/instanceId pair. Keeping this in one place lets a request board and a
 * board on a passed ref share the same mutation engine, retry semantics, and
 * `onChange` emission path.
 */
function requestStateRef(
  request: RequestScopeHandle
): StateRef<Record<string, unknown>> {
  return {
    name: "request",
    instanceId: request.identity.id,
    // Live getter — the CAS read path inside createStateBackedTaskCollection
    // calls `state.state` to peek at the current tasks map (e.g. inside
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
