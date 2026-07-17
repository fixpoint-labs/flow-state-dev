/**
 * `serve(app, options)` — stand up a long-lived Node server for a `FlowState`
 * (or a pre-built `FlowApiRouter`).
 *
 * This is the web-process host adapter: the counterpart to `@flow-state-dev/vercel`
 * (serverless) and a worker runtime (background). It is a thin long-lived wrapper
 * over the portable Hono app from `createServerApp` (health checks + the engine
 * router) run on `@hono/node-server`. On top of that app it adds the concerns a
 * self-host needs but a serverless target does not: a static asset directory with
 * SPA fallback (the DevTool UI), and `SIGTERM`/`SIGINT`-driven graceful shutdown
 * that disposes the router and the `FlowState`. SSE streams unbuffered because the
 * app returns the engine's streaming `Response` straight through to `@hono/node-server`.
 *
 * Two behaviour notes vs. the previous hand-rolled bridge: static/SPA serving is
 * now GET-only (Hono also answers HEAD), where the old server handed any method
 * on a non-API path to the SPA fallback; and a mid-stream SSE failure is handled
 * inside `@hono/node-server` rather than logged to stderr, so there is no longer a
 * server-side signal when a live stream dies mid-flight.
 */
import type { Server } from "node:http";
import { serve as honoServe } from "@hono/node-server";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import type { FlowApiRouter, FlowState, DevToolConnectionConfig } from "@flow-state-dev/engine";
import { createServerApp } from "./app";
import { injectDevtoolConfig } from "./devtool-config-injection";
import { isLoopbackHost } from "./bind-guard";

/** Options for {@link serve}. All have sensible defaults for PaaS hosting. */
export interface ServeOptions {
  /** Port to bind. Default: `process.env.PORT`, then `3000`. */
  port?: number;
  /** Host to bind. Default `"0.0.0.0"` (required for most PaaS). */
  host?: string;
  /** API mount prefix. Default `"/api/flows"` (matches `createFlowApiRouter`). */
  basePath?: string;
  /** Health endpoint path. Default `"/healthz"`. 200 once ready, 503 before. */
  healthPath?: string;
  /** Static asset dir served for non-API routes, with `index.html` SPA fallback. */
  staticDir?: string;
  /**
   * DevTool connection config to inject into the served `index.html` as
   * `window.__FSD_DEVTOOL_CONFIG__` (userId / bearer token). Set only by
   * `fsdev dev` from the app's `fsdev.config.ts`; the token is exposed only to
   * the loopback page this dev server serves. Omit for production serving.
   */
  devtoolConfig?: DevToolConnectionConfig;
  /** SIGTERM/SIGINT grace window (ms) before connections are force-closed. Default 10000. */
  shutdownGraceMs?: number;
  /**
   * Whether `serve` installs its own `SIGTERM`/`SIGINT` handlers (which call
   * `close()`). Default `true`. Set `false` when the caller runs its own signal
   * handling and drives `handle.close()` itself, so teardown lives in one path.
   */
  handleSignals?: boolean;
}

/** Handle returned by {@link serve} for lifecycle control. */
export interface ServeHandle {
  /** The underlying `node:http` server. */
  readonly server: Server;
  /** The bound port (resolved, useful when binding port `0`). */
  readonly port: number;
  /**
   * Stop accepting connections, drain in-flight requests (force-closing after
   * the grace window), then dispose the router and the `FlowState`. Idempotent.
   */
  close(): Promise<void>;
}

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_SHUTDOWN_GRACE_MS = 10_000;

/** MIME types for static asset serving. */
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
};

function resolvePort(port: number | undefined): number {
  if (port !== undefined) return port;
  const fromEnv = process.env.PORT;
  if (fromEnv !== undefined && fromEnv.length > 0) {
    const parsed = Number(fromEnv);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return DEFAULT_PORT;
}

/**
 * Stand up a long-lived HTTP server for `app` and resolve once it is listening.
 *
 * The server binds immediately and serves `/healthz` (503 until the router's
 * stores finish initializing, 200 after), so PaaS health checks pass during a
 * cold start. Pass a `FlowState` to have `close()` dispose its stores; pass a
 * raw `FlowApiRouter` to manage store lifecycle yourself.
 */
export function serve(
  app: FlowState | FlowApiRouter,
  options: ServeOptions = {},
): Promise<ServeHandle> {
  const port = resolvePort(options.port);
  const host = options.host ?? DEFAULT_HOST;
  const staticDir = options.staticDir;
  const shutdownGraceMs = options.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE_MS;
  const handleSignals = options.handleSignals ?? true;

  // `basePath`/`healthPath` defaults live in `createServerApp`; pass through.
  const { app: honoApp, tryDedicatedRoute, dispose } = createServerApp(app, {
    basePath: options.basePath,
    healthPath: options.healthPath,
  });

  // Static assets + SPA fallback for the DevTool UI, GET-only (Hono also answers
  // HEAD). Registered after the portable app's health/API routes, so it only
  // catches what they don't, and it matches BEFORE the app's not-found fallback.
  //
  // Order matters on three axes:
  //   1. A real static file is served from disk first, with no wait on init — a
  //      slow store cold start must not stall DevTool assets.
  //   2. A non-file path is then offered to the dedicated-route dispatch, which
  //      BLOCKS on init. That serves a dedicated GET route outside `basePath`
  //      (e.g. an OAuth/webhook callback) instead of shadowing it with SPA HTML,
  //      including one that arrives during cold start.
  //   3. Anything still unmatched falls back to `index.html` (SPA routing).
  if (staticDir !== undefined) {
    // Inject the DevTool connection config into every HTML response (both the
    // real index.html and the SPA fallback) so the loopback DevTool page picks
    // up userId/bearer on boot. Undefined for production serving.
    //
    // Enforce the loopback contract: the config can carry a bearer token, so it
    // must never be injected on a network-exposed bind. Ignore it (with a
    // warning) rather than publish a credential on every interface.
    const devtoolConfig = options.devtoolConfig;
    if (devtoolConfig !== undefined && !isLoopbackHost(host)) {
      process.stderr.write(
        `[flow-state] serve(): ignoring devtoolConfig on non-loopback host "${host}" — ` +
          `it may carry a bearer token that must not be published on a network interface. ` +
          `Bind a loopback host (127.0.0.1) to use DevTool config injection.\n`,
      );
    }
    const htmlTransform =
      devtoolConfig !== undefined && isLoopbackHost(host)
        ? (html: string) => injectDevtoolConfig(html, devtoolConfig)
        : undefined;
    honoApp.get("*", async (c) => {
      const file = await serveStaticFile(c.req.path, staticDir, htmlTransform);
      if (file !== null) return file;
      const dedicated = await tryDedicatedRoute(c.req.raw);
      if (dedicated !== null) return dedicated;
      return serveSpaIndex(staticDir, htmlTransform);
    });
  }

  let server: Server;

  // Memoize so concurrent callers (e.g. a SIGTERM handler and an explicit
  // `handle.close()`) share one teardown and all await its completion.
  let closePromise: Promise<void> | undefined;
  const close = (): Promise<void> => {
    if (closePromise === undefined) closePromise = doClose();
    return closePromise;
  };
  const doClose = async (): Promise<void> => {
    process.off("SIGTERM", onSignal);
    process.off("SIGINT", onSignal);

    await new Promise<void>((resolveClose) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolveClose();
      };
      server.close(() => done());
      // Force-close lingering connections (e.g. open SSE streams) once the
      // grace window elapses so shutdown can't hang.
      const timer = setTimeout(() => {
        server.closeAllConnections?.();
        done();
      }, shutdownGraceMs);
      timer.unref?.();
    });

    await dispose();
  };

  const onSignal = () => {
    void close();
  };

  return new Promise<ServeHandle>((resolveServe, rejectServe) => {
    const onError = (err: Error) => rejectServe(err);
    server = honoServe(
      {
        fetch: honoApp.fetch,
        port,
        hostname: host,
        // Keep Node's native global Request/Response rather than swapping in the
        // adapter's lightweight versions process-wide — avoids surprising other
        // code (and test files) sharing the process.
        overrideGlobalObjects: false,
      },
      (info) => {
        server.off("error", onError);
        // Only take ownership of process signals once the bind succeeds, so a
        // failed listen (e.g. EADDRINUSE) doesn't leave teardown handlers — which
        // would dispose the FlowState — registered for a server that never started.
        // Callers managing their own signals opt out via `handleSignals: false`.
        if (handleSignals) {
          process.on("SIGTERM", onSignal);
          process.on("SIGINT", onSignal);
        }
        resolveServe({ server, port: info.port, close });
      },
    ) as Server;
    server.once("error", onError);
  });
}

/**
 * Serve a real file (or directory `index.html`) from `staticDir` as a Web
 * `Response`. Returns `null` when the path resolves to no file — the caller then
 * decides between a dedicated route and the SPA `index.html` fallback. A
 * directory-traversal attempt returns a 403 `Response` rather than `null`, so it
 * never leaks into the fallback path. Guards against directory traversal.
 */
async function serveStaticFile(
  pathname: string,
  staticDir: string,
  htmlTransform?: (html: string) => string,
): Promise<Response | null> {
  let filePath: string;
  if (pathname === "/" || pathname === "") {
    filePath = join(staticDir, "index.html");
  } else {
    const normalized = resolve(staticDir, "." + pathname);
    if (normalized !== staticDir && !normalized.startsWith(staticDir + sep)) {
      return new Response("Forbidden", { status: 403 });
    }
    filePath = normalized;
  }

  try {
    const fileStat = await stat(filePath);
    if (fileStat.isDirectory()) {
      filePath = join(filePath, "index.html");
      await stat(filePath);
    }

    const content = await readFile(filePath);
    const ext = extname(filePath);
    const mimeType = MIME_TYPES[ext] ?? "application/octet-stream";

    const injected = ext === ".html" && htmlTransform !== undefined;
    const body = injected ? htmlTransform(content.toString("utf8")) : content;
    const headers: Record<string, string> = { "content-type": mimeType };
    // The injected HTML may carry a bearer token — never let a browser or proxy
    // cache the credential-bearing document.
    if (injected) headers["cache-control"] = "no-store";
    return new Response(body, { status: 200, headers });
  } catch {
    return null;
  }
}

/** SPA routing fallback: serve `index.html` for an unmatched client route, or 404. */
async function serveSpaIndex(
  staticDir: string,
  htmlTransform?: (html: string) => string,
): Promise<Response> {
  try {
    const content = await readFile(join(staticDir, "index.html"));
    const injected = htmlTransform !== undefined;
    const body = injected ? htmlTransform(content.toString("utf8")) : content;
    const headers: Record<string, string> = { "content-type": "text/html; charset=utf-8" };
    // A bearer-bearing injected document must not be cached (see serveStaticFile).
    if (injected) headers["cache-control"] = "no-store";
    return new Response(body, { status: 200, headers });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
