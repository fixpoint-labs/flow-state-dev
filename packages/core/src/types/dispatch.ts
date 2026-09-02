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
import { z } from "zod";
import type { BlockContext, BlockDefinition } from "./block";
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
 * Which child session a `task` dispatch runs in, decided per row.
 *
 * - `"per-task"` — one child per row, keyed on the task id. Rows are
 *   independent: a checkout per issue.
 * - `"per-worker"` — one child per seat, shared by every row the seat runs.
 *   The worker remembers what it already did.
 * - `{ key }` — keyed on what the function returns, read from the worker
 *   input the row was packed into. One issue across several phases, or a key
 *   shared across seats.
 *
 * The presets frame the board id into the key, so two boards' children stay
 * apart even when their task ids coincide; a custom key is used as returned.
 */
export type TaskSessionPolicy<TPayload = unknown> =
  | "per-task"
  | "per-worker"
  | { readonly key: (task: TPayload, ctx: BlockContext) => string };

/**
 * Where a dispatcher sends. Static by construction: `(type, target)` is what
 * `defineFlow` verifies, so a block's reachable set is declared rather than
 * computed at run time. A target chosen from data is a router over declared
 * dispatchers, not a dynamic address.
 *
 * A `task` address also carries the seat's session policy — declared once on
 * the dispatcher and read by the board that holds it, so the roster shows
 * statically which seats hand off and where their rows land.
 */
export type DispatchAddress =
  | {
      readonly type: "internal";
      /** The entry name — `flow.internal[target]`. */
      readonly target: string;
    }
  | {
      readonly type: "task";
      /** The entry name — `flow.tasks[target]`. */
      readonly target: string;
      readonly session: TaskSessionPolicy<any>;
    };

/**
 * What a `task` dispatch carries: the claim's identity and the worker's input.
 *
 * Every field is **server-derived at hand-off** — the board supplies them from
 * the ticket it minted off the row it claimed. `attempt`, `createdAt` and
 * `incarnationId` say *which* claim this dispatch believes it is running;
 * `seat` says which of the board's seats the row was routed to. The entry's
 * gate decides whether all of that is still true: verified, never trusted.
 */
export const taskDispatchInputSchema = z.object({
  /** Which board's ledger this dispatch settles against. */
  boardId: z.string().min(1),
  /** The board seat the row is assigned to — the dispatcher's seat on the roster. */
  seat: z.string().min(1),
  /** The claimed row. */
  taskId: z.string().min(1),
  /** The attempt this dispatch believes it is running. */
  attempt: z.number().int().nonnegative(),
  /** The claimed row's creation stamp. */
  createdAt: z.number(),
  /**
   * The claimed row's incarnation nonce. Optional so an envelope persisted
   * before the field shipped still parses; the gate compares it only when both
   * sides carry one (BP-030).
   */
  incarnationId: z.string().optional(),
  /** The materialized worker input, packed at claim time. */
  payload: z.unknown()
});

export type TaskDispatchInput = z.infer<typeof taskDispatchInputSchema>;

/** Length-prefix a field so field boundaries cannot migrate in a composed key. */
function framed(value: string): string {
  return `${value.length}:${value}`;
}

/**
 * The child-session key a `task` dispatch runs under, for one envelope and one
 * policy. Shared by `dispatcher()` and the board's hand-off so both derive the
 * same child for the same row.
 *
 * @throws when a `key` policy returns something other than a non-empty string —
 *   the key names the child session, so an empty one is a computed refusal.
 */
export function taskSessionKeyFor(
  blockName: string,
  policy: TaskSessionPolicy<any>,
  envelope: TaskDispatchInput,
  ctx: BlockContext
): string {
  if (policy === "per-task") {
    return `task|${framed(envelope.boardId)}|${framed(envelope.taskId)}`;
  }
  if (policy === "per-worker") {
    return `worker|${framed(envelope.boardId)}|${framed(envelope.seat)}`;
  }
  const key = policy.key(envelope.payload, ctx);
  if (typeof key !== "string" || key.length === 0) {
    throw new Error(
      `[dispatcher] "${blockName}" computed an empty session key for task ` +
        `"${envelope.taskId}" (${JSON.stringify(key)}). The key names the child session; ` +
        `return a value that identifies the unit of work.`
    );
  }
  return key;
}

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

/**
 * A `task` entry: the block a board drain hands a claimed row to, in a session
 * of its own. Declared on the flow like any other entry — `tasks: { implement:
 * { block } }` — and reached only through a `task` dispatch from a
 * `dispatcher({ type: "task" })` seat on a board. `defineFlow` wraps the entry
 * in that board's claim gate (see {@link TaskBinding}), so the block receives
 * the packed worker input the row was claimed with, never the envelope, and
 * never runs against a row nothing verified.
 */
export type TaskEntry = ActionCore;

/**
 * What a task board binds onto the hand-off it installs at a `task` dispatcher
 * seat: which board it is, and the claim gate every entry the seat addresses
 * must run behind.
 *
 * The gate needs the board's ledger, which lives outside `core`, so the board
 * supplies it and `defineFlow` applies it: for every reachable task dispatcher
 * the walk finds, the target entry is rebuilt as `gate(entry)`. That is what
 * lets an author declare a task entry as a plain block — the same shape as an
 * action — and still never have it reached without the row re-read, the claim
 * verified, the task scope marked and the ticket re-minted first.
 */
export type TaskBinding = {
  readonly boardId: string;
  /** Wrap an entry in this board's claim gate. `target` is the entry's name on the flow. */
  readonly gate: (entry: ActionCore, target: string) => ActionCore;
};

/**
 * Bindings are keyed by the block's ADDRESS object, not the block. Every
 * rebuild path (`connectInput`, `.rescue()`, `asTool`) forwards
 * `definition.dispatch` by reference, so a hand-off the drain connects into
 * its routing table — a rebuilt copy — still resolves the binding its board
 * put on the original. A block whose address is a different object is unbound.
 */
const taskBindings = new WeakMap<object, TaskBinding>();

/**
 * Bind a board's claim gate to the block that dispatches its tasks. Substrate-
 * facing; called by `taskBoard()` on the hand-off it installs at each
 * `dispatcher({ type: "task" })` seat, after `markDispatcher` has stamped the
 * address the binding is keyed by.
 *
 * @throws when the block carries no `task` address, or is already bound to a
 *   different board — one hand-off serves one board, or the walk could not say
 *   whose gate the entry gets.
 */
export function bindTaskDispatcher(block: BlockDefinition<any, any>, binding: TaskBinding): void {
  const address = block.dispatch;
  if (address === undefined || address.type !== "task") {
    throw new Error(
      `Block "${block.name}" carries no task address to bind board "${binding.boardId}" to. ` +
        `Mark it with a \`{ type: "task" }\` address first.`
    );
  }
  const existing = taskBindings.get(address);
  if (existing !== undefined && existing.boardId !== binding.boardId) {
    throw new Error(
      `Block "${block.name}" is already bound to board "${existing.boardId}" and cannot also ` +
        `be bound to board "${binding.boardId}". One task dispatcher serves one board.`
    );
  }
  taskBindings.set(address, binding);
}

/** The board binding on a task dispatcher, or `undefined` when no board holds it. */
export function taskBindingOf(block: BlockDefinition<any, any>): TaskBinding | undefined {
  const address = block.dispatch;
  return address === undefined ? undefined : taskBindings.get(address);
}
