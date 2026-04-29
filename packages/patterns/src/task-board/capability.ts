/**
 * Task Board capability — exposes a board's `TaskCollectionRef` as a
 * first-class capability so any block in the same flow can read or
 * mutate the board without re-deriving the collection wiring.
 *
 * Why a capability and not just a helper:
 *
 * - **Single config surface.** A board's `name`, `collectionId`, and
 *   `stateKey` get declared once on `taskBoard({...})`. The returned
 *   `.capability` is the only thing other blocks need to import. No
 *   second `getOrCreateTaskCollection` call with matching arguments,
 *   no risk of drift between the pattern's collection and a manually-
 *   wired one.
 *
 * - **Auto-installed schema.** The capability declares
 *   `targetStateSchemas: { [boardName]: taskBoardStateSchema }` so any
 *   block that lists the capability in `uses` automatically contributes
 *   the board's `tasks` slot to the parent sequencer's state schema.
 *   Consumers no longer need to extend their flow-level state schema by
 *   hand to add a board.
 *
 * - **Typed `ctx.cap.<name>` accessor.** `defineCapability`'s `fns`
 *   field exposes `ctx.cap.taskBoard_<boardName>.tasks` to the
 *   consuming block. The reach-across to the parent board's state ref
 *   is centralized here — the same `ctx.getTarget(boardName)` lookup
 *   the pattern uses internally.
 *
 * Naming: capability name is `taskBoard_<boardName>` (underscore, not
 * dot) so the resulting key is a valid JavaScript identifier and
 * consumers get dot-notation access in TypeScript:
 * `ctx.cap.taskBoard_research`, `ctx.cap.taskBoard_financials`. Other
 * capabilities in the codebase (`workingMemory`, `skills`, `mcp`) are
 * singletons with flat names; Task Board is parameterized per board so
 * the prefix carries the board name.
 */
import { defineCapability } from "@flow-state-dev/core";
import type { BlockContext, StateRef } from "@flow-state-dev/core/types";
import type { ZodTypeAny } from "zod";
import {
  getOrCreateTaskCollection,
  type TaskCollectionRef,
} from "@flow-state-dev/tasks";

import { taskBoardStateSchema } from "./schemas";

/**
 * Sequencer-spec options. The capability constructs the collection
 * via `getOrCreateTaskCollection({ backing: "sequencer", ... })`
 * against the parent board sequencer's state ref, resolved via
 * `ctx.getTarget(boardName)`. Consumers must run inside the board's
 * sequencer subtree (the targets registry won't resolve `boardName`
 * for siblings) — using the capability from outside that scope throws
 * a clear error instead of silently writing to the wrong state.
 *
 * The capability declares the board's `tasks` slot via
 * `targetStateSchemas: { [boardName]: taskBoardStateSchema }` so
 * consumers transitively contribute the state schema without manual
 * flow-level wiring.
 */
export interface TaskBoardSequencerCapabilityOptions {
  backing: "sequencer";
  /** Board name — also the key used by `ctx.getTarget(boardName)` to find the board's state ref. */
  boardName: string;
  /** Stable collection identifier — matches `data.collectionId` on emitted `task-change` items. */
  collectionId: string;
  /** Sequencer-state slot key holding the `Record<id, Task>`. Default `"tasks"`. */
  stateKey?: string;
}

/**
 * Request-scoped options (FIX-471). The collection lives on
 * `ctx.request` so any block in the request — board-internal or
 * sibling — can read/mutate it. The capability does NOT declare
 * `targetStateSchemas` (the slot isn't on a parent sequencer) and does
 * NOT require the consumer to be inside the board's subtree, which is
 * what enables re-entry from outer loops that wrap `board.block`
 * across iterations.
 *
 * The slot key on `ctx.request.state` defaults to `collectionId` so
 * multiple request-backed boards in one request are namespaced by
 * default; override `stateKey` if the id collides with other
 * request-state shapes.
 */
export interface TaskBoardRequestCapabilityOptions {
  backing: "request";
  boardName: string;
  collectionId: string;
  stateKey?: string;
}

/**
 * Factory-backed options. The capability defers entirely to the
 * caller-supplied `(ctx) => TaskCollectionRef` factory — used for
 * resource-collection-backed boards or any custom backing the pattern
 * itself doesn't understand.
 *
 * The capability does NOT declare a state schema in this mode, since
 * the storage is opaque. Schema declaration is the caller's
 * responsibility (typically already handled by their resource
 * collection's `defineResource`).
 */
export interface TaskBoardFactoryCapabilityOptions {
  backing: "factory";
  boardName: string;
  collectionId: string;
  factory: (ctx: BlockContext) => TaskCollectionRef;
}

export type TaskBoardCapabilityOptions =
  | TaskBoardSequencerCapabilityOptions
  | TaskBoardRequestCapabilityOptions
  | TaskBoardFactoryCapabilityOptions;

/**
 * Capability accessor — what consumers see at
 * `ctx.cap.taskBoard_<boardName>`. Exposes the board's
 * `TaskCollectionRef` via a getter; every method on the returned ref
 * is CAS-safe and emits `task-change` component items on the same
 * stream the board itself publishes on.
 *
 * `tasks` is a getter (not a bare property) because `defineCapability`
 * constrains `fns` to a record of functions — capabilities expose
 * helpers, not values. Calling `ctx.cap.taskBoard_<name>.tasks()`
 * resolves the collection lazily through the active block context.
 *
 * The intersection with `Record<string, (...args) => any>` satisfies
 * `defineCapability`'s `TFns` generic constraint without forcing the
 * consumer to widen `ctx: any` to the same shape.
 */
export type TaskBoardCapabilityAccessor = {
  tasks: () => TaskCollectionRef;
} & Record<string, (...args: any[]) => any>;

/**
 * Build a `DefinedCapability` that exposes a Task Board's collection at
 * `ctx.cap["taskBoard.<boardName>"].tasks`.
 *
 * Backing-aware: sequencer-spec options auto-wire
 * `getOrCreateTaskCollection({ backing: "sequencer", ... })` and declare
 * the board's `tasks` slot via `targetStateSchemas`. Factory options
 * defer entirely to the caller-supplied `(ctx) => TaskCollectionRef`
 * factory, which can produce any backing (resource-collection, custom
 * external store, etc.).
 *
 * The returned capability is reused as a singleton by `taskBoard()` —
 * consumers don't typically call this directly. Use `board.capability`
 * from a `taskBoard({...})` handle instead.
 */
export function createTaskBoardCapability(
  options: TaskBoardCapabilityOptions
) {
  const { boardName, collectionId } = options;
  const capabilityName = `taskBoard_${boardName}` as const;

  if (options.backing === "factory") {
    // Factory-backed boards are opaque to the pattern — defer entirely
    // to the user's factory. No state schema declaration, since the
    // storage is the caller's responsibility (typically a
    // ResourceCollection that already declares its own).
    const userFactory = options.factory;
    return defineCapability({
      name: capabilityName,
      fns: (ctx: BlockContext): TaskBoardCapabilityAccessor => ({
        tasks: () => userFactory(ctx),
      }),
    });
  }

  if (options.backing === "request") {
    // Request-backed: the collection's tasks live on `ctx.request`, so
    // there's no parent sequencer slot to declare and no `getTarget`
    // scoping check. Any block that lists this capability in `uses` can
    // read or mutate the board, including blocks that run BEFORE,
    // AFTER, or BETWEEN `board.block` invocations from a parent loop.
    // That's the whole point of this backing — re-entry across multiple
    // board calls within the same request.
    //
    // Tasks are namespaced on `ctx.request.state` at `[stateKey ??
    // collectionId]`; collisions with other request-state shapes are
    // the consumer's responsibility (override `stateKey` if needed).
    const { collectionId, stateKey } = options;
    return defineCapability({
      name: capabilityName,
      fns: (ctx: BlockContext): TaskBoardCapabilityAccessor => ({
        tasks: () =>
          getOrCreateTaskCollection({
            ctx,
            backing: "request",
            collectionId,
            stateKey,
          }),
      }),
    });
  }

  // Sequencer-backed: state schema declared transitively, collection
  // resolved strictly via `ctx.getTarget(boardName)` against the parent
  // board sequencer.
  //
  // No `ctx.sequencer` fallback: the targets registry only resolves
  // when `boardName` is in scope (i.e. the calling block is executing
  // inside the board's sequencer subtree). Falling back to
  // `ctx.sequencer` for siblings would silently return a foreign state
  // ref and let the collection write to the wrong record. Failing
  // loudly here makes the misuse case obvious instead of corrupting
  // state.
  //
  // `taskBoardStateSchema` is cast to a wider `ZodTypeAny` because
  // without the cast TS recursively unifies the schema's shape against
  // `defineCapability`'s `targetStateSchemas` generic and trips the
  // "type instantiation is excessively deep" guard for nested z.record
  // chains — the framework consumes the schema as `ZodTypeAny` at
  // runtime, so the wider type loses no information.
  const stateSchema: ZodTypeAny = taskBoardStateSchema;
  const { stateKey } = options;

  return defineCapability({
    name: capabilityName,
    targetStateSchemas: {
      [boardName]: stateSchema,
    },
    fns: (ctx: BlockContext): TaskBoardCapabilityAccessor => ({
      tasks: () => {
        const target = ctx.getTarget<Record<string, unknown>>(boardName);
        if (target === undefined) {
          throw new Error(
            `[task-board] capability "${capabilityName}" can only be used from a block executing inside the board sequencer "${boardName}". ctx.getTarget("${boardName}") returned undefined — the board is not on the current execution chain.`
          );
        }
        return getOrCreateTaskCollection({
          ctx,
          backing: "sequencer",
          collectionId,
          sequencer: target as StateRef<Record<string, unknown>>,
          stateKey,
        });
      },
    }),
  });
}
