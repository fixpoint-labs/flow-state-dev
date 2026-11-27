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
import { principalResolverIdentity } from "../transports/auth/pickPrincipalResolver";
import { principalOwns, type Principal } from "../context/principal";
import { isDefaultBodyUserIdPrincipalResolver } from "../transports/auth/defaultBodyUserIdPrincipalResolver";
import { pinRejectsCaller } from "../context/instance-pin";
import { isOrgAttributed } from "../context/org-attribution";
import { resolveRecordOwner, type OwnedRecord } from "../context/record-owner";
import { isWriteRecord, isWriteSessionId } from "../resources/default-write-flow";
import { tenantMatches } from "../stores/scope-keys";
import type { SessionRecord } from "../stores/types";

/**
 * The caller as `flow`'s doors resolve them (`Principal`), or `undefined`
 * when that instance's resolver refuses them.
 */
export type InstanceCallerResolver = (flow: FlowInstance) => Promise<Principal | undefined>;

/**
 * Build the per-request {@link InstanceCallerResolver}.
 *
 * A caller an instance's resolver refuses (`PrincipalResolutionError`) is not
 * that instance's caller, so the answer is `undefined` and the route never
 * answers 401 on that instance's account. Any other error propagates.
 *
 * Resolution is per instance: a credential one instance's resolver accepts
 * says nothing about another's. Instances that share a resolver identity
 * (`principalResolverIdentity`: the resolver and the settings the host
 * applies to its answer) are resolved once per request, at the first such
 * instance's address. That identity is what the principal carries as
 * `resolvedBy`.
 *
 * @param action The route kind, carried on the envelope as the doors carry theirs.
 * @param tenantId The request's tenant, stamped on each principal so the owner comparison sees it.
 */
export function createInstanceCallerResolver(options: {
  registry: FlowRegistry;
  host: InboundTransportHost;
  request: Request;
  hostResolver: PrincipalResolver;
  action: string;
  tenantId?: string;
}): InstanceCallerResolver {
  const { registry, host, request, hostResolver, action, tenantId } = options;
  const resolved = new Map<string | undefined, Promise<Principal | undefined>>();

  const resolveAt = async (address: string): Promise<Principal | undefined> => {
    try {
      const principal = await host.resolvePrincipal({
        source: "http",
        request,
        envelope: { flowKind: address, action, metadata: {}, input: undefined }
      });
      return tenantId === undefined ? principal : { ...principal, tenantId };
    } catch (error) {
      if (error instanceof PrincipalResolutionError) return undefined;
      throw error;
    }
  };

  return (flow) => {
    const identity = principalResolverIdentity(registry, flow.id, hostResolver);
    let caller = resolved.get(identity);
    if (caller === undefined) {
      caller = resolveAt(flow.id);
      resolved.set(identity, caller);
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
  registry: Pick<FlowRegistry, "get" | "list">,
  callerFor: InstanceCallerResolver,
  row: OwnedRecord & { userId: string; orgId?: string | null; tenantId?: string | null }
): Promise<boolean | undefined> {
  // FIX-2624: a write record is no conversation and no run a listing shows,
  // whoever asks; decided from the record's own fields (`isWriteRecord`).
  if (isWriteRecord(row)) return false;
  const owner = resolveRecordOwner(registry, row);
  if (!owner.ok || !flowAuthenticates(owner.flow)) return undefined;
  const caller = await callerFor(owner.flow);
  if (caller === undefined) return false;
  if (!principalOwns(row, caller)) return false;
  return !pinRejectsCaller(owner.flow.ownerPin, caller);
}

/** What {@link admitSession} judges a session against: who asks, in which tenant, and the rule for a row no own resolver owns. */
export type SessionAdmissionContext = {
  registry: Pick<FlowRegistry, "get" | "list">;
  callerFor: InstanceCallerResolver;
  tenantId: string | undefined;
  /** The owner rule for a row whose instance has no resolver of its own. Only asked of an attributed row. */
  hostRule: (session: SessionRecord) => boolean | Promise<boolean>;
};

// FIX-2725 D1; FIX-2942.
/**
 * The one admission of another session: the HTTP session list's per row, a
 * view's session reads', and a block's named reach (`named-session.ts`). Every
 * door that shows a caller a session it did not start asks this, so they
 * cannot drift apart.
 *
 * A row of another tenant is never admitted, nor a write session, which is no
 * conversation, nor a row stored before organizations were required
 * (`isOrgAttributed`). A row owned by an instance with a resolver of its own is
 * judged on that resolver's word ({@link ownResolverVerdict}); any other row by
 * the caller's `hostRule`.
 */
export async function admitSession(ctx: SessionAdmissionContext, session: SessionRecord): Promise<boolean> {
  if (!tenantMatches(session.tenantId, ctx.tenantId)) return false;
  if (isWriteSessionId(session.id)) return false;
  if (!isOrgAttributed(session)) return false;
  return (await ownResolverVerdict(ctx.registry, ctx.callerFor, session)) ?? ctx.hostRule(session);
}
