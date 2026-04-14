/**
 * Vercel deployment adapter for flow-state-dev.
 *
 * Wraps a `FlowApiRouter` (from `createFlowApiRouter`) into Next.js App Router
 * handlers with Vercel-specific SSE response shaping, heartbeats, and
 * runtime configuration.
 */
import type {
  FlowApiRouter,
  NextAppRouteHandler,
  VercelHandlerInput,
  VercelHandlerOptions
} from "./types";
import { injectHeartbeat } from "./heartbeat";

const DEFAULT_HEARTBEAT_MS = 15_000;

/**
 * Additional SSE headers for Vercel's proxy infrastructure.
 *
 * - `no-transform` prevents CDN/proxy layers from buffering or gzipping the stream.
 * - `X-Accel-Buffering: no` disables Nginx-level buffering (Vercel's edge uses Nginx).
 */
const VERCEL_SSE_HEADERS: Record<string, string> = {
  "cache-control": "no-cache, no-transform",
  "x-accel-buffering": "no"
};

function isSSEResponse(response: Response): boolean {
  const ct = response.headers.get("content-type") ?? "";
  return ct.includes("text/event-stream");
}

/**
 * Resolves a `VercelHandlerInput` to a concrete router. Handles both
 * pre-built routers and lazy factory functions (sync or async).
 */
function resolveRouter(input: VercelHandlerInput): FlowApiRouter | Promise<FlowApiRouter> {
  if (typeof input === "function") return input();
  return input;
}

/**
 * Creates Next.js App Router handlers for deploying a flow-state-dev app to Vercel.
 *
 * Handles the Next.js 15 async params contract, injects Vercel-specific SSE
 * headers to prevent proxy buffering, and adds periodic heartbeat comments
 * to keep long-lived streams alive.
 *
 * ```ts
 * // app/api/fsd/[[...path]]/route.ts
 * import { createVercelHandler } from '@flow-state-dev/vercel';
 * import { getRouter } from '@/lib/server';
 *
 * export const { GET, POST, PATCH, DELETE } = createVercelHandler(getRouter);
 *
 * export const runtime = "nodejs";
 * export const maxDuration = 300;
 * export const dynamic = "force-dynamic";
 * ```
 */
export function createVercelHandler(
  app: VercelHandlerInput,
  options?: VercelHandlerOptions
): {
  GET: NextAppRouteHandler;
  POST: NextAppRouteHandler;
  PATCH: NextAppRouteHandler;
  DELETE: NextAppRouteHandler;
} {
  const heartbeatMs = options?.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const onAbort = options?.onAbort;

  // Cache the resolved router promise so the factory is called at most once.
  let cachedRouter: FlowApiRouter | Promise<FlowApiRouter> | undefined;

  function getRouter(): FlowApiRouter | Promise<FlowApiRouter> {
    if (cachedRouter === undefined) {
      cachedRouter = resolveRouter(app);
    }
    return cachedRouter;
  }

  /**
   * Adds Vercel-specific headers to SSE responses and wraps the stream body
   * with heartbeat injection. Non-SSE responses pass through unchanged.
   */
  function wrapResponse(response: Response): Response {
    if (!isSSEResponse(response) || response.body === null) {
      return response;
    }

    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(VERCEL_SSE_HEADERS)) {
      headers.set(key, value);
    }

    const body = injectHeartbeat(response.body, heartbeatMs);
    return new Response(body, { status: response.status, headers });
  }

  function makeHandler(method: keyof FlowApiRouter): NextAppRouteHandler {
    return async (req, ctx) => {
      // Wire up abort callback if provided.
      if (onAbort !== undefined) {
        req.signal.addEventListener("abort", () => onAbort(req), { once: true });
      }

      const [router, params] = await Promise.all([getRouter(), ctx.params]);
      const response = await router[method](req, { params });
      return wrapResponse(response);
    };
  }

  return {
    GET: makeHandler("GET"),
    POST: makeHandler("POST"),
    PATCH: makeHandler("PATCH"),
    DELETE: makeHandler("DELETE")
  };
}
