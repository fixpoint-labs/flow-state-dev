// FIX-2624.
/**
 * Routes for user and org resources with no session: a direct read by scope
 * and key, a write sent through the flow the resource's `runBy` names, and the
 * identity read of one flow.
 *
 * Each resolves the caller in its handler, through `resolveFlowCaller`
 * (`scope-address.ts`) at the flow whose rules apply, so route-auth classifies
 * them `exempt`, as it does the action route: every declaring flow for a read
 * or a default write (each must sign the caller in, and one's pin admit them,
 * before anything but an unused key's answer is given), the writer for a send
 * to `runBy: { flow }`, as a direct POST to it would, and the path's flow for
 * the identity read. None reads the user or org from the body, the query or a
 * header, except the open mode's development resolver, which takes the
 * request's `userId` as every route does in that mode.
 *
 * A direct read runs no block and touches no session: it is a store read and
 * the client projection. A send derives the writer's session on the server and
 * hands the action route a request it would have taken from a client, with the
 * caller already resolved.
 */
import type { FlowRegistry } from "../registry/flow-registry";
import type { StoreRegistry } from "../stores/types";
import type { InboundTransportHost, PrincipalResolver } from "../transports/types";
import { unknownFlowMessage } from "../context/instance-pin";
import { getString, jsonResponse, parseJsonBody, extractTenantId } from "./route-utils";
import type { ParsedFlowRoute } from "./parseFlowRoute";
import {
  admitAddress,
  flowDeclares,
  isAddressScope,
  projectForClient,
  readAddressed,
  resolveFlowCaller
} from "../resources/scope-address";
import { DEFAULT_WRITE_FLOW, writeSessionId } from "../resources/default-write-flow";

type ScopeRouteContext = {
  host: InboundTransportHost;
  registry: FlowRegistry;
  stores: StoreRegistry;
  hostResolver: PrincipalResolver;
};

function refusedResponse(refused: { status: number; code: string; message: string }): Response {
  return jsonResponse(refused.status, { error: refused.code, message: refused.message });
}

/**
 * GET /resources/:scope/:key
 * The caller's copy of a user or org resource, as the client sees it, and its
 * version (0: nothing stored yet, the value is the schema's default).
 */
export async function handleReadScopeResource(
  request: Request,
  route: Extract<ParsedFlowRoute, { kind: "read_scope_resource" }>,
  ctx: ScopeRouteContext
): Promise<Response> {
  if (!isAddressScope(route.scope)) {
    return jsonResponse(400, { error: "invalid_scope", message: `Scope "${route.scope}" is not "user" or "org"` });
  }
  const admitted = await admitAddress({
    ...ctx,
    request,
    scope: route.scope,
    key: route.key,
    action: route.kind,
    claimedUserId: getString(new URL(request.url).searchParams.get("userId"))
  });
  if ("refused" in admitted) return refusedResponse(admitted.refused);
  const { address, caller } = admitted;
  const { state, version } = await readAddressed(ctx.stores, address, caller);
  const value = await projectForClient(address, state);
  return jsonResponse(200, {
    scope: address.scope,
    key: address.key,
    // Absent when the session's snapshot carries no state for it either.
    ...(value !== undefined ? { value } : {}),
    version
  });
}

/**
 * GET /:flowKind/identity
 * The user and org the server acts as under this flow's sign-in.
 */
export async function handleFlowIdentity(
  request: Request,
  route: Extract<ParsedFlowRoute, { kind: "flow_identity" }>,
  ctx: ScopeRouteContext
): Promise<Response> {
  const flow = ctx.registry.get(route.flowKind);
  if (flow === undefined || flow.id === DEFAULT_WRITE_FLOW) {
    return jsonResponse(404, { error: unknownFlowMessage(route.flowKind) });
  }
  const principal = await resolveFlowCaller({
    ...ctx,
    request,
    flow,
    action: route.kind,
    claimedUserId: getString(new URL(request.url).searchParams.get("userId"))
  });
  if ("refused" in principal) {
    return principal.refused.code === "outside_pin"
      ? jsonResponse(404, { error: unknownFlowMessage(route.flowKind) })
      : jsonResponse(principal.refused.status, { error: "unauthenticated", message: principal.refused.message });
  }
  return jsonResponse(200, { userId: principal.userId, orgId: principal.orgId });
}

/** What the action route needs to run a resource send. */
export type ResourceSend = {
  /** The writing flow's instance id. */
  flowKind: string;
  /** The writer's session, derived on the server. */
  sessionId: string;
  /** The caller, resolved through the declaring flow. */
  principal: { userId: string; orgId: string };
};

/**
 * Resolve a send addressed to a resource (`POST /resources/:scope/:key/actions/:action`)
 * to the flow that writes it, its caller and the caller's write session. A
 * resource with no `runBy` is refused: a client can't write it.
 */
export async function resolveResourceSend(
  request: Request,
  route: Extract<ParsedFlowRoute, { kind: "send_resource" }>,
  ctx: ScopeRouteContext & { tenantIdHeader?: string }
): Promise<ResourceSend | Response> {
  if (!isAddressScope(route.scope)) {
    return jsonResponse(400, { error: "invalid_scope", message: `Scope "${route.scope}" is not "user" or "org"` });
  }
  // The open mode's development resolver takes the body's userId, as the action route does.
  const claimedUserId = getString((await parseJsonBody(request.clone())).userId);
  // Nothing about the resource is said until the caller passes every declaring flow.
  const admitted = await admitAddress({ ...ctx, request, scope: route.scope, key: route.key, action: route.actionName, claimedUserId });
  if ("refused" in admitted) return refusedResponse(admitted.refused);
  const { address } = admitted;
  const runBy = address.config.runBy;
  if (runBy === undefined) {
    return jsonResponse(403, {
      error: "not_writable",
      message:
        `Resource "${route.key}" at ${route.scope} scope sets no runBy, so a client can't write it. ` +
        `Server flows still write it from inside their actions.`
    });
  }
  let writer: string;
  let caller = admitted.caller;
  if (runBy === "default") {
    // Held by every host from the start (`registerBuiltIn`); a hand-built registry may lack it.
    if (ctx.registry.get(DEFAULT_WRITE_FLOW) === undefined) {
      return jsonResponse(501, { error: "no_default_write_flow", message: "This host's registry holds no default write flow." });
    }
    writer = DEFAULT_WRITE_FLOW;
  } else {
    const flow = ctx.registry.get(runBy.flow);
    const declares = flow !== undefined && flowDeclares(ctx.registry, flow, address.scope, address.key);
    if (flow === undefined || !declares) {
      return jsonResponse(409, {
        error: "runby_flow_missing",
        message:
          `Resource "${route.key}" at ${route.scope} scope names runBy flow "${runBy.flow}", which is not registered ` +
          `here or does not declare it.`
      });
    }
    // The writer's action runs, so the writer's door decides who the caller is:
    // its resolver, requireUser and defaultUserId, as a direct POST to it would.
    const writerCaller = await resolveFlowCaller({ ...ctx, request, flow, action: route.actionName, claimedUserId });
    if ("refused" in writerCaller) return refusedResponse(writerCaller.refused);
    writer = flow.id;
    caller = writerCaller;
  }
  const tenantId = extractTenantId(request, ctx.tenantIdHeader);
  return {
    flowKind: writer,
    sessionId: writeSessionId(
      { scope: address.scope, key: address.key, writer },
      { userId: caller.userId, orgId: caller.orgId, tenantId }
    ),
    principal: caller
  };
}
