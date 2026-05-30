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
import type { BlockDefinition, ConnectorFn } from "../../types/block";
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
};

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
    const connector = arg2 === undefined ? undefined : (arg1 as ConnectorFn<any, any>);
    const block = (arg2 ?? arg1) as BlockDefinition<any, any>;
    return { block, connector };
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
