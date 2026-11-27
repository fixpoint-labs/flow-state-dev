// FIX-2623.
/**
 * The view routes:
 *
 * - `POST /:flowKind/views/:viewName` — a user or org view, with no session.
 * - `POST /:flowKind/:sessionId/views/:viewName` — a session view, on that session.
 *
 * Each runs the view for its caller and answers `200 { output, topics, hears }`:
 * the answer, the change topics what it read falls under, deduped and
 * sorted, and which notices under each may change it. Nothing is stored (`execution/runView.ts`). A keyed view adds its
 * rows' `keys`; a body that names a `changed` notice with ids may get a
 * partial answer, flagged `partial: { removed }`.
 *
 * A caller outside the flow instance's owner pin gets the 404 an unregistered
 * address gets, before anything about the flow's views is answered.
 *
 * The caller is resolved on the `:flowKind` path through the flow's own
 * resolver (`pickPrincipalResolver`, through `host.resolvePrincipal`), as an
 * action and a read are, never from the body, query or headers. A
 * user or org view takes user and org from that principal and runs on no
 * session; a session view is fenced the way the session's action route is:
 * a session the caller may not run in answers as an id with no session
 * behind it, and a view can't make one.
 */
import { NOTICE_MAX_IDS } from "@flow-state-dev/core/internal";
import type { ViewChange } from "@flow-state-dev/core";
import type { FlowRegistry } from "../registry/flow-registry";
import type { StoreRegistry } from "../stores/types";
import type { InboundTransportHost } from "../transports/types";
import type { RuntimeConfig } from "../runtime-config";
import { PrincipalResolutionError } from "../transports/errors";
import {
  assertSessionAdmitted,
  FlowInstanceBindingMismatchError,
  OrgBindingMismatchError,
  TenantBindingMismatchError,
  UserBindingMismatchError
} from "../context/binding-errors";
import { InstancePinMismatchError, pinRejectsCaller, unknownFlowMessage } from "../context/instance-pin";
import { NoSessionError } from "../context/no-session";
import { UnrecordedReadError, ViewModelCallError } from "../context/view-reads";
import { FlowError } from "../errors/flow-error";
import { runView, UnknownViewError } from "../execution/runView";
import { isWireTopic } from "../push/socket-session";
import { keyHearingPartitions } from "../push/partition-key";
import { asObject, extractTenantId, jsonResponse, loadTenantSession, parseJsonBody, unknownSessionResponse } from "./route-utils";
import type { ParsedFlowRoute } from "./parseFlowRoute";
import type { FlowInstance } from "@flow-state-dev/core/types";
import type { SessionRecord } from "../stores/types";
import type { SessionAdmission, SuspensionAdmission } from "../context/request-sessions";
import { isOrgAttributed } from "../context/org-attribution";
import { resolveRecordOwner } from "../context/record-owner";
import { admitSession, flowAuthenticates, ownResolverVerdict, type InstanceCallerResolver } from "./instance-caller";
import { principalOwns } from "../context/principal";

type ViewRoute = Extract<ParsedFlowRoute, { kind: "run_view" }>;

type ViewRouteContext = {
  host: InboundTransportHost;
  registry: FlowRegistry;
  stores: StoreRegistry;
  runtimeConfig: RuntimeConfig;
  /** Header carrying the tenant id; defaults to `x-tenant-id`. */
  tenantIdHeader?: string;
  // FIX-2725 D1.
  /** The caller as each instance's own doors resolve it: the session list's admission, for the view's session reads. */
  callerFor: InstanceCallerResolver;
  // FIX-2750.
  /** The router's push secret, which keys the partitions an answer read; `undefined` on a host with no push. */
  pushSecret: () => string | undefined;
};

/** Run one view for its caller. See the file header. */
export async function handleRunView(request: Request, route: ViewRoute, ctx: ViewRouteContext): Promise<Response> {
  const flow = ctx.registry.get(route.flowKind);
  if (flow === undefined) return jsonResponse(404, { error: unknownFlowMessage(route.flowKind) });

  const body = await parseJsonBody(request);
  const metadata = asObject(body.metadata);
  const tenantId = extractTenantId(request, ctx.tenantIdHeader);

  let principal;
  try {
    principal = await ctx.host.resolvePrincipal({
      source: "http",
      request,
      envelope: {
        flowKind: flow.id,
        action: route.viewName,
        ...(route.sessionId !== undefined ? { sessionId: route.sessionId } : {}),
        metadata: { ...(metadata ?? {}), body },
        input: body.input
      }
    });
  } catch (error) {
    if (error instanceof PrincipalResolutionError) {
      // As the action route: a missing body.userId is the legacy 400.
      const status = error.status === 401 && error.message.includes("userId") ? 400 : error.status;
      return jsonResponse(status, { error: error.message });
    }
    throw error;
  }

  // The instance's owner pin, before anything about the flow is answered: a
  // caller outside it gets the 404 an unregistered address gets, so it can't
  // learn the instance exists or which views it has (as session create does).
  if (pinRejectsCaller(flow.ownerPin, { userId: principal.userId, orgId: principal.orgId })) {
    return jsonResponse(404, { error: unknownFlowMessage(route.flowKind) });
  }

  const view = Object.hasOwn(flow.views ?? {}, route.viewName) ? flow.views![route.viewName]! : undefined;
  if (view === undefined) return jsonResponse(404, { error: new UnknownViewError(flow.id, route.viewName).message });

  // The address must match the view's scope: a session view names its
  // session, and a user or org view names none.
  if (view.scope === "session" && route.sessionId === undefined) {
    return jsonResponse(400, {
      error: "view_needs_session",
      message: `View "${route.viewName}" runs on a session: call it at /${route.flowKind}/<sessionId>/views/${route.viewName}`
    });
  }
  if (view.scope !== "session" && route.sessionId !== undefined) {
    return jsonResponse(400, {
      error: "view_takes_no_session",
      message: `View "${route.viewName}" runs at ${view.scope} scope, with no session: call it at /${route.flowKind}/views/${route.viewName}`
    });
  }

  try {
    if (route.sessionId !== undefined) {
      // A session view runs in a session that exists: it can't create one.
      // Another user's session answers as an unknown one, as the action route answers it.
      const session = await loadTenantSession(ctx.stores.session, route.sessionId, tenantId);
      if (session === undefined) return unknownSessionResponse(route.sessionId);
      assertSessionAdmitted(flow, session, { sessionId: route.sessionId, userId: principal.userId, tenantId });
    }
    const changed = changeOf(body.changed);
    const answer = await runView({
      flow,
      viewName: route.viewName,
      input: body.input,
      ...(changed !== undefined ? { changed } : {}),
      userId: principal.userId,
      orgId: principal.orgId,
      ...(route.sessionId !== undefined ? { sessionId: route.sessionId } : {}),
      ...(tenantId !== undefined ? { tenantId } : {}),
      stores: ctx.stores,
      runtimeConfig: ctx.runtimeConfig,
      signal: request.signal,
      resolveFlow: (address) => ctx.registry.get(address),
      // The door's kind and resolver, kept for the run, as an action's are: a
      // read across the caller's sessions admits each as a named reach would.
      ...(principal.kind !== undefined ? { principalKind: principal.kind } : {}),
      ...(principal.resolvedBy !== undefined ? { resolvedBy: principal.resolvedBy } : {}),
      flows: ctx.registry,
      admitSession: viewSessionAdmission(ctx, flow, tenantId),
      admitSuspension: (entry) => viewSuspensionAdmission(ctx, flow, entry)
    });
    return jsonResponse(200, {
      output: answer.output ?? null,
      topics: answer.topics,
      hears: keyHearingPartitions(answer.hears, ctx.pushSecret(), tenantId ?? ""),
      ...(answer.keys !== undefined ? { keys: answer.keys } : {}),
      ...(answer.partial !== undefined ? { partial: answer.partial } : {})
    });
  } catch (error) {
    return viewFailureResponse(error, route);
  }
}

// FIX-2725 D1.
/**
 * Which of the caller's sessions a view's session reads may answer, on top of
 * the owner rule they apply: the one session admission (`admitSession`), the
 * HTTP session list's. A row of an instance with a resolver of its own is
 * judged by that resolver with this request's credentials, so a caller the
 * view's flow admits but that instance refuses reads nothing of it. Any other
 * row needs an organization; and when the view's own flow resolves its callers
 * itself, the host's resolver must name the same owner, as the HTTP list's
 * host rule would, since the view's principal is not the host's.
 */
function viewSessionAdmission(ctx: ViewRouteContext, flow: FlowInstance, tenantId: string | undefined): SessionAdmission {
  const hostRule = async (session: SessionRecord): Promise<boolean> => {
    if (!flowAuthenticates(flow)) return true;
    const owner = resolveRecordOwner(ctx.registry, session);
    if (!owner.ok) return false;
    const caller = await ctx.callerFor(owner.flow);
    return caller !== undefined && principalOwns(session, caller);
  };
  return (session) => admitSession({ registry: ctx.registry, callerFor: ctx.callerFor, tenantId, hostRule }, session);
}

// FIX-2770.
/**
 * Whether a view's read of the caller's pending suspensions may answer one
 * row: the instance's own credential check, judged on the row's request,
 * with or without a session, by the rule `admitSession` applies to a
 * session: a row of an instance with a resolver of its own is judged on that
 * resolver's word (`ownResolverVerdict`); any other row needs an owner that
 * resolves and an organization, and, when the view's own flow resolves its
 * callers itself, the host's resolver must name the same user and
 * organization for the row's owner. A sessionless suspension has no session
 * for `admitSession` to judge, so this is what covers it; a row with a
 * session also passes the session admission (`request-sessions.ts`). It only
 * removes rows the store's query already scoped to the caller.
 */
async function viewSuspensionAdmission(
  ctx: ViewRouteContext,
  flow: FlowInstance,
  entry: Parameters<SuspensionAdmission>[0]
): Promise<boolean> {
  const own = await ownResolverVerdict(ctx.registry, ctx.callerFor, entry);
  if (own !== undefined) return own;
  const owner = resolveRecordOwner(ctx.registry, entry);
  if (!owner.ok || !isOrgAttributed(entry)) return false;
  if (!flowAuthenticates(flow)) return true;
  const caller = await ctx.callerFor(owner.flow);
  return caller !== undefined && principalOwns(entry, caller);
}

// FIX-2625 D1.
/**
 * The change a call asks the view to answer for, from `body.changed`: a wire
 * topic, a kind, and 1 to {@link NOTICE_MAX_IDS} string ids. Anything else is
 * no change, and the view runs whole. It decides only which rows the view
 * reads again, through the view's own checks, never who may read them.
 */
function changeOf(value: unknown): ViewChange | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { topic, kind, ids } = value as Record<string, unknown>;
  if (!isWireTopic(topic) || typeof kind !== "string" || !CHANGE_KINDS.has(kind)) return undefined;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > NOTICE_MAX_IDS || !ids.every((id) => typeof id === "string")) return undefined;
  return { topic, kind: kind as ViewChange["kind"], ids: [...ids] as string[] };
}

const CHANGE_KINDS = new Set(["items", "request", "run", "state", "resource", "board", "suspension", "resync"]);

/** What a failed view answers: the action route's answer for a binding refusal, a named code for the rest. */
function viewFailureResponse(error: unknown, route: ViewRoute): Response {
  if (error instanceof UnknownViewError) return jsonResponse(404, { error: error.message });
  // A pin miss never names the instance or which half of the pin failed,
  // however it surfaces: the pre-check above stops the caller, and this keeps
  // one thrown later, or wrapped by the block executor, from saying more.
  if (hasCause(error, InstancePinMismatchError)) return jsonResponse(404, { error: unknownFlowMessage(route.flowKind) });
  if (
    route.sessionId !== undefined &&
    (error instanceof UserBindingMismatchError ||
      error instanceof OrgBindingMismatchError ||
      error instanceof TenantBindingMismatchError)
  ) {
    return unknownSessionResponse(route.sessionId);
  }
  if (error instanceof FlowInstanceBindingMismatchError) {
    return jsonResponse(409, {
      error: error.reason === "migration-required" ? "migration-required" : "wrong-instance-session",
      message: `Record "${error.recordId}" is not owned by flow instance "${error.addressedFlowId}"`
    });
  }
  // The view's own code is wrong, not the call: 422, named.
  if (error instanceof ViewModelCallError) return jsonResponse(422, { error: "view_model_call", message: error.message });
  if (error instanceof NoSessionError) return jsonResponse(422, { error: "view_no_session", message: error.message });
  if (error instanceof UnrecordedReadError) return jsonResponse(422, { error: "view_unrecorded_read", message: error.message });
  if (FlowError.isInstance(error)) {
    const status = error.code === "validation_error" ? 400 : error.code === "read_only" ? 409 : error.retryable ? 503 : 422;
    return jsonResponse(status, { error: error.code ?? "view_failed", message: error.message });
  }
  const message = error instanceof Error ? error.message : String(error);
  return jsonResponse(500, { error: "view_failed", message });
}

/** Whether `error`, or an error in its `cause` chain, is a `type`. */
function hasCause(error: unknown, type: new (...args: never[]) => Error): boolean {
  for (let cause: unknown = error, depth = 0; cause instanceof Error && depth < 8; cause = (cause as Error).cause, depth += 1) {
    if (cause instanceof type) return true;
  }
  return false;
}
