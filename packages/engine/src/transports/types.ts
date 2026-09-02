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
  ActionCore,
  InboundSource,
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
import type { RuntimeConfig } from "../runtime-config";
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
  "requestId" | "resumeContext" | "signal" | "responseEmitter" | "includeTrace"
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
   * Runtime config to run this dispatch under, instead of the host's own
   * (FIX-1077).
   *
   * Server-set and internal, like `source` and `resolvedActionCore` — never read
   * from a request body, so it adds no caller-facing surface. Today's one writer
   * is the detached start operation: a child continues the launching request's
   * work, and that request may be running under a config the caller derived
   * (`fsdev run` builds one so `--model` applies), which the host was never
   * constructed with.
   *
   * **The rule this field exists for: a detached child inherits the LAUNCHING
   * REQUEST's effective config, not the host's construction-time one.** A host
   * is built once; a caller may run any given request under a config it derived
   * (`fsdev run` builds `{ ...appConfig, modelResolver, logger }` so `--model`
   * takes effect), and the child is that request's own work continued in the
   * background.
   *
   * **And the limit, which is part of the rule rather than an exception to it:
   * it cannot cross a serialization boundary.** A `RuntimeConfig` holds live
   * resolvers and providers, so the external-dispatcher branch ignores this — a
   * queued job runs under its own worker's config, which is the only thing that
   * process can honour. Carrying just a model *id* across would not fix it: the
   * worker has its own gateways and keys, so a forced id may not resolve there
   * at all. The host therefore WARNS at the dispatch that drops an override
   * rather than pretending it applied.
   *
   * Three separate rounds of fixes rediscovered this limit one instance at a
   * time. It is written here so the fourth does not have to.
   */
  runtimeConfig?: RuntimeConfig;

  /**
   * Pre-resolved action core, set ONLY by adapters for an event dispatch that
   * has no static coordinate to recover from — today, the dynamic schedule
   * whose handler block is produced at dispatch time by a resolver. When
   * present, the runtime runs this core directly instead of resolving from
   * `flow` via `resolveEntry`. Like `source`, it is set internally and
   * never read from a request body, so it adds no attack surface on the
   * caller-addressed path. Not serializable and not persisted: on recovery the
   * field is absent, which is why durable dynamic schedules do not recover
   * (a documented non-goal). Statically-declared bindings (HTTP actions,
   * webhooks, chat `on`, `schedules.static`) leave this unset and resolve by
   * coordinate.
   *
   * Scope: only `runAction.resolveAction` consumes the carried core. The two
   * coordinate-resolution sites in `createExecutionContext` (eager-resource
   * prefetch and the live token-budget `remaining` accessor) are not given it,
   * so for a dynamic schedule they resolve nothing: eager block-declared
   * resources are not prefetched (collections still lazy-load on access; eager
   * singles are absent) and the in-flow `tokenUsage.remaining` reads
   * `+Infinity`. Terminal token-budget enforcement is unaffected — it reads the
   * budget off the carried core that `runAction` runs. This within-run
   * degradation is the accepted cost of the dynamic schedule's ad-hoc path,
   * alongside its non-recoverability; static bindings have neither limitation.
   */
  resolvedActionCore?: ActionCore;

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
   * Resolves once the request has been *accepted* — discoverable, with nothing
   * left that could make it silently not exist. It does not wait for execution
   * to finish, and it rejects when acceptance fails, so a caller that acks on it
   * never acks a request that never runs.
   *
   * What "discoverable" costs differs by path, and each promises what its own
   * path can honour:
   *
   * - **External dispatch** (FIX-828): the enqueue-time store writes
   *   (`activeRequests` entry + the `in_progress` record) have committed AND the
   *   dispatcher has taken the job. Adapters that ack before the client opens
   *   `GET …/stream` (the `202` path) await this; a store-write or enqueue
   *   failure rejects it and surfaces as a failed POST / reverted resume.
   * - **In-process, `queue` policy** (FIX-999): the same enqueue-time writes.
   *   The run itself is still waiting behind its concurrency key.
   * - **In-process, ordinary** (FIX-982): the run's own `activeRequests`
   *   registration has committed. `dispatchLocal` returns while `runAction` is
   *   still at its first await, so without this a caller would ack a request
   *   while the write that makes it exist could still fail. The `in_progress`
   *   record follows during execution on this path, so an immediate `…/stream`
   *   read can still miss it; the entry that recovery and the sweeper key off is
   *   what has landed.
   *
   * **Acceptance is discoverability, not safety, and it is not trying to be.**
   * Setup continues after it and can still fail without recording anything. What
   * protects a caller that handed over durable work is that work's own lease:
   * if the run dies at any point — during setup, mid-execution, or by the
   * process going away — the lease lapses and the owner recovers the row. That
   * is the designed recovery path for every way a child can die, and no dispatch
   * milestone improves on it.
   *
   * What acceptance buys is therefore *visibility*, not safety: a
   * fire-and-forget caller holds no `finished`, so without this a registration
   * failure is silent and the row waits out its lease with nothing anywhere
   * saying why. With it, the failure surfaces where it happened.
   *
   * Optional on the type because a custom dispatcher may not distinguish
   * acceptance from completion. Every dispatcher this package ships does.
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
