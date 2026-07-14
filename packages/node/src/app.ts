/**
 * `createServerApp(app, options)` — the portable Hono app that fronts a
 * `FlowState` (or a pre-built `FlowApiRouter`).
 *
 * This is the one serving primitive every host target wraps. It owns the
 * cross-target host policy — lazy router resolution, a `/healthz` endpoint
 * (503 while initializing, 500 on permanent init failure, 200 once ready), and
 * an API catch-all that delegates to the engine's `FlowApiRouter` — and exposes
 * a Web-Fetch handler (`app.fetch`) that runs unchanged on `@hono/node-server`
 * (long-lived), AWS Lambda, Bun, or Deno. It deliberately does NOT serve static
 * assets and does NOT import `@hono/node-server`, so it stays importable from
 * any runtime; static/DevTool serving is a long-lived-host concern that lives
 * in `serve()`.
 */
import { Hono, type Context } from "hono";
import {
  dispatchDedicatedRoute,
  disposeFlowApiRouter,
  isFlowState,
  type FlowApiRouter,
  type FlowState,
} from "@flow-state-dev/engine";

/** Options for {@link createServerApp}. Defaults match `createFlowApiRouter`. */
export interface ServerAppOptions {
  /**
   * API mount prefix. Default `"/api/flows"`. Interpolated raw into a Hono route
   * pattern, so avoid `:` and `*` (Hono pattern syntax) in a custom value.
   */
  basePath?: string;
  /** Health endpoint path. Default `"/healthz"`. 200 once ready, 503 before. */
  healthPath?: string;
}

/** The portable host app plus its lifecycle handles. */
export interface ServerApp {
  /**
   * The Hono app. `app.fetch` is the Web-Fetch handler every adapter consumes
   * (`@hono/node-server`, `hono/aws-lambda`, Bun, Deno).
   */
  readonly app: Hono;
  /**
   * Dispose the resolved router and, when built from a `FlowState`, its stores.
   * Idempotent and safe to call before initialization settles.
   */
  dispose(): Promise<void>;
}

const DEFAULT_BASE_PATH = "/api/flows";
const DEFAULT_HEALTH_PATH = "/healthz";

/** Escape a string for safe use as a literal inside a `RegExp`. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Segments after the mount prefix, e.g. `/api/flows/chat/send` → `["chat","send"]`. */
function pathSegments(pathname: string, basePath: string): string[] {
  const prefix = new RegExp(`^${escapeRegExp(basePath)}/?`);
  const after = pathname.replace(prefix, "");
  return after.split("/").filter((s) => s.length > 0);
}

/**
 * Build the portable host app for `app` (a `FlowState` or a raw
 * `FlowApiRouter`).
 *
 * Router resolution starts immediately: for a `FlowState` this kicks off store
 * init and the app reports 503 on `/healthz` and the API until it resolves (500
 * if it rejects); a raw router is ready at once. The API catch-all delegates to
 * the engine router by HTTP method, passing the Web `Request` straight through —
 * SSE response bodies stream unbuffered on whichever host runs `app.fetch`.
 */
export function createServerApp(
  app: FlowState | FlowApiRouter,
  options: ServerAppOptions = {},
): ServerApp {
  const basePath = options.basePath ?? DEFAULT_BASE_PATH;
  const healthPath = options.healthPath ?? DEFAULT_HEALTH_PATH;

  const flowState = isFlowState(app) ? app : undefined;

  let router: FlowApiRouter | undefined;
  let ready = false;
  let initError: Error | undefined;
  let routerPromise: Promise<FlowApiRouter>;
  if (flowState !== undefined) {
    // A FlowState resolves its router asynchronously (store init); report 503
    // until it settles, 500 if it rejects.
    routerPromise = flowState.getRouter();
    routerPromise.then(
      (r) => {
        router = r;
        ready = true;
      },
      (err: unknown) => {
        initError = err instanceof Error ? err : new Error(String(err));
      },
    );
  } else {
    // A raw router has nothing to initialize — ready synchronously, so a host
    // that dispatches the first request immediately (a warm serverless invoke)
    // doesn't race a microtask and see a spurious 503.
    router = app as FlowApiRouter;
    ready = true;
    routerPromise = Promise.resolve(router);
  }

  const hono = new Hono();

  hono.get(healthPath, (c) => {
    if (initError !== undefined) {
      // A permanent init failure (bad config, unreachable store) won't resolve
      // by retrying — return 500 so a PaaS fails the deploy fast instead of
      // treating a 503 as transient and spinning in a health-check retry loop.
      return c.json({ status: "error", message: initError.message }, 500);
    }
    if (ready) return c.json({ status: "ok" }, 200);
    return c.json({ status: "initializing" }, 503);
  });

  const dispatch = async (c: Context): Promise<Response> => {
    // Await the (lazy) router rather than snapshotting `ready`: a serverless host
    // has no `/healthz` gate, so the invoke that triggers a cold start must wait
    // for store init instead of getting a spurious 503. `/healthz` keeps the
    // point-in-time snapshot (below) where a PaaS needs it. For the long-lived
    // host this turns "503 during boot" into "the request waits until ready".
    let resolved: FlowApiRouter;
    try {
      resolved = await routerPromise;
    } catch {
      return c.json({ error: "Server failed to initialize" }, 500);
    }
    const method = c.req.method.toUpperCase();
    const handler = resolved[method as keyof FlowApiRouter];
    if (handler === undefined) {
      // Methods the router doesn't expose (PUT, HEAD, OPTIONS, ...) get 405.
      // HEAD is deliberately not normalized to GET — that would execute the GET
      // action handler (with its side effects) just to discard the body.
      return c.json({ error: "Method not allowed" }, 405);
    }
    const path = pathSegments(c.req.path, basePath);
    return handler(c.req.raw, { params: { path } });
  };

  // The bare mount and everything under it both reach the engine router.
  hono.all(basePath, dispatch);
  hono.all(`${basePath}/*`, dispatch);

  // Keep API errors uniformly JSON: a router throw would otherwise fall through
  // to Hono's default plain-text 500. Only custom transport-adapter routes throw
  // uncaught — the engine's canonical `handle` catches internally.
  hono.onError((_err, c) => c.json({ error: "Internal server error" }, 500));

  // Anything Hono didn't otherwise route is offered to the engine's DEDICATED
  // route dispatcher, which serves ONLY a transport adapter's routes that live
  // OUTSIDE `basePath` — e.g. the MCP adapter's `/mcp/:kind` under
  // `dedicatedBasePath` — and never the canonical flow-API handler. That keeps
  // the flow API (list-flows, actions, sessions) reachable ONLY under
  // `basePath`: an out-of-prefix path like `/my-flow/run` (or a bare `GET /`)
  // is a plain 404, not a leaked endpoint. This runs after any statically-
  // mounted routes (the DevTool `get("*")` that `serve()` adds for a
  // `staticDir`), so it only catches what they don't.
  hono.notFound(async (c) => {
    let resolved: FlowApiRouter;
    try {
      resolved = await routerPromise;
    } catch {
      return c.json({ error: "Server failed to initialize" }, 500);
    }
    const res = await dispatchDedicatedRoute(resolved, c.req.raw);
    return res ?? c.json({ error: "Not found" }, 404);
  });

  return {
    app: hono,
    async dispose() {
      try {
        await routerPromise;
      } catch {
        // init failed; nothing to dispose on the router side.
      }
      if (router !== undefined) await disposeFlowApiRouter(router);
      if (flowState !== undefined) await flowState.dispose();
    },
  };
}
