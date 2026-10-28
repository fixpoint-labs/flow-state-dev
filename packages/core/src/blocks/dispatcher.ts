/**
 * `dispatcher()` — a block that sends one dispatch to one declared entry, and
 * with `wait: true` waits for what it started (FIX-2082).
 *
 * A **router** picks a block to run *here*. A **dispatcher** names an entry to
 * run *elsewhere*: in a child session it derives, or in a session that already
 * exists. It is a handler under the hood — its body puts a typed envelope
 * through the runtime's dispatch seam and returns the handle the seam gives
 * back — and it carries its `(type, action)` on the block definition, so
 * `defineFlow` can check the action resolves and a task board can read which
 * of its assignees dispatch without running anything.
 *
 * **The address is static so it can be verified; the envelope is dynamic so it
 * can be useful.** `type` and `action` never vary — that pair is exactly what
 * `defineFlow`'s walk checks. The session and the payload are computed per
 * invocation from the block's input. When the *address* genuinely varies, that
 * is a `router` over declared dispatchers: the reachable set stays declared,
 * and a model choosing a recipient chooses from an allowlist rather than
 * producing a runtime string.
 *
 * ```ts
 * const wakeEpic = dispatcher({
 *   name: "wake-epic",
 *   action: "wake",                                    // flow.internal.actions.wake
 *   inputSchema: z.object({ epicSessionId: z.string(), reason: z.string() }),
 *   session: { id: (input) => input.epicSessionId },   // deliver into an existing session
 *   payload: (input) => ({ reason: input.reason }),
 * });
 *
 * const runInBackground = dispatcher({
 *   name: "run-in-background",
 *   action: "analyze",
 *   inputSchema: z.object({ documentId: z.string() }),
 *   session: { key: (input) => input.documentId },     // one child per document, adopted on retry
 * });
 *
 * const replyToSender = dispatcher({
 *   name: "reply-to-sender",
 *   action: "receive-reply",
 *   session: { from: true },                           // stamped sender, not a caller-named id
 * });
 * ```
 *
 * **Another flow is an address, not another mechanism.** Add `flowKind` — the
 * other flow instance's id, which for an ordinary singleton is its kind — and
 * the entry resolves on that instance instead of this one. The dispatch is
 * still fire-and-forget, and a reply is still the same `{ from: true }` block —
 * pointed back at the sender's flow.
 *
 * ```ts
 * const notifyBilling = dispatcher({
 *   name: "notify-billing",
 *   flowKind: "billing",                               // resolves on the billing flow
 *   action: "invoice-ready",
 *   inputSchema: z.object({ invoiceId: z.string() }),
 *   session: { key: (input) => input.invoiceId },
 * });
 * ```
 *
 * `defineFlow` holds one flow's entry maps, so it cannot check that address.
 * The seam does, against the flows the process registered, and refuses by name:
 * `flow-not-found` or `no-entry`, thrown as `DispatchRefusedError`.
 *
 * A `task` dispatcher **sits in a task board's `workers` under an assignee**,
 * where an inline worker would go, and the board hands each row it routes to
 * that assignee off to `flow.task.actions[action]` in the child session the
 * policy names.
 *
 * ```ts
 * const board = taskBoard({
 *   boardId: "issue-work",
 *   collection: issues,
 *   workers: {
 *     triage: triageWorker,                                   // inline
 *     implement: dispatcher({                                 // dispatches
 *       name: "dispatch-implement",
 *       action: "implement",                                  // flow.task.actions.implement
 *       session: "per-task",
 *     }),
 *   },
 * });
 * ```
 *
 * Its input is the claim envelope the board mints from the row it claimed — a
 * verified claim on a durable row is the trust a `task` dispatch carries, and
 * only a board holds one. Run anywhere else it dispatches an envelope no board
 * minted, and the entry's gate refuses it against the ledger.
 *
 * ## Waiting for the result (FIX-2082)
 *
 * An `internal` dispatcher with `wait: true` sends its dispatch, then parks its
 * request on the one wait gate, bound to the request it started, and outputs
 * how that request ended: `{ status: "completed", output }`,
 * `{ status: "failed", error }`, or `{ status: "running" }` at the host's
 * default deadline, which stops nothing. A durable host that keeps wakes is
 * needed; elsewhere, and past five waits deep, the block refuses before it
 * sends anything. A `task` dispatcher's `wait` is the board's to read: its drain
 * waits on the row it hands over.
 */
import { z, type ZodTypeAny } from "zod";
import type { BlockContext, BlockDefinition } from "../types/block";
import { canHoldWait, MAX_WAIT_DEPTH } from "../types/wait-gate";
import { waitOnRequest } from "./wait-on-request";
import {
  DispatchRefusedError,
  dispatchThroughSeam,
  markDispatcher,
  resolveTaskAction,
  resolveTaskFlowKind,
  resolveTaskSessionTarget,
  taskDispatchInputSchema,
  type DispatchAddress,
  type SessionTarget,
  type TaskEntryChoice,
  type TaskFlowTarget,
  type TaskTargetQuery,
  type TaskStateTarget,
  type TaskSessionPolicy
} from "../types/dispatch";
import { handler } from "./handler";
import { logicalBlockIdOf } from "./internal/block-instance-id";

/** What a dispatcher returns: enough to find the work it started. */
export const dispatchHandleSchema = z.object({
  /** The session the dispatch runs in — derived child or the named existing one. */
  sessionId: z.string(),
  /** The request the dispatch became. */
  requestId: z.string(),
  /** True when the child session already existed and was adopted. */
  adopted: z.boolean()
});

export type DispatchHandle = z.infer<typeof dispatchHandleSchema>;

/**
 * What a dispatcher with `wait: true` outputs: how the request it started
 * ended, or that it was still running at the deadline.
 */
export const dispatchWaitResultSchema = z.object({
  /** `completed` or `failed` once the request ended; `running` at the deadline, nothing stopped. */
  status: z.enum(["completed", "failed", "running"]),
  /** The request's output, when it completed. */
  output: z.unknown().optional(),
  /** Why it failed, when it failed or was stopped. */
  error: z.string().optional(),
  /** The request the dispatch became: how to find it later. */
  requestId: z.string()
});

export type DispatchWaitResult = z.infer<typeof dispatchWaitResultSchema>;

/**
 * Which session an `internal` dispatch runs in, computed from the dispatcher's
 * input.
 *
 * - `key` — a child of the running session, derived from the returned key.
 *   Minted on first use, adopted after: the same key from the same parent lands
 *   on the same child, so a retry re-enters the work it started. Use a value
 *   that names the unit of work — a document id, an issue key. Add `state` for
 *   the child's initial session state: the target flow's `stateSchema` parses
 *   it and its `session.createCheck` judges it. A child that already exists
 *   keeps its own.
 * - `id` — an existing session. Delivered into it when it exists and belongs
 *   to this principal on this flow; refused by name otherwise. Never created.
 * - `from: true` — the seam-stamped sender. The block names no session id;
 *   the runtime delivers into `metadata.dispatch.from.sessionId`. Use this to
 *   reply, not `{ id: (input) => input.replyTo }`.
 */
export type DispatcherSession<TInput> =
  | {
      readonly key: (input: TInput, ctx: BlockContext) => string;
      readonly state?:
        | Readonly<Record<string, unknown>>
        | ((input: TInput, ctx: BlockContext) => Readonly<Record<string, unknown>>);
    }
  | { readonly id: (input: TInput, ctx: BlockContext) => string }
  | { readonly from: true };

/** An `internal` dispatcher: sends this request's authority to `flow.internal.actions[action]`. */
export interface InternalDispatcherConfig<TInputSchema extends ZodTypeAny = ZodTypeAny> {
  name: string;
  description?: string;
  /**
   * Discriminant. Omit it — `internal` is the default. A board's dispatcher is
   * one whose `session` is a task policy; do not set `type` there.
   */
  type?: "internal";
  /**
   * The entry name — resolves `flow.internal.actions[action]` on the flow
   * {@link InternalDispatcherConfig.flowKind} names. Verified at `defineFlow`
   * for a same-flow address, at the seam for a cross-flow one.
   */
  action: string;
  /**
   * The **other flow instance** this dispatcher sends to — its exact id: a
   * singleton's kind, or a collection member's explicit id. Omit for the
   * sending instance's own entry, which is the ordinary case. A collection's
   * bare kind names no instance and refuses `flow-not-found`; an explicit
   * value equal to the sender's own id is the sender.
   *
   * A cross-flow dispatch is fire-and-forget in the same sense a same-flow one
   * is — it starts a request over there and returns the handle, it does not
   * wait for a result. Getting one back is the same three-request shape it is
   * within a flow: the recipient replies with a `{ from: true }` dispatcher of
   * its own, pointed back at `flowKind: <the sender's flow>`.
   *
   * `defineFlow` cannot check this address — it holds one flow's entry maps and
   * this names another's. The check runs at the seam instead, against what the
   * process actually registered, and refuses by name: `flow-not-found` for an
   * unregistered flow, `no-entry` for a flow that declares no such entry.
   * Both reach this block as a thrown `DispatchRefusedError`.
   */
  flowKind?: string;
  /** What this block accepts. Defaults to `z.unknown()`. */
  inputSchema?: TInputSchema;
  /** Which session the dispatch runs in. */
  session: DispatcherSession<z.infer<TInputSchema>>;
  /**
   * The entry's input, computed from this block's input. Defaults to the input
   * itself. Validated on arrival by the entry's own schema.
   */
  payload?: (input: z.infer<TInputSchema>, ctx: BlockContext) => unknown | Promise<unknown>;
  /** Hide this block's trace from clients. Default: false. */
  transient?: boolean;
  /**
   * Wait for the request this dispatch starts, and output how it ended
   * ({@link DispatchWaitResult}) instead of the handle. Default: `false`.
   * Bounded by the host's default wait deadline, at which the output is
   * `running` and nothing is stopped.
   */
  wait?: boolean;
}

/**
 * A `task` dispatcher: a board's dispatcher that hands its assignee's rows off to
 * `flow.task.actions[action]`. `TPayload` is the worker input a `key` policy reads —
 * a task board's `TaskWorkerInput`.
 */
export interface TaskDispatcherConfig<TPayload = unknown> {
  name: string;
  description?: string;
  /**
   * Discriminant. Omit it — a `"per-task"` / `"per-worker"` / `{ key }`
   * session already makes it a task dispatcher. The board reads `dispatch.type === "task"`
   * off the block; callers do not set this.
   */
  type?: "task";
  /**
   * The entry name — resolves `flow.task.actions[action]`. Verified at
   * `defineFlow` for a same-flow address, at the seam for a cross-flow one.
   *
   * Or `{ among, by }`, chosen per row: `by` is handed the row's assignee, id
   * and input and answers one of the names in `among`. Every name in `among`
   * is verified exactly as a string `action` is; an answer outside it refuses
   * the dispatch `no-entry`. See {@link TaskEntryChoice}.
   */
  action: string | TaskEntryChoice;
  /**
   * The **other flow** this dispatcher dispatches to. Omit for this flow's own
   * task entry. Same skip as an `internal` cross-flow address: `defineFlow`
   * cannot see the other flow's map, so the seam resolves it.
   *
   * Or a function, looked up once per task: `(task, ctx) => flowId`, handed
   * the row's assignee, id and input. Use it when which flow serves a task is
   * known only when the task is handed over (a flow registered after start,
   * say). Answering `undefined` refuses the dispatch `flow-not-found`, naming
   * the assignee. See {@link TaskFlowTarget}.
   */
  flowKind?: string | TaskFlowTarget;
  /** Which child session each row runs in. See {@link TaskSessionPolicy}. */
  session: TaskSessionPolicy<TPayload>;
  /**
   * The initial session state each row's child session is created with: a
   * fixed object, or `(task, ctx) => object`, looked up per task and handed
   * the row's assignee, id and input. The target flow's `stateSchema` parses
   * it and its `session.createCheck` judges it. A child that already exists
   * keeps its own. See {@link TaskStateTarget}.
   */
  state?: Readonly<Record<string, unknown>> | TaskStateTarget;
  /** Hide this block's trace from clients. Default: false. */
  transient?: boolean;
  /**
   * Whether the board's drain waits on each row it hands over. Unset follows
   * the board's mode: a plan board waits on every row, a delegation board on
   * none. A board refuses a dispatcher that contradicts its mode.
   */
  wait?: boolean;
}

/** Either dispatcher config; `session` (and an explicit `type`) discriminates. */
export type DispatcherConfig<TInputSchema extends ZodTypeAny = ZodTypeAny, TPayload = unknown> =
  | InternalDispatcherConfig<TInputSchema>
  | TaskDispatcherConfig<TPayload>;

/**
 * Build a dispatcher block. See the module header.
 *
 * The first signature takes an `internal` dispatcher that declares its
 * `inputSchema`, ahead of the task one, so the session callbacks (`key`,
 * `state`, `id`) are typed with that schema's input. TypeScript types a
 * callback against the first signature it tries, and a task config's
 * `(task: unknown)` would otherwise stick.
 */
export function dispatcher<TInputSchema extends ZodTypeAny>(
  config: InternalDispatcherConfig<TInputSchema> & { inputSchema: TInputSchema; wait: true }
): BlockDefinition<TInputSchema, typeof dispatchWaitResultSchema>;
export function dispatcher<TInputSchema extends ZodTypeAny>(
  config: InternalDispatcherConfig<TInputSchema> & { inputSchema: TInputSchema }
): BlockDefinition<TInputSchema, typeof dispatchHandleSchema>;
export function dispatcher<TPayload = unknown>(
  config: TaskDispatcherConfig<TPayload>
): BlockDefinition<typeof taskDispatchInputSchema, typeof dispatchHandleSchema>;
export function dispatcher<TInputSchema extends ZodTypeAny = ZodTypeAny>(
  config: InternalDispatcherConfig<TInputSchema> & { wait: true }
): BlockDefinition<TInputSchema, typeof dispatchWaitResultSchema>;
export function dispatcher<TInputSchema extends ZodTypeAny = ZodTypeAny>(
  config: InternalDispatcherConfig<TInputSchema>
): BlockDefinition<TInputSchema, typeof dispatchHandleSchema>;
export function dispatcher(
  config: DispatcherConfig
): BlockDefinition<any, typeof dispatchHandleSchema | typeof dispatchWaitResultSchema> {
  const { name, description, action, transient } = config;
  const type = resolveDispatcherType(config);
  if (typeof action === "object" && action !== null && type === "task") {
    assertEntryChoice(name, action);
  } else if (typeof action !== "string" || action.length === 0) {
    throw new Error(
      type === "task"
        ? `[dispatcher] "${name}" must name a non-empty action entry, or a choice ` +
            `{ among: [...names], by: (task) => name } among declared ones`
        : `[dispatcher] "${name}" must name a non-empty action entry. Only a task ` +
            `dispatcher chooses its entry per row.`
    );
  }
  if (type !== "internal" && type !== "task") {
    throw new Error(
      `[dispatcher] "${name}" dispatches type "${String(type)}", which authored code cannot ` +
        `supply the trust for. A block may dispatch "internal" (its own request's authority) ` +
        `or "task" (a claim on a durable row, minted by the task board that holds the dispatcher).`
    );
  }

  const common = {
    name,
    ...(description !== undefined ? { description } : {}),
    ...(transient !== undefined ? { transient } : {})
  };

  const flowKind = config.flowKind;
  if (typeof flowKind === "function" && resolveDispatcherType(config) !== "task") {
    throw new Error(
      `[dispatcher] "${name}" declares a computed flowKind on an internal dispatcher. Only a ` +
        `task dispatcher looks its flow up per task; an internal address names its flow as a string.`
    );
  }
  if (
    flowKind !== undefined &&
    typeof flowKind !== "function" &&
    (typeof flowKind !== "string" || flowKind.length === 0)
  ) {
    throw new Error(
      `[dispatcher] "${name}" declares an empty flowKind (${JSON.stringify(flowKind)}). ` +
        `A cross-flow address names the flow to resolve the entry on; omit it to address ` +
        `this flow's own entry.`
    );
  }

  if (type === "task") {
    const session = config.session;
    if (!isTaskSessionPolicy(session)) {
      throw new Error(
        `[dispatcher] "${name}" must declare a task session policy: "per-task", "per-worker", ` +
          `{ key: (task) => string }, or { by: (task) => ({ key } | { id }) }.`
      );
    }
    // A target looked up per task runs each task in a session of its own. The
    // entry it reaches may keep session state (an agent's conversation), and
    // a shared policy would run several tasks, possibly for different
    // workers, through one child session.
    if (typeof flowKind === "function" && session !== "per-task") {
      throw new Error(
        `[dispatcher] "${name}" looks its flow up per task but declares session ` +
          `${JSON.stringify(typeof session === "string" ? session : "by" in session ? "{ by }" : "{ key }")}. A per-task ` +
          `target hands each task over in a session of its own: declare \`session: "per-task"\`.`
      );
    }
    const childState = (config as TaskDispatcherConfig).state;
    const wait = (config as TaskDispatcherConfig).wait;
    const address: DispatchAddress = {
      type: "task",
      action,
      session,
      ...(flowKind !== undefined ? { flowKind } : {}),
      ...(childState !== undefined ? { state: childState } : {}),
      ...(wait !== undefined ? { wait } : {})
    };
    const block = handler({
      ...common,
      inputSchema: taskDispatchInputSchema,
      outputSchema: dispatchHandleSchema,
      execute: async (envelope, ctx): Promise<DispatchHandle> => {
        const task: TaskTargetQuery = {
          assignee: envelope.assignee,
          taskId: envelope.taskId,
          input: envelope.payload
        };
        const taskAddress = address as Extract<DispatchAddress, { type: "task" }>;
        const entry = await resolveTaskAction(name, taskAddress, task, ctx);
        const sessionTarget = await resolveTaskSessionTarget(name, taskAddress, envelope, task, ctx);
        const target = await resolveTaskFlowKind(name, taskAddress, task, ctx);
        const outcome = await dispatchThroughSeam(ctx, {
          type: "task",
          action: entry,
          session: sessionTarget,
          payload: envelope,
          from: name,
          provenance: { taskId: envelope.taskId },
          ...(target !== undefined ? { flowKind: target } : {})
        });
        if (!outcome.ok) {
          throw new DispatchRefusedError(name, address, outcome.refused, outcome.detail);
        }
        return handleOf(outcome);
      }
    });
    return markDispatcher(block, address);
  }

  const internal = config as InternalDispatcherConfig;
  const { session, payload } = internal;
  const address: DispatchAddress = {
    type: "internal",
    action: action as string,
    ...(flowKind !== undefined ? { flowKind: flowKind as string } : {})
  };
  const inputSchema = internal.inputSchema ?? z.unknown();
  const send = async (input: unknown, ctx: BlockContext, waits = false): Promise<DispatchHandle> => {
    const sessionTarget = resolveSessionTarget(name, session, input, ctx);
    const body = payload === undefined ? input : await payload(input, ctx);
    const outcome = await dispatchThroughSeam(ctx, {
      ...address,
      session: sessionTarget,
      payload: body,
      from: name,
      ...(waits ? { waits: true } : {})
    });
    if (!outcome.ok) {
      throw new DispatchRefusedError(name, address, outcome.refused, outcome.detail);
    }
    return handleOf(outcome);
  };
  if (internal.wait === true) {
    const block = handler({
      ...common,
      inputSchema,
      outputSchema: dispatchWaitResultSchema,
      execute: (input, ctx) => sendAndWait(name, ctx, () => send(input, ctx, true))
    });
    return markDispatcher(block, address);
  }
  const block = handler({
    ...common,
    inputSchema,
    outputSchema: dispatchHandleSchema,
    execute: (input, ctx) => send(input, ctx)
  });
  return markDispatcher(block, address);
}

/**
 * Send the dispatch once, then wait for the request it started (FIX-2082).
 *
 * Every check comes before anything is sent: a host that can hold the wait,
 * and a chain no deeper than {@link MAX_WAIT_DEPTH}. The dispatch and the
 * wait's plan (its gate and deadline) are each kept by `runOnce`, so the replay
 * after the park sends nothing again and parks on the same gate. The park is
 * owed before the dispatch (`RequestWaits.owingPark`), so a process that dies
 * between the two leaves a request the engine continues.
 */
async function sendAndWait(name: string, ctx: BlockContext, send: () => Promise<DispatchHandle>): Promise<DispatchWaitResult> {
  const waits = ctx.requestHost?.waits;
  if (waits === undefined || !canHoldWait(ctx) || ctx.runOnce === undefined || ctx.suspend === undefined) {
    throw new Error(
      `[dispatcher] "${name}": wait_unavailable: this host can't hold a wait (it needs a durable ` +
        `action on a host whose store keeps wakes), so nothing was dispatched. Drop \`wait\` to get the handle back.`
    );
  }
  const once = ctx.runOnce.bind(ctx);
  const key = logicalBlockIdOf(ctx);
  if (key === undefined) {
    // A key by anything less (the block's name) would let a second send read back the first.
    throw new Error(
      `[dispatcher] "${name}": wait_unavailable: this block has no identity to keep its dispatch under, so ` +
        "nothing was dispatched. Run it inside a request."
    );
  }
  const sendThenWait = async (): Promise<DispatchWaitResult> => {
    const handle = await once(`fsd.dispatch.send:${key}`, async () => {
      const depth = await waits.depth({});
      if (depth > MAX_WAIT_DEPTH) {
        throw new Error(
          `[dispatcher] "${name}": wait_too_deep: this wait would be ${depth} deep, and waits nest at most ` +
            `${MAX_WAIT_DEPTH} deep. Nothing was dispatched.`
        );
      }
      return send();
    });
    const requestId = handle.requestId;
    const outcome = await waitOnRequest(ctx, {
      requestId,
      gateId: `dispatch:${requestId}`,
      planKey: `fsd.dispatch.wait:${key}`,
      message: `Waiting on the request "${name}" dispatched`
    });
    return { ...outcome, requestId };
  };
  // The park is owed before the dispatch (FIX-2269): a process that dies
  // between the two leaves the request for the engine to continue.
  return waits.owingPark !== undefined ? waits.owingPark(sendThenWait) : sendThenWait();
}

function handleOf(outcome: { sessionId: string; requestId: string; adopted: boolean }): DispatchHandle {
  return { sessionId: outcome.sessionId, requestId: outcome.requestId, adopted: outcome.adopted };
}

function isTaskSessionPolicy(value: unknown): value is TaskSessionPolicy<any> {
  if (value === "per-task" || value === "per-worker") return true;
  if (typeof value !== "object" || value === null) return false;
  const { key, by } = value as { key?: unknown; by?: unknown };
  // Exactly one of the two: a policy that both keys and chooses is ambiguous.
  return typeof key === "function" ? by === undefined : typeof by === "function" && key === undefined;
}

/**
 * Refuse a per-row entry choice that could not be verified: `among` must list
 * at least one entry, each named once, and `by` must be the function that
 * picks among them.
 */
function assertEntryChoice(name: string, choice: TaskEntryChoice): void {
  const among: unknown = (choice as { among?: unknown }).among;
  const valid =
    Array.isArray(among) &&
    among.length > 0 &&
    among.every((entry) => typeof entry === "string" && entry.length > 0) &&
    new Set(among).size === among.length &&
    typeof choice.by === "function";
  if (!valid) {
    throw new Error(
      `[dispatcher] "${name}" chooses its entry per row but declares ${JSON.stringify(among)} ` +
        `as the entries it chooses among. Declare { among: ["entry", ...], by: (task) => entry }: ` +
        `at least one entry, each named once, so every entry a row can land on is verified.`
    );
  }
}

/**
 * `type` is optional. A task-board session policy (`"per-task"`,
 * `"per-worker"`, `{ by }`, or a bare `{ key }` with no internal fields), or an
 * entry chosen per row, makes a task dispatcher. Everything else — including `{ key }` plus `state`, `inputSchema` or `payload`
 * — is `internal`.
 */
function resolveDispatcherType(config: DispatcherConfig): string {
  if (config.type !== undefined) return config.type;
  // Only a task dispatcher chooses its entry or its session per row.
  if (typeof config.action === "object" && config.action !== null) return "task";
  const session = config.session;
  if (session === "per-task" || session === "per-worker") return "task";
  if (typeof session === "object" && session !== null) {
    if ("by" in session) return "task";
    if ("id" in session || "from" in session || "state" in session) return "internal";
    if (typeof (session as { key?: unknown }).key === "function") {
      const keyed = config as InternalDispatcherConfig;
      if (keyed.inputSchema != null || keyed.payload != null) return "internal";
      return "task";
    }
  }
  return "internal";
}

/**
 * Run the session policy and refuse an empty result by name. The value is
 * computed by the flow, so this is the likely path rather than a defensive
 * one — the refusal names the block and which half of the policy produced it.
 */
function resolveSessionTarget<TInput>(
  blockName: string,
  session: DispatcherSession<TInput>,
  input: TInput,
  ctx: BlockContext
): SessionTarget {
  if ("from" in session) {
    return { from: true };
  }
  if ("key" in session) {
    const key = session.key(input, ctx);
    if (typeof key !== "string" || key.length === 0) {
      throw new Error(
        `[dispatcher] "${blockName}" computed an empty session key (${JSON.stringify(key)}). ` +
          `The key names the child session; return a value that identifies the unit of work.`
      );
    }
    if (session.state === undefined) return { key };
    const state = typeof session.state === "function" ? session.state(input, ctx) : session.state;
    if (typeof state !== "object" || state === null || Array.isArray(state)) {
      throw new Error(
        `[dispatcher] "${blockName}" computed a child session state that is not an object ` +
          `(${JSON.stringify(state)}).`
      );
    }
    return { key, state };
  }
  const id = session.id(input, ctx);
  if (typeof id !== "string" || id.length === 0) {
    throw new Error(
      `[dispatcher] "${blockName}" computed an empty session id (${JSON.stringify(id)}). ` +
        `An \`id\` policy names an existing session; return the id of the session to deliver into.`
    );
  }
  return { id };
}
