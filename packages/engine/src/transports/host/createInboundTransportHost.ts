/**
 * Construct an `InboundTransportHost` that adapters consume.
 *
 * The host owns registry/stores wiring, principal resolution, and the
 * action-dispatch machinery. It is the runtime surface every adapter
 * (HTTP, MCP, webhook, scheduled, custom) sees — adapters never touch
 * `runAction` directly.
 *
 * Principal resolution is also answered here for in-process callers
 * (`resolveInProcessPrincipal`, FIX-1551), through the same code, and this
 * module is the only place `source: "cli"` can be produced.
 */
import type { FlowInstance } from "@flow-state-dev/core/types";
import { SessionCreateRefusedError } from "../../context/session-birth";
import type { FlowRegistry } from "../../registry/flow-registry";
import type { SessionRecord, StoreRegistry } from "../../stores/types";
import type { ExecutionResult } from "../../execution/types";
import type { RuntimeConfig } from "../../runtime-config";
import { createLiveRequestStream } from "../../streaming/live-stream";
import { createResponseEmitter } from "../../streaming/response-emitter";
import {
  continueRequest as continueRequestImpl,
  type ContinueRequestResult
} from "../../execution/request-continuation";
import {
  isSameSession,
  resolveRequestIncarnation,
  resolveSessionStorageKey,
  tenantMatches
} from "../../stores/scope-keys";
import { settleUnstartedRequest } from "../../execution/settle-unstarted-request";
import { createInitialRequestRecord } from "../../context/initial-request-record";
import {
  assertSessionAdmitted,
  FlowInstanceBindingMismatchError,
  OrgBindingMismatchError,
  RequestOwnerMismatchError,
  UserBindingMismatchError
} from "../../context/binding-errors";
import { isOrgAttributed } from "../../context/org-attribution";
import { claimRequestRecord, principalOwnsRequest } from "../../context/request-principal";
import { pinRejectsCaller, UnknownFlowError } from "../../context/instance-pin";
import { foreignRecordRefusal, ownsRecord } from "../../context/record-owner";
import {
  DEFAULT_RUNTIME_LOGGER,
  logRuntimeEvent,
  summarizeForLog
} from "../../execution/logging";
import {
  deregisterAbortController,
  registerAbortController,
  replaceAbortController,
  tagAbortController,
  wasFiredOnlyFenced
} from "../../execution/abort-registry";
import { generateId } from "../../utils/generate-id";
import {
  OrgRequiredError,
  PrincipalResolutionError
} from "../errors";
import {
  createConcurrencyArbiter,
  isPendingAdmission,
  type ConcurrencyAdmission,
  type ConcurrencyArbiter
} from "../concurrency/arbiter";
import { pickPrincipalResolver } from "../auth/pickPrincipalResolver";
import {
  defaultBodyUserIdPrincipalResolver,
  isDefaultBodyUserIdPrincipalResolver
} from "../auth/defaultBodyUserIdPrincipalResolver";
import { DEFAULT_ORG_ID, isValidOrgId } from "@flow-state-dev/core";
import type { FlowDispatcher, DispatchEnvelope, LeaseTurn } from "../dispatcher";
import { CLI_SOURCE, INTERNAL_SOURCE, TASK_SOURCE } from "../../execution/transport-sources";
import {
  createInProcessDispatcher,
  isInProcessDispatcher,
  type InProcessDispatcher
} from "./in-process-dispatcher";
import type {
  DispatchHandle,
  HostContinueRequestOptions,
  InboundRequestEnvelope,
  InboundTransportHost,
  PrincipalResolutionContext,
  PrincipalResolver,
  ResolvedPrincipal
} from "../types";

/**
 * Fallback cadence for beating an enqueue-time registry entry while an
 * in-process queued run waits behind its concurrency key (FIX-999).
 *
 * Matches `runAction`'s own default so the entry's freshness cadence does not
 * change when the worker body takes over. A flow that configures
 * `request.heartbeatIntervalMs` overrides it — see `resolveQueuedHeartbeatMs`.
 */
const DEFAULT_QUEUED_HEARTBEAT_INTERVAL_MS = 10_000;

/**
 * The cadence to keep a queued entry warm at, for a given flow.
 *
 * Must track the flow's own heartbeat rather than the default: a deployment is
 * free to pair a fast heartbeat with a correspondingly tight stale threshold
 * (the liveness gate only requires `threshold >= 2 * heartbeat`), and a fixed
 * 10s beat against a 3s threshold lets the sweeper reap a request that is
 * merely waiting its turn. The queued entry would then read as not live while
 * the work is still perfectly valid — the exact false negative the queued
 * heartbeat was added to remove.
 *
 * `0` disables heartbeats for the flow, and is preserved here: the caller skips
 * the timer entirely rather than falling back to a default the flow declined.
 */
function resolveQueuedHeartbeatMs(heartbeatIntervalMs: number | undefined): number {
  return heartbeatIntervalMs ?? DEFAULT_QUEUED_HEARTBEAT_INTERVAL_MS;
}

export type CreateInboundTransportHostOptions = {
  registry: FlowRegistry;
  stores: StoreRegistry;
  resolvePrincipal: PrincipalResolver;
  /**
   * Instance-level options forwarded verbatim through the execution chain.
   * The host reads `maxResponseBufferSize` / `defaultSseHeartbeatMs` /
   * `onBackgroundWork` for live-stream wiring, exposes the resolvers /
   * logger on the returned host, and passes the bundle to
   * `runAction`. See {@link RuntimeConfig}.
   */
  runtimeConfig: RuntimeConfig;
  /**
   * Controls where flow actions execute. Default: in-process via runAction.
   * Set to a FlowDispatcher implementation to route execution to an
   * external worker (e.g., BullMQ WorkerDispatcher).
   */
  dispatcher?: FlowDispatcher;
  /**
   * Concurrency arbiter to enforce policy through. Defaults to a fresh one.
   *
   * Supplied when more than one host serves the same process, so a declared
   * `queue`/`reject` policy is enforced ONCE rather than once per host — two
   * arbiters hold two independent keyed gates, and a request admitted by one
   * knows nothing about a key the other is holding (FIX-1077).
   *
   * An arbiter over a backend shared across processes
   * (`arbitratesAcrossProcesses`) also arbitrates work this host hands to an
   * external dispatcher (FIX-1634).
   */
  arbiter?: ConcurrencyArbiter;
};

/**
 * Whether `error` is an admission refused before this dispatch wrote anything:
 * another flow instance's record, another principal's request, or another
 * user's or organization's session. The record under the id, if any, is not this dispatch's to
 * terminate: it belongs to someone else, or it is the caller's own earlier
 * request under an id it reused.
 */
function isRefusedAdmission(error: unknown): boolean {
  return (
    error instanceof FlowInstanceBindingMismatchError ||
    error instanceof RequestOwnerMismatchError ||
    error instanceof UserBindingMismatchError ||
    error instanceof OrgBindingMismatchError ||
    error instanceof SessionCreateRefusedError
  );
}

/**
 * Contexts the engine's in-process entry point built itself (FIX-1551).
 *
 * `source: "cli"` is reserved: the host refuses it on any context that is not
 * in this set. Module-private on purpose — never exported, never keyed through
 * `Symbol.for`, never on the host adapters receive — so the only code that can
 * add to it is {@link resolveInProcessPrincipal}, which no network adapter is
 * handed. A source string alone is not enough: the host is shared and each
 * adapter builds its own resolution context, so an adapter declaring any
 * source of its own could still stamp `cli` on the context it resolves.
 */
const inProcessAsks = new WeakSet<PrincipalResolutionContext>();

/** An answer to "who is this caller", with whether the framework supplied it. */
type PrincipalResolution = {
  principal: ResolvedPrincipal;
  /**
   * True when the resolver that ran is the framework default, so the
   * organization is the reserved development one rather than a verified value.
   */
  isDevelopmentDefault: boolean;
};

/**
 * Build the one place the framework decides who an inbound caller is:
 * resolver precedence, the user fallback and `requireUser`, and the
 * organization rules. Every inbound transport's host and the in-process entry
 * point call this, so a terminal and an HTTP request cannot get different
 * answers to the same question.
 *
 * `warn` reports deployment configuration once per resolution instance. The
 * in-process entry point passes none: it reports the identity it used itself.
 */
function createPrincipalResolution(options: {
  registry: FlowRegistry;
  resolvePrincipal: PrincipalResolver;
  warn?: (message: string, context: Record<string, unknown>) => void;
}): (context: PrincipalResolutionContext) => Promise<PrincipalResolution> {
  const { registry, resolvePrincipal, warn } = options;

  // The warning below is once per host, not once per request. It reports a
  // deployment's configuration — "this app has no authentication" — which is
  // the same fact on every request, and a per-request line would bury it in the
  // very logs an operator reads to find it.
  let warnedDevelopmentDefault = false;

  /**
   * The organization this request runs under, or a refusal.
   *
   * The single place the framework decides an organization, for every inbound
   * transport (FIX-1442). Two sources and no third: a configured resolver's
   * verified value, or — only when the app configures no authentication at all
   * — the reserved development default.
   *
   * A configured resolver is held to the full contract. It cannot decline to
   * name an organization and have the framework guess one, and it cannot claim
   * {@link DEFAULT_ORG_ID}: that identity means "nobody authenticated here", so
   * an authenticated principal holding it would put verified callers into the
   * same boundary as unauthenticated ones.
   */
  const resolveOrgIdentity = (
    context: PrincipalResolutionContext,
    isDevelopmentDefault: boolean,
    resolvedOrgId: string | undefined
  ): string => {
    if (isDevelopmentDefault) {
      if (warn !== undefined && !warnedDevelopmentDefault) {
        warnedDevelopmentDefault = true;
        warn(
          `[flow-state] no authentication.resolvePrincipal is configured; running under the ` +
            `development organization "${DEFAULT_ORG_ID}". Configure a resolver that returns a ` +
            `verified orgId before serving more than one organization.`,
          { source: context.source }
        );
      }
      return DEFAULT_ORG_ID;
    }

    if (resolvedOrgId === undefined) {
      throw new PrincipalResolutionError(
        "Request requires a verified organization: authentication.resolvePrincipal " +
          "returned no usable orgId. Return a nonempty, well-formed orgId from the resolver.",
        { status: 401 }
      );
    }
    if (resolvedOrgId === DEFAULT_ORG_ID) {
      throw new PrincipalResolutionError(
        `Request requires a verified organization: "${DEFAULT_ORG_ID}" is reserved for ` +
          `unauthenticated single-organization development and cannot be claimed by a ` +
          `configured resolver. Return this deployment's own organization id.`,
        { status: 401 }
      );
    }
    return resolvedOrgId;
  };

  return async (context: PrincipalResolutionContext): Promise<PrincipalResolution> => {
    // `cli` is reserved for the in-process entry point (FIX-1551). Refused
    // before any resolver runs, whatever source the adapter that built this
    // context declared — a resolver branching on `source === "cli"` must never
    // see a network request.
    if (context.source === CLI_SOURCE && !inProcessAsks.has(context)) {
      throw new PrincipalResolutionError(
        `source "${CLI_SOURCE}" is reserved for the engine's in-process entry point ` +
          `(fsdev run and fsdev chat); a transport adapter cannot resolve a request under it.`,
        { status: 401 }
      );
    }

    // Per-flow `authentication.resolvePrincipal` wins over the host-level
    // fallback when the flow is registered and configured. Adapters never
    // touch this; they always call `host.resolvePrincipal` and the host
    // routes per-flow overrides transparently. The precedence itself lives in
    // `pickPrincipalResolver` so the route-level guard's enforce/skip decision
    // cannot drift from the resolver actually called here.
    const flow = registry.get(context.envelope.flowKind);
    const flowAuth = flow?.authentication;
    const resolver = pickPrincipalResolver(
      registry,
      context.envelope.flowKind,
      resolvePrincipal
    );
    const requireUser = flow?.requireUser ?? true;
    const defaultUserId = flowAuth?.defaultUserId;

    // Whether the resolver that actually ran is the framework default — i.e.
    // this flow authenticates nobody. That is the ONE case where the framework
    // supplies the organization instead of reading a verified one, so it is
    // decided from the resolver that ran rather than from the shape of what it
    // returned. A configured resolver that happens to return nothing is an
    // authentication failure, not an invitation to fall back to development
    // identity (BR-2).
    const isDevelopmentDefault = isDefaultBodyUserIdPrincipalResolver(resolver);

    const result = await Promise.resolve(resolver(context));
    let userId: string | undefined;
    let orgId: string | undefined;
    if (result !== null && result !== undefined) {
      userId =
        typeof result.userId === "string" && result.userId.length > 0
          ? result.userId
          : undefined;
      orgId = isValidOrgId(result.orgId) ? result.orgId : undefined;
    }

    if (userId === undefined && defaultUserId !== undefined && defaultUserId.length > 0) {
      userId = defaultUserId;
    }

    if (userId === undefined) {
      if (requireUser) {
        throw new PrincipalResolutionError(
          "Action request requires non-empty userId",
          { status: 401 }
        );
      }
      // Flow opted out of user identity but the host has nowhere to route
      // user-keyed runtime state. Authors must either return a userId from
      // the resolver or set `authentication.defaultUserId`. Surface this as
      // a 500 because it's a configuration mistake, not a caller error.
      throw new PrincipalResolutionError(
        `Flow "${context.envelope.flowKind}" has authentication.requireUser: false ` +
        `but no userId was resolved. Set authentication.defaultUserId or return a ` +
        `userId from authentication.resolvePrincipal.`,
        { status: 500 }
      );
    }

    return {
      principal: { userId, orgId: resolveOrgIdentity(context, isDevelopmentDefault, orgId) },
      isDevelopmentDefault
    };
  };
}

/** What an in-process caller asks: the question an HTTP action request asks, minus the request. */
export interface InProcessPrincipalQuestion {
  /** The flow instance address (a singleton's kind, or a collection member's id). */
  flowKind: string;
  /** The action the caller is about to run. */
  action: string;
  /** The action input, as the resolver would see it on an HTTP request. */
  input: unknown;
  /**
   * The user the local caller names, the way an unauthenticated HTTP caller
   * names one in its body. A resolver that authenticates ignores it; the
   * framework default returns it.
   */
  userId: string;
}

/** Who an in-process caller is, and where that answer came from. */
export interface InProcessPrincipal extends ResolvedPrincipal {
  /**
   * `resolver` when a configured resolver named the organization;
   * `development-default` when the flow authenticates nobody and the framework
   * supplied {@link DEFAULT_ORG_ID}.
   */
  from: "resolver" | "development-default";
}

/**
 * Who an in-process caller is, answered by the same resolution every inbound
 * transport's host uses: a flow's own resolver before `resolvePrincipal`, the
 * user fallback, and the organization rules. `fsdev run` and `fsdev chat` ask
 * this before they write anything.
 *
 * The resolver sees `source: "cli"`, no `request`, and `metadata.body` as an
 * HTTP action body: `{ userId, input }` from the question. The context is
 * frozen. That source is reserved: only this function can produce a
 * context the host accepts it on. Refusals are the host's own
 * `PrincipalResolutionError`s (or whatever the resolver threw), unchanged — a
 * resolver that needs a credential refuses here exactly as it refuses an HTTP
 * caller without one.
 *
 * In-process only. No route, header, query or environment variable reaches it.
 * `FlowState.resolveInProcessPrincipal` calls it with the app's own registry
 * and host resolver; pass a bare `registry` for flows with no host resolver.
 */
export async function resolveInProcessPrincipal(
  options: { registry: FlowRegistry; resolvePrincipal?: PrincipalResolver },
  question: InProcessPrincipalQuestion
): Promise<InProcessPrincipal> {
  const resolution = createPrincipalResolution({
    registry: options.registry,
    resolvePrincipal: options.resolvePrincipal ?? defaultBodyUserIdPrincipalResolver
  });
  // `metadata.body` has the shape of the JSON body an HTTP action request
  // carries (`{ userId, input }`), so a resolver that reads the body sees the
  // same data from a terminal as from the equivalent HTTP caller.
  //
  // Frozen before it is marked, so a resolver that keeps the context cannot
  // later change what a marked context says (its flow, action or named user)
  // and pass it back through a host. The input is the caller's own object and
  // is not frozen: it goes on to run the action.
  const context: PrincipalResolutionContext = Object.freeze({
    source: CLI_SOURCE,
    envelope: Object.freeze({
      flowKind: question.flowKind,
      action: question.action,
      input: question.input,
      metadata: Object.freeze({
        body: Object.freeze({ userId: question.userId, input: question.input })
      })
    })
  });
  inProcessAsks.add(context);
  const { principal, isDevelopmentDefault } = await resolution(context);
  return {
    ...principal,
    from: isDevelopmentDefault ? "development-default" : "resolver"
  };
}

/**
 * Build the host used by every transport adapter.
 *
 * `dispatch` resolves the flow, registers a live-stream for SSE consumers,
 * and starts `runAction` in fire-and-forget mode. The returned
 * `DispatchHandle` lets the adapter consume the live stream synchronously
 * (HTTP+SSE) or await `finished` for a final result (webhook, schedule).
 */
export function createInboundTransportHost(
  options: CreateInboundTransportHostOptions
): InboundTransportHost {
  const { registry, stores, resolvePrincipal, runtimeConfig } = options;
  const { onBackgroundWork, maxResponseBufferSize, defaultSseHeartbeatMs } =
    runtimeConfig;

  const inProcessDispatcher = createInProcessDispatcher({
    registry,
    stores,
    runtimeConfig
  });
  const effectiveDispatcher: FlowDispatcher | InProcessDispatcher =
    options.dispatcher ?? inProcessDispatcher;
  const isExternalDispatcher = !isInProcessDispatcher(effectiveDispatcher);

  // One arbiter governs every dispatch, so an action's concurrency policy is
  // enforced once at this shared seam (FIX-837). Work handed to an external
  // dispatcher (BullMQ) runs in another process, so it is arbitrated only when
  // the arbiter's keys are shared with that process: the dispatch takes its
  // place here, the place rides the job, and the worker waits its turn and gives
  // it back when the run ends (FIX-1634). A `hold` job's place has its turn at
  // once, and a `defer` job takes no place here: its worker claims the key once
  // it is free (`leaseTurn`, FIX-1836). Over a process-local arbiter it is not
  // arbitrated at all — releasing a key at enqueue would free a `reject` lease
  // when the job is queued rather than when the run completes.
  const arbiter = options.arbiter ?? createConcurrencyArbiter();
  const arbitratesExternalDispatch = isExternalDispatcher && arbiter.arbitratesAcrossProcesses;

  /**
   * Hand a STARTED run's `finished` to the adapter's keep-alive hook, containing
   * a synchronous throw from it.
   *
   * Both seams that start a run — `dispatch` and `continueRequest` — call the
   * hook last, once the run is already under way, and both are synchronous from
   * their caller's point of view (`continueRequest` via the promise it returns).
   * The hook is adapter-supplied and does throw in practice: Next's `after()`
   * and `waitUntil` both raise synchronously when called outside a request
   * scope. An escaping throw would therefore make a synchronous failure mean two
   * different things, and each caller reads it as only one — the pre-start one:
   * the dispatch operation reads it as "nothing was dispatched" and
   * settles the row it handed over, and the resume route reads it as
   * "setup failed" and reverts the suspension to `pending`, inviting a second
   * resume against a request whose run is still going. Two writers, one row
   * (FIX-982, FIX-1095).
   *
   * Containing it here is what makes "a synchronous throw is pre-start" a
   * property those callers can rely on rather than one they assume.
   *
   * Failing to register keep-alive is real — on a freeze-after-response platform
   * the run can stall — but it is not a failure to start, and the handle the
   * caller gets back is honest either way. So it is logged, not raised.
   */
  /**
   * Emit a diagnostic without letting it become the failure it was describing.
   *
   * A `RuntimeLogger` is adapter- or app-supplied, so `warn`/`error` are
   * arbitrary code that can throw. Both callers here are on a path where that
   * throw would be read as something else entirely: one runs before a
   * dispatch has materialized, where the dispatch operation reads a
   * synchronous throw as "nothing was started" and settles the row — so a failed
   * log line would report work as never started when the only thing that failed
   * was the logging. The other is the containment inside
   * `registerBackgroundWork`, where a throwing logger would escape the very
   * helper that exists to stop a throw escaping.
   *
   * `console.error` deliberately, and not through the logger: the logger is what
   * just failed.
   */
  const logSafely = (
    logger: RuntimeConfig["logger"],
    level: "warn" | "error",
    message: string,
    context: Record<string, unknown>
  ): void => {
    try {
      logRuntimeEvent(logger ?? DEFAULT_RUNTIME_LOGGER, level, message, context);
    } catch (error) {
      console.error("[flow-state] runtime logger threw", error);
    }
  };

  const registerBackgroundWork = (
    finished: Promise<unknown>,
    context: { requestId: string; flowKind?: string },
    /**
     * The hook for THIS dispatch. Defaults to the host's, which is right for
     * every seam that has no per-request config of its own.
     */
    hook: RuntimeConfig["onBackgroundWork"] = onBackgroundWork
  ): void => {
    if (hook === undefined) return;
    try {
      hook(finished);
    } catch (error) {
      logSafely(
        runtimeConfig.logger,
        "error",
        "[flow-state] onBackgroundWork threw; the run was started but is not registered as background work",
        { ...context, error: summarizeForLog(error) }
      );
    }
  };

  /**
   * Refuse a dispatch addressed to one instance that names a session or
   * request another instance owns — before any enqueue-time write, so a
   * foreign record is never overwritten, acknowledged or heartbeated on this
   * instance's behalf. The direct execution path repeats the same check in
   * `runAction`, before its own registration; this is the transport half.
   *
   * A request record is fenced atomically below (create-if-absent), so this
   * pre-read is the session half plus the fast refusal; the CAS is what closes
   * two concurrent admissions of one caller-supplied id.
   *
   * Resolves the session it read and admitted, if any, so a later write to
   * the session goes only to that one.
   */
  const admitOwnership = async (
    flow: FlowInstance,
    dispatchEnvelope: DispatchEnvelope
  ): Promise<SessionRecord | undefined> => {
    let session: SessionRecord | undefined;
    if (dispatchEnvelope.sessionId !== undefined) {
      session = await stores.session.get(
        resolveSessionStorageKey(dispatchEnvelope.sessionId, dispatchEnvelope.tenantId)
      );
      assertSessionAdmitted(flow, session, {
        sessionId: dispatchEnvelope.sessionId,
        userId: dispatchEnvelope.userId,
        tenantId: dispatchEnvelope.tenantId
      });
      // The organization binding the run enforces at execution, checked here
      // too so a request from another organization is refused before it takes
      // a place on the session's key. An unattributed session is left to the
      // execution-time check, which names that condition itself.
      if (
        session !== undefined &&
        tenantMatches(session.tenantId, dispatchEnvelope.tenantId) &&
        isOrgAttributed(session) &&
        session.orgId !== dispatchEnvelope.orgId
      ) {
        throw new OrgBindingMismatchError(
          dispatchEnvelope.sessionId,
          session.orgId as string,
          dispatchEnvelope.orgId as string
        );
      }
    }
    const active = await stores.activeRequests.get(dispatchEnvelope.requestId);
    if (active !== undefined && !ownsRecord(flow, active)) {
      const refusal = foreignRecordRefusal(flow, active);
      throw new FlowInstanceBindingMismatchError(
        "request",
        dispatchEnvelope.requestId,
        flow.id,
        `an in-flight request with this id: ${refusal.detail}`,
        refusal.reason
      );
    }
    if (active !== undefined && !principalOwnsRequest(active, dispatchEnvelope)) {
      throw new RequestOwnerMismatchError(dispatchEnvelope.requestId);
    }
    return session;
  };

  /**
   * Materialize the enqueue-time `in_progress` stub and the `activeRequests`
   * entry, owner-fenced, and move a child session's update time so a view of
   * its parent sees the run while it waits. The record is written
   * create-if-absent: a lost race against a foreign owner refuses rather than
   * overwriting, and a lost race against this same owner (a retry reusing its
   * id) keeps the existing record and re-stamps it, which is the
   * last-write-wins hand-off it always was.
   * Resolves once the entry is this dispatch's to keep warm and to remove on
   * exit.
   *
   * @param admitted The session `admitOwnership` read and admitted, if any.
   * @param onClaimed Called with the claimed record's incarnation (a hand-off
   *   keeps the holder's) the moment the record is claimed, before any later
   *   await: from then on the record is visible and cancellable, so a
   *   controller registered before it must carry the incarnation by then.
   */
  const materializeOwned = async (
    flow: FlowInstance,
    dispatchEnvelope: DispatchEnvelope,
    admitted: SessionRecord | undefined,
    entry: Omit<Parameters<typeof stores.activeRequests.register>[0], "flowKind" | "flowId">,
    onClaimed?: (incarnation: string) => void
  ): Promise<void> => {
    const record = createInitialRequestRecord(
      { ...dispatchEnvelope, flowKind: flow.kind, flowId: flow.id },
      entry.startedAt
    );
    // Owner-fenced on both axes: another flow instance's or another user's
    // record under this id is never overwritten or re-parented.
    const claimed = await claimRequestRecord(stores, flow, record);
    onClaimed?.(resolveRequestIncarnation(claimed));
    // A request under a child session moves the child's update time here,
    // where the request is first recorded as working, and not when its run
    // starts: the run can wait behind a concurrency key, or in an external
    // queue, for a long time before that. A live view of the parent finds runs
    // by that time (`routes/session-stream-routes.ts`), and a child whose last
    // run finished long ago is found no other way. After the request record,
    // so a read that finds the moved child finds the request too. Before the
    // entry, so a failure here leaves no entry behind.
    //
    // Only a child the request will be let run in: its tenant, its owner and
    // its organization, each as `createExecutionContext` checks it later. A
    // request that check refuses must not have moved the child first. And only
    // the child admission read and checked as this flow instance's: one
    // deleted and created again under the id since, by anyone and under any
    // flow, is another session this request was never admitted to. A child
    // created since admission found none is new, so a view of its parent finds
    // it by its update time already.
    if (dispatchEnvelope.sessionId !== undefined && admitted !== undefined) {
      const sessionKey = resolveSessionStorageKey(
        dispatchEnvelope.sessionId,
        dispatchEnvelope.tenantId
      );
      const session = await stores.session.get(sessionKey);
      if (
        session !== undefined &&
        isSameSession(admitted, session) &&
        session.parentSessionId != null &&
        tenantMatches(session.tenantId, dispatchEnvelope.tenantId) &&
        session.userId === dispatchEnvelope.userId &&
        isValidOrgId(session.orgId) &&
        session.orgId === dispatchEnvelope.orgId
      ) {
        // Written only over the version just read, and one past it, so a
        // writer still holding the older copy conflicts rather than putting it
        // back over this one. A write that got in first has moved the update
        // time already, so a conflict is not an error.
        await stores.session.set(
          sessionKey,
          { ...session, updatedAt: Date.now(), version: session.version + 1 },
          session.version
        );
      }
    }
    await stores.activeRequests.register({ ...entry, flowKind: flow.kind, flowId: flow.id });
  };

  const dispatch = (envelope: InboundRequestEnvelope): DispatchHandle => {
    // Exact instance address: a singleton's kind, or a collection member's
    // explicit id. The address travels on `flowKind` unchanged; the records
    // written below carry the resolved instance's actual kind and its id.
    const flow = registry.get(envelope.flowKind);
    if (flow === undefined) {
      throw new UnknownFlowError(envelope.flowKind);
    }

    const requestId = envelope.requestId ?? generateId("req");

    const dispatchEnvelope: DispatchEnvelope = {
      requestId,
      flowKind: envelope.flowKind,
      actionName: envelope.action,
      input: envelope.input,
      userId: envelope.principal.userId,
      sessionId: envelope.sessionId,
      orgId: envelope.orgId ?? envelope.principal.orgId,
      tenantId: envelope.tenantId,
      source: envelope.source,
      metadata: envelope.metadata,
      resolvedActionCore: envelope.resolvedActionCore
    };

    // The config this dispatch runs under. Normally the host's own; a detached
    // child carries the LAUNCHING request's, because the caller may have derived
    // one the host was never built with — `fsdev run` does, so `--model` reaches
    // the detached child rather than silently resolving the app's default
    // (FIX-1077). Server-set only; see `InboundRequestEnvelope.runtimeConfig`.
    const dispatchRuntimeConfig = envelope.runtimeConfig ?? runtimeConfig;

    // Say so when a caller-derived model resolver is about to be dropped at the
    // serialization boundary (FIX-1077).
    //
    // No brand and no CLI plumbing needed: the condition IS the divergence. A
    // launching request whose config carries a different resolver from the
    // host's is one a caller derived — `fsdev run --model` is the shipped case —
    // and an external dispatcher cannot carry it, because a `RuntimeConfig`
    // holds live resolvers and providers that do not serialize. Serializing just
    // the model id was the alternative and is worse: the worker is a different
    // process with its own gateways and keys, so a forced id may not resolve
    // there at all, replacing a silent wrong model with a failure surfacing
    // where the caller cannot see it.
    //
    // Warned rather than refused because refusing would break a working command
    // for a condition that may never arise in it — a queue-configured app whose
    // flows never detach is unaffected. This fires only at the exact dispatch
    // that loses the override.
    if (
      isExternalDispatcher &&
      envelope.runtimeConfig !== undefined &&
      envelope.runtimeConfig.modelResolver !== runtimeConfig.modelResolver
    ) {
      logSafely(
        dispatchRuntimeConfig.logger,
        "warn",
        `[flow-state] the model override on this run does NOT apply to background work ` +
          `dispatched to a queue: request "${requestId}" (flow "${envelope.flowKind}") will ` +
          `run under the worker's own model configuration, not the override. Generators in ` +
          `this process still use it.`,
        { requestId, flowKind: envelope.flowKind, source: envelope.source }
      );
    }

    // Per-flow `voice.provider` wins over the router-level provider, mirroring
    // the principal-resolver override pattern below. Merged once here so
    // `runAction` receives the effective value (via `runtimeConfig.voiceProvider`)
    // and never re-merges.
    const effectiveVoiceProvider =
      flow.voice?.provider ?? dispatchRuntimeConfig.voiceProvider;

    // Per-flow SSE heartbeat override wins over the host default.
    const flowHeartbeatMs = flow.request?.sseHeartbeatMs;
    const sseHeartbeatMs =
      flowHeartbeatMs !== undefined ? flowHeartbeatMs : defaultSseHeartbeatMs;

    // Concurrency admission. For `reject` it claims the action's key and
    // refuses with `ConcurrencyRejectedError` when another request holds it,
    // so a dropped caller never materializes a run; `queue` joins the key's
    // line (the run starts in its turn); `allow` takes nothing, preserving
    // today's timing. Only the *start* of execution is gated: the handle
    // (requestId, liveStream, finished) is still returned synchronously, so an
    // SSE client gets an open stream while queued. External dispatch without a
    // shared backend skips arbitration (no key, nothing taken).
    //
    // WHEN the place is taken depends on the backend. Over the in-memory
    // default it is taken here, synchronously, before any record or stream
    // exists, so a `reject` is still thrown from `dispatch`. Over a shared
    // backend it is taken only once `admitOwnership` has passed (BP-031): a
    // caller that does not own the session or request id must not hold, or
    // stand in line on, its key, where every process would honour the place.
    // That refusal, and the backend's own errors, arrive through `accepted`.
    //
    // `hold` and `defer` cross the queue too (FIX-1836): the job carries how
    // it reaches its turn (`leaseTurn`), and its worker carries that out.
    const decision =
      isExternalDispatcher && !arbitratesExternalDispatch
        ? { policy: "allow" as const, key: undefined }
        : arbiter.resolve(flow, envelope.action, dispatchEnvelope);
    // `hold` and `defer` take their place only once ownership has passed, on
    // every backend. Neither is refused synchronously (a `defer` over its cap
    // is refused through the handle), so nothing is lost by waiting, and a
    // caller who does not own the session never marks its key held or uses
    // up its defer cap, not even for the moment before the refusal (BP-031).
    const admitsAfterOwnership =
      arbiter.arbitratesAcrossProcesses || decision.policy === "hold" || decision.policy === "defer";
    const upFront = admitsAfterOwnership ? undefined : arbiter.admit(decision, requestId);
    // The admission once taken. From here until a branch below hands it to its
    // run, every failure gives it back: the synchronous setup is wrapped below,
    // and each asynchronous chain ends in `releaseHeldAdmission`. A place nobody
    // gives back holds its key until the process restarts.
    let held: ConcurrencyAdmission | undefined =
      upFront === undefined || isPendingAdmission(upFront) ? undefined : upFront;
    // The incarnation of the request this dispatch claimed, once it has.
    // Every terminal write below is for that request, not for whatever holds
    // the id by the time the write happens.
    let claimedIncarnation: string | undefined;
    /**
     * Take the admission, unless it was taken up front, and continue with it.
     * Continues synchronously when it already is, so the in-memory default
     * keeps today's timing to the microtask.
     */
    const admitThen = <T>(next: (admitted: ConcurrencyAdmission) => T | Promise<T>): Promise<T> => {
      const taken = held;
      if (taken !== undefined) {
        try {
          return Promise.resolve(next(taken));
        } catch (error) {
          return Promise.reject(error);
        }
      }
      return Promise.resolve()
        .then(() => upFront ?? arbiter.admit(decision, requestId))
        .then((admitted) => {
          held = admitted;
          return next(admitted);
        });
    };
    /**
     * Undo a dispatch that failed after admission and before its run started,
     * then rethrow. Gives the place back when one was taken, and terminates the
     * `in_progress` record this dispatch may have written. A refusal found a
     * record that is not this dispatch's (another owner's, or the caller's own
     * earlier request under a reused id), so it terminates nothing; and a
     * failure before the place was taken (a refusal, an unreachable backend)
     * wrote nothing at all.
     */
    const releaseHeldAdmission = async (error: unknown): Promise<never> => {
      if (held === undefined) throw error;
      await held.release();
      if (!isRefusedAdmission(error)) {
        await settleUnstartedRequest(
          stores,
          requestId,
          { status: "failed", cause: error },
          claimedIncarnation
        );
      }
      throw error;
    };

    let liveStream: DispatchHandle["liveStream"] = null;
    let responseEmitter: DispatchHandle["responseEmitter"];
    let finished: Promise<ExecutionResult>;
    // Resolves once the request is accepted. Every branch sets it, and each
    // means "discoverable" in the terms its own path can honour: enqueue-time
    // store writes committed plus the job taken (external), those same writes
    // committed (in-process `queue`), or the run's own `activeRequests`
    // registration committed (in-process, FIX-982).
    let accepted: Promise<void> | undefined;
    // Whether the `activeRequests` entry under this id is THIS dispatch's —
    // written by its own materialization, or by the run it started. An
    // admission refused before either happened must leave a foreign owner's
    // entry alone on the way out.
    let entryOwned = false;
    try {
      // The envelope's `responseEmitter` field is three-state:
      //   - `undefined` (default) → host owns streaming; create a LiveRequestStream
      //   - `null`                → explicit fire-and-forget (webhook, schedule)
      //   - a `ResponseEmitter`   → caller is bringing its own; do not create a
      //                             redundant live stream and waste a slot
      //
      // External dispatchers (BullMQ, etc.) execute in a separate context and
      // persist events to the shared store. The client falls back to the GET
      // request-stream endpoint (store-driven live tail) when it receives a 202
      // instead of an inline SSE response, so creating a live stream here would
      // be an empty pipe that never receives events.
      liveStream =
        envelope.responseEmitter === undefined && !isExternalDispatcher
          ? createLiveRequestStream({
              requestId,
              maxBufferSize: maxResponseBufferSize,
              sseHeartbeatMs
            })
          : null;

      // Pick the emitter in priority order: caller-provided emitter wins when
      // present (skips the live-stream branch above by construction), otherwise
      // the host's live-stream emitter, otherwise a fresh internal emitter so
      // the runtime always has somewhere to write items. The handle exposes
      // whichever one was used.
      responseEmitter =
        envelope.responseEmitter ??
        liveStream?.emitter ??
        createResponseEmitter({ requestId });

      // Delegate to the dispatcher. InProcessDispatcher uses dispatchLocal
      // (carries non-serializable context); external dispatchers use the
      // generic dispatch interface.
      if ("dispatchLocal" in effectiveDispatcher) {
        // The in-process milestones, held here rather than read off the handle
        // because `gateStart` owns *when* the run is started and the handle does
        // not exist until it does (FIX-982). The `queue` branch below has its own,
        // earlier acceptance — its enqueue-time writes — and ignores these.
        let markAccepted: () => void = () => {};
        let failAccepted: (error: unknown) => void = () => {};
        const inProcessAccepted = new Promise<void>((resolve, reject) => {
          markAccepted = resolve;
          failAccepted = reject;
        });
        // Handled unconditionally: this is discarded on the `queue` path and
        // ignored by every caller that only wants `finished`.
        void inProcessAccepted.catch(() => {});

        /**
         * `abortHandoff` is a controller the run must take over rather than
         * merely be checked against. The queued branch holds one: an abort that
         * lands between its pre-start check and `runAction`'s own registration
         * would otherwise be thrown away, because `runAction` would register a
         * fresh controller over the one that was aborted. Handing the controller
         * itself over makes the handoff atomic, so the abort cannot fall between
         * two registrations no matter when it lands (FIX-1077). It is the
         * controller and its incarnation, not its signal, so the run can still
         * tell a cancel for another request under the id from its own.
         */
        const startRun = (abortHandoff?: {
          controller: AbortController;
          incarnation?: string;
        }): Promise<ExecutionResult> => {
          // A run holding its turn on a shared backend is stopped once its
          // place can no longer be kept: another process may take the key.
          const lost = held?.lost;
          const handle = (effectiveDispatcher as InProcessDispatcher).dispatchLocal(
            dispatchEnvelope,
            {
              signal:
                lost === undefined || envelope.signal === undefined
                  ? (envelope.signal ?? lost)
                  : AbortSignal.any([envelope.signal, lost]),
              abortHandoff,
              responseEmitter,
              effectiveRuntimeConfig: {
                ...dispatchRuntimeConfig,
                voiceProvider: effectiveVoiceProvider
              }
            }
          );
          handle.accepted?.then(() => {
            entryOwned = true;
            markAccepted();
          }, failAccepted);
          return handle.finished;
        };

        // A DISPATCHED request (the seam's `internal` / `task` sources) takes this
        // branch whatever its policy, and the reason is the meaning of `accepted`
        // rather than the concurrency queue. The seam hands back a handle the
        // moment acceptance resolves, and a later read of that request authorizes
        // off the provenance persisted in its record's `metadata.dispatch` — the
        // incarnation guard reads its recipient lineage from there. On the
        // ordinary non-queued path acceptance is `onRegistered`, fired well before
        // the request record is written, so the sender would be handed an id whose
        // durable stamp does not exist yet, and a failure in that window leaves an
        // accepted but unverifiable delivery. The queued branch already resolves
        // acceptance off its own enqueue-time writes, so the id and its stamp
        // become durable together. Under `allow` the gate below is a passthrough,
        // so the run still starts immediately — only what `accepted` waits for
        // changes.
        const isDispatched =
          envelope.source === INTERNAL_SOURCE || envelope.source === TASK_SOURCE;

        // A `defer` run waits for its key like a `queue` run, so it needs the
        // same discoverable stub, heartbeat and cancel watch while it waits.
        const waitsForKey =
          (decision.policy === "queue" || decision.policy === "defer") && decision.key !== undefined;
        if (isDispatched || waitsForKey) {
          // Registered HERE rather than left to `runAction`, because between this
          // dispatch and the run's own registration the request is real,
          // discoverable, and cancellable by anyone reading the store — and yet
          // has no controller for `abortRequest` to find. `runAction` re-registers
          // (overwriting this one) when it actually starts, which is the same
          // last-write-wins hand-off the enqueue-time record already uses, so this
          // adds a window rather than a second registry to keep in sync. The
          // `finally` below removes it on every exit, started or not.
          let queuedAbort = registerAbortController(requestId);
          // A `queue` run's start is deferred behind the key, so `dispatchLocal`
          // (which registers `activeRequests` and writes the request record) has
          // not run when this handle is returned. Materialize a discoverable
          // `in_progress` record + activeRequests entry now — the same enqueue-time
          // stub the external dispatcher writes (FIX-828) — so the synchronously
          // returned `requestId` resolves instead of 404ing on `.../requests/:id/
          // stream` while queued. `runAction` adopts/overwrites the stub when the
          // run starts (last-write-wins). If the wait budget elapses the run never
          // starts, so flip the stub to a terminal failure rather than leaving a
          // phantom `in_progress` the client can never resolve.
          const ts = Date.now();
          // Ownership first, then the place, then the writes: see the
          // admission note above for why the place waits on ownership.
          const materialized = admitOwnership(flow, dispatchEnvelope)
            .then((admitted) =>
              admitThen(() => materializeOwned(flow, dispatchEnvelope, admitted, {
                requestId,
                actionName: dispatchEnvelope.actionName,
                sessionId: dispatchEnvelope.sessionId,
                userId: dispatchEnvelope.userId,
                orgId: dispatchEnvelope.orgId,
                tenantId: dispatchEnvelope.tenantId,
                source: dispatchEnvelope.source ?? "http",
                input: dispatchEnvelope.input,
                metadata: dispatchEnvelope.metadata,
                startedAt: ts,
                lastHeartbeatAt: ts
              }, (incarnation) => {
                // Until its record is claimed this controller belongs to no known
                // request, so an abort fenced on one does not fire it. Tagged the
                // moment the record exists, because a cancel can land from then on.
                claimedIncarnation = incarnation;
                tagAbortController(requestId, queuedAbort, incarnation);
              }))
            )
            .then(() => {
              entryOwned = true;
            })
            // Only `run` gives the place back, and it is reached only once
            // materialization succeeds; every failure before that gives it
            // back here.
            .catch(releaseHeldAdmission);

          // This branch defers a start, so it needs the same acceptance signal the
          // external branch has (FIX-999). `accepted` was previously left
          // `undefined` here, so a caller that awaits "where one exists" awaited
          // nothing on the one in-process path that can defer — reporting Started
          // before the record was discoverable, and before a failed materialization
          // was known. Awaiting an absent promise is not a weaker guarantee, it is
          // no guarantee.
          accepted = materialized.then(() => undefined);

          // Nothing heartbeats the enqueue-time entry while the run waits behind
          // the concurrency key, so the stale sweeper reaps a perfectly valid
          // queued request and a liveness read reports it not live. The rule this
          // restores is "whoever owns the entry keeps it warm": the host
          // registered it, so the host heartbeats it until the run starts and
          // `runAction`'s own timer takes over. No sweeper exemption — an
          // exemption for unstarted requests would reintroduce the never-reaped
          // entry the liveness gate's sweep arm exists to prevent.
          let queuedHeartbeat: ReturnType<typeof setInterval> | undefined;
          const stopQueuedHeartbeat = (): void => {
            if (queuedHeartbeat !== undefined) {
              clearInterval(queuedHeartbeat);
              queuedHeartbeat = undefined;
            }
          };

          const queuedHeartbeatMs = resolveQueuedHeartbeatMs(
            flow.request?.heartbeatIntervalMs
          );

          finished = materialized
            .then(() => {
              // A flow that disables heartbeats gets no queued timer either —
              // starting one here would keep an entry warm that the flow asked
              // never to be kept warm.
              if (queuedHeartbeatMs > 0) {
                queuedHeartbeat = setInterval(() => {
                  stores.activeRequests.heartbeat(requestId).catch(() => {});
                }, queuedHeartbeatMs);
                if (typeof (queuedHeartbeat as { unref?: () => void }).unref === "function") {
                  (queuedHeartbeat as unknown as { unref: () => void }).unref();
                }
              }
              // Whether the run reached its turn. A wait that fails first — the
              // budget spent, or a shared backend unreachable mid-wait — never
              // started it, and leaves the stub for this dispatch to settle.
              let started = false;
              // A fired controller is decided once: is it a cancel of the
              // request this dispatch claimed, or a fenced fire for that request
              // after another request took the id? A fenced fire is for the
              // request this dispatch claimed. If another request has taken the
              // id since, that fire is not its cancel: the run adopts it and
              // starts on an unfired controller, and its own start read settles
              // any cancel recorded on it. An unfenced fire (shutdown) stops
              // whatever holds the id.
              let handoffIncarnation = claimedIncarnation;
              let cancelFence: string | undefined;
              let decided: { controller: AbortController; outcome: Promise<boolean> } | undefined;
              const isCancelled = (): Promise<boolean> => {
                if (decided?.controller === queuedAbort) return decided.outcome;
                const fired = queuedAbort;
                const outcome = (async () => {
                  const holder = await stores.request.get(requestId).catch(() => undefined);
                  // Compared with the request the controller is for now: the
                  // claimed one, or the one a stale cancel handed it to.
                  const heldByAnother =
                    holder !== undefined &&
                    handoffIncarnation !== undefined &&
                    resolveRequestIncarnation(holder) !== handoffIncarnation;
                  const fencedOnly = wasFiredOnlyFenced(fired);
                  if (holder !== undefined && heldByAnother && fencedOnly) {
                    handoffIncarnation = resolveRequestIncarnation(holder);
                    queuedAbort = replaceAbortController(requestId, fired, handoffIncarnation);
                    watchWhileQueued();
                    return false;
                  }
                  cancelFence = fencedOnly ? handoffIncarnation : undefined;
                  return true;
                })();
                decided = { controller: fired, outcome };
                return outcome;
              };
              // On a shared backend a place still in line is renewed for as
              // long as this process waits on it, so a cancel is acted on as it
              // lands: the wait is withdrawn, the place given back, and the stub
              // settled below, rather than all of it waiting for the turn.
              const withdrawn = new AbortController();
              const onQueuedAbort = (): void => {
                void isCancelled().then((cancelled) => {
                  if (cancelled && !started) withdrawn.abort();
                });
              };
              const watchWhileQueued = (): void => {
                // In memory the turn-time check below is the only one, as it
                // always was: a place there is not renewed while it waits.
                if (started || !arbiter.arbitratesAcrossProcesses) return;
                if (queuedAbort.signal.aborted) onQueuedAbort();
                else queuedAbort.signal.addEventListener("abort", onQueuedAbort, { once: true });
              };
              watchWhileQueued();
              const cancelledBeforeStart = async (): Promise<never> => {
                await settleUnstartedRequest(stores, requestId, { status: "aborted" }, cancelFence);
                throw new Error(
                  `Request "${requestId}" was cancelled before it left the concurrency queue`
                );
              };
              // Set by now: materialization runs only once admitted.
              return held!.run(async () => {
                started = true;
                queuedAbort.signal.removeEventListener("abort", onQueuedAbort);
                // `runAction` re-registers and starts its own heartbeat timer from
                // here, so the host's stewardship of the entry ends exactly here.
                stopQueuedHeartbeat();
                // Cancelled while it sat in the queue, so do not start it now.
                //
                // A queued run is the one dispatch that exists without an abort
                // controller: `runAction` registers that, and `runAction` has not
                // been called yet. So `abortRequest` finds nothing and returns
                // false, and a cancel issued in this window — shutdown's drain is
                // the reachable one — silently does not apply. Waking up after
                // `dispose()` and starting a run against closed adapters is a
                // corrupting outcome rather than an untidy one, so the wait is
                // registered (above) and the decision is re-read here, at the last
                // moment before anything runs (FIX-1077).
                if (queuedAbort.signal.aborted && (await isCancelled())) {
                  return cancelledBeforeStart();
                }
                // The check above is not sufficient on its own and is not meant to
                // be: an abort landing after it would be lost if `runAction`
                // registered a fresh controller over this one. Handing the
                // controller down is what closes that gap: the check
                // short-circuits the run entirely when the decision is already
                // made, and the controller carries it when it is made a moment
                // later, along with whom it was made for.
                return startRun({ controller: queuedAbort, incarnation: handoffIncarnation });
              }, withdrawn.signal).catch(async (error: unknown) => {
                if (!started && withdrawn.signal.aborted) return cancelledBeforeStart();
                // The stub is this dispatch's own by now — materialization
                // succeeded before the gate opened — so a refusal raised by the
                // RUN (the loser of a session create race, checked in
                // `createExecutionContext`) terminates it like any other start
                // that never happened. Left `in_progress`, it would outlive the
                // entry the `finally` below removes and be invisible to the
                // sweeper. Only the admission-time refusal, handled above, found
                // a record that was never ours. A session another user created
                // under the id while the run waited is refused the same way, and
                // the stub it leaves is ours to settle.
                //
                // A wait that failed before its turn (the budget spent, a shared
                // backend unreachable) means no run started, so it ends only the
                // request this dispatch claimed. A binding refusal comes from the
                // run, which adopted whatever held the id, so it ends that.
                if (!started) {
                  await settleUnstartedRequest(
                    stores,
                    requestId,
                    { status: "failed", cause: error },
                    claimedIncarnation
                  );
                } else if (
                  error instanceof FlowInstanceBindingMismatchError ||
                  error instanceof UserBindingMismatchError
                ) {
                  await settleUnstartedRequest(stores, requestId, {
                    status: "failed",
                    cause: error
                  });
                }
                throw error;
              });
            })
            .finally(() => {
              stopQueuedHeartbeat();
              // Whoever registered it removes it, on every exit — started,
              // cancelled, or timed out — so the pre-start window cannot leak
              // controllers into a long-lived process. Idempotent with
              // `runAction`'s own deregistration on the path where it did start.
              deregisterAbortController(requestId);
            });
        } else {
          // Nothing is written before the run here (`runAction` writes its own
          // records), so a shared backend's place waits only on ownership.
          const arbitrated =
            admitsAfterOwnership &&
            decision.key !== undefined &&
            decision.policy !== "allow";
          finished = arbitrated
            ? admitOwnership(flow, dispatchEnvelope).then(() =>
                admitThen((admitted) => admitted.run(startRun))
              )
            : admitThen((admitted) => admitted.run(startRun));
          // A start that never happens (the gate threw on the way in) must fail
          // acceptance rather than leave it pending forever. Once the run has
          // registered this is already settled and both arms are no-ops.
          finished.then(markAccepted, failAccepted);
          accepted = inProcessAccepted;
        }
      } else {
        // External dispatchers (BullMQ, etc.) run in a separate process and only
        // register the request once the worker starts `runAction`. A client GET
        // .../stream that arrives first would find no record and 404. Materialize
        // the activeRequests entry and an `in_progress` record here, at enqueue
        // time, so the stream route resolves a live record and tails events
        // immediately (FIX-828). The shared `createInitialRequestRecord` builder
        // constructs this stub the same way the worker would, so the worker
        // adopts it as-is and skips its own write. Gating the dispatcher hand-off
        // on these writes means a store failure fails the dispatch rather than
        // enqueueing a job with no discoverable record (no orphan). Resume and the
        // Vercel adapter route through here too, so both inherit the fix.
        //
        // `lastHeartbeatAt` is stamped at enqueue and nothing heartbeats until
        // the worker claims the job and re-registers (runAction), so this entry's
        // age measures queue wait, not worker death. `queuedAt` says so on the
        // entry itself, which is what keeps a backed-up queue from reading as a
        // pile of dead requests (FIX-999): the liveness read reports a queued job
        // live, and the sweeper leaves it alone until it outlives the queued
        // grace, at which point it is reaped like anything else.
        //
        // The in-process branch above keeps its entry warm with a timer instead,
        // and that difference is not an inconsistency. There the host is holding
        // the run and can honestly assert "this is still mine". Here it hands the
        // job to another process and returns 202 — on a serverless host it may be
        // frozen moments later. A timer here would make a queued job's survival
        // depend on the liveness of a process that is not running it, and would
        // beat on behalf of work it has no knowledge of.
        // `acceptance` resolves once the request is accepted: the enqueue-time
        // writes commit AND the dispatcher accepts the job. The response path
        // awaits the exposed `accepted` view before acking, so the 202 means
        // "discoverable and enqueued" — not merely "record written". Crucially the
        // enqueue (`effectiveDispatcher.dispatch`) is inside this promise, so an
        // enqueue failure rejects the ack (failing the POST / reverting the
        // resume) rather than landing in the detached `finished` chain after a 202
        // already went out.
        //
        // Arbitrated only over a shared backend (FIX-1634): the place is taken
        // once ownership passes, before these writes, and rides the job as
        // `leasePlace`; the
        // worker waits its turn and gives it back when the run ends. Until the job
        // is enqueued the place is this dispatch's, so every failure on the way
        // gives it back. Without a shared backend nothing was taken.
        const ts = Date.now();
        const acceptance = admitOwnership(flow, dispatchEnvelope)
          .then((admitted) =>
            admitThen(() => materializeOwned(flow, dispatchEnvelope, admitted, {
              requestId,
              actionName: dispatchEnvelope.actionName,
              sessionId: dispatchEnvelope.sessionId,
              userId: dispatchEnvelope.userId,
              orgId: dispatchEnvelope.orgId,
              tenantId: dispatchEnvelope.tenantId,
              source: dispatchEnvelope.source ?? "http",
              input: dispatchEnvelope.input,
              metadata: dispatchEnvelope.metadata,
              startedAt: ts,
              lastHeartbeatAt: ts,
              queuedAt: ts
            }, (incarnation) => {
              claimedIncarnation = incarnation;
            }))
          )
          .then(async () => {
            entryOwned = true;
            const place = held?.place;
            // A `hold` place has its turn already; a `defer` job holds no place
            // yet and claims its key once the key is free.
            const leaseTurn: LeaseTurn | undefined =
              decision.key === undefined
                ? undefined
                : decision.policy === "hold"
                  ? { kind: "now" }
                  : decision.policy === "defer"
                    ? { kind: "when-free", key: decision.key }
                    : undefined;
            const handle = await effectiveDispatcher.dispatch({
              ...dispatchEnvelope,
              ...(place !== undefined ? { leasePlace: place } : {}),
              ...(leaseTurn !== undefined ? { leaseTurn } : {})
            });
            // Enqueued: the place is the job's now, and its worker renews it.
            // Until here this process held it, and the admission renewed it.
            held?.handOff(handle.finished);
            return handle;
          })
          // Materialization or the enqueue failed: the job is not running and
          // never will. The record can land before the entry write fails, and a
          // failed enqueue leaves a fully-written one, so it is terminated
          // rather than left `in_progress` with nothing for the sweeper to reap
          // (the `finally` below only deregisters the entry). The place goes
          // back with it.
          .catch(releaseHeldAdmission);

        accepted = acceptance.then(() => undefined);
        finished = acceptance.then((handle) => handle.finished);
      }
    } catch (error) {
      // A synchronous throw between admission and the hand-off to a run: give
      // the place back before the error leaves `dispatch`. In memory the
      // give-back is synchronous, so the key is free by the time it does.
      if (held !== undefined) void held.release();
      liveStream?.close();
      throw error;
    }

    finished = finished.finally(() => {
      if (liveStream !== null) {
        liveStream.close();
      }
      // Safety net: deregister if runAction didn't (e.g., truly catastrophic
      // failure) — but only an entry this dispatch owns. A dispatch refused at
      // admission never registered, and the entry under its id, if any, is
      // another instance's live work.
      if (entryOwned) {
        stores.activeRequests.deregister(requestId).catch(() => {});
      }
    });

    // Contained by `registerBackgroundWork`, because this is the ONLY thing left
    // in `dispatch` that can throw synchronously and the run has already been
    // started above — see that helper for why an escaping throw is damaging.
    //
    // Taken from `dispatchRuntimeConfig`, not from the host's construction-time
    // config, and on a freeze-after-response platform that distinction is the
    // difference between the child finishing and the child stalling. The run
    // executes under the dispatch config; the keep-alive hook is what holds the
    // process open for it. Read the host's instead and a detached child launched
    // by a request whose config carries its own `after()` / `waitUntil` hands
    // `finished` to the wrong scope — or to nothing — and the platform freezes
    // the container the moment the parent responds, with the child mid-run.
    // Every other per-dispatch value here already resolves this way
    // (`voiceProvider`, `logger`); this one did not.
    registerBackgroundWork(
      finished,
      { requestId, flowKind: dispatchEnvelope.flowKind },
      dispatchRuntimeConfig.onBackgroundWork
    );

    // The HTTP 202 path awaits `accepted`, not `finished`, so a fire-and-forget
    // external dispatch can leave `finished` unobserved. Mark it handled to
    // avoid an unhandled rejection (e.g. an enqueue failure, which is already
    // surfaced to the caller via `accepted`). This only registers an extra
    // rejection handler — callers that await `finished` still observe it.
    void finished.catch(() => {});
    // Likewise `accepted`: a caller that awaits only `finished` (MCP does)
    // sees the same failure there, so an unobserved `accepted` must not
    // surface as an unhandled rejection.
    void accepted?.catch(() => {});

    return {
      requestId,
      responseEmitter,
      liveStream,
      finished: finished as Promise<ExecutionResult>,
      accepted
    };
  };

  const continueRequest = async (
    opts: HostContinueRequestOptions
  ): Promise<ContinueRequestResult> => {
    const result = await continueRequestImpl({
      requestId: opts.requestId,
      resumeContext: opts.resumeContext,
      signal: opts.signal,
      responseEmitter: opts.responseEmitter,
      includeTrace: opts.includeTrace,
      stores,
      flowRegistry: registry,
      runtimeConfig
    });

    // Keep the serverless function alive until the resumed run finishes, exactly
    // as `dispatch` does (above). The resume route returns 202 without awaiting
    // `finished`, so on a freeze-after-response platform (Vercel: no BullMQ, the
    // continuation runs inline via `runAction`) the inline run would stall when
    // the response is sent and only resume when a later invocation thaws the
    // container — the resume appears to hang for tens of seconds, the flow's
    // remaining steps never run, and a refresh still shows `in_progress`.
    // Registering `finished` with `onBackgroundWork` (→ Next `after()` /
    // waitUntil) lets it run to completion. Contained by
    // `registerBackgroundWork`: `continueRequestImpl` above has already started
    // the run, so a throw escaping from here would reject this promise and the
    // resume route would read that as setup having failed — reverting the
    // suspension of a request that is still running (FIX-1095).
    //
    // `void .catch` marks `finished` handled: the 202 path doesn't await it, so
    // an unobserved rejection must not surface as an unhandled rejection. It
    // stays inside the keep-alive branch, which is the only case where nothing
    // else is guaranteed to observe the promise.
    if (onBackgroundWork !== undefined) {
      registerBackgroundWork(result.finished, { requestId: opts.requestId });
      void result.finished.catch(() => {});
    }

    return result;
  };

  const validateDispatch = async (
    envelope: InboundRequestEnvelope
  ): Promise<void> => {
    const flow = registry.get(envelope.flowKind);
    if (flow === undefined) {
      throw new UnknownFlowError(envelope.flowKind);
    }
    // Organization identity is no longer a per-flow opt-in to check here
    // (FIX-1442). Every envelope reaching dispatch carries one: `resolve`
    // validated it for inbound callers, and a trusted direct submitter is
    // validated at its own seam. What remains is the envelope's own
    // completeness, checked for the same reason it always was — before
    // anything is written.
    const orgId = envelope.orgId ?? envelope.principal.orgId;
    if (!isValidOrgId(orgId)) {
      throw new OrgRequiredError(envelope.flowKind, "dispatch");
    }
    // Before the 202. A mismatch is the same answer as an address this
    // process does not hold, so the caller cannot probe which it was.
    if (pinRejectsCaller(flow.ownerPin, { userId: envelope.principal.userId, orgId })) {
      throw new UnknownFlowError(envelope.flowKind);
    }
  };

  // The host's resolution is the shared one, reporting configuration through
  // this host's logger. See `createPrincipalResolution`.
  const resolution = createPrincipalResolution({
    registry,
    resolvePrincipal,
    warn: (message, context) => logSafely(runtimeConfig.logger, "warn", message, context)
  });

  const resolve = async (
    context: PrincipalResolutionContext
  ): Promise<ResolvedPrincipal> => (await resolution(context)).principal;

  return {
    registry,
    stores,
    resolvers: {
      model: runtimeConfig.modelResolver,
      // Router-level provider only — the per-action effective provider (which
      // may be a per-flow override) is merged in `dispatch` and not mirrored
      // here. This bag exists for adapter introspection.
      voice: runtimeConfig.voiceProvider
    },
    logger: runtimeConfig.logger,
    usesExternalDispatcher: isExternalDispatcher,
    arbitratesExternalDispatch,
    dispatch,
    continueRequest,
    validateDispatch,
    resolvePrincipal: resolve
  };
}
