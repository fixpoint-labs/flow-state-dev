/**
 * The dispatcher assignee: how a board dispatches a row through the dispatch
 * protocol.
 *
 * An assignee under `workers` is a block. A `dispatcher({ type: "task" })` in that
 * position is the assignee that **dispatches**: the board routes each row it claims
 * for the assignee to that dispatcher, and the row runs in a child session, in the
 * block the flow declares at `flow.task.actions[action]`. A worker is just a
 * block; to run it elsewhere instead of inline, the assignee holds a dispatcher,
 * on a board that declares `mode: "delegation"` (`./board-mode`).
 * This module owns two things and nothing else:
 *
 * 1. reading a board's assignees — a bare block means inline, a dispatcher
 *    dispatches, and the removed assignee shapes are refused by name;
 * 2. the construction-time refusals — `assertDispatchBoardSupported` for the
 *    board, `assertDispatchEntrySupported` for the entry block the gate is
 *    given.
 *
 * **No execution lives here.** The drain-side dispatch is `blocks/dispatch-row.ts`
 * and the child-side gate is `task-entry.ts`; this module only decides what a
 * declaration *means* and refuses the ones that cannot work.
 *
 * ## Where a dispatched assignee's rows land
 *
 * The dispatcher's `session` policy decides which child session a row runs in.
 * Two questions decide it: does the work get its own request (yes, for every
 * task dispatcher), and what keys its session?
 *
 * | `session`         | keyed on                                   | use it when |
 * |-------------------|--------------------------------------------|-------------|
 * | `"per-task"`      | the task id                                | work is independent — a checkout per issue |
 * | `"per-worker"`    | this assignee, one child per claiming session  | the worker should remember what it already did |
 * | `{ key: fn }`     | a value the function reads off the task    | one issue across spec, implement and review |
 * | `{ by: fn }`      | per row: a key, or an existing session's id | some rows run apart, others join a running session |
 *
 * The entry is declared the same way: a string `action`, or `{ among, by }`,
 * which picks one of the declared names per row.
 *
 * A shared session serialises its rows: `defineFlow` defaults the entry a
 * `per-worker`, `key` or `by` assignee dispatches to `queue` concurrency (an explicit
 * policy on the entry wins), so two rows dispatched into one child do not
 * interleave their writes.
 */
import { getBaseCapability, type DispatchHandle } from "@flow-state-dev/core";
import type { BlockDefinition, DispatchAddress, TaskDispatchInput } from "@flow-state-dev/core/types";
import type { DefinedTaskCollection, TaskWorker, TaskWorkerRegistry } from "../tasks";
import type { TaskBoardBacking } from "./index";

/** The address a `dispatcher({ type: "task" })` assignee carries: its entry and session policy. */
export type TaskAssigneeAddress = Extract<DispatchAddress, { type: "task" }>;

/** The block `dispatcher({ type: "task" })` builds: its input is the claim envelope. */
export type TaskDispatcherBlock = BlockDefinition<any, any, TaskDispatchInput, DispatchHandle>;

/** What a board assignee holds: a worker that runs inline, or a task dispatcher that dispatches. */
export type TaskAssignee<TIn = unknown, TOut = unknown> = TaskWorker<TIn, TOut> | TaskDispatcherBlock;

/**
 * A worker registry whose values may also be task dispatchers.
 *
 * Deliberately **not** parameterized by the board's `TInput`/`TOutput`:
 * `TaskWorkerRegistry` is not either, because registry workers are
 * heterogeneous — each declares its own payload schema and the board's
 * generics describe the collection, not every route.
 */
export type TaskAssigneeRegistry = Record<string, TaskAssignee>;

/**
 * True when `block` is a task dispatcher — a block carrying a `task` address —
 * and so an assignee that dispatches rather than runs inline.
 */
export function isTaskDispatcher(block: unknown): block is TaskWorker & { dispatch: TaskAssigneeAddress } {
  if (typeof block !== "object" || block === null) return false;
  const candidate = block as { run?: unknown; dispatch?: { type?: unknown } };
  return typeof candidate.run === "function" && candidate.dispatch?.type === "task";
}

/** One assignee that dispatches: its assignee name and the address it carries. */
export interface DispatchingAssignee {
  /**
   * The assignee's name — the row's `assignee`, which the dispatch is
   * addressed by. Empty when the dispatcher sat at a uniform or floor assignee.
   */
  name: string;
  /**
   * Where the dispatcher sat: a named assignee, the uniform `workers` block,
   * the `defaultWorker` fallback, or a plan board's `newSession` (FIX-2082),
   * which takes the rows filed `session: "new"`. What every reader branches on.
   */
  kind: "named" | "uniform" | "floor" | "newSession";
  /** `assignee:<name>`, `uniform`, `floor` or `newSession` — the readable form, for refusals. Never branched on. */
  label: string;
  dispatch: TaskAssigneeAddress;
}

/**
 * Read one assignee's value: the block that runs there and, when the block is a
 * task dispatcher, where it dispatches to.
 *
 * The removed assignee shapes are refused by name rather than silently read as
 * inline (BP-030): a board that still says `{ block, session }`,
 * `{ worker, dispatch }` or `dispatch: { mode: "detached" }` would otherwise
 * run its worker in the drain and never dispatch.
 */
export function resolveWorkerSlot(
  slot: unknown,
  where: string
): { block: TaskWorker; dispatch?: TaskAssigneeAddress } {
  if (isTaskDispatcher(slot)) return { block: slot, dispatch: slot.dispatch };
  if (typeof slot === "object" && slot !== null && typeof (slot as { run?: unknown }).run === "function") {
    return { block: slot as TaskWorker };
  }
  const fix =
    `An assignee is a block. To run it inline, put the block there; to dispatch it, put a ` +
    `\`dispatcher({ action, session })\` there and declare the block on the flow ` +
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
        `[task-board] ${where} uses the removed \`{ ${keys.join(", ")} }\` assignee shape. ${fix}`
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
 * Flatten a board's worker declarations into the blocks the drain composes
 * and the assignees that dispatch.
 *
 * Returns the bare-block shapes `buildWorkerStep` already understands — a task
 * dispatcher is a block like any other — so reading an assignee costs the drain
 * nothing: a board with no dispatcher assignees produces exactly the values it was
 * handed. A dispatcher at a position that is not a named assignee (uniform, floor) is
 * collected with an empty name so {@link assertDispatchBoardSupported} can
 * refuse it by its label.
 */
export function resolveWorkerSlots(config: {
  name: string;
  workers: TaskWorker | TaskAssigneeRegistry;
  defaultWorker?: TaskWorker;
}): {
  /** Ready for `buildWorkerStep` — bare values untouched. */
  workers: TaskWorker | TaskWorkerRegistry;
  defaultWorker?: TaskWorker;
  dispatchers: DispatchingAssignee[];
  /** The named assignees that run in the drain: named, and not a dispatcher. */
  inline: string[];
} {
  const dispatchers: DispatchingAssignee[] = [];
  const inline: string[] = [];
  const take = (
    name: string,
    kind: DispatchingAssignee["kind"],
    label: string,
    resolved: { block: TaskWorker; dispatch?: TaskAssigneeAddress }
  ) => {
    if (resolved.dispatch === undefined) {
      if (kind === "named") inline.push(name);
      return;
    }
    dispatchers.push({ name, kind, label, dispatch: resolved.dispatch });
  };

  let workers: TaskWorker | TaskWorkerRegistry;
  if (typeof (config.workers as { run?: unknown }).run === "function") {
    const resolved = resolveWorkerSlot(config.workers, `"${config.name}" workers`);
    workers = resolved.block;
    take("", "uniform", "uniform", resolved);
  } else {
    const registry: TaskWorkerRegistry = {};
    for (const [assignee, slot] of Object.entries(config.workers as Record<string, unknown>)) {
      const resolved = resolveWorkerSlot(slot, `"${config.name}" assignee "${assignee}"`);
      registry[assignee] = resolved.block;
      take(assignee, "named", `assignee:${assignee}`, resolved);
    }
    workers = registry;
  }

  let defaultWorker: TaskWorker | undefined;
  if (config.defaultWorker !== undefined) {
    const resolved = resolveWorkerSlot(config.defaultWorker, `"${config.name}" defaultWorker`);
    defaultWorker = resolved.block;
    take("", "floor", "floor", resolved);
  }

  return {
    workers,
    ...(defaultWorker !== undefined ? { defaultWorker } : {}),
    dispatchers,
    inline,
  };
}

/**
 * Read a block's authored `sessionStateSchema`.
 *
 * `BlockDefinition.config` is typed as the narrow `BlockConfig`, which omits
 * the scope-state schemas, but the builders spread the caller's whole config
 * onto it (`blocks/handler.ts`), so the authored value is there at runtime.
 */
function authoredSessionStateSchema(
  block: TaskWorker
): { schema: unknown; capability?: string } | undefined {
  const config = block.config as
    | { sessionStateSchema?: unknown; __resolvedCapabilities?: unknown[] }
    | undefined;
  if (config?.sessionStateSchema !== undefined) return { schema: config.sessionStateSchema };
  // A capability's own top-level schema is unconditional whenever the
  // capability is used, so it is as walkable as the block's. (A preset's
  // contribution is not: it is conditional on runtime opt-out.)
  for (const ref of config?.__resolvedCapabilities ?? []) {
    const base = getBaseCapability(ref as Parameters<typeof getBaseCapability>[0]);
    if (base.sessionStateSchema !== undefined) {
      return { schema: base.sessionStateSchema, capability: base.name };
    }
  }
  return undefined;
}

/**
 * The first block at or under `root` that authors a session-state schema.
 *
 * Composed children are the reachable half of this refusal. A dispatched block
 * is routinely a sequencer or a router, and the block that declares the schema
 * is usually a step inside it — which runs in the child's session exactly as
 * the root does. A capability a block `uses` is read through the block's
 * resolved capabilities, for its own top-level schema; a preset's contribution
 * is conditional on runtime opt-out and is not walked.
 */
function nestedSessionStateSchema(
  root: TaskWorker
): { block: { name: string }; schema: unknown; capability?: string } | undefined {
  const seen = new Set<unknown>();
  const queue: unknown[] = [root];
  while (queue.length > 0) {
    const block = queue.pop();
    if (block == null || seen.has(block)) continue;
    seen.add(block);
    const authored = authoredSessionStateSchema(block as TaskWorker);
    if (authored !== undefined) {
      return { block: block as { name: string }, ...authored };
    }
    for (const child of (block as { childBlocks?: unknown[] }).childBlocks ?? []) {
      queue.push(child);
    }
  }
  return undefined;
}

/**
 * Construction-time refusals for a board with at least one dispatcher assignee.
 *
 * Every refusal is **by name and loud** — never a warning, never a degrade.
 * A board that quietly runs dispatched work on a backing that cannot settle it
 * fails only after the first restart.
 *
 * @throws {Error} naming the board, the offending declaration, and the fix.
 */
export function assertDispatchBoardSupported(options: {
  name: string;
  boardId: string | undefined;
  backing: TaskBoardBacking;
  /** The durable collection's own declaration, when the backing has one. */
  collection?: DefinedTaskCollection;
  dispatchers: readonly DispatchingAssignee[];
}): void {
  const { name, boardId, backing, collection, dispatchers } = options;
  if (dispatchers.length === 0) return;

  const declared = dispatchers.map((assignee) => assignee.label).join(", ");

  // A dispatch is addressed by the row's assignee: a named assignee's name, or,
  // for the fallback, the assignee the row was claimed with. A uniform worker
  // stands in for every row whatever it names, so it has no address.
  const unnamed = dispatchers.filter((assignee) => assignee.kind === "uniform");
  if (unnamed.length > 0) {
    throw new Error(
      `[task-board] "${name}" holds a task dispatcher at ${unnamed.map((s) => s.label).join(", ")}, ` +
        `but a uniform worker cannot dispatch — a dispatch is addressed by the row's assignee. ` +
        `Declare it under \`workers: { <name>: dispatcher({ action, session }) }\`, or as the ` +
        `\`defaultWorker\`, which hands each row over under the assignee it names.`
    );
  }

  // A child session id is derived from the key plus `boardId`, and the gate
  // the board binds is scoped to it, so the value lands in persisted keys and
  // in the flow definition. `name` is unique per flow rather than per session
  // and `collectionId` is the literal "factory-supplied" for every factory
  // board, so neither can stand in.
  if (boardId === undefined || boardId.length === 0) {
    throw new Error(
      `[task-board] "${name}" dispatches assignees (${declared}) but has no boardId — a board ` +
        `that dispatches needs an explicit, stable boardId because it is hashed into the ` +
        `child session id and scopes the claim gate its entries run behind. Renaming it ` +
        `re-keys live child sessions.`
    );
  }

  // `backing: "resource"` is the only durable one. The default `request`
  // backing's lifetime IS the request, so a dispatched worker on it runs with
  // nothing able to settle or observe it; `sequencer` is per-invocation;
  // `factory` is caller-opaque, so the board cannot establish durability.
  if (backing !== "resource") {
    throw new Error(
      `[task-board] "${name}" dispatches assignees (${declared}) on a ${backing}-backed ` +
        `collection — dispatched work outlives the request that claimed it, so the board ` +
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
      `[task-board] "${name}" dispatches assignees (${declared}) on a session-scoped ` +
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
 * A dispatched block runs in a session it may share with other rows (the
 * per-key and per-worker policies), so two blocks declaring the same
 * session-state key with different shapes would corrupt each other silently —
 * `createScopeStateOps` performs no parse. Keep the block's state on the task
 * instead. Checked at definition rather than at `taskBoard()` because the
 * block lives on the flow, not the board.
 *
 * @throws {Error} naming the board, the entry, the block, and the fix.
 */
export function assertDispatchEntrySupported(options: {
  name: string;
  /** The entry's name on the flow. */
  target: string;
  block: TaskWorker;
}): void {
  const { name, target, block } = options;
  const authored = nestedSessionStateSchema(block);
  if (authored === undefined) return;
  const via =
    authored.capability !== undefined
      ? `, via capability "${authored.capability}"`
      : "";
  const where =
    authored.block.name === block.name
      ? `("${block.name}"${via})`
      : `("${block.name}", via composed block "${authored.block.name}"${via})`;
  throw new Error(
    `[task-board] "${name}" dispatches to task entry "${target}" ${where}, which declares ` +
      `sessionStateSchema — a dispatched block runs in a child session it may share with ` +
      `other rows, where two blocks choosing the same key with different shapes corrupt ` +
      `each other with no error. Keep the block's state on the task instead.`
  );
}
