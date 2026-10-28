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
import { Hono } from "hono";
import {
  createInProcessFetch,
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
   * Match `req` against ONLY a transport adapter's dedicated routes (those
   * registered OUTSIDE `basePath`, e.g. the MCP adapter's `/mcp/:kind` under
   * `dedicatedBasePath`). Returns the matched `Response`, or `null` when none
   * match — it never touches the canonical flow-API handler. The app already
   * uses this in its not-found fallback; a host that registers its own broad
   * catch-all AFTER the app (e.g. `serve()`'s SPA `get("*")` for a `staticDir`)
   * must call it first so a dedicated route isn't shadowed by that fallback.
   * Blocks on init like the canonical handler, so a dedicated route (including a
   * GET one — OAuth/webhook callbacks) is served once ready rather than falling
   * through to the fallback during a store cold start. Returns null if init
   * failed. The SPA host should call it only AFTER its static-file fast path, so
   * real assets are still served without waiting on init.
   */
  tryDedicatedRoute(req: Request): Promise<Response | null>;
  /**
   * Dispose the resolved router and, when built from a `FlowState`, its stores.
   * Idempotent and safe to call before initialization settles.
   *
   * @param options.drainMs How long the router waits for the requests its due
   *   wakes started before it aborts them (the router's own default, 10 s,
   *   when omitted). `serve` passes what is left of its shutdown grace.
   */
  dispose(options?: { drainMs?: number }): Promise<void>;
}

const DEFAULT_BASE_PATH = "/api/flows";
const DEFAULT_HEALTH_PATH = "/healthz";

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

  // The engine's one dispatch path, the same an in-process client takes: it
  // awaits the (lazy) router rather than snapshotting `ready` — a serverless
  // host has no `/healthz` gate, so the invoke that triggers a cold start
  // waits for store init instead of getting a spurious 503 (500 if init
  // failed) — answers 405 for a method the router lacks, and reads the path
  // from the raw URL under `basePath`. `/healthz` keeps the point-in-time
  // snapshot (below) where a PaaS needs it. Given the same `FlowState`, it
  // resolves the same memoized router this app holds.
  const inProcessFetch = createInProcessFetch(app, { basePath });

  // The bare mount and everything under it both reach the engine router.
  hono.all(basePath, (c) => inProcessFetch(c.req.raw));
  hono.all(`${basePath}/*`, (c) => inProcessFetch(c.req.raw));

  // Keep API errors uniformly JSON: a router throw would otherwise fall through
  // to Hono's default plain-text 500. Only custom transport-adapter routes throw
  // uncaught — the engine's canonical `handle` catches internally.
  hono.onError((_err, c) => c.json({ error: "Internal server error" }, 500));

  // Dedicated-route match for a host that mounts its own broad catch-all AFTER
  // the app — `serve()`'s SPA `get("*")` for a `staticDir`. It BLOCKS on init
  // (awaits `routerPromise`) so a dedicated route — including a GET one, e.g. an
  // OAuth/webhook callback — is served once ready instead of falling through to
  // the SPA HTML during a store cold start. Returns null if init failed. The SPA
  // host calls this only AFTER its static-file fast path, so real assets are
  // still served from disk without waiting on init.
  const tryDedicatedRoute = async (req: Request): Promise<Response | null> => {
    let resolved: FlowApiRouter;
    try {
      resolved = await routerPromise;
    } catch {
      return null;
    }
    return dispatchDedicatedRoute(resolved, req, basePath);
  };

  // The last-resort fallback: anything Hono didn't otherwise route (in
  // production, every miss; in `fsdev dev`, only the non-GET misses — the SPA
  // `get("*")` catches GET). It serves ONLY dedicated out-of-`basePath` adapter
  // routes, never the canonical flow-API handler, so the flow API (list-flows,
  // actions, sessions) stays reachable ONLY under `basePath`: an out-of-prefix
  // path like `/my-flow/run` (or a bare `GET /`) is a plain 404, not a leak.
  //
  // Unlike the SPA fallback it BLOCKS on init (awaits `routerPromise`) like the
  // canonical handler: a dedicated route (e.g. `POST /mcp/:kind`) that arrives
  // during a store cold start is served once ready instead of a spurious 404,
  // and it has no static assets to stall. A permanent init failure 500s.
  hono.notFound(async (c) => {
    let resolved: FlowApiRouter;
    try {
      resolved = await routerPromise;
    } catch {
      return c.json({ error: "Server failed to initialize" }, 500);
    }
    const res = await dispatchDedicatedRoute(resolved, c.req.raw, basePath);
    return res ?? c.json({ error: "Not found" }, 404);
  });

  return {
    app: hono,
    tryDedicatedRoute,
    async dispose(options) {
      try {
        await routerPromise;
      } catch {
        // init failed; nothing to dispose on the router side.
      }
      if (router !== undefined) await disposeFlowApiRouter(router, options);
      if (flowState !== undefined) await flowState.dispose();
    },
  };
}
