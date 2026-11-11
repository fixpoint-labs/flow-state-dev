/**
 * Vercel deployment adapter for flow-state-dev.
 *
 * Wraps a `FlowApiRouter` (from `createFlowApiRouter`) into Next.js App Router
 * handlers with Vercel-specific SSE response shaping and runtime configuration.
 *
 * SSE heartbeats are emitted by `@flow-state-dev/engine` for every live and
 * GET-attach stream — this adapter no longer injects them itself.
 */
import { declareEphemeralDisk } from "@flow-state-dev/engine/host";
import type {
  FlowApiRouter,
  VercelHandlerInput,
  VercelHandlerOptions
} from "./types";

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
 * This host's runtime: on Vercel (`VERCEL` set, as the platform sets it), a
 * function's disk does not last between requests, so the router is told
 * before it serves one. It then refuses attachment uploads to a blob store
 * that keeps bytes on this host, by name, rather than storing files the next
 * request can't read; a hosted blob store is unaffected. Served anywhere else,
 * such as `next dev` or `next start` on a machine, the disk lasts and a local
 * blob store takes uploads.
 */
function onThisHost(router: FlowApiRouter): FlowApiRouter {
  if (process.env.VERCEL) declareEphemeralDisk(router);
  return router;
}

function resolveRouter(input: VercelHandlerInput): FlowApiRouter | Promise<FlowApiRouter> {
  const router = typeof input === "function" ? input() : input;
  return router instanceof Promise ? router.then(onThisHost) : onThisHost(router);
}

type CatchAllHandler = (
  req: Request,
  ctx: { params: Promise<{ path?: string[] }> }
) => Promise<Response>;

type BareHandler = (req: Request) => Promise<Response>;

/**
 * Shared handler factory used by both createVercelHandler and createVercelBareHandler.
 */
function createHandlerCore(
  app: VercelHandlerInput,
  options?: VercelHandlerOptions
) {
  const onAbort = options?.onAbort;

  let cachedRouter: FlowApiRouter | Promise<FlowApiRouter> | undefined;

  function getRouter(): FlowApiRouter | Promise<FlowApiRouter> {
    if (cachedRouter === undefined) {
      cachedRouter = resolveRouter(app);
    }
    return cachedRouter;
  }

  function wrapResponse(response: Response): Response {
    if (!isSSEResponse(response) || response.body === null) {
      return response;
    }
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(VERCEL_SSE_HEADERS)) {
      headers.set(key, value);
    }
    return new Response(response.body, { status: response.status, headers });
  }

  return { getRouter, wrapResponse, onAbort };
}

/**
 * Creates Next.js App Router handlers for deploying a flow-state-dev app to Vercel.
 *
 * Handles the Next.js 15 async params contract and injects Vercel-specific
 * SSE headers to prevent proxy buffering. SSE heartbeats are emitted by
 * `@flow-state-dev/engine` for every live and GET-attach stream.
 *
 * ```ts
 * // app/api/fsd/[...path]/route.ts
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
  GET: CatchAllHandler;
  POST: CatchAllHandler;
  PATCH: CatchAllHandler;
  DELETE: CatchAllHandler;
} {
  const { getRouter, wrapResponse, onAbort } = createHandlerCore(app, options);

  function makeHandler(method: keyof FlowApiRouter): CatchAllHandler {
    return async (req, ctx) => {
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

/**
 * Creates bare-path handlers for the `/api/flows` route (no path segments).
 *
 * Next.js `[...path]` catch-all requires at least one segment, so the bare
 * path needs a sibling `route.ts` that forwards to the router with an empty
 * path array.
 *
 * ```ts
 * // app/api/flows/route.ts
 * import { createVercelBareHandler } from '@flow-state-dev/vercel';
 * import { getRouter } from '@/lib/server';
 *
 * export const { GET, POST } = createVercelBareHandler(getRouter);
 * ```
 */
export function createVercelBareHandler(
  app: VercelHandlerInput,
  options?: VercelHandlerOptions
): {
  GET: BareHandler;
  POST: BareHandler;
} {
  const { getRouter, wrapResponse } = createHandlerCore(app, options);

  function makeBareHandler(method: keyof FlowApiRouter): BareHandler {
    return async (req) => {
      const router = await getRouter();
      const response = await router[method](req, { params: { path: [] } });
      return wrapResponse(response);
    };
  }

  return {
    GET: makeBareHandler("GET"),
    POST: makeBareHandler("POST")
  };
}
