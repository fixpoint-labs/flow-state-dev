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
  FlowStateSettings,
  Middleware,
  ModelResolver,
  VoiceProvider
} from "@flow-state-dev/core/types";
import type { TracingLevel } from "@flow-state-dev/core";
import type { StoreRegistry } from "../stores/types";
import type { FlowRegistry } from "../registry/flow-registry";
import { createRuntimeConfig, type RuntimeConfig } from "../runtime-config";
import type { ErrorCaptureHandler } from "../errors/error-capture";
import {
  createFlowRouteHandlers,
  NOOP_INTERNAL_ROUTE_SEAMS
} from "./http-handlers";
import {
  createHttpTransportAdapter,
  HTTP_TRANSPORT_SOURCE
} from "../transports/http/createHttpTransportAdapter";
import { TransportRouteCollisionError } from "../transports/errors";
import { createStaleRequestSweeper } from "../execution/stale-request-sweeper";
import type { MatchFunction } from "path-to-regexp";
import {
  compileTransportPattern,
  matchTransportRoute
} from "./router";
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
  /**
   * Voice provider for TTS and STT. Optional. If omitted, flows requesting TTS
   * silently skip synthesis (text continues), and the transcribe endpoint
   * returns 501. A per-flow `voice.provider` on the flow definition overrides
   * this at dispatch time.
   */
  voiceProvider?: VoiceProvider;
  /** Instance-level settings threaded onto every block as `ctx.settings`. */
  settings?: FlowStateSettings;
  maxResponseBufferSize?: number;
  maxConcurrentStreams?: number;
  staleStreamTtlMs?: number;
  middleware?: Middleware[];
  /**
   * Tracing verbosity for observability (non-durable) state snapshots
   * (FIX-406 6H): `"verbose"` (per-step, for DevTool), `"normal"` (block
   * boundaries only), or `"minimal"` (none). Durable resume checkpoints are
   * unaffected. Unset → the runtime falls back to `resolveTracingLevel()`
   * (`FSDEV_TRACING_LEVEL`, else `"verbose"` in dev / `"minimal"` in prod).
   * Recommended: `"normal"` for production servers, `"verbose"` for `fsdev dev`.
   */
  tracingLevel?: TracingLevel;
  /**
   * HTTP header carrying the tenant id (FIX-406 6D). Default `x-tenant-id`.
   * The extracted value is exposed on request/session/block context identities
   * (`ctx.request.identity.tenantId`). Optional — single-tenant apps ignore it.
   * Note: tenant-scoped store-key isolation is a separate, deferred change;
   * this only threads the axis through context.
   */
  tenantIdHeader?: string;
  onError?: (error: Error, context: { method: string; path: string }) => void;
  /**
   * Opt-in error-capture sink (FIX-724). Block-aware: routes runtime block
   * failures to an external observability service with the failing block's
   * identity. Forwarded verbatim into the runtime config. Off by default.
   */
  errorCapture?: ErrorCaptureHandler;
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

  /**
   * Default SSE wire heartbeat interval in milliseconds. Applied to every
   * live and GET-attach SSE response when the per-flow
   * `request.sseHeartbeatMs` is unset. The heartbeat keeps NAT/proxy idle
   * timeouts from closing the connection and gives clients a robust
   * inactivity signal.
   * Default: 15000 (15 seconds). Set to 0 to disable.
   */
  defaultSseHeartbeatMs?: number;

  /**
   * How often the server-internal stale-request sweeper runs (milliseconds).
   * The sweeper marks `in_progress` requests whose registry heartbeat has
   * stopped as `interrupted`, releasing session locks for the next action.
   * Default: 30000 (30 seconds). Set to 0 to disable.
   */
  staleSweepIntervalMs?: number;

  /**
   * Heartbeat-age threshold (milliseconds) used by the stale-request
   * sweeper to decide that an active request has gone stuck. Should be
   * at least 2× the executor's registry heartbeat (default 10s) to avoid
   * false positives. Default: 60000 (60 seconds).
   */
  staleSweepThresholdMs?: number;

  /**
   * Enable the privileged read-only debug endpoint surface under
   * `/api/flows/sessions/:id/debug/resources*`. Fail-closed: default
   * `false`. Explicit `true` always wins over the env flag. When
   * `undefined`, falls back to `process.env.FSDEV_DEBUG_ENDPOINTS === "1"`.
   *
   * The DevTool consumes this surface; `fsdev dev` opts in automatically.
   * Production deployments must opt in deliberately.
   */
  debugEndpointsEnabled?: boolean;

  /**
   * Additional origins permitted to reach debug endpoints. Loopback
   * (`http://localhost*`, `http://127.0.0.1*`, `http://[::1]*`) is allowed
   * by default. Matching is by origin prefix.
   */
  debugAllowedOrigins?: string[];

  /**
   * Permit requests with no `Origin` header (e.g. curl, server-side fetches)
   * to reach debug endpoints when the gate is enabled. Default `true` —
   * curl-friendly for local debugging.
   *
   * Security note: the origin gate is light defense-in-depth, not strong
   * auth. When the env flag is enabled on a non-localhost-bound server,
   * any headerless client can reach the surface regardless of physical
   * location. The deploying team owns the binding (the spec assumes
   * `fsdev dev` semantics: localhost-only). Set this to `false` to require
   * a browser-enforced `Origin` header that matches the allowlist.
   */
  debugAllowAnonymousLocal?: boolean;

  /**
   * Cap on the number of keys enumerated when computing collection counts
   * for the debug tree. Counts beyond this are reported as `truncated: true`.
   * Default 1000 — bounds cost on org/flow-scope collections without
   * starving the tree response.
   */
  debugCountLimit?: number;

  /**
   * @internal — set by `createFlowState`, which has already resolved its
   * resolvers and instance settings. Direct callers pass the flat options
   * above; the router bundles them itself. When provided, it wins over the
   * flat versions of the bundled fields (`modelResolver`, `settings`, …),
   * which are then ignored.
   */
  runtimeConfig?: RuntimeConfig;
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

const DEFAULT_STALE_SWEEP_INTERVAL_MS = 30_000;
const DEFAULT_STALE_SWEEP_THRESHOLD_MS = 60_000;

/**
 * Creates a catch-all route adapter with default no-op internal seam behavior.
 */
export function createFlowApiRouter(options: CreateFlowApiRouterOptions): FlowApiRouter {
  // Bundle the forwarded instance-level options once at this public boundary.
  // `createFlowState` passes a pre-built `runtimeConfig`; direct callers get
  // it constructed from their flat options here.
  const runtimeConfig = options.runtimeConfig ?? createRuntimeConfig(options);
  const handlers = createFlowRouteHandlers({
    ...options,
    runtimeConfig,
    internalSeams: NOOP_INTERNAL_ROUTE_SEAMS
  });

  // Server-internal sweeper: marks requests whose executor heartbeat stopped
  // as interrupted, releasing session locks. Disabled when interval is 0.
  const staleSweepIntervalMs =
    options.staleSweepIntervalMs !== undefined
      ? options.staleSweepIntervalMs
      : DEFAULT_STALE_SWEEP_INTERVAL_MS;
  const staleSweepThresholdMs =
    options.staleSweepThresholdMs !== undefined
      ? options.staleSweepThresholdMs
      : DEFAULT_STALE_SWEEP_THRESHOLD_MS;
  const sweeper = createStaleRequestSweeper({
    stores: handlers.host.stores,
    intervalMs: staleSweepIntervalMs,
    staleThresholdMs: staleSweepThresholdMs
  });

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
  // canonical handler already covers them via the catch-all. Patterns are
  // compiled once at registration so dispatch is allocation-free per call.
  type CompiledRoute = {
    adapterSource: string;
    route: TransportRoute;
    matcher: MatchFunction<Record<string, string | string[]>>;
  };
  const customRoutes: CompiledRoute[] = [];
  for (const { adapter, bindings } of allBindings) {
    if (adapter.source === HTTP_TRANSPORT_SOURCE) continue;
    for (const route of bindings.routes ?? []) {
      customRoutes.push({
        adapterSource: adapter.source,
        route,
        matcher: compileTransportPattern(route.path)
      });
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
      for (const { route, matcher } of customRoutes) {
        if (route.method.toUpperCase() !== req.method.toUpperCase()) continue;
        const matched = matchTransportRoute(matcher, url.pathname);
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
    // Stop the sweeper first so its tick can't race with adapter teardown.
    sweeper.dispose();
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

