/**
 * `serve(app, options)` — stand up a long-lived Node `http` server for a
 * `FlowState` (or a pre-built `FlowApiRouter`).
 *
 * This is the web-process host adapter: the counterpart to `@flow-state-dev/vercel`
 * (serverless) and a worker runtime (background). It resolves the router,
 * bridges `node:http` ↔ Web `Request`/`Response` (streaming SSE unbuffered),
 * exposes a `/healthz` endpoint for PaaS health checks, optionally serves a
 * static asset directory with SPA fallback, and wires `SIGTERM`/`SIGINT` to a
 * graceful shutdown that disposes the router and the `FlowState`.
 */
import {
  createServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import {
  disposeFlowApiRouter,
  type FlowApiRouter,
  type FlowState,
} from "@flow-state-dev/server";
import { handleApiRequest } from "./bridge";

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
const DEFAULT_BASE_PATH = "/api/flows";
const DEFAULT_HEALTH_PATH = "/healthz";
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

/** Discriminate a `FlowState` handle from a pre-built `FlowApiRouter`. */
function isFlowState(app: FlowState | FlowApiRouter): app is FlowState {
  return typeof (app as FlowState).getRouter === "function";
}

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
  const basePath = options.basePath ?? DEFAULT_BASE_PATH;
  const healthPath = options.healthPath ?? DEFAULT_HEALTH_PATH;
  const staticDir = options.staticDir;
  const shutdownGraceMs = options.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE_MS;
  const handleSignals = options.handleSignals ?? true;

  const flowState = isFlowState(app) ? app : undefined;

  // Kick off router resolution. For a FlowState this triggers store init; the
  // server is ready once it resolves. A raw router is ready immediately.
  let router: FlowApiRouter | undefined;
  let ready = false;
  let initError: Error | undefined;
  const routerPromise: Promise<FlowApiRouter> = flowState
    ? flowState.getRouter()
    : Promise.resolve(app as FlowApiRouter);
  routerPromise.then(
    (r) => {
      router = r;
      ready = true;
    },
    (err: unknown) => {
      initError = err instanceof Error ? err : new Error(String(err));
    },
  );

  const onStreamError = (err: Error) => {
    process.stderr.write(`[serve] SSE stream error: ${err.message}\n`);
  };

  const server = createServer(async (req, res) => {
    const url = req.url ?? "/";
    const path = url.split("?")[0];

    if (path === healthPath) {
      handleHealth(res, ready, initError);
      return;
    }

    if (path.startsWith(basePath)) {
      if (initError !== undefined) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Server failed to initialize" }));
        return;
      }
      if (!ready || router === undefined) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Server initializing" }));
        return;
      }
      await handleApiRequest(req, res, url, router, { basePath, onStreamError });
      return;
    }

    if (staticDir !== undefined) {
      await serveStaticFile(res, url, staticDir);
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

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

    // Let an in-flight init settle so dispose is clean, then tear down.
    try {
      await routerPromise;
    } catch {
      // init failed; nothing to dispose on the router side.
    }
    if (router !== undefined) {
      await disposeFlowApiRouter(router);
    }
    if (flowState !== undefined) {
      await flowState.dispose();
    }
  };

  const onSignal = () => {
    void close();
  };

  return new Promise<ServeHandle>((resolveServe, rejectServe) => {
    server.once("error", rejectServe);
    server.listen(port, host, () => {
      server.off("error", rejectServe);
      // Only take ownership of process signals once the bind succeeds, so a
      // failed listen (e.g. EADDRINUSE) doesn't leave teardown handlers — which
      // would dispose the FlowState — registered for a server that never started.
      // Callers managing their own signals opt out via `handleSignals: false`.
      if (handleSignals) {
        process.on("SIGTERM", onSignal);
        process.on("SIGINT", onSignal);
      }
      const boundPort = (server.address() as AddressInfo).port;
      resolveServe({ server, port: boundPort, close });
    });
  });
}

/** Respond to a health probe: 200 once ready, 503 while initializing, 500 on init failure. */
function handleHealth(
  res: ServerResponse,
  ready: boolean,
  initError: Error | undefined,
): void {
  if (initError !== undefined) {
    // A permanent init failure (bad config, unreachable store) won't resolve by
    // retrying — return 500 so a PaaS fails the deploy fast instead of treating
    // a 503 as transient and spinning in a health-check retry loop.
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "error", message: initError.message }));
    return;
  }
  if (ready) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }
  res.writeHead(503, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "initializing" }));
}

/**
 * Serve a static file from `staticDir`, falling back to `index.html` for
 * unmatched routes (SPA routing). Guards against directory traversal.
 */
async function serveStaticFile(
  res: ServerResponse,
  url: string,
  staticDir: string,
): Promise<void> {
  const cleanUrl = url.split("?")[0];

  let filePath: string;
  if (cleanUrl === "/" || cleanUrl === "") {
    filePath = join(staticDir, "index.html");
  } else {
    const normalized = resolve(staticDir, "." + cleanUrl);
    if (normalized !== staticDir && !normalized.startsWith(staticDir + sep)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
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

    res.writeHead(200, { "Content-Type": mimeType });
    res.end(content);
  } catch {
    // SPA fallback: serve index.html for unmatched routes.
    try {
      const indexPath = join(staticDir, "index.html");
      const content = await readFile(indexPath);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  }
}
