/**
 * The one place resolver precedence is decided.
 *
 * A flow's own `authentication.resolvePrincipal` wins over the host-level
 * fallback. Two callers need this answer and must never disagree:
 * `createInboundTransportHost` uses it to pick the resolver it *calls*, and
 * the route-level guard uses it to decide whether authentication is enforced
 * at all. If those drifted, the guard could wave through a route the host
 * would have authenticated, or demand a principal the host resolves
 * differently — a security bug in either direction.
 */
import type { FlowRegistry } from "../../registry/flow-registry";
import type { PrincipalResolver } from "../types";

/**
 * The resolver that governs `flowKind`: the flow's own if it configures one,
 * otherwise `hostResolver`. An unregistered or absent `flowKind` (a route that
 * spans every flow) yields the host-level fallback.
 */
export function pickPrincipalResolver(
  registry: FlowRegistry,
  flowKind: string | undefined,
  hostResolver: PrincipalResolver
): PrincipalResolver {
  const flow = flowKind === undefined ? undefined : registry.get(flowKind);
  return flow?.authentication?.resolvePrincipal ?? hostResolver;
}
