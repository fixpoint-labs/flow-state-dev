/**
 * One dispatch protocol: typed entries, addresses, and the dispatch seam.
 *
 * Every arrival at a flow is a **dispatch** of one **type**, delivered to one
 * **entry** addressed by `(type, name)`. A caller over HTTP sends a `public`
 * dispatch to `flow.actions[name]`; the host cron sends a `schedule` dispatch to
 * `flow.schedules.static[id]`; a task board drain sends a `task` dispatch to
 * `flow.task.actions[name]`; a running request sends an `internal` dispatch to
 * `flow.internal.actions[name]`. Delivery is the same for all of them — one envelope,
 * one door (`host.dispatch`), one request record — and so is addressing: one
 * keyed lookup with **no fallback**. A dispatch addressed to a type that
 * declares no such entry is refused by name; it never resolves another type's
 * map.
 *
 * ## One flow, or another one
 *
 * An `internal` or `task` address may name a **different flow** — `flowKind`
 * on the address. Delivery is the same door; what changes is which flow's
 * entry map the target is resolved on, and therefore *when*. A same-flow address is
 * resolved by `defineFlow`, which holds the map. A cross-flow address cannot
 * be: the flow it names is registered separately, so the entry check happens
 * at the seam, on the target flow the process actually has. That is a **miss
 * with a name** — `flow-not-found` or `no-entry` — reaching the sending block
 * as a thrown {@link DispatchRefusedError}, never a retry, a queue, or a
 * fall-through to the sender's own map.
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
 * task board see statically which of its assignees dispatch. A substrate package
 * that must reach the seam directly (the task board's drain) marks its block
 * with `markDispatcher` so the walk stays complete.
 */
import { z } from "zod";
import type { BlockContext, BlockDefinition } from "./block";
import type { ActionCore } from "./flow";

/** The kinds of dispatch a flow can receive. Each resolves one map on the flow. */
export type DispatchType = "public" | "webhook" | "schedule" | "task" | "internal";

/** Every dispatch type, for validation and iteration. */
export const DISPATCH_TYPES: readonly DispatchType[] = [
  "public",
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
 * Which session a `task` dispatch runs in, decided per row.
 *
 * - `"per-task"` — one child per row, keyed on the task id (a follow-up row,
 *   whose payload names `followUpOf`, on the task it follows). Rows are
 *   independent: a checkout per issue.
 * - `"per-worker"` — one child per assignee, shared by every row routed to it.
 *   The worker remembers what it already did.
 * - `{ key }` — keyed on what the function returns, read from the worker
 *   input the row was packed into. One issue across several phases, or a key
 *   shared across assignees.
 * - `{ by }` — chosen per row (see {@link TaskSessionChoice}): a keyed child,
 *   as `{ key }` makes, or an **existing** session by id. One board can then
 *   send some rows to a child of their own and others into a session that is
 *   already running. An id is delivered into, never created, and refused by
 *   name when it is missing or not this principal's on this flow, so an id
 *   read off a row cannot reach a session the claimer could not.
 *
 * The presets frame the board id into the key, so two boards' children stay
 * apart even when their task ids coincide; a custom key is used as returned.
 */
export type TaskSessionPolicy<TPayload = unknown> =
  | "per-task"
  | "per-worker"
  | { readonly key: (task: TPayload, ctx: BlockContext) => string }
  | {
      readonly by: (
        task: TaskTargetQuery,
        ctx: BlockContext
      ) => TaskSessionChoice | Promise<TaskSessionChoice>;
    };

/** The session policies that always derive a keyed child: every policy but `{ by }`. */
export type KeyedTaskSessionPolicy<TPayload = unknown> = Exclude<
  TaskSessionPolicy<TPayload>,
  { readonly by: unknown }
>;

/**
 * What a `{ by }` session policy answers for one row: a child `key`, minted on
 * first use and adopted after exactly as a `{ key }` policy's is, or the `id`
 * of an existing session to deliver into (the {@link SessionTarget} `{ id }`).
 */
export type TaskSessionChoice = { readonly key: string } | { readonly id: string };

/**
 * A `task` address's entry, chosen per row: `by` answers, for each row, one of
 * the entry names listed in `among`. Every listed name is declared and
 * verified like a string `action` (`defineFlow` for this flow, the seam for
 * another), so the entries a board's rows can land on are still declared, not
 * computed. An answer outside `among` is refused before anything is dispatched.
 */
export type TaskEntryChoice = {
  readonly among: readonly string[];
  readonly by: (task: TaskTargetQuery, ctx: BlockContext) => string | Promise<string>;
};

/**
 * The task a `task` dispatcher's per-task target is asked about: who the row
 * is assigned to, which row, and the worker input it was claimed with. All of
 * it comes off the claim the board minted, never from a caller.
 */
export type TaskTargetQuery = {
  /** The row's assignee, the name the board routed it by. */
  readonly assignee: string;
  readonly taskId: string;
  /** The packed worker input the row was claimed with. */
  readonly input: unknown;
  /**
   * The user whose request filed the row, as the ledger recorded it when the
   * row was added. Supplied by a board's hand-over, which reads it off the
   * row it claimed; absent when the ledger recorded none, or when a bare
   * dispatcher is run with an envelope (which carries no filer).
   */
  readonly filedBy?: string;
};

/**
 * A `task` dispatcher's flow, looked up per task: the id of the flow instance
 * the entry lives on, or `undefined` when nothing answers for this task (the
 * dispatch is then refused `flow-not-found`, naming the assignee). Resolved
 * once per dispatch, before anything is dispatched.
 */
export type TaskFlowTarget = (
  task: TaskTargetQuery,
  ctx: BlockContext
) => string | undefined | Promise<string | undefined>;

/**
 * A `task` dispatcher's child-session initial state, looked up per task: what
 * the target flow's `stateSchema` parses and its `session.createCheck` judges
 * when the task's child session is created. Handed the same server-derived
 * task a per-task flow target is (assignee, id, input), because the state
 * names who runs the row. Resolved once per dispatch, before anything is
 * dispatched.
 */
export type TaskStateTarget = (
  task: TaskTargetQuery,
  ctx: BlockContext
) => Readonly<Record<string, unknown>> | Promise<Readonly<Record<string, unknown>>>;

/**
 * Where a dispatcher sends. `(type, action)` is static by construction: it is
 * what the block declares, so its reachable entries are declared rather than
 * computed at run time. An `internal` action chosen from data is a router over
 * declared dispatchers, not a dynamic address. A `task` address may choose its
 * entry per row ({@link TaskEntryChoice}), but only among declared ones: every
 * name it can answer is listed on the address and verified like a string
 * `action`. Its `flowKind` may be a {@link TaskFlowTarget}: the entry is still
 * declared, and only which flow serves it is looked up when a task is handed
 * over. Such a target is cross-flow, so nothing at definition time can list
 * the flows it reaches.
 *
 * `defineFlow` verifies the same-flow pair. A cross-flow address is equally
 * static and equally declared — it is simply verified one layer later, by the
 * seam, against the flow the running process registered under that kind.
 *
 * A `task` address also carries the dispatcher's session policy — declared
 * once on the dispatcher and read by the board that holds it, so the board can
 * list statically which of its assignees dispatch and where their rows land.
 */
export type DispatchAddress =
  | {
      readonly type: "internal";
      /** The entry name — `flow.internal.actions[action]`. */
      readonly action: string;
      /**
       * The flow the entry lives on, when it is **not this one**. Absent is
       * same-flow, which is the whole of what `defineFlow` can check.
       *
       * A cross-flow address is declared exactly like a same-flow one — a
       * string on the block, resolved by the walk it is reachable from — but
       * the flow it names is registered independently of this one, so nothing
       * at definition time can read its entry map. The check moves to the
       * seam, where it stays a **named refusal**: `flow-not-found` when this
       * process has no such flow, `no-entry` when the flow has no such entry.
       * Never a retry, a queue, or a fall through to this flow's own map.
       */
      readonly flowKind?: string;
    }
  | {
      readonly type: "task";
      /**
       * The entry name — `flow.task.actions[action]` — or a choice among
       * declared entry names, made per row (see {@link TaskEntryChoice}).
       */
      readonly action: string | TaskEntryChoice;
      readonly session: TaskSessionPolicy<any>;
      /**
       * The flow the entry lives on, when it is **not this one**. Same skip
       * as an `internal` cross-flow address: `defineFlow` cannot see the
       * other flow's map, so the seam resolves it. A function is looked up
       * per task (see {@link TaskFlowTarget}) and is always cross-flow.
       */
      readonly flowKind?: string | TaskFlowTarget;
      /**
       * The initial state each task's child session is created with: a fixed
       * object, or looked up per task (see {@link TaskStateTarget}). A child
       * that already exists keeps its own.
       */
      readonly state?: Readonly<Record<string, unknown>> | TaskStateTarget;
      /**
       * Whether the board's drain waits on a row it hands over (FIX-2082).
       * Absent follows the board's mode: a plan board waits, a delegation
       * board doesn't. A board refuses one that contradicts its mode.
       */
      readonly wait?: boolean;
    };

/**
 * What a `task` dispatch carries: the claim's identity and the worker's input.
 *
 * Every field is **server-derived at dispatch** — the board supplies them from
 * the ticket it minted off the row it claimed. `attempt`, `createdAt` and
 * `incarnationId` say *which* claim this dispatch believes it is running;
 * `assignee` names the assignee the board routed the row to. The entry's
 * gate decides whether all of that is still true: verified, never trusted.
 */
export const taskDispatchInputSchema = z.object({
  /** Which board's ledger this dispatch settles against. */
  boardId: z.string().min(1),
  /** The assignee the board routed the row to. */
  assignee: z.string().min(1),
  /** The claimed row. */
  taskId: z.string().min(1),
  /** The attempt this dispatch believes it is running. */
  attempt: z.number().int().nonnegative(),
  /**
   * The row's turn generation as of the claim: two turns of one attempt are
   * two claims (a task held on questions midway runs its next turn on its
   * same attempt). Optional so an envelope persisted before it still parses;
   * the gate compares it when present.
   */
  turn: z.number().int().nonnegative().optional(),
  /** The claimed row's creation stamp. */
  createdAt: z.number(),
  /**
   * The claimed row's incarnation nonce. Optional so an envelope persisted
   * before the field shipped still parses; the gate compares it only when both
   * sides carry one (BP-030).
   */
  incarnationId: z.string().optional(),
  /**
   * The partition the claim was taken in, when the board's ledger keeps one
   * set of rows per partition. The gate reads the row there, at the running
   * user's scope; absent for every other ledger.
   */
  partition: z.string().min(1).optional(),
  /** The materialized worker input, packed at claim time. */
  payload: z.unknown()
});

export type TaskDispatchInput = z.infer<typeof taskDispatchInputSchema>;

/**
 * Length-prefix a field so field boundaries cannot migrate in a composed key:
 * `("u_ab", "c")` and `("u_a", "bc")` would otherwise concatenate identically.
 * The writer's half of the codec; {@link readFramed} is the reader's.
 */
export function framed(value: string): string {
  return `${value.length}:${value}`;
}

/**
 * Read one {@link framed} field starting at `at`: the value and where the next
 * field begins, or `null` when the input does not have that shape.
 *
 * Strict about the shape `framed` writes — the digits must be exactly the
 * decimal spelling of the value's length (no leading zeros) and the value must
 * be fully present. An empty value is accepted: `framed("")` is `0:`, and a
 * reader that needs non-empty fields checks that itself.
 */
export function readFramed(
  input: string,
  at: number
): { value: string; next: number } | null {
  const separator = input.indexOf(":", at);
  if (separator === -1) return null;
  const digits = input.slice(at, separator);
  if (!/^\d+$/.test(digits)) return null;
  const length = Number.parseInt(digits, 10);
  if (String(length) !== digits) return null;
  const start = separator + 1;
  const end = start + length;
  if (end > input.length) return null;
  return { value: input.slice(start, end), next: end };
}

/**
 * The child-session key a `task` dispatch runs under, for one envelope and one
 * policy. Shared by `dispatcher()` and the board's dispatch so both derive the
 * same child for the same row.
 *
 * @throws when a `key` policy returns something other than a non-empty string —
 *   the key names the child session, so an empty one is a computed refusal.
 */
export function taskSessionKeyFor(
  blockName: string,
  policy: KeyedTaskSessionPolicy<any>,
  envelope: TaskDispatchInput,
  ctx: BlockContext
): string {
  if (policy === "per-task") {
    // A follow-up runs in the session of the task it follows: the board packs
    // that task's id onto the payload from the row it claimed (server-derived).
    const followUpOf = (envelope.payload as { followUpOf?: unknown } | undefined)?.followUpOf;
    const sessionTask = typeof followUpOf === "string" && followUpOf.length > 0 ? followUpOf : envelope.taskId;
    return `task|${framed(envelope.boardId)}|${framed(sessionTask)}`;
  }
  if (policy === "per-worker") {
    return `worker|${framed(envelope.boardId)}|${framed(envelope.assignee)}`;
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
 * The session a `task` dispatch runs in, for one row, as the seam takes it:
 * the address's keyed child (see {@link taskSessionKeyFor}) with its initial
 * state, or what a `{ by }` policy answers for this row. A `{ key }` answer is
 * a child like any other and gets the address's state; an `{ id }` answer is an
 * existing session, which keeps its own, so the state is not looked up.
 * Shared by `dispatcher()` and the board's dispatch, so both send the same row
 * to the same session.
 *
 * @throws when a `{ by }` policy answers anything but exactly one non-empty
 *   `key` or `id`, or the state target answers a non-object. Decided before
 *   anything is dispatched.
 */
export async function resolveTaskSessionTarget(
  blockName: string,
  address: Extract<DispatchAddress, { type: "task" }>,
  envelope: TaskDispatchInput,
  task: TaskTargetQuery,
  ctx: BlockContext
): Promise<SessionTarget> {
  const choice = await chooseTaskSession(blockName, address.session, envelope, task, ctx);
  if ("id" in choice) return { id: choice.id };
  const state = await resolveTaskState(blockName, address, task, ctx);
  return state === undefined ? { key: choice.key } : { key: choice.key, state };
}

async function chooseTaskSession(
  blockName: string,
  policy: TaskSessionPolicy<any>,
  envelope: TaskDispatchInput,
  task: TaskTargetQuery,
  ctx: BlockContext
): Promise<TaskSessionChoice> {
  if (typeof policy !== "object" || !("by" in policy)) {
    return { key: taskSessionKeyFor(blockName, policy, envelope, ctx) };
  }
  const choice: unknown = await policy.by(task, ctx);
  if (typeof choice === "object" && choice !== null) {
    const { key, id } = choice as { key?: unknown; id?: unknown };
    if (key !== undefined && id === undefined && typeof key === "string" && key.length > 0) {
      return { key };
    }
    if (id !== undefined && key === undefined && typeof id === "string" && id.length > 0) {
      return { id };
    }
  }
  throw new Error(
    `[dispatcher] "${blockName}" chose a session for task "${task.taskId}" that is not one ` +
      `non-empty \`key\` or \`id\` (${JSON.stringify(choice)}). Answer \`{ key }\` for a child ` +
      `session or \`{ id }\` for an existing one.`
  );
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
 *   auto-creating turns all three into work nobody is watching. **Unless it
 *   carries `state`**: then a session absent at that id is created there, as a
 *   session of its own (no parent), from that state, judged by the target
 *   flow's `session.createCheck` with `via: "dispatch"` exactly as a `key`
 *   child is. The block computed the id and the state, so the create check is
 *   what decides whether that id is this principal's to create.
 * - `from` — the **seam-stamped sender**. The runtime reads
 *   `metadata.dispatch.from.sessionId` through `readDispatchStamp` and delivers
 *   into that session as an `id` would. The author names no session. A request
 *   that was not dispatched has no sender (`no-sender`).
 */
export type SessionTarget =
  | {
      readonly key: string;
      /**
       * The child's initial session state, read only when the child is
       * created: a child that already exists keeps its own. The target flow's
       * `stateSchema` parses it and its `session.createCheck` judges it.
       * Computed by the dispatching block's own code, never taken from a
       * caller's input.
       */
      readonly state?: Readonly<Record<string, unknown>>;
    }
  | {
      readonly id: string;
      /**
       * Initial state, read only when this id is created (see `id` above).
       * From the dispatching block's code, never a caller's input.
       */
      readonly state?: Readonly<Record<string, unknown>>;
    }
  | { readonly from: true };

/** What a dispatcher hands the seam. Every field is computed by the block that dispatches. */
export type DispatchSpec = {
  readonly type: BlockDispatchType;
  readonly action: string;
  /**
   * The flow instance the entry lives on — its exact id — when it is not the
   * sending request's own.
   */
  readonly flowKind?: string;
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
  /**
   * The sending request parks on the dispatched request at once, waiting for
   * it (`dispatcher({ wait: true })`, FIX-2082). The seam stamps the child
   * with who waits on it, from the sender's own server-derived facts, so the
   * child's wait depth counts its sender before the sender's park is written.
   */
  readonly waits?: boolean;
};

/**
 * Why a dispatch was refused. A name the caller can branch on rather than a
 * message it has to parse. Every refusal is decided before anything is
 * dispatched, so a refused caller still owns whatever it was handing over.
 */
export type DispatchRefusal =
  /** The flow declares no entry at `(type, action)`. Resolution never falls through. */
  | "no-entry"
  /**
   * A cross-flow address names a flow this process has not registered. The
   * runtime half of an address `defineFlow` could not verify — a typo, a flow
   * that was never deployed here, or one deployed behind a different host.
   */
  | "flow-not-found"
  /** An `id` target with no starting state names a session that does not exist. */
  | "session-not-found"
  /** An `id` target names a session that is not this principal's, or not this flow's. */
  | "session-not-addressable"
  /** A `key` target derived a child id already held by a record that is not this request's child. */
  | "key-occupied"
  /** The target flow's `session.createCheck` refused to create the session: a `key` child, or an `id` target carrying starting state. */
  | "create-refused"
  /** This process executes requests but was not wired to dispatch one. */
  | "no-dispatch-operation"
  /** The host refused before starting — a `reject` concurrency policy whose key is held. */
  | "dispatch-rejected"
  /**
   * An `id` delivery on a deployment whose runner hands work to an external
   * queue and whose worker adapter supplies no shared lease backend, where the
   * recipient's concurrency policy would not be applied to it.
   * A `key` child is unaffected.
   */
  | "external-dispatcher"
  /**
   * A `{ from: true }` target on a request the runtime did not dispatch — no
   * trusted `metadata.dispatch.from`. A caller-written bag on an HTTP body is
   * not a sender.
   */
  | "no-sender";

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
 * A symbol rather than a named member, deliberately: a `ctx.dispatch`-style
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
      `Block "${blockName}" could not dispatch to ${address.type}:${describeAction(address)}: ` +
        `${refused} — ${detail}`
    );
    this.name = "DispatchRefusedError";
  }
}

/**
 * Every entry name an address can reach: its `action`, or each name a per-row
 * choice lists. What `defineFlow` and the run-time routability check verify,
 * and what a board lists as where an assignee's rows can land.
 */
export function addressEntries(address: DispatchAddress): readonly string[] {
  return typeof address.action === "string" ? [address.action] : address.action.among;
}

/** An address's action for messages: `"name"`, or `one of "a", "b"` for a per-row choice. */
export function describeAction(address: DispatchAddress): string {
  return typeof address.action === "string"
    ? `"${address.action}"`
    : `one of ${address.action.among.map((name) => `"${name}"`).join(", ")}`;
}

/**
 * The entry a `task` dispatch goes to: the address's string as declared, or
 * its per-row choice's answer for this task.
 *
 * @throws {DispatchRefusedError} `no-entry` when the choice answers a name its
 *   `among` does not list. Decided before anything is dispatched, like every
 *   refusal, so a board's dispatch still holds the claim.
 */
export async function resolveTaskAction(
  blockName: string,
  address: Extract<DispatchAddress, { type: "task" }>,
  task: TaskTargetQuery,
  ctx: BlockContext
): Promise<string> {
  const action = address.action;
  if (typeof action === "string") return action;
  const chosen: unknown = await action.by(task, ctx);
  if (typeof chosen === "string" && action.among.includes(chosen)) return chosen;
  throw new DispatchRefusedError(
    blockName,
    address,
    "no-entry",
    `the entry chosen for task "${task.taskId}" (assignee "${task.assignee}") was ` +
      `${JSON.stringify(chosen)}, which is not among the entries this dispatcher declares.`
  );
}

/**
 * The initial state a `task` dispatch creates its child session with: the
 * address's object as declared, or its per-task target's answer for this task.
 * `undefined` when the address declares none.
 *
 * @throws when the answer is not a plain object.
 */
export async function resolveTaskState(
  blockName: string,
  address: Extract<DispatchAddress, { type: "task" }>,
  task: TaskTargetQuery,
  ctx: BlockContext
): Promise<Readonly<Record<string, unknown>> | undefined> {
  const state = address.state;
  if (state === undefined) return undefined;
  const resolved = typeof state === "function" ? await state(task, ctx) : state;
  if (typeof resolved !== "object" || resolved === null || Array.isArray(resolved)) {
    throw new Error(
      `[dispatcher] "${blockName}" computed a child session state for task "${task.taskId}" that ` +
        `is not an object (${JSON.stringify(resolved)}).`
    );
  }
  return resolved;
}

/**
 * The flow a `task` dispatch goes to: the address's string as declared, or
 * its per-task target's answer for this task. `undefined` is same-flow for a
 * string-less address.
 *
 * @throws {DispatchRefusedError} `flow-not-found`, naming the assignee, when a
 *   per-task target answers nothing or an empty id. Decided before anything is
 *   dispatched, like every refusal.
 */
export async function resolveTaskFlowKind(
  blockName: string,
  address: Extract<DispatchAddress, { type: "task" }>,
  task: TaskTargetQuery,
  ctx: BlockContext
): Promise<string | undefined> {
  const target = address.flowKind;
  if (typeof target !== "function") return target;
  const resolved = await target(task, ctx);
  if (typeof resolved === "string" && resolved.length > 0) return resolved;
  throw new DispatchRefusedError(
    blockName,
    address,
    "flow-not-found",
    `nothing answers for assignee "${task.assignee}" (task "${task.taskId}"): its per-task ` +
      `target returned ${JSON.stringify(resolved)}.`
  );
}

/**
 * Put a dispatch through the runtime's dispatch seam.
 *
 * Substrate-facing. Authored flows reach this through `dispatcher()`; a
 * substrate block that calls it directly (the task board's dispatch) must also
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
 * the target resolves and a board can see the dispatch statically.
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
 * of its own. Declared on the flow like any other entry — `task: { actions: {
 * implement: { block } } }` — and reached only through a `task` dispatch from a
 * `dispatcher({ type: "task" })` in a board's `workers`. `defineFlow` wraps the entry
 * in that board's claim gate (see {@link TaskBinding}), so the block receives
 * the packed worker input the row was claimed with, never the envelope, and
 * never runs against a row nothing verified.
 */
export type TaskEntry = ActionCore & {
  /**
   * Where this entry takes tasks from when no board in this flow dispatches to
   * it: a binding whose gate reads each task off the ledger its dispatch
   * names, so one entry serves tasks from many ledgers, including ones made
   * after the flow was defined. `defineFlow` applies this gate exactly as it
   * applies a board's, so the entry still never runs against a row nothing
   * verified. An entry a board in this flow also dispatches to is refused: one
   * entry runs behind one gate.
   */
  readonly from?: TaskBinding;
  /**
   * The binding whose gate fronts this entry, set by `defineFlow` when it
   * applies the gate. Read by the run-time routability check on a carried
   * core: a task dispatcher produced at dispatch time must be held by the same
   * board, or its rows would be claimed on one ledger and refused at another
   * board's gate after the dispatch was accepted.
   */
  readonly gatedBy?: TaskBinding;
};

/**
 * What a task board binds onto the dispatch it installs at a `task`
 * dispatcher: which board it is, and the claim gate every entry the dispatcher
 * addresses must run behind.
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
  /** Wrap an entry in this board's claim gate. The second argument is the entry's name on the flow. */
  readonly gate: (entry: ActionCore, target: string) => ActionCore;
  /**
   * Internal entries the flow holding this board must declare (FIX-2078: a
   * board that hands rows out is heard back on `onTaskSettled`). `defineFlow`
   * refuses a flow that reaches the board and lacks one, by name.
   */
  readonly requiresInternal?: readonly string[];
  /**
   * The board hands its rows to an entry that declares where it takes tasks
   * from (`TaskEntry.from`) through that entry's own gate, which reads the row
   * off this board's ledger by id (FIX-2082: a worker's step filed
   * `session: "new"`, handed to its own `work` entry). Without it, an entry
   * with `from` that this board also dispatches to is refused. An entry
   * without `from` still runs behind this board's gate, and a flow that
   * declares no such entry is not refused: it files no row for it, and a
   * dispatch to it is refused `no-entry`.
   */
  readonly viaEntrySource?: boolean;
};

/**
 * Bindings are keyed by the block's ADDRESS object, not the block. Every
 * rebuild path (`connectInput`, `.rescue()`, `asTool`) forwards
 * `definition.dispatch` by reference, so a dispatch the drain connects into
 * its routing table — a rebuilt copy — still resolves the binding its board
 * put on the original. A block whose address is a different object is unbound.
 */
const taskBindings = new WeakMap<object, TaskBinding>();

/**
 * Bind a board's claim gate to the block that dispatches its tasks. Substrate-
 * facing; called by `taskBoard()` on the dispatch it installs at each
 * `dispatcher({ type: "task" })`, after `markDispatcher` has stamped the
 * address the binding is keyed by.
 *
 * @throws when the block carries no `task` address, or is already bound to a
 *   different board — one dispatch serves one board, or the walk could not say
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
