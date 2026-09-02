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
 * Only `internal` is dispatchable from authored code. A `task` dispatch carries
 * a verified claim on a durable row, which only a task board holds, so the
 * board builds that dispatcher itself.
 */
import { z, type ZodTypeAny } from "zod";
import type { BlockContext, BlockDefinition } from "../types/block";
import {
  DispatchRefusedError,
  dispatchThroughSeam,
  markDispatcher,
  type SessionTarget
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
 * Which session the dispatch runs in, computed from the dispatcher's input.
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

export interface DispatcherConfig<TInputSchema extends ZodTypeAny = ZodTypeAny> {
  name: string;
  description?: string;
  /** The dispatch type. Authored dispatchers send `internal` dispatches. */
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

/** Build a dispatcher block. See the module header. */
export function dispatcher<TInputSchema extends ZodTypeAny = ZodTypeAny>(
  config: DispatcherConfig<TInputSchema>
): BlockDefinition<TInputSchema, typeof dispatchHandleSchema> {
  const { name, description, type, target, session, payload, transient } = config;
  if (typeof target !== "string" || target.length === 0) {
    throw new Error(`[dispatcher] "${name}" must name a non-empty target entry`);
  }
  if (type !== "internal") {
    throw new Error(
      `[dispatcher] "${name}" dispatches type "${String(type)}", which authored code cannot ` +
        `supply the trust for. A block may dispatch "internal" (its own request's authority); ` +
        `a "task" dispatch is built by the task board that holds the claim.`
    );
  }
  const address = { type, target } as const;
  const inputSchema = (config.inputSchema ?? z.unknown()) as TInputSchema;

  const block = handler({
    name,
    ...(description !== undefined ? { description } : {}),
    ...(transient !== undefined ? { transient } : {}),
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
      return {
        sessionId: outcome.sessionId,
        requestId: outcome.requestId,
        adopted: outcome.adopted
      };
    }
  });

  return markDispatcher(block, address) as unknown as BlockDefinition<
    TInputSchema,
    typeof dispatchHandleSchema
  >;
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
