/**
 * `dispatcher()` — a block that sends one dispatch to one declared entry.
 *
 * A **router** picks a block to run *here*. A **dispatcher** names an entry to
 * run *elsewhere*: in a child session it derives, or in a session that already
 * exists. It is a handler under the hood — its body puts a typed envelope
 * through the runtime's dispatch seam and returns the handle the seam gives
 * back — and it carries its `(type, target)` on the block definition, so
 * `defineFlow` can check the target resolves and a task board can read which
 * of its seats hand off without running anything.
 *
 * **The address is static so it can be verified; the envelope is dynamic so it
 * can be useful.** `type` and `target` never vary — that pair is exactly what
 * `defineFlow`'s walk checks. The session and the payload are computed per
 * invocation from the block's input. When the *address* genuinely varies, that
 * is a `router` over declared dispatchers: the reachable set stays declared,
 * and a model choosing a recipient chooses from an allowlist rather than
 * producing a runtime string.
 *
 * ```ts
 * const wakeEpic = dispatcher({
 *   name: "wake-epic",
 *   type: "internal",
 *   target: "wake",                                    // flow.internal.wake
 *   inputSchema: z.object({ epicSessionId: z.string(), reason: z.string() }),
 *   session: { id: (input) => input.epicSessionId },   // deliver into an existing session
 *   payload: (input) => ({ reason: input.reason }),
 * });
 *
 * const runInBackground = dispatcher({
 *   name: "run-in-background",
 *   type: "internal",
 *   target: "analyze",
 *   inputSchema: z.object({ documentId: z.string() }),
 *   session: { key: (input) => input.documentId },     // one child per document, adopted on retry
 * });
 * ```
 *
 * A `task` dispatcher is a **seat on a task board**: put it under `workers`
 * where an inline worker would go, and the board hands each row it routes
 * there off to `flow.tasks[target]` in the child session the policy names.
 *
 * ```ts
 * const board = taskBoard({
 *   boardId: "issue-work",
 *   collection: issues,
 *   workers: {
 *     triage: triageWorker,                                   // inline
 *     implement: dispatcher({                                 // hands off
 *       name: "hand-off-implement",
 *       type: "task",
 *       target: "implement",                                  // flow.tasks.implement
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
 */
import { z, type ZodTypeAny } from "zod";
import type { BlockContext, BlockDefinition } from "../types/block";
import {
  DispatchRefusedError,
  dispatchThroughSeam,
  markDispatcher,
  taskDispatchInputSchema,
  taskSessionKeyFor,
  type DispatchAddress,
  type SessionTarget,
  type TaskSessionPolicy
} from "../types/dispatch";
import { handler } from "./handler";

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
 * Which session an `internal` dispatch runs in, computed from the dispatcher's
 * input.
 *
 * - `key` — a child of the running session, derived from the returned key.
 *   Minted on first use, adopted after: the same key from the same parent lands
 *   on the same child, so a retry re-enters the work it started. Use a value
 *   that names the unit of work — a document id, an issue key.
 * - `id` — an existing session. Delivered into it when it exists and belongs
 *   to this principal on this flow; refused by name otherwise. Never created.
 */
export type DispatcherSession<TInput> =
  | { readonly key: (input: TInput, ctx: BlockContext) => string }
  | { readonly id: (input: TInput, ctx: BlockContext) => string };

/** An `internal` dispatcher: sends this request's authority to `flow.internal[target]`. */
export interface InternalDispatcherConfig<TInputSchema extends ZodTypeAny = ZodTypeAny> {
  name: string;
  description?: string;
  type: "internal";
  /** The entry name — resolves `flow.internal[target]`. Verified at `defineFlow`. */
  target: string;
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
}

/**
 * A `task` dispatcher: a board seat that hands its rows off to
 * `flow.tasks[target]`. `TPayload` is the worker input a `key` policy reads —
 * a task board's `TaskWorkerInput`.
 */
export interface TaskDispatcherConfig<TPayload = unknown> {
  name: string;
  description?: string;
  type: "task";
  /** The entry name — resolves `flow.tasks[target]`. Verified at `defineFlow`. */
  target: string;
  /** Which child session each row runs in. See {@link TaskSessionPolicy}. */
  session: TaskSessionPolicy<TPayload>;
  /** Hide this block's trace from clients. Default: false. */
  transient?: boolean;
}

/** Either dispatcher config; the `type` field discriminates. */
export type DispatcherConfig<TInputSchema extends ZodTypeAny = ZodTypeAny, TPayload = unknown> =
  | InternalDispatcherConfig<TInputSchema>
  | TaskDispatcherConfig<TPayload>;

/** Build a dispatcher block. See the module header. */
export function dispatcher<TInputSchema extends ZodTypeAny = ZodTypeAny>(
  config: InternalDispatcherConfig<TInputSchema>
): BlockDefinition<TInputSchema, typeof dispatchHandleSchema>;
export function dispatcher<TPayload = unknown>(
  config: TaskDispatcherConfig<TPayload>
): BlockDefinition<typeof taskDispatchInputSchema, typeof dispatchHandleSchema>;
export function dispatcher(
  config: DispatcherConfig
): BlockDefinition<any, typeof dispatchHandleSchema> {
  const { name, description, type, target, transient } = config;
  if (typeof target !== "string" || target.length === 0) {
    throw new Error(`[dispatcher] "${name}" must name a non-empty target entry`);
  }
  if (type !== "internal" && type !== "task") {
    throw new Error(
      `[dispatcher] "${name}" dispatches type "${String(type)}", which authored code cannot ` +
        `supply the trust for. A block may dispatch "internal" (its own request's authority) ` +
        `or "task" (a claim on a durable row, minted by the task board that holds the seat).`
    );
  }

  const common = {
    name,
    ...(description !== undefined ? { description } : {}),
    ...(transient !== undefined ? { transient } : {})
  };

  if (config.type === "task") {
    const session = config.session;
    if (!isTaskSessionPolicy(session)) {
      throw new Error(
        `[dispatcher] "${name}" must declare a task session policy: "per-task", "per-worker", ` +
          `or { key: (task) => string }.`
      );
    }
    const address: DispatchAddress = { type: "task", target, session };
    const block = handler({
      ...common,
      inputSchema: taskDispatchInputSchema,
      outputSchema: dispatchHandleSchema,
      execute: async (envelope, ctx): Promise<DispatchHandle> => {
        const key = taskSessionKeyFor(name, session, envelope, ctx);
        const outcome = await dispatchThroughSeam(ctx, {
          type: "task",
          target,
          session: { key },
          payload: envelope,
          from: name,
          provenance: { taskId: envelope.taskId }
        });
        if (!outcome.ok) {
          throw new DispatchRefusedError(name, address, outcome.refused, outcome.detail);
        }
        return handleOf(outcome);
      }
    });
    return markDispatcher(block, address);
  }

  const { session, payload } = config;
  const address: DispatchAddress = { type: "internal", target };
  const inputSchema = config.inputSchema ?? z.unknown();
  const block = handler({
    ...common,
    inputSchema,
    outputSchema: dispatchHandleSchema,
    execute: async (input, ctx): Promise<DispatchHandle> => {
      const sessionTarget = resolveSessionTarget(name, session, input, ctx);
      const body = payload === undefined ? input : await payload(input, ctx);
      const outcome = await dispatchThroughSeam(ctx, {
        ...address,
        session: sessionTarget,
        payload: body,
        from: name
      });
      if (!outcome.ok) {
        throw new DispatchRefusedError(name, address, outcome.refused, outcome.detail);
      }
      return handleOf(outcome);
    }
  });
  return markDispatcher(block, address);
}

function handleOf(outcome: { sessionId: string; requestId: string; adopted: boolean }): DispatchHandle {
  return { sessionId: outcome.sessionId, requestId: outcome.requestId, adopted: outcome.adopted };
}

function isTaskSessionPolicy(value: unknown): value is TaskSessionPolicy<any> {
  if (value === "per-task" || value === "per-worker") return true;
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { key?: unknown }).key === "function"
  );
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
  if ("key" in session) {
    const key = session.key(input, ctx);
    if (typeof key !== "string" || key.length === 0) {
      throw new Error(
        `[dispatcher] "${blockName}" computed an empty session key (${JSON.stringify(key)}). ` +
          `The key names the child session; return a value that identifies the unit of work.`
      );
    }
    return { key };
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
