/**
 * Hand-off declaration surface for `taskBoard`.
 *
 * A seat under `workers` is a block. A `dispatcher({ type: "task" })` in that
 * position is the seat that **hands off**: the board routes each row it claims
 * for the seat to that dispatcher, and the row runs in a child session, in the
 * block the flow declares at `flow.tasks[target]`. A worker is just a block;
 * to run it elsewhere instead of inline, the seat holds a dispatcher. This
 * module owns three things and nothing else:
 *
 * 1. reading a seat — an inline block, or a task dispatcher whose address says
 *    where its rows go — and refusing the removed seat shapes by name, so a
 *    bare worker value keeps meaning "inline" and no existing board needs
 *    editing;
 * 2. `resolveWorkerSlots`, which flattens a board's `workers` / `defaultWorker`
 *    config into the blocks the drain composes plus the seats that hand off;
 * 3. the construction-time refusals — `assertHandOffBoardSupported` for the
 *    board, `assertHandOffBlockSupported` for the entry block the gate is
 *    given.
 *
 * **No execution lives here.** The drain-side hand-off is `blocks/hand-off.ts`
 * and the child-side gate is `task-entry.ts`; this module only decides what a
 * declaration *means* and refuses the ones that cannot work.
 *
 * ## Where a handed-off seat's rows land
 *
 * The dispatcher's `session` policy decides which child session a row runs in.
 * Two questions decide it: does the work get its own request (yes, for every
 * task dispatcher), and what keys its session?
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
import type { DispatchHandle } from "@flow-state-dev/core";
import type { BlockDefinition, DispatchAddress, TaskDispatchInput } from "@flow-state-dev/core/types";
import type {
  DefinedTaskCollection,
  Task,
  TaskWorker,
  TaskWorkerRegistry,
} from "../tasks";
import type { TaskBoardBacking } from "./index";

/** The address a `dispatcher({ type: "task" })` seat carries: its entry and session policy. */
export type TaskSeatAddress = Extract<DispatchAddress, { type: "task" }>;

/** The block `dispatcher({ type: "task" })` builds: its input is the claim envelope. */
export type TaskDispatcherBlock = BlockDefinition<any, any, TaskDispatchInput, DispatchHandle>;

/** What a board seat holds: a worker that runs inline, or a task dispatcher that hands off. */
export type TaskSeat<TIn = unknown, TOut = unknown> = TaskWorker<TIn, TOut> | TaskDispatcherBlock;

/**
 * A worker registry whose values may also be task dispatchers.
 *
 * Deliberately **not** parameterized by the board's `TInput`/`TOutput`:
 * `TaskWorkerRegistry` is not either, because registry workers are
 * heterogeneous — each declares its own payload schema and the board's
 * generics describe the collection, not every route.
 */
export type TaskSeatRegistry = Record<string, TaskSeat>;

/**
 * True when `block` is a task dispatcher — a block carrying a `task` address —
 * and so a seat that hands off rather than runs inline.
 */
export function isTaskDispatcher(block: unknown): block is TaskWorker & { dispatch: TaskSeatAddress } {
  if (typeof block !== "object" || block === null) return false;
  const candidate = block as { run?: unknown; dispatch?: { type?: unknown } };
  return typeof candidate.run === "function" && candidate.dispatch?.type === "task";
}

/** Which slot on a board a worker occupies. */
export type WorkerSeat =
  | { readonly kind: "assignee"; readonly name: string }
  | { readonly kind: "uniform" }
  | { readonly kind: "floor" };

/**
 * One declared worker, flattened: the block at the seat, the seat, and — when
 * the block is a task dispatcher — the address its rows are handed off to.
 */
export interface ResolvedWorkerSlot {
  seat: WorkerSeat;
  /** `assignee:<name>`, `uniform`, or `floor` — the readable form, for refusals. */
  label: string;
  block: TaskWorker;
  /** Present exactly when the seat hands off. */
  dispatch?: TaskSeatAddress;
}

/** The readable form of a seat, for refusal messages and diagnostics. */
export function seatLabel(seat: WorkerSeat): string {
  return seat.kind === "assignee" ? `assignee:${seat.name}` : seat.kind;
}

/**
 * Read one seat's value: the block that runs there and, when the block is a
 * task dispatcher, where it hands off to.
 *
 * The removed seat shapes are refused by name rather than silently read as
 * inline (BP-030): a board that still says `{ block, session }`,
 * `{ worker, dispatch }` or `dispatch: { mode: "detached" }` would otherwise
 * run its worker in the drain and never hand off.
 */
export function resolveWorkerSlot(
  slot: unknown,
  where: string
): { block: TaskWorker; dispatch?: TaskSeatAddress } {
  if (isTaskDispatcher(slot)) return { block: slot, dispatch: slot.dispatch };
  if (typeof slot === "object" && slot !== null && typeof (slot as { run?: unknown }).run === "function") {
    return { block: slot as TaskWorker };
  }
  const fix =
    `A seat is a block. To run it inline, put the block there; to hand it off, put a ` +
    `\`dispatcher({ type: "task", target, session })\` there and declare the block on the flow ` +
    `as \`tasks: { [target]: { block } }\`.`;
  if (typeof slot === "object" && slot !== null) {
    const keys = Object.keys(slot);
    if (keys.includes("dispatch")) {
      throw new Error(
        `[task-board] ${where} uses the removed \`dispatch: { mode }\` option. ${fix}`
      );
    }
    if (keys.includes("block") || keys.includes("worker") || keys.includes("session")) {
      throw new Error(
        `[task-board] ${where} uses the removed \`{ ${keys.join(", ")} }\` seat shape. ${fix}`
      );
    }
  }
  throw new Error(`[task-board] ${where} is not a block (got ${describe(slot)}). ${fix}`);
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (typeof value !== "object") return typeof value;
  return `an object with keys ${JSON.stringify(Object.keys(value))}`;
}

/**
 * Flatten a board's worker declarations into the blocks the drain composes.
 *
 * Returns the bare-block shapes `buildWorkerStep` already understands — a task
 * dispatcher is a block like any other — so reading a seat costs the drain
 * nothing: a board with no dispatcher seats produces exactly the values it was
 * handed. The drain substitutes its own hand-off for each dispatcher seat when
 * it builds the routing table.
 */
export function resolveWorkerSlots(config: {
  name: string;
  workers: TaskWorker | TaskSeatRegistry;
  defaultWorker?: TaskWorker;
}): {
  /** Ready for `buildWorkerStep` — bare values untouched. */
  workers: TaskWorker | TaskWorkerRegistry;
  defaultWorker?: TaskWorker;
  slots: ResolvedWorkerSlot[];
  /** The slots that hand off, in declaration order. */
  handedOff: ResolvedWorkerSlot[];
} {
  const slots: ResolvedWorkerSlot[] = [];
  const push = (seat: WorkerSeat, resolved: { block: TaskWorker; dispatch?: TaskSeatAddress }) => {
    slots.push({ seat, label: seatLabel(seat), ...resolved });
  };

  let workers: TaskWorker | TaskWorkerRegistry;
  if (typeof (config.workers as { run?: unknown }).run === "function") {
    const resolved = resolveWorkerSlot(config.workers, `"${config.name}" workers`);
    workers = resolved.block;
    push({ kind: "uniform" }, resolved);
  } else {
    const registry: TaskWorkerRegistry = {};
    for (const [assignee, slot] of Object.entries(config.workers as Record<string, unknown>)) {
      const resolved = resolveWorkerSlot(slot, `"${config.name}" seat "${assignee}"`);
      registry[assignee] = resolved.block;
      push({ kind: "assignee", name: assignee }, resolved);
    }
    workers = registry;
  }

  let defaultWorker: TaskWorker | undefined;
  if (config.defaultWorker !== undefined) {
    const resolved = resolveWorkerSlot(config.defaultWorker, `"${config.name}" defaultWorker`);
    defaultWorker = resolved.block;
    push({ kind: "floor" }, resolved);
  }

  return {
    workers,
    ...(defaultWorker !== undefined ? { defaultWorker } : {}),
    slots,
    handedOff: slots.filter((slot) => slot.dispatch !== undefined),
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
 * the hand-off is addressed by. So the value this reads cannot move under it,
 * and it survives a restart and a second drain with no run state to rebuild.
 *
 * @param slots EVERY resolved slot, not just the handed-off ones. The floor case
 *   is defined by the assignees it is *not*, so a handed-off-only list would
 *   read an inline registry worker as unrouted and send it to the floor.
 */
export function handedOffTaskPredicate(
  slots: readonly ResolvedWorkerSlot[]
): ((task: Task) => boolean) | undefined {
  if (!slots.some((slot) => slot.dispatch !== undefined)) return undefined;

  const declared = new Set<string>();
  const handedOff = new Set<string>();
  for (const slot of slots) {
    if (slot.seat.kind !== "assignee") continue;
    declared.add(slot.seat.name);
    if (slot.dispatch !== undefined) handedOff.add(slot.seat.name);
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
 * Read a block's authored `sessionStateSchema`.
 *
 * `BlockDefinition.config` is typed as the narrow `BlockConfig`, which omits
 * the scope-state schemas, but the builders spread the caller's whole config
 * onto it (`blocks/handler.ts`), so the authored value is there at runtime.
 */
function authoredSessionStateSchema(block: TaskWorker): unknown {
  return (block.config as { sessionStateSchema?: unknown } | undefined)
    ?.sessionStateSchema;
}

/**
 * The first block at or under `root` that authors a session-state schema.
 *
 * Composed children are the reachable half of this refusal. A handed-off block
 * is routinely a sequencer or a router, and the block that declares the schema
 * is usually a step inside it — which runs in the child's session exactly as
 * the root does. Capabilities are not walkable here: a capability that
 * contributes `sessionStateSchema` never writes it onto the consuming block's
 * `config`, and a preset's contribution is conditional on runtime opt-out.
 */
function nestedSessionStateSchema(
  root: TaskWorker
): { block: { name: string }; schema: unknown } | undefined {
  const seen = new Set<unknown>();
  const queue: unknown[] = [root];
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
 * Construction-time refusals for a board with at least one dispatcher seat.
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

  // A hand-off is addressed by its seat NAME — the row's assignee — so a seat
  // with no name has no address. Uniform and floor workers run inline.
  const unnamed = handedOff.filter((slot) => slot.seat.kind !== "assignee");
  if (unnamed.length > 0) {
    throw new Error(
      `[task-board] "${name}" holds a task dispatcher at ${unnamed.map((s) => s.label).join(", ")}, ` +
        `but only a named seat can hand off — its name is the assignee the row is routed by. ` +
        `Declare it under \`workers: { <name>: dispatcher({ type: "task", … }) }\`.`
    );
  }

  // A child session id is derived from the key plus `boardId`, and the gate
  // the board binds is scoped to it, so the value lands in persisted keys and
  // in the flow definition. `name` is unique per flow rather than per session
  // and `collectionId` is the literal "factory-supplied" for every factory
  // board, so neither can stand in.
  if (boardId === undefined || boardId.length === 0) {
    throw new Error(
      `[task-board] "${name}" hands off seats (${declared}) but has no boardId — a board ` +
        `that hands off needs an explicit, stable boardId because it is hashed into the ` +
        `child session id and scopes the claim gate its entries run behind. Renaming it ` +
        `re-keys live child sessions.`
    );
  }

  // `backing: "resource"` is the only durable one. The default `request`
  // backing's lifetime IS the request, so a handed-off worker on it runs with
  // nothing able to settle or observe it; `sequencer` is per-invocation;
  // `factory` is caller-opaque, so the board cannot establish durability.
  if (backing !== "resource") {
    throw new Error(
      `[task-board] "${name}" hands off seats (${declared}) on a ${backing}-backed ` +
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
      `[task-board] "${name}" hands off seats (${declared}) on a session-scoped ` +
        `collection — a child session would resolve an empty ledger and never find the row ` +
        `it was dispatched for. Add \`sharedToLineage: true\` so the ledger resolves to the ` +
        `lineage root and the child addresses the same rows the board claimed, or declare ` +
        `the collection \`scope: "user"\` or \`scope: "org"\`.`
    );
  }
}

/**
 * The refusal the board's claim gate applies to the entry block it is put in
 * front of, at `defineFlow`.
 *
 * A handed-off block runs in a session it may share with other rows (the
 * per-key and per-worker policies), so two blocks declaring the same
 * session-state key with different shapes would corrupt each other silently —
 * `createScopeStateOps` performs no parse. Keep the block's state on the task
 * instead. Checked at definition rather than at `taskBoard()` because the
 * block lives on the flow, not the board.
 *
 * @throws {Error} naming the board, the entry, the block, and the fix.
 */
export function assertHandOffBlockSupported(options: {
  name: string;
  /** The entry's name on the flow. */
  target: string;
  block: TaskWorker;
}): void {
  const { name, target, block } = options;
  const authored = nestedSessionStateSchema(block);
  if (authored === undefined) return;
  const where =
    authored.block.name === block.name
      ? `("${block.name}")`
      : `("${block.name}", via composed block "${authored.block.name}")`;
  throw new Error(
    `[task-board] "${name}" hands off to task entry "${target}" ${where}, which declares ` +
      `sessionStateSchema — a handed-off block runs in a child session it may share with ` +
      `other rows, where two blocks choosing the same key with different shapes corrupt ` +
      `each other with no error. Keep the block's state on the task instead.`
  );
}
