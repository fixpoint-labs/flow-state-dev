/**
 * The caller as each flow instance's own doors resolve it, for the routes that
 * span every instance: the flow catalog, the session listing and the
 * active-request listing.
 *
 * Opening a session and running an action resolve the caller through
 * `host.resolvePrincipal` at the instance's address, so the host applies the
 * instance's own resolver if it has one (`pickPrincipalResolver`) and that
 * instance's `requireUser` / `defaultUserId`. A cross-flow read has no single
 * address, so it asks the same question once per instance it is about to show,
 * and gets the same answer the door would give. The call carries no body, the
 * same as the route guard's own (`route-auth.ts`).
 */
import type { FlowInstance } from "@flow-state-dev/core/types";
import type { FlowRegistry } from "../registry/flow-registry";
import type { InboundTransportHost, PrincipalResolver } from "../transports/types";
import { PrincipalResolutionError } from "../transports/errors";
import { pickPrincipalResolver } from "../transports/auth/pickPrincipalResolver";
import { isDefaultBodyUserIdPrincipalResolver } from "../transports/auth/defaultBodyUserIdPrincipalResolver";
import { pinRejectsCaller } from "../context/instance-pin";
import { resolveRecordOwner, type OwnedRecord } from "../context/record-owner";

/** A caller one instance's resolver accepted. */
export type InstanceCaller = { userId: string; orgId: string };

/**
 * The caller as `flow`'s doors resolve them, or `undefined` when that
 * instance's resolver refuses them.
 */
export type InstanceCallerResolver = (flow: FlowInstance) => Promise<InstanceCaller | undefined>;

/**
 * Build the per-request {@link InstanceCallerResolver}.
 *
 * A caller an instance's resolver refuses (`PrincipalResolutionError`) is not
 * that instance's caller, so the answer is `undefined` and the route never
 * answers 401 on that instance's account. Any other error propagates.
 *
 * Resolution is per instance: a credential one instance's resolver accepts
 * says nothing about another's. Instances that share a resolver and the
 * settings the host applies to its answer (`requireUser`, `defaultUserId`) are
 * resolved once per request, at the first such instance's address.
 *
 * @param action The route kind, carried on the envelope as the doors carry theirs.
 */
export function createInstanceCallerResolver(options: {
  registry: FlowRegistry;
  host: InboundTransportHost;
  request: Request;
  hostResolver: PrincipalResolver;
  action: string;
}): InstanceCallerResolver {
  const { registry, host, request, hostResolver, action } = options;
  const resolved = new Map<PrincipalResolver, Map<string, Promise<InstanceCaller | undefined>>>();

  const resolveAt = async (address: string): Promise<InstanceCaller | undefined> => {
    try {
      return await host.resolvePrincipal({
        source: "http",
        request,
        envelope: { flowKind: address, action, metadata: {}, input: undefined }
      });
    } catch (error) {
      if (error instanceof PrincipalResolutionError) return undefined;
      throw error;
    }
  };

  return (flow) => {
    const resolver = pickPrincipalResolver(registry, flow.id, hostResolver);
    const settings = JSON.stringify([
      flow.requireUser ?? true,
      flow.authentication?.defaultUserId ?? null
    ]);
    let byResolver = resolved.get(resolver);
    if (byResolver === undefined) {
      byResolver = new Map();
      resolved.set(resolver, byResolver);
    }
    let caller = byResolver.get(settings);
    if (caller === undefined) {
      caller = resolveAt(flow.id);
      byResolver.set(settings, caller);
    }
    return caller;
  };
}

/** Whether `flow` configures a resolver of its own that is not the framework default. */
export function flowAuthenticates(flow: {
  authentication?: { resolvePrincipal?: PrincipalResolver };
}): boolean {
  const resolver = flow.authentication?.resolvePrincipal;
  return resolver !== undefined && !isDefaultBodyUserIdPrincipalResolver(resolver);
}

/**
 * A host listing's verdict on one row, when the row belongs to an instance
 * that resolves its callers with a resolver of its own. `undefined` for every
 * other row, which the listing judges by its host-level rule as before.
 *
 * The row is shown only when that instance's resolver accepts the caller, the
 * row's recorded owner and organization are the principal it returned (the
 * owner check the session and request routes apply), and, for a pinned
 * instance, that principal is inside the pin.
 */
export async function ownResolverVerdict(
  registry: FlowRegistry,
  callerFor: InstanceCallerResolver,
  row: OwnedRecord & { userId: string; orgId?: string | null }
): Promise<boolean | undefined> {
  const owner = resolveRecordOwner(registry, row);
  if (!owner.ok || !flowAuthenticates(owner.flow)) return undefined;
  const caller = await callerFor(owner.flow);
  if (caller === undefined) return false;
  if (row.userId !== caller.userId || row.orgId !== caller.orgId) return false;
  return !pinRejectsCaller(owner.flow.ownerPin, caller);
}
