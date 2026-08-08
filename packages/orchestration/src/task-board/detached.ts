/**
 * Detached-dispatch declaration surface for `taskBoard` (FIX-982 P1).
 *
 * A board declares that a worker runs **outside** the request that claimed its
 * task by wrapping the worker in a `{ worker, dispatch }` entry. This module
 * owns three things and nothing else:
 *
 * 1. the entry shape and its runtime narrowing, so a bare worker value keeps
 *    meaning "inline" and no existing board needs editing (BP-030);
 * 2. `resolveWorkerEntries`, which flattens a board's `workers` /
 *    `defaultWorker` config into the worker blocks the drain composes plus the
 *    set that asked to be detached;
 * 3. `assertDetachedBoardSupported`, the construction-time refusals.
 *
 * **No execution lives here.** Nothing in P1 dispatches anything out of the
 * request — a worker declared `detached` is validated and then still runs
 * inline, because the spawn arrives in P3a. That is deliberate: the refusals
 * have to exist before the mechanism does, or the first detached board is
 * built against a backing that cannot settle it.
 *
 * ## Where the refusals live, and why two of them are not here
 *
 * The spec (§6 decision 11, §8 P1) asks for six construction-time refusals.
 * Three of them are decidable from what `taskBoard()` is handed and are
 * enforced below. Two are not, and the enforcement point had to move to where
 * the fact first exists:
 *
 * - **an unfencable store (the filesystem adapter).** A `DefinedTaskCollection`
 *   names a resource pattern and a scope. The store adapter behind it comes
 *   from the runtime `StoreRegistry`, which does not exist when `taskBoard()`
 *   runs, so the board cannot ask whether the store fences ownership. The
 *   check belongs where the collection resolves.
 * - **`contextSupply: "conversation"` on a detached participant.** That field
 *   lives on an `AgentSpec` and is consumed by `materializeWorker`; the block
 *   handed to `workers` no longer carries it. The check belongs where specs and
 *   board config meet, on the delegation surface.
 *
 * Both are called out on the PR rather than faked here. Refusing on a fact you
 * cannot see is how a guard becomes a silent no-op, which is the failure class
 * this whole issue exists to remove.
 */
import type { TaskWorker, TaskWorkerRegistry } from "../tasks";
import type { TaskBoardBacking } from "./index";

/**
 * How a worker's claimed task is executed.
 *
 * - `"inline"` — run inside the claiming request. The default, and what a bare
 *   worker value means.
 * - `"detached"` — run in a Workstream (a child session) that outlives the
 *   claiming request.
 */
export interface TaskWorkerDispatch {
  mode: "inline" | "detached";
}

/**
 * A worker plus its dispatch declaration. Accepted anywhere a bare
 * {@link TaskWorker} is, except as the top-level uniform `workers` value — see
 * {@link isTaskWorkerEntry} for why that one position is spelled differently.
 */
export interface TaskWorkerEntry<TIn = unknown, TOut = unknown> {
  worker: TaskWorker<TIn, TOut>;
  /** Omitted means `{ mode: "inline" }`. */
  dispatch?: TaskWorkerDispatch;
}

/** A worker slot: the bare block, or the block wrapped with its dispatch mode. */
export type TaskWorkerSlot<TIn = unknown, TOut = unknown> =
  | TaskWorker<TIn, TOut>
  | TaskWorkerEntry<TIn, TOut>;

/**
 * A worker registry that also accepts `{ worker, dispatch }` values.
 *
 * Deliberately **not** parameterized by the board's `TInput`/`TOutput`:
 * `TaskWorkerRegistry` is not either, because registry workers are
 * heterogeneous — each declares its own payload schema and the board's
 * generics describe the collection, not every route. Threading the board's
 * generics through here would reject registries that compile today.
 */
export type TaskWorkerSlotRegistry = Record<string, TaskWorkerSlot>;

/**
 * True when `slot` is a `{ worker, dispatch }` entry rather than a bare block.
 *
 * Discriminates the same way `isUniformWorker` does — on the substrate `run`
 * dispatch entry — so a *registry* whose keys happen to be `"worker"` and
 * `"dispatch"` cannot be mistaken for an entry: an entry's `worker` must itself
 * carry `run`, and the entry object itself must not.
 *
 * This is why a **uniform** worker declares detachment through the board-level
 * `dispatch` field instead of by wrapping. At the top level `workers: { worker:
 * block }` is genuinely ambiguous — a one-key registry routing assignee
 * `"worker"` and a uniform entry are the same object — and resolving that by
 * guessing would silently change how an existing board routes. The registry
 * position has no such ambiguity, because a registry *value* is never a
 * registry.
 */
export function isTaskWorkerEntry(slot: unknown): slot is TaskWorkerEntry {
  if (typeof slot !== "object" || slot === null) return false;
  const candidate = slot as { run?: unknown; worker?: { run?: unknown } };
  if (typeof candidate.run === "function") return false;
  return typeof candidate.worker?.run === "function";
}

/** Unwrap a worker slot into its block and whether it asked to be detached. */
export function resolveWorkerSlot(slot: TaskWorkerSlot): {
  worker: TaskWorker;
  detached: boolean;
} {
  if (isTaskWorkerEntry(slot)) {
    return { worker: slot.worker, detached: slot.dispatch?.mode === "detached" };
  }
  return { worker: slot as TaskWorker, detached: false };
}

/**
 * One declared worker, flattened: the block the drain composes, plus the
 * coordinate label the refusals report it under. The label is for error
 * messages only — the durable routing coordinate is P2's.
 */
export interface ResolvedWorkerSlot {
  /** `assignee:<name>`, `uniform`, or `floor`. Used in refusal messages. */
  label: string;
  worker: TaskWorker;
  detached: boolean;
}

/**
 * Flatten a board's worker declarations into the blocks the drain composes.
 *
 * Returns the bare-block shapes the existing `buildWorkerStep` already
 * understands, so unwrapping an entry costs the drain nothing: a board with no
 * entries produces exactly the values it was handed.
 */
export function resolveWorkerSlots(config: {
  workers: TaskWorker | Record<string, TaskWorkerSlot>;
  defaultWorker?: TaskWorkerSlot;
  /** Board-level dispatch. Uniform-worker boards only. */
  dispatch?: TaskWorkerDispatch;
}): {
  /** Ready for `buildWorkerStep` — entries unwrapped, bare values untouched. */
  workers: TaskWorker | TaskWorkerRegistry;
  defaultWorker?: TaskWorker;
  slots: ResolvedWorkerSlot[];
  detached: ResolvedWorkerSlot[];
} {
  const slots: ResolvedWorkerSlot[] = [];

  let workers: TaskWorker | TaskWorkerRegistry;
  if (typeof (config.workers as { run?: unknown }).run === "function") {
    const worker = config.workers as TaskWorker;
    workers = worker;
    slots.push({
      label: "uniform",
      worker,
      detached: config.dispatch?.mode === "detached",
    });
  } else {
    const registry: TaskWorkerRegistry = {};
    for (const [assignee, slot] of Object.entries(
      config.workers as Record<string, TaskWorkerSlot>
    )) {
      const resolved = resolveWorkerSlot(slot);
      registry[assignee] = resolved.worker;
      slots.push({ label: `assignee:${assignee}`, ...resolved });
    }
    workers = registry;
  }

  let defaultWorker: TaskWorker | undefined;
  if (config.defaultWorker !== undefined) {
    const resolved = resolveWorkerSlot(config.defaultWorker);
    defaultWorker = resolved.worker;
    slots.push({ label: "floor", ...resolved });
  }

  return {
    workers,
    ...(defaultWorker !== undefined ? { defaultWorker } : {}),
    slots,
    detached: slots.filter((slot) => slot.detached),
  };
}

/**
 * Read a worker block's authored `sessionStateSchema`.
 *
 * `BlockDefinition.config` is typed as the narrow `BlockConfig`, which omits
 * the scope-state schemas, but the builders spread the caller's whole config
 * onto it (`blocks/handler.ts`), so the authored value is there at runtime.
 * The cast is the read, not a widening of the public type.
 */
function authoredSessionStateSchema(worker: TaskWorker): unknown {
  return (worker.config as { sessionStateSchema?: unknown } | undefined)
    ?.sessionStateSchema;
}

/**
 * Construction-time refusals for a board with at least one detached worker.
 *
 * Every refusal is **by name and loud** — never a warning, never a degrade.
 * A board that quietly runs detached work on a backing that cannot settle it
 * fails only after the first restart, which is the shape decision 11 exists to
 * rule out.
 *
 * @throws {Error} naming the board, the offending declaration, and the fix.
 */
export function assertDetachedBoardSupported(options: {
  name: string;
  boardId: string | undefined;
  backing: TaskBoardBacking;
  detached: readonly ResolvedWorkerSlot[];
}): void {
  const { name, boardId, backing, detached } = options;
  if (detached.length === 0) return;

  const declared = detached.map((slot) => slot.label).join(", ");

  // A derived Workstream id is a hash of `(parentSessionId, boardId,
  // coordinate, topic)`. `name` is unique per flow rather than per session and
  // `collectionId` is the literal "factory-supplied" for every factory board,
  // so neither can stand in: the value lands in a persisted key and cannot be
  // an incidental string (decision 10).
  if (boardId === undefined || boardId.length === 0) {
    throw new Error(
      `[task-board] "${name}" declares detached workers (${declared}) but has no boardId — ` +
        `a detached board needs an explicit, stable boardId because it is hashed into the ` +
        `Workstream's session id. Renaming it re-keys live Workstreams.`
    );
  }

  // `backing: "resource"` is the only durable one. The default `request`
  // backing's lifetime IS the request, so a detached worker on it runs with
  // nothing able to settle or observe it; `sequencer` is per-invocation;
  // `factory` is caller-opaque, so the board cannot establish durability at
  // all (decision 3).
  if (backing !== "resource") {
    throw new Error(
      `[task-board] "${name}" declares detached workers (${declared}) on a ${backing}-backed ` +
        `collection — detached work outlives the request that claimed it, so the board must be ` +
        `durable. Pass a defineTaskCollection() to \`collection\`.`
    );
  }

  // Every detached worker in a flow becomes a route on ONE shared
  // WorkstreamFlow, so two routes declaring the same session-state key with
  // different shapes would corrupt each other silently — `createScopeStateOps`
  // performs no parse, so the collision is invisible at declaration, at `tsc`,
  // and at write time. One construction-time refusal is the whole fix for now;
  // key-shape compatibility validation is a follow-up nothing yet needs.
  for (const slot of detached) {
    if (authoredSessionStateSchema(slot.worker) !== undefined) {
      throw new Error(
        `[task-board] "${name}" detached worker ${slot.label} ("${slot.worker.name}") declares ` +
          `sessionStateSchema — detached workers share one Workstream flow, where two routes ` +
          `choosing the same key with different shapes corrupt each other with no error. ` +
          `Keep the worker's state on the task instead.`
      );
    }
  }
}
