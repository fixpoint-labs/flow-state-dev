/**
 * One dispatch protocol: typed entries, addresses, and the dispatch seam.
 *
 * Every arrival at a flow is a **dispatch** of one **type**, delivered to one
 * **entry** addressed by `(type, name)`. A caller over HTTP sends a `public`
 * dispatch to `flow.actions[name]`; the host cron sends a `schedule` dispatch to
 * `flow.schedules.static[id]`; a task board drain sends a `task` dispatch to
 * `flow.tasks[name]`; a running request sends an `internal` dispatch to
 * `flow.internal[name]`. Delivery is the same for all of them — one envelope,
 * one door (`host.dispatch`), one request record — and so is addressing: one
 * keyed lookup with **no fallback**. A dispatch addressed to a type that
 * declares no such entry is refused by name; it never resolves another type's
 * map.
 *
 * What differs per type is who owns the entry's input schema and who may put a
 * dispatch through the door. A block may dispatch a type only when it can
 * itself supply that type's trust: it holds its own request's authority
 * (`internal`), or that plus a verified claim on a durable row (`task`). It
 * cannot manufacture a principal (`public`) or a signature over raw bytes
 * (`webhook`), so those types are not dispatchable from a block.
 *
 * ## The seam is reached through a factory, not a `ctx` method
 *
 * A block does not *call* a dispatch; it *is* one — see `dispatcher()` in
 * `blocks/dispatcher.ts`. The runtime's dispatch operation is attached to the
 * block context under {@link DISPATCH_SEAM}, a symbol key, rather than as a
 * named member, so that the set of blocks that dispatch is the set of blocks
 * carrying a {@link DispatchAddress}. That is what lets `defineFlow` walk the
 * block graph and refuse an address that resolves nothing, and what lets a
 * task board see statically which of its seats hand off. A substrate package
 * that must reach the seam directly (the task board's drain) marks its block
 * with `markDispatcher` so the walk stays complete.
 */
import type { BlockDefinition } from "./block";
import type { ActionCore } from "./flow";

/** The kinds of dispatch a flow can receive. Each resolves one map on the flow. */
export type DispatchType = "public" | "chat" | "webhook" | "schedule" | "task" | "internal";

/** Every dispatch type, for validation and iteration. */
export const DISPATCH_TYPES: readonly DispatchType[] = [
  "public",
  "chat",
  "webhook",
  "schedule",
  "task",
  "internal"
];

/**
 * The types a block may dispatch — the ones whose trust a running request can
 * supply itself. See the module header for why the others are excluded.
 */
export type BlockDispatchType = "internal" | "task";

/**
 * Where a dispatcher sends. Static by construction: the pair is what
 * `defineFlow` verifies, so a block's reachable set is declared rather than
 * computed at run time. A target chosen from data is a router over declared
 * dispatchers, not a dynamic address.
 */
export type DispatchAddress = {
  readonly type: BlockDispatchType;
  /** The entry name — `flow.internal[target]` or `flow.tasks[target]`. */
  readonly target: string;
  /**
   * On a task dispatch made by a board: the board whose entry `target` must
   * be. `defineFlow` refuses a task entry that belongs to a different board
   * than the dispatcher naming it, which is how two boards spreading their
   * entries onto one flow cannot silently shadow each other.
   */
  readonly boardId?: string;
};

/**
 * Which session a dispatch runs in.
 *
 * - `key` — a **child** of the running session, derived from this key together
 *   with the running request's tenant, principal, session and lineage. Minted
 *   on first use and adopted after, so the same key from the same parent always
 *   lands on the same child: a retry re-enters the child it already started.
 * - `id` — an **existing** session. Delivered into it when it exists and is
 *   this principal's on this flow; refused by name otherwise. Never created —
 *   an unknown id is a typo, a stale reference, or a hallucinated value, and
 *   auto-creating turns all three into work nobody is watching.
 */
export type SessionTarget = { readonly key: string } | { readonly id: string };

/** What a dispatcher hands the seam. Every field is computed by the block that dispatches. */
export type DispatchSpec = {
  readonly type: BlockDispatchType;
  readonly target: string;
  readonly session: SessionTarget;
  /** The entry's input. Validated by the entry's own schema on arrival. */
  readonly payload: unknown;
  /** The dispatching block's name. Provenance only — never resolved. */
  readonly from: string;
  /**
   * Server-derived facts stamped onto the child request's record beside the
   * address — a board puts its task id here. Never a caller's bag: it lands on
   * the wire as server truth, so only put here what the runtime produced.
   */
  readonly provenance?: Readonly<Record<string, unknown>>;
};

/**
 * Why a dispatch was refused. A name the caller can branch on rather than a
 * message it has to parse. Every refusal is decided before anything is
 * dispatched, so a refused caller still owns whatever it was handing over.
 */
export type DispatchRefusal =
  /** The flow declares no entry at `(type, target)`. Resolution never falls through. */
  | "no-entry"
  /** An `id` target names a session that does not exist. */
  | "session-not-found"
  /** An `id` target names a session that is not this principal's, or not this flow's. */
  | "session-not-addressable"
  /** A `key` target derived a child id already held by a record that is not this request's child. */
  | "key-occupied"
  /** This process executes requests but was not wired to dispatch one. */
  | "no-dispatch-operation"
  /** The host refused before starting — a `reject` concurrency policy whose key is held. */
  | "dispatch-rejected";

/** Outcome of a dispatch. `adopted` says whether the child session already existed. */
export type DispatchOutcome =
  | {
      readonly ok: true;
      readonly sessionId: string;
      readonly requestId: string;
      readonly adopted: boolean;
    }
  | {
      readonly ok: false;
      readonly refused: DispatchRefusal;
      /** Operator-facing detail. Not a stable contract; branch on `refused`. */
      readonly detail: string;
    };

/** The runtime's dispatch operation, bound to the running request's identity. */
export type DispatchSeam = (spec: DispatchSpec) => Promise<DispatchOutcome>;

/**
 * The context slot the runtime attaches its dispatch operation under.
 *
 * A symbol rather than a named member, deliberately: a `ctx.startDetached`-style
 * verb is reachable from any handler body, which makes "which blocks dispatch"
 * unanswerable at definition time. Reaching the seam through
 * `dispatchThroughSeam` from a block marked with `markDispatcher` keeps the
 * reachable set declared.
 */
export const DISPATCH_SEAM: unique symbol = Symbol.for("@flow-state-dev/dispatch-seam");

/**
 * Thrown when a block dispatches in a context no runtime host wired — a unit
 * test, a hand-built mock, or a process that executes requests but was never
 * given a dispatch operation.
 */
export class NoDispatchSeamError extends Error {
  readonly code = "no-dispatch-seam";

  constructor(blockName: string) {
    super(
      `Block "${blockName}" sends a dispatch, but no dispatch seam is wired on this context. ` +
        "A host built through the shipped entry points supplies one; a hand-built test context " +
        "must attach one under DISPATCH_SEAM."
    );
    this.name = "NoDispatchSeamError";
  }
}

/**
 * Thrown by a dispatcher block when the seam refuses. Carries the address and
 * the refusal by name so a `.rescue()` can branch on it.
 */
export class DispatchRefusedError extends Error {
  readonly code = "dispatch-refused";

  constructor(
    readonly blockName: string,
    readonly address: DispatchAddress,
    readonly refused: DispatchRefusal,
    readonly detail: string
  ) {
    super(
      `Block "${blockName}" could not dispatch to ${address.type}:"${address.target}": ` +
        `${refused} — ${detail}`
    );
    this.name = "DispatchRefusedError";
  }
}

/**
 * Put a dispatch through the runtime's dispatch seam.
 *
 * Substrate-facing. Authored flows reach this through `dispatcher()`; a
 * substrate block that calls it directly (the task board's hand-off) must also
 * be marked with {@link markDispatcher}, or `defineFlow`'s walk cannot see the
 * address it dispatches to.
 */
export function dispatchThroughSeam(
  ctx: { readonly [DISPATCH_SEAM]?: DispatchSeam },
  spec: DispatchSpec
): Promise<DispatchOutcome> {
  const seam = ctx[DISPATCH_SEAM];
  if (seam == null) throw new NoDispatchSeamError(spec.from);
  return seam(spec);
}

/**
 * Stamp a block with the address it dispatches to, so `defineFlow` can verify
 * the target resolves and a board can see the hand-off statically.
 *
 * Assigns in place: the caller owns the block it just built, and every rebuild
 * path (`connectInput`, `.rescue()`, `asTool`) forwards `definition.dispatch`.
 */
export function markDispatcher<TBlock extends { dispatch?: DispatchAddress }>(
  block: TBlock,
  address: DispatchAddress
): TBlock {
  block.dispatch = address;
  return block;
}

/**
 * An `internal` entry: a block plus execution policy, reachable only by an
 * `internal` dispatch from a `dispatcher()` in a running request of this flow.
 * No HTTP or MCP caller can name it — the map it lives in is the boundary.
 */
export type InternalEntry = ActionCore;

/** The brand a task board stamps on the entries it produces. */
export const TASK_ENTRY: unique symbol = Symbol.for("@flow-state-dev/task-entry");

/**
 * What the brand records: which board's claim gate wraps the entry, and the
 * gate itself. The block is in the mark so that the brand cannot outlive the
 * gate: an entry spread from `board.tasks` keeps its brand, which is what
 * lets an author override `concurrency` or the hooks — but one that swaps
 * `block` no longer runs the gate, and `defineFlow` refuses it by comparing
 * the two.
 */
export type TaskEntryMark = {
  readonly boardId: string;
  /** The claim gate the board built; must still be the entry's `block`. */
  readonly block: BlockDefinition<any, any>;
};

/**
 * A `task` entry: the block a board drain hands a claimed row to, in a session
 * of its own. **Produced only by a task board** — the entry's block is the
 * board's claim gate around the worker, which re-reads the row, verifies the
 * claim, marks the task scope and re-mints the claim ticket before the worker
 * runs. `defineFlow` refuses an unbranded entry, so a worker can never be
 * reached by a task dispatch without that gate in front of it.
 */
export type TaskEntry = ActionCore & { readonly [TASK_ENTRY]: TaskEntryMark };

/** True when `value` is an entry a task board produced. */
export function isTaskEntry(value: unknown): value is TaskEntry {
  if (typeof value !== "object" || value === null) return false;
  const mark = (value as { [TASK_ENTRY]?: unknown })[TASK_ENTRY];
  return (
    typeof mark === "object" &&
    mark !== null &&
    typeof (mark as TaskEntryMark).boardId === "string" &&
    typeof (mark as TaskEntryMark).block === "object" &&
    (mark as TaskEntryMark).block !== null
  );
}

/**
 * Brand an entry as board-produced. Substrate-facing; called by `taskBoard()`.
 * The mark records the entry's block at branding time — the board's claim
 * gate — so a later `block` override is detectable.
 */
export function markTaskEntry(entry: ActionCore, mark: { readonly boardId: string }): TaskEntry {
  return { ...entry, [TASK_ENTRY]: { boardId: mark.boardId, block: entry.block } };
}
