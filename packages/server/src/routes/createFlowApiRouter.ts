/**
 * Catch-all route adapter for framework-owned `/api/flows/[...path]` endpoints.
 *
 * The router is the host: it builds an `InboundTransportHost`, mounts the
 * built-in `HttpTransportAdapter`, plus any additional adapters supplied
 * via the `adapters` option, and exposes the merged route table as the
 * canonical `{ GET, POST, PATCH, DELETE }` dispatcher. The public API
 * shape and behavior is unchanged for callers that don't pass `adapters`.
 */
import type {
  Middleware,
  ModelResolver,
  SpeechResolver,
  TranscriptionResolver
} from "@flow-state-dev/core/types";
import type { StoreRegistry } from "../stores/types";
import type { FlowRegistry } from "../registry/flow-registry";
import {
  createFlowRouteHandlers,
  NOOP_INTERNAL_ROUTE_SEAMS,
  type InternalRouteSeams
} from "./http-handlers";
import {
  createHttpTransportAdapter,
  HTTP_TRANSPORT_SOURCE
} from "../transports/http/createHttpTransportAdapter";
import { TransportRouteCollisionError } from "../transports/errors";
import type {
  InboundTransportAdapter,
  PrincipalResolver,
  TransportBindings,
  TransportRoute
} from "../transports/types";

/**
 * Public router adapter options.
 */
export type CreateFlowApiRouterOptions = {
  registry: FlowRegistry;
  stores?: Partial<StoreRegistry>;
  modelResolver?: ModelResolver;
  speechResolver?: SpeechResolver;
  transcriptionResolver?: TranscriptionResolver;
  maxResponseBufferSize?: number;
  maxConcurrentStreams?: number;
  staleStreamTtlMs?: number;
  middleware?: Middleware[];
  onError?: (error: Error, context: { method: string; path: string }) => void;
  /**
   * Whether to detect interrupted requests from previous runs on startup.
   * Disable on serverless platforms where background queries on init can
   * exhaust the Postgres pool before actual requests are served.
   * Default: true.
   */
  detectInterruptedOnStartup?: boolean;
  /**
   * Called with a promise that must complete for background action execution
   * to finish. On serverless platforms, pass this promise to `waitUntil()`
   * so the function instance stays alive after the 202 response is sent.
   *
   * Without this, fire-and-forget `runAction` may be killed before persisting
   * results, causing stream 404s and lost data.
   */
  onBackgroundWork?: (promise: Promise<unknown>) => void;
  /**
   * Additional inbound transport adapters mounted alongside the built-in
   * HTTP adapter. Routes from every adapter merge into the returned
   * `{ GET, POST, PATCH, DELETE }` dispatcher; path collisions throw a
   * `TransportRouteCollisionError` at construction time. (FIX-438)
   */
  adapters?: InboundTransportAdapter[];

  /**
   * Host-level fallback principal resolver, called when an inbound flow has
   * no `authentication.resolvePrincipal` of its own. Defaults to
   * `defaultBodyUserIdPrincipalResolver`, which reads `body.userId` from
   * the parsed HTTP body. Per-flow `defineFlow({ authentication })` always
   * wins over this fallback. (FIX-23)
   */
  resolvePrincipal?: PrincipalResolver;
};

type CreateInternalFlowApiRouterOptions = CreateFlowApiRouterOptions & {
  internalSeams?: InternalRouteSeams;
};

type NextRouteContext = {
  params: {
    path?: string[];
  };
};

type AdapterBindings = {
  adapter: InboundTransportAdapter;
  bindings: TransportBindings;
};

/**
 * Returned by `createFlowApiRouter`. The four method properties are the
 * canonical `{ GET, POST, PATCH, DELETE }` dispatcher for the catch-all
 * route. The shape matches what Next.js / Vercel / Hono catch-all routes
 * expect; it is intentionally backward-compatible with the pre-FIX-438
 * router so consumers indexing by HTTP method (`router[method]`,
 * `keyof typeof router`) keep working.
 *
 * For teardown of registered transport adapters, call
 * `disposeFlowApiRouter(router)` — keeping it off the router shape avoids
 * widening `keyof` for index-call consumers.
 */
export type FlowApiRouter = {
  GET: (req: Request, ctx: NextRouteContext) => Promise<Response>;
  POST: (req: Request, ctx: NextRouteContext) => Promise<Response>;
  PATCH: (req: Request, ctx: NextRouteContext) => Promise<Response>;
  DELETE: (req: Request, ctx: NextRouteContext) => Promise<Response>;
};

/**
 * Per-router teardown registry. Populated by `createFlowApiRouter`,
 * consumed by `disposeFlowApiRouter`. WeakMap so the router (and its
 * bindings closure) get GC'd normally when no one holds a reference.
 */
const routerDisposers = new WeakMap<FlowApiRouter, () => Promise<void>>();

/**
 * Tear down a router by invoking each adapter's `bindings.stop()` in
 * reverse order. Best-effort — failures are logged but don't abort the
 * sweep. Idempotent: a second call after dispose is a no-op.
 *
 * Most callers don't need this: Next.js / Vercel / serverless hosts
 * tear down by killing the process. It's intended for long-running
 * servers (custom Node HTTP, Deno, Bun) and tests.
 */
export async function disposeFlowApiRouter(router: FlowApiRouter): Promise<void> {
  const dispose = routerDisposers.get(router);
  if (dispose === undefined) return;
  routerDisposers.delete(router);
  await dispose();
}

/**
 * Creates a catch-all route adapter with default no-op internal seam behavior.
 */
export function createFlowApiRouter(options: CreateFlowApiRouterOptions): FlowApiRouter {
  const internalOptions: CreateInternalFlowApiRouterOptions = {
    ...options,
    internalSeams: NOOP_INTERNAL_ROUTE_SEAMS
  };
  const handlers = createFlowRouteHandlers(internalOptions);

  // Built-in HTTP adapter delegates to the canonical handler. The catch-all
  // route returned by the adapter doesn't need to be wired into a custom
  // dispatcher here — the public `{ GET, POST, PATCH, DELETE }` shape is
  // preserved by routing every method through `handlers.handle`. Custom
  // adapters add their own routes via `bindings.routes`, validated against
  // collisions below.
  const httpAdapter = createHttpTransportAdapter({
    handle: handlers.handle
  });
  const allAdapters: InboundTransportAdapter[] = [
    httpAdapter,
    ...(options.adapters ?? [])
  ];
  const allBindings: AdapterBindings[] = allAdapters.map((adapter) => ({
    adapter,
    bindings: adapter.createBindings(handlers.host)
  }));

  validateRouteUniqueness(allBindings);

  // Invoke each adapter's `start` hook after bindings are collected.
  // The contract documents this as the post-construction setup point
  // (e.g., loading a JWKS, opening a long-poll). The router itself is
  // synchronous, so async `start` is fire-and-forget here — adapters
  // that need strict await semantics for startup should compose around
  // `createFlowApiRouter` and await the bindings themselves. Errors are
  // logged so they don't get silently swallowed.
  for (const { adapter, bindings } of allBindings) {
    if (bindings.start === undefined) continue;
    try {
      const result = bindings.start();
      if (result instanceof Promise) {
        result.catch((err) => {
          console.error(
            `[flow-state] adapter "${adapter.source}" start hook failed`,
            err
          );
        });
      }
    } catch (err) {
      // Synchronous start errors abort host startup per the contract.
      throw err;
    }
  }

  // Build the custom-adapter route table for non-HTTP adapters. Routes
  // declared by the built-in HTTP adapter are intentionally skipped — the
  // canonical handler already covers them via the catch-all.
  const customRoutes: { adapterSource: string; route: TransportRoute }[] = [];
  for (const { adapter, bindings } of allBindings) {
    if (adapter.source === HTTP_TRANSPORT_SOURCE) continue;
    for (const route of bindings.routes ?? []) {
      customRoutes.push({ adapterSource: adapter.source, route });
    }
  }

  const dispatch = async (
    req: Request,
    ctx: NextRouteContext
  ): Promise<Response> => {
    // Custom adapters get first crack at any route they registered. If none
    // match, fall through to the canonical handler. This preserves the
    // existing behavior for the default configuration (no custom adapters)
    // and gives custom transports an unambiguous path.
    if (customRoutes.length > 0) {
      const url = new URL(req.url);
      for (const { route } of customRoutes) {
        if (route.method.toUpperCase() !== req.method.toUpperCase()) continue;
        const matched = matchRoute(route.path, url.pathname);
        if (matched !== null) {
          return route.handler(req, { params: matched });
        }
      }
    }
    return handlers.handle(req, { path: ctx.params.path });
  };

  // Best-effort teardown: invoke each adapter's `stop` hook in reverse
  // order. Failures are logged so one bad adapter doesn't block teardown
  // of the rest. Stored in a WeakMap keyed by the router so `dispose` is
  // not part of the router's public shape (keeps `keyof typeof router`
  // narrow for consumers that index by HTTP method).
  const dispose = async (): Promise<void> => {
    for (let i = allBindings.length - 1; i >= 0; i--) {
      const entry = allBindings[i];
      if (entry === undefined || entry.bindings.stop === undefined) continue;
      try {
        await entry.bindings.stop();
      } catch (err) {
        console.error(
          `[flow-state] adapter "${entry.adapter.source}" stop hook failed`,
          err
        );
      }
    }
  };

  const router: FlowApiRouter = {
    GET: dispatch,
    POST: dispatch,
    PATCH: dispatch,
    DELETE: dispatch
  };
  routerDisposers.set(router, dispose);
  return router;
}

/**
 * Reject overlapping `(method, path)` pairs across adapters at host
 * construction so dispatch is unambiguous at runtime. The HTTP adapter's
 * catch-all does not participate — collisions are checked among non-HTTP
 * adapter routes only.
 */
function validateRouteUniqueness(allBindings: AdapterBindings[]): void {
  const seen = new Map<string, string[]>();
  for (const { adapter, bindings } of allBindings) {
    if (adapter.source === HTTP_TRANSPORT_SOURCE) continue;
    for (const route of bindings.routes ?? []) {
      const normalizedPath = route.path.startsWith("/") ? route.path : `/${route.path}`;
      const key = `${route.method.toUpperCase()} ${normalizedPath}`;
      const sources = seen.get(key) ?? [];
      sources.push(adapter.source);
      seen.set(key, sources);
    }
  }
  for (const [key, sources] of seen.entries()) {
    if (sources.length > 1) {
      const [method, path] = key.split(" ", 2);
      throw new TransportRouteCollisionError(method, path, sources);
    }
  }
}

/**
 * Minimal path matcher with `:param` and `*` wildcard support. Returns the
 * captured params on match, `null` otherwise. Adapter-declared routes use
 * this matcher; the canonical `/api/flows` table parses paths through
 * `parseFlowRoute` and does not go through this code.
 */
function matchRoute(
  pattern: string,
  pathname: string
): Record<string, string> | null {
  const normalizedPattern = pattern.startsWith("/") ? pattern : `/${pattern}`;
  const patternSegments = normalizedPattern.split("/").filter((s) => s.length > 0);
  const pathSegments = pathname.split("/").filter((s) => s.length > 0);
  const params: Record<string, string> = {};

  for (let i = 0; i < patternSegments.length; i++) {
    const patternSeg = patternSegments[i] as string;
    if (patternSeg === "*") {
      // Wildcard absorbs the remainder of the path.
      params.rest = pathSegments.slice(i).join("/");
      return params;
    }
    const pathSeg = pathSegments[i];
    if (pathSeg === undefined) return null;
    if (patternSeg.startsWith(":")) {
      params[patternSeg.slice(1)] = pathSeg;
      continue;
    }
    if (patternSeg !== pathSeg) return null;
  }
  if (patternSegments.length !== pathSegments.length) return null;
  return params;
}
