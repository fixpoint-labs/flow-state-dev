/**
 * Task Board capability — the whole consumer surface for a board's tasks.
 *
 * A composer picks the board's backing once on `taskBoard({...})` and then only
 * ever touches this capability's accessor. Add `board.capability` to any block's
 * `uses` and call the sugar directly:
 *
 * ```ts
 * await ctx.cap.<name>.addTask({ goal: "…" });
 * const done = await ctx.cap.<name>.listTasks({ status: "completed" });
 * ```
 *
 * Why a capability and not a helper:
 *
 * - **Single config surface.** The board's storage choice, `collectionId`, and
 *   `stateKey` are declared once on `taskBoard({...})`. Consumers import only
 *   `board.capability` — no second `getOrCreateTaskCollection` call with
 *   matching arguments, no drift.
 * - **Direct sugar.** `addTask`/`addTasks`/`getTask`/`listTasks`/`countTasks`
 *   delegate to the resolved `TaskCollectionRef`, so a read or write is one call
 *   instead of resolve-then-call. `tasks()` is retained as the full-ref escape
 *   hatch.
 * - **Bare `ctx.cap.<name>` accessor.** The capability name is the board name
 *   verbatim. Hyphenated names (`ctx.cap["my-board"]`) work via bracket access;
 *   prototype-poisoning names are rejected at construction here — the layer that
 *   owns the key.
 *
 * Backing-aware resolution — all three backings share `buildTaskBoardAccessor`:
 * - **sequencer**: resolves strictly via `ctx.getTarget(boardName)`; throws if
 *   used from outside the board's sequencer subtree (state must be in scope).
 * - **request**: resolves via `ctx.request`; usable from any block in the
 *   request (siblings, outer loops), which is what makes add-before-drain work.
 * - **resource**: resolves the registered `DefinedTaskCollection` from
 *   `ctx.resources`; the collection is installed via the internal
 *   resource-declaring capability threaded through this capability's `uses`.
 * - **factory**: defers to the caller-supplied `(ctx) => TaskCollectionRef`.
 *
 * The resolve is re-run on every accessor call (not memoized) so a resource-
 * backed read after a mid-drain add sees fresh state.
 */
import { defineCapability, type DefinedCapability } from "@flow-state-dev/core";
import type {
  BlockContext,
  MaybePromise,
  StateRef,
} from "@flow-state-dev/core/types";
import {
  getOrCreateTaskCollection,
  type Task,
  type TaskCollectionRef,
  type TaskFilter,
  type TaskCapOptions,
  type TaskHandle,
  type TaskInit,
} from "../tasks";

import { taskBoardStateSchema } from "./schemas";
import { assertSafeCapabilityKey } from "../tasks/collection/safe-key";
import { resolveResourceTaskCollection } from "./resolve-resource";

/**
 * Sequencer-spec options. Resolves the collection via
 * `getOrCreateTaskCollection({ backing: "sequencer", ... })` against the parent
 * board sequencer's state ref (`ctx.getTarget(boardName)`). Consumers must run
 * inside the board's sequencer subtree; using the capability from a sibling
 * throws rather than writing to the wrong state.
 *
 * Declares the board's `tasks` slot via
 * `targetStateSchemas: { [boardName]: taskBoardStateSchema }` so consumers
 * contribute the state schema transitively.
 */
interface TaskBoardSequencerCapabilityOptions extends TaskCapOptions {
  backing: "sequencer";
  /** Board name — also the `ctx.getTarget(boardName)` key for the board's state ref. */
  boardName: string;
  /** Stable collection identifier — matches `data.collectionId` on emitted `task-change` items. */
  collectionId: string;
  /** Sequencer-state slot key holding the `Record<id, Task>`. Default `"tasks"`. */
  stateKey?: string;
}

/**
 * Request-scoped options. The collection lives on `ctx.request`, so any block in
 * the request — board-internal or sibling — can read/mutate it. No
 * `targetStateSchemas`, no subtree requirement: that's what enables adding a
 * task from a sibling or outer step before the board drains, and re-entry from
 * outer loops that wrap `board.drain`.
 */
interface TaskBoardRequestCapabilityOptions extends TaskCapOptions {
  backing: "request";
  boardName: string;
  collectionId: string;
  stateKey?: string;
}

/**
 * Resource-backed options (durable board). The collection is a
 * `DefinedTaskCollection` registered via an internal resource-declaring
 * capability, threaded through this capability's `uses` (so sibling actions that
 * list `board.capability` install the resource too) and the board sequencer's
 * `uses` (so the drain does). Resolved from `ctx.resources[resourceKey]`.
 */
interface TaskBoardResourceCapabilityOptions {
  backing: "resource";
  boardName: string;
  collectionId: string;
  /** `ctx.resources` key the durable collection is registered under (its id). */
  resourceKey: string;
  /** Internal resource-declaring capability composed via `uses`. */
  resourceCapability: DefinedCapability;
}

/**
 * Factory-backed options. Defers entirely to the caller-supplied factory — for
 * externally-managed or custom stores. No state schema is declared (the storage
 * is opaque; the factory owns any declaration).
 */
interface TaskBoardFactoryCapabilityOptions<TInput = unknown, TOutput = unknown> {
  backing: "factory";
  boardName: string;
  collectionId: string;
  factory: (ctx: BlockContext) => MaybePromise<TaskCollectionRef<TInput, TOutput>>;
}

export type TaskBoardCapabilityOptions<TInput = unknown, TOutput = unknown> =
  | TaskBoardSequencerCapabilityOptions
  | TaskBoardRequestCapabilityOptions
  | TaskBoardResourceCapabilityOptions
  | TaskBoardFactoryCapabilityOptions<TInput, TOutput>;

/**
 * Capability accessor — what consumers see at `ctx.cap.<boardName>`.
 *
 * Generic in the board's task payload types: `taskBoard<TInput, TOutput>(...)`
 * threads `TInput`/`TOutput` through the handle to here, so `addTask` type-checks
 * the payload and the query methods return `Task<TInput, TOutput>`. Without the
 * threading a mismatched `addTask({ input })` would compile silently.
 *
 * `tasks()` returns the full `TaskCollectionRef`. The sugar methods delegate to
 * that ref: `addTask`/`addTasks` mutate; `getTask`/`listTasks`/`countTasks`
 * wrap the ref's synchronous reads (they're `async` only because resolving the
 * ref is). Every method re-resolves the ref, so reads always reflect the latest
 * committed state.
 *
 * A closed object of function-typed properties satisfies `defineCapability`'s
 * `TFns extends Record<string, (...args) => any>` constraint on its own — no
 * `& Record<string, …>` intersection, which would re-widen every method back to
 * `(...args: any[]) => any` and erase exactly the payload checking above.
 */
export type TaskBoardCapabilityAccessor<TInput = unknown, TOutput = unknown> = {
  /** The board's full `TaskCollectionRef` — the escape hatch for the whole API. */
  tasks: () => Promise<TaskCollectionRef<TInput, TOutput>>;
  /** Add one task. */
  addTask: (task: TaskInit<TInput>) => Promise<Task<TInput, TOutput>>;
  /** Add several tasks. */
  addTasks: (tasks: TaskInit<TInput>[]) => Promise<Task<TInput, TOutput>[]>;
  /** Read one task by id (undefined if absent). */
  getTask: (id: string) => Promise<TaskHandle<TInput, TOutput> | undefined>;
  /** List tasks, optionally filtered. */
  listTasks: (filter?: TaskFilter) => Promise<TaskHandle<TInput, TOutput>[]>;
  /** Count tasks, optionally filtered. */
  countTasks: (filter?: TaskFilter) => Promise<number>;
};

/**
 * Build the accessor over a per-call `resolve`. Not memoized: each method
 * re-resolves so a read after a mid-drain add sees fresh state — the freshness
 * resource backing depends on. For request/sequencer backings `resolve` is a
 * cheap synchronous wrap; for resource backing it re-hydrates the collection's
 * read-mirror (one `collection.list()`), so a tight loop of sugar calls on a
 * large durable board pays that per call. Reach for `tasks()` once and reuse the
 * ref when you need many reads in a row without intervening writes.
 */
function buildTaskBoardAccessor<TInput, TOutput>(
  resolve: () => Promise<TaskCollectionRef<TInput, TOutput>>
): TaskBoardCapabilityAccessor<TInput, TOutput> {
  return {
    tasks: resolve,
    addTask: async (task) => (await resolve()).addTask(task),
    addTasks: async (tasks) => (await resolve()).addTasks(tasks),
    getTask: async (id) => (await resolve()).get(id),
    listTasks: async (filter) => (await resolve()).list(filter),
    countTasks: async (filter) => (await resolve()).count(filter),
  };
}

/**
 * Build a `DefinedCapability` that exposes a Task Board's collection at
 * `ctx.cap.<boardName>`. See module doc. The returned capability is reused as a
 * singleton by `taskBoard()` — consumers use `board.capability`, not this.
 */
export function createTaskBoardCapability<
  TInput = unknown,
  TOutput = unknown,
  const TName extends string = string,
>(
  // `& { boardName: TName }` captures the board name as a string literal (via the
  // `const` type param) so the returned capability is `DefinedCapability<TName,
  // …>`, not `DefinedCapability<string, …>`. That matters downstream: core's
  // `InferCapabilities` maps a `string` name to a `Record<string, accessor>`
  // index signature (so `ctx.cap.anyName` wrongly type-checks and multiple boards'
  // payloads intersect), whereas a literal name yields a single precise
  // `ctx.cap[<boardName>]` property.
  options: TaskBoardCapabilityOptions<TInput, TOutput> & { boardName: TName }
): DefinedCapability<TName, TaskBoardCapabilityAccessor<TInput, TOutput>> {
  const { boardName, collectionId } = options;
  // Board name flows verbatim into `ctx.cap[<name>]`. Reject prototype-poisoning
  // names here — the layer that owns the accessor key — so misuse throws at
  // construction instead of corrupting the accessor record at runtime.
  assertSafeCapabilityKey(boardName);
  const capabilityName = boardName;

  if (options.backing === "factory") {
    const userFactory = options.factory;
    return defineCapability({
      name: capabilityName,
      fns: (ctx: BlockContext): TaskBoardCapabilityAccessor<TInput, TOutput> =>
        // `async` normalizes a sync-or-async factory to a Promise and captures a
        // synchronous throw as a rejection, honoring the accessor contract.
        buildTaskBoardAccessor<TInput, TOutput>(async () => userFactory(ctx)),
    });
  }

  if (options.backing === "request") {
    // The caps ride the capability too, not just the drain's factory (FIX-931):
    // `getOrCreateTaskCollection` never caches, so `ctx.cap.<board>.addTask`
    // builds its OWN ref. One resolver per board, not one per writer — without
    // this the capability would be an uncapped writer onto the same board.
    const { stateKey, maxTotalTasks, maxEnqueuedTasks } = options;
    return defineCapability({
      name: capabilityName,
      fns: (ctx: BlockContext): TaskBoardCapabilityAccessor<TInput, TOutput> =>
        buildTaskBoardAccessor<TInput, TOutput>(() =>
          getOrCreateTaskCollection<TInput, TOutput>({
            ctx,
            backing: "request",
            collectionId,
            stateKey,
            maxTotalTasks,
            maxEnqueuedTasks,
          })
        ),
    });
  }

  if (options.backing === "resource") {
    const { resourceKey, resourceCapability } = options;
    return defineCapability({
      name: capabilityName,
      // Compose the internal resource-declaring capability so any block that
      // lists `board.capability` also installs the durable collection.
      uses: [resourceCapability],
      fns: (ctx: BlockContext): TaskBoardCapabilityAccessor<TInput, TOutput> =>
        buildTaskBoardAccessor<TInput, TOutput>(() =>
          resolveResourceTaskCollection<TInput, TOutput>(ctx, {
            boardName,
            resourceKey,
            collectionId,
          })
        ),
    });
  }

  // Sequencer-backed: state schema declared transitively; collection resolved
  // strictly via `ctx.getTarget(boardName)`. No `ctx.sequencer` fallback — the
  // targets registry only resolves inside the board's subtree, so failing loudly
  // here beats silently writing to a sibling's state.
  const { stateKey, maxTotalTasks, maxEnqueuedTasks } = options;
  return defineCapability({
    name: capabilityName,
    targetStateSchemas: {
      [boardName]: taskBoardStateSchema,
    },
    fns: (ctx: BlockContext): TaskBoardCapabilityAccessor<TInput, TOutput> =>
      buildTaskBoardAccessor<TInput, TOutput>(async () => {
        const target = ctx.getTarget<Record<string, unknown>>(boardName);
        if (target === undefined) {
          throw new Error(
            `[task-board] capability "${capabilityName}" can only be used from a block ` +
              `executing inside the board sequencer "${boardName}". ctx.getTarget("${boardName}") ` +
              `returned undefined — the board is not on the current execution chain.`
          );
        }
        return getOrCreateTaskCollection<TInput, TOutput>({
          ctx,
          backing: "sequencer",
          collectionId,
          sequencer: target as StateRef<Record<string, unknown>>,
          stateKey,
          maxTotalTasks,
          maxEnqueuedTasks,
        });
      }),
  });
}
