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
 * **No execution lives here.** The spawn is `blocks/spawn-detached.ts` and the
 * child's entry point is `detached-runner.ts`; this module only decides what a
 * declaration *means* and refuses the ones that cannot work. The refusals
 * landed before the mechanism did, deliberately — otherwise the first detached
 * board is built against a backing that cannot settle it.
 *
 * ## Where the refusals live, and why two of them are not here
 *
 * The spec (§6 decision 11, §8 P1) asks for six construction-time refusals.
 * Four of them are decidable from what `taskBoard()` is handed and are
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
import type {
  DefinedTaskCollection,
  Task,
  TaskWorker,
  TaskWorkerRegistry,
} from "../tasks";
import { coordinateLabel, type WorkerCoordinate } from "./coordinate";
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
 * routing coordinate that addresses it.
 */
export interface ResolvedWorkerSlot {
  /**
   * The durable routing coordinate (FIX-982 P2). Derived from the board's own
   * declarations — this is what a detached binding is keyed by, and what a wake
   * arriving after a restart resolves the worker through.
   */
  coordinate: WorkerCoordinate;
  /**
   * `assignee:<name>`, `uniform`, or `floor` — the readable form of
   * {@link coordinate}, used in refusal messages. Derived, not a second source
   * of truth.
   */
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
  const push = (coordinate: WorkerCoordinate, rest: { worker: TaskWorker; detached: boolean }) => {
    slots.push({ coordinate, label: coordinateLabel(coordinate), ...rest });
  };

  let workers: TaskWorker | TaskWorkerRegistry;
  if (typeof (config.workers as { run?: unknown }).run === "function") {
    const worker = config.workers as TaskWorker;
    workers = worker;
    push(
      { kind: "uniform" },
      { worker, detached: config.dispatch?.mode === "detached" }
    );
  } else {
    const registry: TaskWorkerRegistry = {};
    for (const [assignee, slot] of Object.entries(
      config.workers as Record<string, TaskWorkerSlot>
    )) {
      const resolved = resolveWorkerSlot(slot);
      registry[assignee] = resolved.worker;
      push({ kind: "assignee", name: assignee }, resolved);
    }
    workers = registry;
  }

  let defaultWorker: TaskWorker | undefined;
  if (config.defaultWorker !== undefined) {
    const resolved = resolveWorkerSlot(config.defaultWorker);
    defaultWorker = resolved.worker;
    push({ kind: "floor" }, resolved);
  }

  return {
    workers,
    ...(defaultWorker !== undefined ? { defaultWorker } : {}),
    slots,
    detached: slots.filter((slot) => slot.detached),
  };
}

/**
 * Build the board's "this row's work runs in a Workstream" test (FIX-982), or
 * `undefined` when the board declared nothing detached.
 *
 * **Derived from the board's own declarations plus the row's `assignee`, and
 * that is the durable part.** The tempting alternative is to read the row's
 * `claimedBy.sessionId` and call it detached when it differs from the drain's
 * own session — but nothing ever makes it differ. `claimedBy` is written only
 * by `applyClaimToTask`, inside `claim()`, and the Workstream never claims:
 * its start gate re-mints a ticket from the row it verified. So a handed-off
 * row still carries the session of the PARENT that claimed it, and a comparison
 * against the drain's own session is equal by construction — a test that reads
 * as a hand-off check and excludes nothing, on every board, forever.
 *
 * The assignee is a sound basis precisely because a detached board freezes it:
 * `setAssignee` declines `immutable-assignee` there, since the assignee is what
 * the routing coordinate derives from and the child session is keyed off that
 * coordinate at dispatch. So the value this reads cannot move under it, and it
 * survives a restart and a second drain over the same board with no run state
 * to rebuild.
 *
 * Resolution mirrors the runner's `coordinateForTask` — uniform, then a
 * declared assignee, then the floor — so the drain and the Workstream agree on
 * which worker a row belongs to. `undefined` for an all-inline board keeps
 * every existing board on the `count()` path it always used.
 *
 * @param slots EVERY resolved slot, not just the detached ones. The floor case
 *   is defined by the assignees it is *not*, so a detached-only list would read
 *   an inline registry worker as unrouted and send it to the floor.
 */
export function detachedTaskPredicate(
  slots: readonly ResolvedWorkerSlot[]
): ((task: Task) => boolean) | undefined {
  if (!slots.some((slot) => slot.detached)) return undefined;

  // A uniform board routes every row to its one worker, so the row never needs
  // reading.
  if (slots.some((slot) => slot.detached && slot.coordinate.kind === "uniform")) {
    return () => true;
  }

  const declared = new Set<string>();
  const detachedAssignees = new Set<string>();
  let floorDetached = false;
  for (const slot of slots) {
    if (slot.coordinate.kind === "assignee") {
      declared.add(slot.coordinate.name);
      if (slot.detached) detachedAssignees.add(slot.coordinate.name);
    }
    if (slot.coordinate.kind === "floor" && slot.detached) floorDetached = true;
  }

  return (task: Task): boolean => {
    // `Set.has` rather than a bare index, for the reason the drain and the
    // runner both use one: `assignee` reaches the board from a model-facing
    // tool, and an index would resolve an inherited `Object.prototype` member.
    if (task.assignee !== undefined && declared.has(task.assignee)) {
      return detachedAssignees.has(task.assignee);
    }
    return floorDetached;
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
 * The first block at or under `worker` that authors a session-state schema.
 *
 * Composed children are the reachable half of this refusal. A detached worker is
 * routinely a sequencer or a router, and the block that declares the schema is
 * usually a step inside it — which runs in the Workstream's session exactly as
 * the root does, and collides with a sibling route's key exactly as the root
 * would. Inspecting only the root accepted the board and left the declaration to
 * surface as a missing typed key inside the child.
 *
 * **Composition is walkable; capabilities are not.** A capability that
 * contributes `sessionStateSchema` — at its top level or through a preset —
 * never writes it onto the consuming block's `config`, so no walk of this shape
 * can see it. That is the same separate-channel problem `tools` has, and closing
 * it is a different piece of work: a preset's contribution is conditional on
 * runtime opt-out, so a definition-time walk of `__presetDefs` would refuse
 * boards whose preset never activates.
 *
 * Visited-set rather than a depth bound, for the reason the flow's own binding
 * walk uses one: blocks are shared and a router route may point back up.
 */
function nestedSessionStateSchema(
  worker: TaskWorker
): { block: { name: string }; schema: unknown } | undefined {
  const seen = new Set<unknown>();
  const queue: unknown[] = [worker];
  while (queue.length > 0) {
    const block = queue.pop();
    if (block == null || seen.has(block)) continue;
    seen.add(block);
    const schema = authoredSessionStateSchema(block as TaskWorker);
    if (schema !== undefined) {
      return { block: block as { name: string }, schema };
    }
    for (const child of (block as { childBlocks?: unknown[] }).childBlocks ?? []) {
      queue.push(child);
    }
  }
  return undefined;
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
  /**
   * The durable collection's own declaration, when the backing has one.
   *
   * The declaration rather than a field off it, so the predicate below can be
   * relaxed by reading one more thing about the collection instead of by
   * changing this signature and every caller.
   */
  collection?: DefinedTaskCollection;
  detached: readonly ResolvedWorkerSlot[];
}): void {
  const { name, boardId, backing, collection, detached } = options;
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

  // A Workstream runs in its OWN session, and a session-scoped collection
  // resolves against the running session — so the child would address an empty
  // ledger rather than the one that claimed the row. Nothing about that failure
  // announces itself: the start gate reads the missing row as a stale claim and
  // returns, the row stays `in_progress`, the next drain reclaims and
  // redispatches it, and the board loops until the abandonment cap finally
  // errors it out. A board that never dispatches is easier to fix than a board
  // that dispatches forever (FIX-1074).
  //
  // **One condition, deliberately.** A session-scoped collection becomes
  // REACHABLE FROM ITS WORKSTREAM the moment it resolves to the lineage root
  // rather than to the running session, because parent and child then address
  // the same rows. `sharedToWorkstream` is the declaration that says exactly
  // that, so the refusal is "session-scoped AND not resolving to the lineage
  // root" — the flag is not an override of this rule, it is the thing the rule
  // was always asking about.
  //
  // Reachable is all it becomes, and the word is chosen against the obvious
  // looser one: it says the child can FIND the row, not that the claim on it is
  // still live. The hand-off lease bound this module's runner documents
  // (FIX-1070 — nothing renews a detached row's lease between hand-off and the
  // child's first breath) applies to a lineage-rooted board exactly as it does
  // to a user- or org-scoped one. It is also the runner's own wording, so this
  // build-time refusal and the runtime stale-claim error name the same thing.
  if (collection?.scope === "session" && collection.sharedToWorkstream !== true) {
    throw new Error(
      `[task-board] "${name}" declares detached workers (${declared}) on a session-scoped ` +
        `collection — a Workstream runs in its own session, so it would resolve an empty ledger ` +
        `and never find the row it was dispatched for. Add \`sharedToWorkstream: true\` so the ` +
        `ledger resolves to the lineage root and the child addresses the same rows the board ` +
        `claimed, or declare the collection \`scope: "user"\` or \`scope: "org"\`.`
    );
  }

  // Every detached worker in a flow becomes a route on ONE shared
  // WorkstreamFlow, so two routes declaring the same session-state key with
  // different shapes would corrupt each other silently — `createScopeStateOps`
  // performs no parse, so the collision is invisible at declaration, at `tsc`,
  // and at write time. One construction-time refusal is the whole fix for now;
  // key-shape compatibility validation is a follow-up nothing yet needs.
  for (const slot of detached) {
    const authored = nestedSessionStateSchema(slot.worker);
    if (authored !== undefined) {
      const where =
        authored.block.name === slot.worker.name
          ? `("${slot.worker.name}")`
          : `("${slot.worker.name}", via composed block "${authored.block.name}")`;
      throw new Error(
        `[task-board] "${name}" detached worker ${slot.label} ${where} declares ` +
          `sessionStateSchema — detached workers share one Workstream flow, where two routes ` +
          `choosing the same key with different shapes corrupt each other with no error. ` +
          `Keep the worker's state on the task instead.`
      );
    }
  }
}
