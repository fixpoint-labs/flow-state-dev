// Argument-shape resolution for the sequencer DSL. Several dispatching methods
// (`step`, `stepIf`, `work`, `workIf`, `forEach`, `forEachBackground`) accept
// the same families of overloads — a bare block, a connector plus block, a
// factory plus inline config, or a block plus options. This module is the
// single home for the discriminators that pull those overloads apart, so a new
// DSL method declares its shape rather than re-deriving it inline. The
// resolvers are deliberately condition-agnostic: callers that take a leading
// `condition` argument strip it before resolving.
//
// `doUntil` / `doWhile` keep their own inline two-line discrimination — they
// only support `(block) | (connector, block)` (no factory arm), so they don't
// consume this resolver.
import type { BlockContext, BlockDefinition, ConnectorFn } from "../../types/block";
import type { InlineBlockFactory } from "../sequencer-methods";
import { isBlockDefinition } from "./utils";

/**
 * Detects inline config objects passed to sequencer DSL methods.
 * Primary discriminator: `outputSchema` (a Zod type with a `_def` property).
 * Secondary discriminator: an `execute` function (for `tap`, where
 * `outputSchema` is optional). Rejects `BlockDefinition` objects, which also
 * carry properties but are identified by their `kind`/`name`/`config` shape.
 */
export function isInlineConfig(value: unknown): boolean {
  if (typeof value !== "object" || value === null || isBlockDefinition(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;

  // Primary: has a Zod outputSchema
  if (
    record.outputSchema !== undefined &&
    typeof record.outputSchema === "object" &&
    record.outputSchema !== null &&
    (record.outputSchema as Record<string, unknown>)._def !== undefined
  ) {
    return true;
  }

  // Secondary: has execute function (for tap where outputSchema is optional)
  return typeof record.execute === "function";
}

/**
 * Detects a concurrency-options object in the trailing argument slot of the
 * iterating methods (`forEach`, `forEachBackground`). Rejects block
 * definitions so a trailing block is never mistaken for options.
 *
 * Note: an empty object `{}` is treated as options (the `Object.keys` clause).
 * This matches current behavior; tightening it is a deliberate non-goal
 * (FIX-508 §7).
 */
export function isConcurrencyOptions(value: unknown): value is { maxConcurrency?: number; concurrency?: number } {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  if (isBlockDefinition(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return "maxConcurrency" in record || "concurrency" in record || Object.keys(record).length === 0;
}

/**
 * The resolved shape for a single-child method (`step`, `stepIf`). Exactly one
 * of `block` / `factory` is set. When `factory` is set, `inlineConfig`
 * accompanies it and the caller builds the concrete block at definition time
 * (so its output schema and declared resources flow into the sequencer's
 * accumulators).
 */
export type ChildCallShape = {
  block?: BlockDefinition<any, any>;
  connector?: ConnectorFn<any, any>;
  factory?: InlineBlockFactory;
  inlineConfig?: Record<string, unknown>;
  /** Per-step dispatch options (FIX-1005) — see {@link isStepOptions}. */
  stepOptions?: StepOptions;
};

/**
 * Per-step dispatch options for `.step()` (FIX-1005).
 *
 * Deliberately tiny. This is not a general escape hatch for per-step config —
 * both members carry something a step's *dispatch* owns and the block itself
 * cannot see: the signal it runs under, and the moment its dispatch ends.
 */
export type StepOptions = {
  /**
   * An **additional** abort signal this step runs under, resolved per
   * execution from the running context.
   *
   * Composed with the request's signal, never a replacement for it: the step
   * aborts when either fires, so a caller cannot accidentally make a step
   * outlive a cancelled request. Return `undefined` and the step runs exactly
   * as it would without the option.
   *
   * The resolver runs once per dispatch, immediately before the child is
   * invoked, so it can read state a preceding step wrote.
   */
  abortSignal?: (ctx: BlockContext) => AbortSignal | undefined;
  /**
   * Called once when this step's dispatch leaves, **by every path** — it
   * returned, it threw, or it suspended — and told which of the three it was.
   *
   * Suspension is the one that needs a seam at all. `.rescue()` is deliberately
   * not run for a `SuspensionError` (suspension is control flow, not a
   * failure), and a suspended request does not abort its signal either, so a
   * step that parks on `ctx.suspend()` passes through no handler a caller can
   * compose. Anything a preceding step started and this step's completion was
   * supposed to stop — a timer, a lease renewal, a subscription — outlives the
   * request without this.
   *
   * **Why the outcome is part of the contract.** A caller that releases on
   * every exit alike releases too early on the two exits that are *not*
   * suspension: `"returned"` and `"threw"` both hand off to a downstream step
   * (a recorder, a `.rescue()` handler) that still has work to do, and this
   * hook fires before that step runs. A lease renewal stopped here has stopped
   * before the write it was protecting. So the useful shape is usually "release
   * only on `"suspended"`, and let the downstream handler release the rest".
   *
   * Runs in a `finally` and cannot change the step's outcome — a throw from it
   * is caught, logged and discarded, so a cleanup bug cannot turn a suspension
   * into a crash. It is for releasing what the dispatch was holding, not for
   * recovery; throwing here is still a caller bug, it just is not the step's
   * problem.
   *
   * **Must be synchronous.** The return type is `void`, and TypeScript lets an
   * `async` function satisfy that — so an async hook type-checks, is never
   * awaited, and its release has not happened when the step settles (a
   * rejection from one surfaces as an unhandled rejection, not as an error
   * here). Awaiting it is deliberately not offered: it would move when the step
   * settles, and *when* is the whole point of this hook.
   *
   * **Not called when nothing was dispatched**, which is two situations, not
   * one: a `.stepIf()` whose condition was false, and a step whose child is
   * injected from the resume replay log instead of executed. The second matters
   * because a durable request can re-enter many times, and a hook that fired on
   * every re-entry would run non-idempotent cleanup — releasing a semaphore,
   * decrementing a refcount — once per resume for work that ran once.
   */
  onSettled?: (ctx: BlockContext, outcome: StepOutcome) => void;
};

/**
 * How a step's dispatch left (FIX-1005).
 *
 * `"suspended"` is separated from `"threw"` even though both arrive as a throw,
 * because they are opposite situations for a caller holding a resource: a
 * suspension has no downstream handler at all, and a genuine failure has one
 * (`.rescue()`) that is about to run.
 */
export type StepOutcome = "returned" | "threw" | "suspended";

/**
 * True when `value` is a `.step()` options bag rather than a block, a
 * connector, or an inline config.
 *
 * Keyed on the members the type declares. That keeps the discrimination
 * exact — an inline config carries neither, and a block is excluded outright —
 * so this shape cannot silently re-route an existing `step(connector, block)`
 * or `step(factory, config)` call. The inline-config arm is resolved before
 * this is ever consulted, so a block config can never reach it.
 *
 * **Keyed on presence, not on value type**, and that distinction is the whole
 * correctness of it. Every `StepOptions` member is optional, so all three of
 * these are well-typed calls and all three must resolve the same way:
 *
 * ```ts
 * .step(block, { abortSignal: resolver })   // a function value
 * .step(block, { abortSignal: maybe })      // key present, value undefined
 * .step(block, {})                          // no keys at all
 * ```
 *
 * The middle one is what conditional configuration actually produces — a caller
 * writing `{ abortSignal: enabled ? resolver : undefined }` rather than
 * spreading. Testing `typeof … === "function"` matches only the first, so the
 * other two fall through, the bag is promoted to the child slot, and `.step()`
 * dies at composition time on `block.config` — a valid call taking down the
 * sequencer that contains it, before anything runs.
 *
 * This is exactly the form {@link isConcurrencyOptions} already gets right, a
 * few lines above, by asking `in` rather than asking what the value is. Same
 * question, same answer, same shape.
 *
 * There is no ambiguity to trade away: such an object is not a block (excluded
 * above), not a connector (not a function), and not an inline config (which
 * carries `outputSchema` or `execute`, and is resolved before this is ever
 * consulted).
 */
function isStepOptions(value: unknown): value is StepOptions {
  if (typeof value !== "object" || value === null) return false;
  if (isBlockDefinition(value)) return false;
  const bag = value as Record<string, unknown>;
  return "abortSignal" in bag || "onSettled" in bag || Object.keys(bag).length === 0;
}

/** The resolved shape for a background method (`work`, `workIf`). */
export type BackgroundCallShape = {
  block: BlockDefinition<any, any>;
  connector?: ConnectorFn<any, any>;
  options?: Record<string, unknown>;
};

/** The resolved shape for an iterating method (`forEach`, `forEachBackground`). */
export type IteratingCallShape = {
  blockOrFactory: BlockDefinition<any, any> | ((...args: any[]) => BlockDefinition<any, any>);
  connector?: ConnectorFn<any, any>;
  options?: { maxConcurrency?: number; concurrency?: number };
};

/**
 * Resolve the overload shape for a sequencer DSL call.
 *
 * - `"child"`: `(block)` | `(connector, block)` | `(factory, inlineConfig)`.
 *   A leading function that is not a block, paired with an inline-config object,
 *   is the factory form; otherwise the presence of a second argument promotes
 *   the first to a connector.
 * - `"background"`: `(block)` | `(connector, block)` | `(block, options)` |
 *   `(connector, block, options)`. A block in the second slot signals a leading
 *   connector; otherwise the first argument is the block and the second is
 *   options.
 * - `"iterating"`: `(blockOrFactory)` | `(connector, blockOrFactory)`, each with
 *   optional trailing concurrency options. A connector is present when there is
 *   a third argument, or a second argument that is not a concurrency-options
 *   object.
 */
export function resolveCallShape(args: unknown[], pattern: "child"): ChildCallShape;
export function resolveCallShape(args: unknown[], pattern: "background"): BackgroundCallShape;
export function resolveCallShape(args: unknown[], pattern: "iterating"): IteratingCallShape;
export function resolveCallShape(
  args: unknown[],
  pattern: "child" | "background" | "iterating"
): ChildCallShape | BackgroundCallShape | IteratingCallShape {
  const [arg1, arg2, arg3] = args;

  if (pattern === "child") {
    if (typeof arg1 === "function" && !isBlockDefinition(arg1) && arg2 !== undefined && isInlineConfig(arg2)) {
      return {
        factory: arg1 as InlineBlockFactory,
        inlineConfig: arg2 as Record<string, unknown>
      };
    }
    // Peel a trailing step-options bag off first (FIX-1005), so the
    // connector/block resolution below sees exactly the arguments it always
    // did. `(block, opts)` and `(connector, block, opts)` both reduce to their
    // pre-existing shape once the bag is removed.
    const stepOptions = isStepOptions(arg3) ? arg3 : isStepOptions(arg2) ? arg2 : undefined;
    const positional = stepOptions === arg2 ? [arg1] : [arg1, arg2];
    const [first, second] = positional;
    const connector = second === undefined ? undefined : (first as ConnectorFn<any, any>);
    const block = (second ?? first) as BlockDefinition<any, any>;
    return { block, connector, stepOptions };
  }

  if (pattern === "background") {
    const hasConnector = isBlockDefinition(arg2);
    const connector = hasConnector ? (arg1 as ConnectorFn<any, any>) : undefined;
    const block = (hasConnector ? arg2 : arg1) as BlockDefinition<any, any>;
    const options = (hasConnector ? arg3 : arg2) as Record<string, unknown> | undefined;
    return { block, connector, options };
  }

  // pattern === "iterating"
  const hasConnector = arg3 !== undefined || (arg2 !== undefined && !isConcurrencyOptions(arg2));
  const connector = hasConnector ? (arg1 as ConnectorFn<any, any>) : undefined;
  const blockOrFactory = (hasConnector ? arg2 : arg1) as IteratingCallShape["blockOrFactory"];
  const options = (hasConnector ? arg3 : arg2) as IteratingCallShape["options"];
  return { blockOrFactory, connector, options };
}
