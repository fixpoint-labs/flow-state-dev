/**
 * Engine-internal middleware type contracts for block execution interception.
 *
 * Middleware is NOT a public extension point. These types support the
 * framework-owned composition seam fed exclusively through `RuntimeConfig`
 * (see `docs/architecture/internal-execution-seams.md`). App authors use
 * lifecycle hooks, `.tap()`, capabilities, or the trace system instead.
 *
 * Middleware wraps block execution with an `around` pattern: each middleware
 * receives execution context and a `next()` function that continues the chain.
 * The innermost `next()` runs the block itself.
 */
import type { BlockKind } from "@flow-state-dev/core/types";
import type { ExecuteBlockContext, ExecutionMetadata } from "../execution/types";

/**
 * Context passed to middleware during block execution.
 * Server-side execution extends this with additional metadata.
 */
export type MiddlewareContext = {
  /** Identity of the block being executed. */
  block: {
    name: string;
    kind: BlockKind;
  };
  /** The input being passed to the block (read-only snapshot). */
  input: unknown;
};

/**
 * A middleware function that wraps block execution.
 *
 * Call `next()` to continue the chain. The return value from `next()` is
 * the block output; the middleware may transform it before returning.
 *
 * @example
 * ```typescript
 * const timing: MiddlewareFn = async (ctx, next) => {
 *   const start = Date.now();
 *   const output = await next();
 *   console.log(`${ctx.block.name} took ${Date.now() - start}ms`);
 *   return output;
 * };
 * ```
 */
export type MiddlewareFn = (
  context: MiddlewareContext,
  next: () => Promise<unknown>
) => Promise<unknown>;

/**
 * Named middleware definition with optional block filter.
 *
 * @example
 * ```typescript
 * const loggingMiddleware: Middleware = {
 *   name: "request-logger",
 *   execute: async (ctx, next) => {
 *     console.log(`executing ${ctx.block.name}`);
 *     return next();
 *   },
 *   filter: (block) => block.kind === "handler",
 * };
 * ```
 */
export type Middleware = {
  /** Unique name for debugging and ordering. */
  name: string;
  /** The middleware function. */
  execute: MiddlewareFn;
  /** Optional filter: only apply to blocks matching this predicate. */
  filter?: (block: { name: string; kind: BlockKind }) => boolean;
};

/**
 * Extended middleware context available during server-side block execution.
 * Includes full execution metadata and the block's execution context.
 */
export type BlockMiddlewareContext = MiddlewareContext & {
  /** Full execution metadata (requestId, userId, sessionId, etc.). */
  metadata: ExecutionMetadata;
  /** The block's execution context with state, response, and scope handles. */
  blockContext: ExecuteBlockContext;
};
