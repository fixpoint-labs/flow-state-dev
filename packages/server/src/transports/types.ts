/**
 * Inbound transport adapter contract.
 *
 * Defines the shape every entry point into the runtime conforms to —
 * native HTTP, MCP, webhooks, scheduled dispatch, and any future custom
 * transport. An adapter translates external input into an action invocation
 * and stamps a `source` identifier onto every request for provenance.
 *
 * The HTTP adapter lives at `transports/http` and is the reference
 * implementation. See `docs/architecture/inbound-transports.md`.
 */
import type {
  InboundSource,
  Middleware,
  ModelResolver,
  PrincipalResolutionContext,
  ResolvePrincipalFn,
  ResolvedPrincipal,
  VoiceProvider
} from "@flow-state-dev/core/types";
import type { FlowRegistry } from "../registry/flow-registry";
import type { ResponseEmitter } from "../streaming/response-emitter";
import type { LiveRequestStream } from "../streaming/live-stream";
import type { StoreRegistry } from "../stores/types";
import type { RuntimeLogger } from "../execution/logging";
import type { ExecutionResult } from "../execution/types";
import type {
  ContinueRequestOptions,
  ContinueRequestResult
} from "../execution/request-continuation";

/**
 * Host-level continuation options (FIX-811). The host supplies
 * `stores`/`flowRegistry`/`runtimeConfig` from its own wiring, so callers pass
 * only the request id, the resolution, and optional streaming context.
 */
export type HostContinueRequestOptions = Pick<
  ContinueRequestOptions,
  "requestId" | "resumeContext" | "signal" | "responseEmitter"
>;

export type { ContinueRequestResult } from "../execution/request-continuation";

export type {
  InboundSource,
  PrincipalResolutionContext,
  ResolvedPrincipal
} from "@flow-state-dev/core/types";

/**
 * Principal resolver hook. The framework owns the wiring; adapters never
 * implement auth themselves — they construct a `PrincipalResolutionContext`
 * and call `host.resolvePrincipal`. The host applies per-flow resolvers,
 * `defaultUserId` fallback, and `requireUser` enforcement around the value
 * returned by this function.
 *
 * Re-exported under the historical `PrincipalResolver` name for backward
 * compatibility; `ResolvePrincipalFn` (in `@flow-state-dev/core/types`) is
 * the canonical name shared by `defineFlow`'s `authentication.resolvePrincipal`.
 */
export type PrincipalResolver = ResolvePrincipalFn;

/**
 * Single shape every adapter constructs before invoking the runtime. The
 * runtime below this layer is identical regardless of `source`.
 */
export interface InboundRequestEnvelope {
  /** Provenance — propagated to RequestRecord.source. */
  source: InboundSource;

  flowKind: string;
  action: string;
  /** Raw input; validated by `action.inputSchema` downstream. */
  input: unknown;

  /** Existing session, or undefined for a new session. */
  sessionId?: string;
  /** Adapter-generated or framework-generated when absent. */
  requestId?: string;
  /** Optional org binding (set if the adapter resolves one). */
  orgId?: string;

  /**
   * Optional tenant the request runs under (FIX-406 6D). Extracted by HTTP
   * adapters from a configurable header (default `x-tenant-id`) and threaded
   * onto the request/session context identities.
   */
  tenantId?: string;

  /**
   * Resolved principal — normally populated by `host.resolvePrincipal`
   * before dispatch. The runtime treats this as authoritative.
   */
  principal: ResolvedPrincipal;

  /** Adapter-specific provenance (webhook headers, MCP session ids, etc.). */
  metadata?: Record<string, unknown>;

  /**
   * Raw HTTP body bytes preserved for adapters that need pre-parse access
   * (webhook signature verification). Only set by HTTP-shaped adapters.
   */
  rawBody?: Uint8Array;

  /**
   * Stream emitter the runtime writes to. HTTP adapter constructs a
   * LiveRequestStream; other adapters may pass `null` for fire-and-forget.
   */
  responseEmitter?: ResponseEmitter | null;

  /** Cancellation signal forwarded from the inbound transport. */
  signal?: AbortSignal;
}

/**
 * Returned synchronously from `host.dispatch`. Adapters use this to wire up
 * their response (HTTP SSE Response, webhook 202 ack, schedule completion
 * log) without awaiting the full action pipeline.
 */
export interface DispatchHandle {
  readonly requestId: string;
  /** ResponseEmitter the runtime writes items to. Always present. */
  readonly responseEmitter: ResponseEmitter;
  /** SSE-shaped readable stream for HTTP transports; null otherwise. */
  readonly liveStream: LiveRequestStream | null;
  /** Resolves when the action completes (success, failure, or abort). */
  readonly finished: Promise<ExecutionResult>;
  /**
   * Resolves once an externally-dispatched request has been *accepted*: the
   * enqueue-time store writes (`activeRequests` entry + the `in_progress`
   * record) have committed AND the dispatcher has accepted the job. Adapters
   * that ack a request before the client opens `GET …/stream` (the `202` path)
   * await this, so the ack means "discoverable and enqueued" — a store-write or
   * an enqueue failure rejects it (and is surfaced as a failed POST / reverted
   * resume) instead of acking a request that never runs. It does not wait for
   * execution to finish. `undefined` for in-process dispatch, where the record
   * is written during execution. (FIX-828)
   */
  readonly accepted?: Promise<void>;
}

/**
 * Single HTTP route exposed by an adapter. The host wires these into the
 * outer `{ GET, POST, PATCH, DELETE }` dispatcher.
 */
export interface TransportRoute {
  method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT";
  /** Path pattern; framework normalizes leading slash. */
  path: string;
  handler: (
    req: Request,
    ctx: { params: Record<string, string> }
  ) => Promise<Response>;
}

/**
 * Outputs returned from `adapter.createBindings`. The host's outer factory
 * wires `routes` into the public method dispatcher.
 */
export interface TransportBindings {
  /** HTTP routes for HTTP-shaped transports. */
  routes?: TransportRoute[];
  /**
   * Optional async setup hook called by the host after all adapters'
   * bindings are collected. Errors abort host startup.
   */
  start?: () => Promise<void> | void;
  /** Optional teardown hook called when the host is torn down. */
  stop?: () => Promise<void> | void;
}

/**
 * Runtime surface available to a transport adapter. The framework owns this
 * type; adapters never construct one. They consume it via `createBindings`.
 */
export interface InboundTransportHost {
  readonly registry: FlowRegistry;
  readonly stores: StoreRegistry;
  readonly resolvers?: {
    model?: ModelResolver;
    /**
     * Router-level voice provider, set once at host construction. Per-action
     * dispatch uses `flow?.voice?.provider ?? voice`; this bag is for adapter
     * introspection only and is not consulted during the per-action merge.
     */
    voice?: VoiceProvider;
  };
  readonly middleware?: Middleware[];
  readonly logger?: RuntimeLogger;

  /**
   * Dispatch an action-execution envelope. Fire-and-forget: returns a
   * synchronous `DispatchHandle` whose `liveStream` and `requestId` are
   * available immediately, while `finished` resolves when the action
   * completes.
   *
   * Adapters that need a streamed response (HTTP+SSE) consume
   * `handle.liveStream.readable`; adapters that only want a final result
   * (webhook, schedule) await `handle.finished`.
   *
   * Throws synchronously for unknown flow kinds or malformed envelopes.
   * Scope: action-execution only. Session/state/resource routes are
   * adapter-owned and use `host.stores` / `host.registry` directly.
   */
  dispatch(envelope: InboundRequestEnvelope): DispatchHandle;

  /**
   * Continue a suspended request under its OWN id (FIX-811). Unlike `dispatch`,
   * which starts a fresh run, this re-enters the existing request: completed
   * blocks replay from the durable log, the resolving `ctx.suspend()` returns
   * the resume payload, and the record transitions `suspended → in_progress →
   * terminal` in place — no second request is created. Wraps `continueRequest`
   * with the host's registry/stores/runtimeConfig. Rejects for a missing record
   * or unregistered flow.
   */
  continueRequest(
    options: HostContinueRequestOptions
  ): Promise<ContinueRequestResult>;

  /**
   * Validate async flow-level pre-conditions before dispatch. Must be
   * awaited between `resolvePrincipal` and `dispatch`. Currently enforces
   * `requiresOrg`; future pre-conditions plug in here.
   *
   * Throws `OrgRequiredError` when the flow requires an org-bound session
   * but no orgId is present on the envelope, the principal, or the stored
   * session. Also throws a plain `Error` for an unregistered `flowKind`
   * (same shape as `dispatch`).
   */
  validateDispatch(envelope: InboundRequestEnvelope): Promise<void>;

  /**
   * Resolve the principal for a request. Phase 1 delegates to the body-
   * userId stub. FIX-23 will replace the stub with a configurable hook on
   * `createFlowApiRouter`. Adapter code does not change between phases —
   * adapters always call this method.
   */
  resolvePrincipal(
    context: PrincipalResolutionContext
  ): Promise<ResolvedPrincipal>;
}

/**
 * Inbound transport adapter — translates external input into action
 * invocations.
 *
 * Adapters are immutable factory objects: a `source` identifier plus a
 * single pure `createBindings(host)` function that produces routes and
 * dispatchers. Adapters do not retain references to the host. They are
 * not mounted as plugins — they are values consumed at host construction.
 */
export interface InboundTransportAdapter {
  /**
   * Stable identifier stamped onto every request as
   * `RequestRecord.source`. See `InboundSource` for the documented
   * known-set.
   */
  readonly source: InboundSource;

  /**
   * Pure factory: produce the routes and dispatchers this adapter exposes
   * given the host runtime. Called once per host construction. Must be
   * synchronous and side-effect-free up to the optional async `start` hook
   * surfaced via the returned bindings.
   */
  createBindings(host: InboundTransportHost): TransportBindings;
}
