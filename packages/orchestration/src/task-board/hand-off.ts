/**
 * The dispatcher seat: how a board hands a row off through the dispatch
 * protocol.
 *
 * A seat under `workers` is a block. A `dispatcher({ type: "task" })` in that
 * position is the seat that **hands off**: the board routes each row it claims
 * for the seat to that dispatcher, and the row runs in a child session, in the
 * block the flow declares at `flow.task.actions[target]`. A worker is just a
 * block; to run it elsewhere instead of inline, the seat holds a dispatcher.
 * This module owns three things and nothing else:
 *
 * 1. recognising a dispatcher seat among the slots `./detached.ts` already
 *    flattens — a bare block still means inline and a `{ worker, dispatch }`
 *    entry still means the detached mode, both untouched behind the D-8 fence;
 * 2. the board's "this row's work runs elsewhere" test for dispatcher seats,
 *    combined by the board with the detached mode's own;
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
 * A shared session serialises its rows: `defineFlow` defaults the entry a
 * `per-worker` or `key` seat hands off to `queue` concurrency (an explicit
 * policy on the entry wins), so two rows dispatched into one child do not
 * interleave their writes.
 */
import type { DispatchHandle } from "@flow-state-dev/core";
import type { BlockDefinition, DispatchAddress, TaskDispatchInput } from "@flow-state-dev/core/types";
import type { DefinedTaskCollection, Task, TaskWorker } from "../tasks";
import type { ResolvedWorkerSlot, TaskWorkerSlot } from "./detached";
import type { TaskBoardBacking } from "./index";

/** The address a `dispatcher({ type: "task" })` seat carries: its entry and session policy. */
export type TaskSeatAddress = Extract<DispatchAddress, { type: "task" }>;

/** The block `dispatcher({ type: "task" })` builds: its input is the claim envelope. */
export type TaskDispatcherBlock = BlockDefinition<any, any, TaskDispatchInput, DispatchHandle>;

/**
 * A worker registry whose values may also be task dispatchers, beside the
 * bare blocks and `{ worker, dispatch }` entries a registry already takes.
 *
 * Deliberately **not** parameterized by the board's `TInput`/`TOutput`:
 * registry workers are heterogeneous — each declares its own payload schema
 * and the board's generics describe the collection, not every route.
 */
export type TaskSeatRegistry = Record<string, TaskWorkerSlot | TaskDispatcherBlock>;

/**
 * True when `block` is a task dispatcher — a block carrying a `task` address —
 * and so a seat that hands off rather than runs inline.
 */
export function isTaskDispatcher(block: unknown): block is TaskWorker & { dispatch: TaskSeatAddress } {
  if (typeof block !== "object" || block === null) return false;
  const candidate = block as { run?: unknown; dispatch?: { type?: unknown } };
  return typeof candidate.run === "function" && candidate.dispatch?.type === "task";
}

/** One seat that hands off: its name, the dispatcher at it, and the address it carries. */
export interface HandOffSeat {
  /** The seat's assignee name — the row's `assignee`, which the hand-off is addressed by. */
  name: string;
  /** `assignee:<name>` — the readable form, for refusals. */
  label: string;
  block: TaskWorker;
  dispatch: TaskSeatAddress;
}

/**
 * The seats that hand off, in declaration order, read off the slots
 * `resolveWorkerSlots` flattened. A dispatcher is a block with a `task`
 * address, so the detached flattening already carried it through as a bare
 * inline block; this recognises it.
 *
 * A dispatcher at a seat that is not an assignee (uniform, floor) is returned
 * with an empty name so {@link assertHandOffBoardSupported} can refuse it by
 * its label.
 */
export function handOffSeats(slots: readonly ResolvedWorkerSlot[]): HandOffSeat[] {
  const seats: HandOffSeat[] = [];
  for (const slot of slots) {
    if (!isTaskDispatcher(slot.worker)) continue;
    seats.push({
      name: slot.coordinate.kind === "assignee" ? slot.coordinate.name : "",
      label: slot.label,
      block: slot.worker,
      dispatch: slot.worker.dispatch
    });
  }
  return seats;
}

/**
 * Build the board's "this row's work runs in a child session" test for its
 * dispatcher seats, or `undefined` when the board holds none.
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
  const declared = new Set<string>();
  const handedOff = new Set<string>();
  for (const slot of slots) {
    if (slot.coordinate.kind !== "assignee") continue;
    declared.add(slot.coordinate.name);
    if (isTaskDispatcher(slot.worker)) handedOff.add(slot.coordinate.name);
  }
  if (handedOff.size === 0) return undefined;

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
  handedOff: readonly HandOffSeat[];
}): void {
  const { name, boardId, backing, collection, handedOff } = options;
  if (handedOff.length === 0) return;

  const declared = handedOff.map((seat) => seat.label).join(", ");

  // A hand-off is addressed by its seat NAME — the row's assignee — so a seat
  // with no name has no address. Uniform and floor workers run inline.
  const unnamed = handedOff.filter((seat) => seat.name.length === 0);
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
  // out. `sharedToWorkstream` is the declaration that makes a session-scoped
  // ledger reachable from the child — it resolves to the lineage root, which
  // parent and child share.
  if (collection?.scope === "session" && collection.sharedToWorkstream !== true) {
    throw new Error(
      `[task-board] "${name}" hands off seats (${declared}) on a session-scoped ` +
        `collection — a child session would resolve an empty ledger and never find the row ` +
        `it was dispatched for. Add \`sharedToWorkstream: true\` so the ledger resolves to the ` +
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
