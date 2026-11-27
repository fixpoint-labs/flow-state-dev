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
 * The resolver that governs the instance at `address` (an exact flow instance
 * id, carried on the historical `flowKind` slot): the instance's own if it
 * configures one, otherwise `hostResolver`. An unregistered or absent address
 * (a route that spans every flow) yields the host-level fallback.
 */
export function pickPrincipalResolver(
  registry: Pick<FlowRegistry, "get">,
  address: string | undefined,
  hostResolver: PrincipalResolver
): PrincipalResolver {
  const flow = address === undefined ? undefined : registry.get(address);
  return flow?.authentication?.resolvePrincipal ?? hostResolver;
}

// FIX-2942.
/**
 * The identity of the resolver that governs the instance at `address`, with
 * the host settings applied to its answer there (`requireUser`,
 * `defaultUserId`): the value a principal's `resolvedBy` carries, and the
 * key the HTTP list resolves once per (`createInstanceCallerResolver`).
 *
 * A value, not the function, so it rides a runner's envelope. The host's
 * resolver is `host`; an instance's own is named by the first registered
 * instance that configures that same function, so instances sharing one
 * resolver share its name. One resolver under two configurations gives two
 * values that never compare equal.
 *
 * `undefined` when the resolver can't be named: `hostResolver` is not known
 * here and the instance configures one of its own, which may be the host's.
 * An absent identity matches nothing.
 */
export function principalResolverIdentity(
  registry: Pick<FlowRegistry, "get" | "list">,
  address: string | undefined,
  hostResolver: PrincipalResolver | undefined
): string | undefined {
  const flow = address === undefined ? undefined : registry.get(address);
  const own = flow?.authentication?.resolvePrincipal;
  if (own !== undefined && hostResolver === undefined) return undefined;
  let name: string;
  if (own === undefined || own === hostResolver) {
    name = "host";
  } else {
    const first = registry.list().find((candidate) => candidate.authentication?.resolvePrincipal === own);
    name = `flow:${first?.id ?? flow?.id}`;
  }
  return JSON.stringify([name, flow?.requireUser ?? true, flow?.authentication?.defaultUserId ?? null]);
}
