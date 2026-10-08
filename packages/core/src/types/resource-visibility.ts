/**
 * A flow's per-turn rule for which of its resources the model's resource
 * tools reach (`defineFlow({ resourceVisibility })`).
 *
 * The flow declares every resource it may ever need; the rule decides, on
 * each turn, which of them the model can list, search, read and write
 * through core's resource tools. It narrows only: a resource it calls
 * `"visible"` is still subject to its own `llmReadable` and `llmWritable`.
 *
 * Block code that names a resource (`ctx.resources.handbook`) is the app's
 * own and is not narrowed.
 */
import type { BlockContext } from "./block";
import type { AnyResourceRef } from "./resource";

/**
 * What the model's resource tools may do with one resource on this turn:
 *
 * - `"visible"`: everything its own flags allow;
 * - `"read-only"`: list, search and read it, but not write it. A write is
 *   refused exactly as for a resource that isn't `llmWritable`;
 * - `"hidden"`: nothing. It answers exactly like a resource that isn't
 *   registered: absent from every listing, and "not found" when named.
 */
export type ResourceVisibility = "visible" | "read-only" | "hidden";

/** One resource as the rule sees it: the key the flow registers it under, and its handle. */
export type ResourceVisibilityTarget = {
  /** The key in the flow's `resources` map (`ctx.resources[name]`). */
  readonly name: string;
  /** The resource or collection's handle on this turn. */
  readonly ref: AnyResourceRef;
};

/**
 * The rule. Called with the running block's context, on every listing and
 * lookup, so it must be synchronous and cheap. Derive the answer from data
 * the server wrote on this turn, never from the turn's input.
 */
export type ResourceVisibilityRule = (ctx: BlockContext, resource: ResourceVisibilityTarget) => ResourceVisibility;
