/**
 * Hand-off declaration surface for `taskBoard`.
 *
 * A board declares that a worker runs **in a session of its own** — outside the
 * request that claimed its task — by wrapping the worker in a
 * `{ block, session }` seat. This module owns three things and nothing else:
 *
 * 1. the seat shape and its runtime narrowing, so a bare worker value keeps
 *    meaning "inline" and no existing board needs editing;
 * 2. `resolveWorkerSlots`, which flattens a board's `workers` / `defaultWorker`
 *    config into the worker blocks the drain composes plus the set that hand
 *    off;
 * 3. `assertHandOffBoardSupported`, the construction-time refusals.
 *
 * **No execution lives here.** The drain-side dispatch is `blocks/hand-off.ts`
 * and the child-side entry is `task-entry.ts`; this module only decides what a
 * declaration *means* and refuses the ones that cannot work.
 *
 * ## Where a handed-off worker's tasks land
 *
 * The seat's `session` policy decides which child session a row runs in. Two
 * questions decide it: does the work get its own request (yes, for every
 * seat declared here), and what keys its session?
 *
 * | `session`         | keyed on                                   | use it when |
 * |-------------------|--------------------------------------------|-------------|
 * | `"per-task"`      | the task id                                | work is independent — a checkout per issue |
 * | `"per-worker"`    | this seat, one child per claiming session  | the worker should remember what it already did |
 * | `{ key: fn }`     | a value the function reads off the task    | one issue across spec, implement and review |
 *
 * A shared session wants `queue` concurrency on its entry rather than the
 * `allow` default, or two tasks dispatched into it interleave their writes.
 */
import type {
  DefinedTaskCollection,
  Task,
  TaskWorker,
  TaskWorkerInput,
  TaskWorkerRegistry,
} from "../tasks";
import type { TaskBoardBacking } from "./index";

/**
 * Which child session a handed-off seat's rows run in. See the module header.
 * The `key` form receives the packed worker input — the same value the worker
 * sees — so a key can read the task id, its `input`, or its `metadata`.
 */
export type TaskSessionPolicy =
  | "per-task"
  | "per-worker"
  | { readonly key: (task: TaskWorkerInput) => string };

/**
 * A worker plus the session policy that hands it off. Accepted as a registry
 * value under `workers`; a bare {@link TaskWorker} in the same position runs
 * inline in the claiming drain's request.
 */
export interface TaskWorkerEntry<TIn = unknown, TOut = unknown> {
  block: TaskWorker<TIn, TOut>;
  /** Present on every entry: an entry that does not name a session runs inline as a bare worker. */
  session: TaskSessionPolicy;
}

/** A worker slot: the bare block, or the block wrapped with its session policy. */
export type TaskWorkerSlot<TIn = unknown, TOut = unknown> =
  | TaskWorker<TIn, TOut>
  | TaskWorkerEntry<TIn, TOut>;

/**
 * A worker registry that also accepts `{ block, session }` values.
 *
 * Deliberately **not** parameterized by the board's `TInput`/`TOutput`:
 * `TaskWorkerRegistry` is not either, because registry workers are
 * heterogeneous — each declares its own payload schema and the board's
 * generics describe the collection, not every route.
 */
export type TaskWorkerSlotRegistry = Record<string, TaskWorkerSlot>;

/**
 * True when `slot` is a `{ block, session }` entry rather than a bare block.
 *
 * Discriminates on the substrate `run` dispatch entry — an entry's `block`
 * must itself carry `run`, and the entry object itself must not — so a
 * *registry* whose keys happen to be `"block"` and `"session"` cannot be
 * mistaken for an entry: a registry *value* is never a registry.
 */
export function isTaskWorkerEntry(slot: unknown): slot is TaskWorkerEntry {
  if (typeof slot !== "object" || slot === null) return false;
  const candidate = slot as { run?: unknown; block?: { run?: unknown } };
  if (typeof candidate.run === "function") return false;
  return typeof candidate.block?.run === "function";
}

/** Unwrap a worker slot into its block and, when it hands off, its session policy. */
export function resolveWorkerSlot(slot: TaskWorkerSlot): {
  block: TaskWorker;
  session?: TaskSessionPolicy;
} {
  if (!isTaskWorkerEntry(slot)) return { block: slot as TaskWorker };

  // The removed shape, refused by name rather than silently read as inline
  // (BP-030): a board that still says `dispatch: { mode: "detached" }` would
  // otherwise run its worker in the drain and never hand off.
  if (Object.hasOwn(slot, "dispatch")) {
    throw new Error(
      `[task-board] a worker entry uses the removed \`dispatch: { mode }\` option. ` +
        `A worker hands off by naming the session it runs in: ` +
        `\`{ block, session: "per-task" | "per-worker" | { key: (task) => string } }\`.`
    );
  }
  const session = (slot as { session?: unknown }).session;
  if (!isSessionPolicy(session)) {
    throw new Error(
      `[task-board] a worker entry must declare \`session\` ("per-task", "per-worker", or ` +
        `{ key: (task) => string }). A bare block runs inline; wrap it only to hand it off.`
    );
  }
  return { block: slot.block, session };
}

function isSessionPolicy(value: unknown): value is TaskSessionPolicy {
  if (value === "per-task" || value === "per-worker") return true;
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { key?: unknown }).key === "function"
  );
}

/** Which slot on a board a worker occupies. */
export type WorkerSeat =
  | { readonly kind: "assignee"; readonly name: string }
  | { readonly kind: "uniform" }
  | { readonly kind: "floor" };

/**
 * One declared worker, flattened: the block the drain composes, its seat, and
 * — when it hands off — the session policy its rows run under.
 */
export interface ResolvedWorkerSlot {
  seat: WorkerSeat;
  /** `assignee:<name>`, `uniform`, or `floor` — the readable form, for refusals. */
  label: string;
  block: TaskWorker;
  /** Present exactly when the seat hands off. */
  session?: TaskSessionPolicy;
}

/** The readable form of a seat, for refusal messages and diagnostics. */
export function seatLabel(seat: WorkerSeat): string {
  return seat.kind === "assignee" ? `assignee:${seat.name}` : seat.kind;
}

/**
 * Flatten a board's worker declarations into the blocks the drain composes.
 *
 * Returns the bare-block shapes `buildWorkerStep` already understands, so
 * unwrapping an entry costs the drain nothing: a board with no entries produces
 * exactly the values it was handed.
 */
export function resolveWorkerSlots(config: {
  workers: TaskWorker | Record<string, TaskWorkerSlot>;
  defaultWorker?: TaskWorkerSlot;
}): {
  /** Ready for `buildWorkerStep` — entries unwrapped, bare values untouched. */
  workers: TaskWorker | TaskWorkerRegistry;
  defaultWorker?: TaskWorker;
  slots: ResolvedWorkerSlot[];
  /** The slots that hand off, in declaration order. */
  handedOff: ResolvedWorkerSlot[];
} {
  const slots: ResolvedWorkerSlot[] = [];
  const push = (seat: WorkerSeat, resolved: { block: TaskWorker; session?: TaskSessionPolicy }) => {
    slots.push({ seat, label: seatLabel(seat), ...resolved });
  };

  let workers: TaskWorker | TaskWorkerRegistry;
  if (typeof (config.workers as { run?: unknown }).run === "function") {
    const worker = config.workers as TaskWorker;
    workers = worker;
    push({ kind: "uniform" }, { block: worker });
  } else {
    const registry: TaskWorkerRegistry = {};
    for (const [assignee, slot] of Object.entries(
      config.workers as Record<string, TaskWorkerSlot>
    )) {
      const resolved = resolveWorkerSlot(slot);
      registry[assignee] = resolved.block;
      push({ kind: "assignee", name: assignee }, resolved);
    }
    workers = registry;
  }

  let defaultWorker: TaskWorker | undefined;
  if (config.defaultWorker !== undefined) {
    const resolved = resolveWorkerSlot(config.defaultWorker);
    defaultWorker = resolved.block;
    push({ kind: "floor" }, resolved);
  }

  return {
    workers,
    ...(defaultWorker !== undefined ? { defaultWorker } : {}),
    slots,
    handedOff: slots.filter((slot) => slot.session !== undefined),
  };
}

/**
 * Build the board's "this row's work runs in a child session" test, or
 * `undefined` when the board hands nothing off.
 *
 * **Derived from the board's own declarations plus the row's `assignee`, and
 * that is the durable part.** The tempting alternative is to read the row's
 * `claimedBy.sessionId` and call it handed off when it differs from the drain's
 * own session — but nothing ever makes it differ: `claimedBy` is written only
 * by `claim()`, and the child never claims; its gate re-mints a ticket from the
 * row it verified. So a handed-off row still carries the session of the PARENT
 * that claimed it.
 *
 * The assignee is a sound basis precisely because a hand-off board freezes it:
 * `setAssignee` declines `immutable-assignee` there, since the assignee is what
 * the task entry is addressed by. So the value this reads cannot move under it,
 * and it survives a restart and a second drain with no run state to rebuild.
 *
 * @param slots EVERY resolved slot, not just the handed-off ones. The floor case
 *   is defined by the assignees it is *not*, so a handed-off-only list would
 *   read an inline registry worker as unrouted and send it to the floor.
 */
export function handedOffTaskPredicate(
  slots: readonly ResolvedWorkerSlot[]
): ((task: Task) => boolean) | undefined {
  if (!slots.some((slot) => slot.session !== undefined)) return undefined;

  const declared = new Set<string>();
  const handedOff = new Set<string>();
  for (const slot of slots) {
    if (slot.seat.kind !== "assignee") continue;
    declared.add(slot.seat.name);
    if (slot.session !== undefined) handedOff.add(slot.seat.name);
  }

  return (task: Task): boolean => {
    // `Set.has` rather than a bare index: `assignee` reaches the board from a
    // model-facing tool, and an index would resolve an inherited
    // `Object.prototype` member.
    if (task.assignee !== undefined && declared.has(task.assignee)) {
      return handedOff.has(task.assignee);
    }
    // Only a named seat hands off — see `assertHandOffBoardSupported`.
    return false;
  };
}

/**
 * Read a worker block's authored `sessionStateSchema`.
 *
 * `BlockDefinition.config` is typed as the narrow `BlockConfig`, which omits
 * the scope-state schemas, but the builders spread the caller's whole config
 * onto it (`blocks/handler.ts`), so the authored value is there at runtime.
 */
function authoredSessionStateSchema(worker: TaskWorker): unknown {
  return (worker.config as { sessionStateSchema?: unknown } | undefined)
    ?.sessionStateSchema;
}

/**
 * The first block at or under `worker` that authors a session-state schema.
 *
 * Composed children are the reachable half of this refusal. A handed-off worker
 * is routinely a sequencer or a router, and the block that declares the schema
 * is usually a step inside it — which runs in the child's session exactly as
 * the root does. Capabilities are not walkable here: a capability that
 * contributes `sessionStateSchema` never writes it onto the consuming block's
 * `config`, and a preset's contribution is conditional on runtime opt-out.
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
 * Construction-time refusals for a board with at least one handed-off worker.
 *
 * Every refusal is **by name and loud** — never a warning, never a degrade.
 * A board that quietly runs handed-off work on a backing that cannot settle it
 * fails only after the first restart.
 *
 * @throws {Error} naming the board, the offending declaration, and the fix.
 */
export function assertHandOffBoardSupported(options: {
  name: string;
  boardId: string | undefined;
  backing: TaskBoardBacking;
  /** The durable collection's own declaration, when the backing has one. */
  collection?: DefinedTaskCollection;
  handedOff: readonly ResolvedWorkerSlot[];
}): void {
  const { name, boardId, backing, collection, handedOff } = options;
  if (handedOff.length === 0) return;

  const declared = handedOff.map((slot) => slot.label).join(", ");

  // A task entry is addressed by its seat NAME — `flow.tasks[name]` — so a
  // worker with no name has no address. Uniform and floor workers run inline.
  const unnamed = handedOff.filter((slot) => slot.seat.kind !== "assignee");
  if (unnamed.length > 0) {
    throw new Error(
      `[task-board] "${name}" hands off ${unnamed.map((s) => s.label).join(", ")}, but only a ` +
        `named worker can hand off — its name is the task entry the flow declares ` +
        `(\`flow.tasks.<name>\`). Declare it under \`workers: { <name>: { block, session } }\`.`
    );
  }

  // A child session id is derived from the key plus `boardId`, and the entry
  // the board produces is branded with it, so the value lands in persisted
  // keys and in the flow definition. `name` is unique per flow rather than
  // per session and `collectionId` is the literal "factory-supplied" for every
  // factory board, so neither can stand in.
  if (boardId === undefined || boardId.length === 0) {
    throw new Error(
      `[task-board] "${name}" hands off workers (${declared}) but has no boardId — a board ` +
        `that hands off needs an explicit, stable boardId because it is hashed into the ` +
        `child session id and brands the task entries it produces. Renaming it re-keys ` +
        `live child sessions.`
    );
  }

  // `backing: "resource"` is the only durable one. The default `request`
  // backing's lifetime IS the request, so a handed-off worker on it runs with
  // nothing able to settle or observe it; `sequencer` is per-invocation;
  // `factory` is caller-opaque, so the board cannot establish durability.
  if (backing !== "resource") {
    throw new Error(
      `[task-board] "${name}" hands off workers (${declared}) on a ${backing}-backed ` +
        `collection — handed-off work outlives the request that claimed it, so the board ` +
        `must be durable. Pass a defineTaskCollection() to \`collection\`.`
    );
  }

  // The child runs in its OWN session, and a session-scoped collection
  // resolves against the running session — so the child would address an
  // empty ledger rather than the one that claimed the row. Nothing about that
  // failure announces itself: the gate reads the missing row as a stale claim
  // and returns, the row stays `in_progress`, the next drain reclaims and
  // redispatches it, and the board loops until the abandonment cap errors it
  // out. `sharedToLineage` is the declaration that makes a session-scoped
  // ledger reachable from the child — it resolves to the lineage root, which
  // parent and child share.
  if (collection?.scope === "session" && collection.sharedToLineage !== true) {
    throw new Error(
      `[task-board] "${name}" hands off workers (${declared}) on a session-scoped ` +
        `collection — a child session would resolve an empty ledger and never find the row ` +
        `it was dispatched for. Add \`sharedToLineage: true\` so the ledger resolves to the ` +
        `lineage root and the child addresses the same rows the board claimed, or declare ` +
        `the collection \`scope: "user"\` or \`scope: "org"\`.`
    );
  }

  // A handed-off worker runs in a session it may share with other rows (the
  // per-key and per-worker policies), so two workers declaring the same
  // session-state key with different shapes would corrupt each other silently
  // — `createScopeStateOps` performs no parse. Keep the worker's state on the
  // task instead.
  for (const slot of handedOff) {
    const authored = nestedSessionStateSchema(slot.block);
    if (authored !== undefined) {
      const where =
        authored.block.name === slot.block.name
          ? `("${slot.block.name}")`
          : `("${slot.block.name}", via composed block "${authored.block.name}")`;
      throw new Error(
        `[task-board] "${name}" handed-off worker ${slot.label} ${where} declares ` +
          `sessionStateSchema — a handed-off worker runs in a child session it may share with ` +
          `other rows, where two workers choosing the same key with different shapes corrupt ` +
          `each other with no error. Keep the worker's state on the task instead.`
      );
    }
  }
}
