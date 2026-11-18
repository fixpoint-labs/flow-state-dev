/**
 * Platform-agnostic Next.js App Router adapter for a `FlowState`.
 *
 * `createNextHandler(flowstate)` returns the `{ GET, POST, PATCH, DELETE }`
 * exports a catch-all route file needs. It resolves the flow-state router
 * lazily on the first request and awaits Next.js 15's async `params`. No
 * Vercel-specific SSE header injection happens here, so the same handler
 * works on Next-on-Cloudflare and other non-Vercel Next deployments. On
 * Vercel, compose with `@flow-state-dev/vercel/next` instead.
 */
import { createNetworkAuthGuard, type FlowApiRouter } from "@flow-state-dev/engine/host";
import type { FlowState } from "@flow-state-dev/engine";

/** Next.js 15 route context — `params` is a promise. */
type NextRouteHandlerContext = { params: Promise<{ path?: string[] }> };

type NextRouteHandler = (
  req: Request,
  ctx: NextRouteHandlerContext
) => Promise<Response>;

async function dispatch(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  req: Request,
  ctx: NextRouteHandlerContext,
  getRouter: () => Promise<FlowApiRouter>,
  guard: ReturnType<typeof createNetworkAuthGuard>
): Promise<Response> {
  const router = await getRouter();
  const refused = await guard(router);
  if (refused !== undefined) return refused;
  const params = await ctx.params;
  return router[method](req, { params });
}

/**
 * Build the catch-all route handlers for a `FlowState`. Mount as:
 *
 * ```ts
 * export const { GET, POST, PATCH, DELETE } = createNextHandler(flowstate);
 * ```
 */
export function createNextHandler(flowstate: FlowState, options: {
  /** Explicitly permit flows that trust a caller-supplied userId. */
  allowUnauthenticated?: boolean;
} = {}): {
  GET: NextRouteHandler;
  POST: NextRouteHandler;
  PATCH: NextRouteHandler;
  DELETE: NextRouteHandler;
} {
  const guard = createNetworkAuthGuard(options.allowUnauthenticated);
  const getRouter = () => flowstate.getRouter();
  return {
    GET: (req, ctx) => dispatch("GET", req, ctx, getRouter, guard),
    POST: (req, ctx) => dispatch("POST", req, ctx, getRouter, guard),
    PATCH: (req, ctx) => dispatch("PATCH", req, ctx, getRouter, guard),
    DELETE: (req, ctx) => dispatch("DELETE", req, ctx, getRouter, guard)
  };
}
