/**
 * Server-side middleware types extending the core middleware contract
 * with execution context and metadata.
 */
import type {
  Middleware,
  MiddlewareContext as CoreMiddlewareContext,
  MiddlewareFn
} from "@flow-state-dev/core/types";
import type { ExecuteBlockContext, ExecutionMetadata } from "../execution/types";

/**
 * Extended middleware context available during server-side block execution.
 * Includes full execution metadata and the block's execution context.
 */
export type BlockMiddlewareContext = CoreMiddlewareContext & {
  /** Full execution metadata (requestId, userId, sessionId, etc.). */
  metadata: ExecutionMetadata;
  /** The block's execution context with state, response, and scope handles. */
  blockContext: ExecuteBlockContext;
};

// Re-export core middleware types for convenience.
export type { Middleware, MiddlewareContext, MiddlewareFn } from "@flow-state-dev/core/types";

/**
 * Typed middleware that receives the full server-side context.
 * Use this type when writing middleware that needs access to execution metadata
 * or block context (state, response emitter, etc.).
 */
export type BlockMiddleware = {
  name: string;
  execute: (
    context: BlockMiddlewareContext,
    next: () => Promise<unknown>
  ) => Promise<unknown>;
  filter?: Middleware["filter"];
};
