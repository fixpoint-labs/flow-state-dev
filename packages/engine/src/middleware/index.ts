/**
 * Engine-internal middleware composition seam.
 *
 * @internal Not a public API. Middleware is not an author-facing extension
 * point — this barrel is consumed only inside `@flow-state-dev/engine` and is
 * NOT re-exported from the package root. See
 * `docs/architecture/internal-execution-seams.md`.
 */
export { composeMiddleware, mergeMiddlewareStacks } from "./compose";
export type {
  BlockMiddlewareContext,
  Middleware,
  MiddlewareContext,
  MiddlewareFn
} from "./types";
