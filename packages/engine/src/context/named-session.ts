// FIX-2942; BP-031.
/**
 * A block's admission to another session it names: the routes' own admission
 * (`admitSession`), fed the run's resolved principal instead of HTTP
 * credentials.
 *
 * A runner's envelope carries no credentials, so the block side cannot ask a
 * flow's resolver the way the HTTP doors do. It answers that question with the
 * run itself: a target whose flow resolves its callers with a resolver of its
 * own admits only a block of that same flow whose principal that same
 * resolver produced. A principal a run inherited (a dispatch from another
 * flow) was never that resolver's verdict, so it is not admitted on it. Any other
 * target is judged by the owner compare the routes apply (`principalOwnsRequest`
 * with the organization required), then the target instance's pin.
 *
 * A run in a session a machine created owns nothing but that session: the
 * gateway a schedule fires as, and the system principal (`{ userId: "system" }`),
 * name a machine, not a person, so two schedules on one of them never reach
 * each other's sessions, and neither does a wake, task or internal run that
 * continues one. That is read from the caller's own session record
 * (`machine-principal.ts`), never from the run's metadata. A schedule that
 * names a person reaches as that person.
 *
 * Every refusal reads as a missing session: {@link admitNamedSession} answers
 * `undefined`, exactly as it does for an id nobody holds, so a caller cannot
 * learn which ids exist.
 */
import type { FlowRegistry } from "../registry/flow-registry";
import { admitSession, flowAuthenticates, type InstanceCallerResolver } from "../routes/instance-caller";
import { resolveSessionStorageKey } from "../stores/scope-keys";
import type { SessionRecord, SessionStore } from "../stores/types";
import { pinRejectsCaller } from "./instance-pin";
import { sessionOwnsNothing } from "./machine-principal";
import { resolveRecordOwner } from "./record-owner";
import { principalOwnsRequest } from "./request-principal";

/** The running block's caller, every field from the run itself (never a payload). */
export interface BlockCaller {
  readonly userId: string;
  readonly orgId: string;
  readonly tenantId?: string;
  /** The exact instance the block runs in. */
  readonly flowId: string;
  /**
   * The exact instance whose own resolver produced this principal, when one
   * did: set only on a run that entered through that instance's door. Absent
   * for an inherited principal (a dispatch, a schedule) or the host's resolver.
   */
  readonly resolvedByFlowId?: string;
  /**
   * The block's own session: the one session a caller that owns nothing still
   * holds, and the record that says whether it owns anything else.
   */
  readonly sessionId: string;
}

/**
 * The block side's {@link InstanceCallerResolver}: a flow with a resolver of
 * its own resolves the run's principal only for a block of that same
 * instance, on a principal that same resolver produced. Every other flow's
 * resolver refuses it.
 */
function createBlockCallerResolver(caller: BlockCaller): InstanceCallerResolver {
  return async (flow) =>
    flowAuthenticates(flow) && flow.id === caller.flowId && flow.id === caller.resolvedByFlowId
      ? { userId: caller.userId, orgId: caller.orgId }
      : undefined;
}

/**
 * The host rule for a target no own resolver owns: the routes' owner compare
 * on the run's principal, the organization required, and the target
 * instance's pin.
 */
function blockHostRule(registry: Pick<FlowRegistry, "get" | "list">, caller: BlockCaller) {
  return (session: SessionRecord): boolean => {
    // What makes the organization required: `principalOwnsRequest` alone
    // treats a session with no org as owned.
    if (session.orgId !== caller.orgId) return false;
    if (!principalOwnsRequest(session, caller)) return false;
    const owner = resolveRecordOwner(registry, session);
    return owner.ok && !pinRejectsCaller(owner.flow.ownerPin, caller);
  };
}

/**
 * The session `sessionId` names, when `caller` may reach it; otherwise
 * `undefined`, the same answer an unknown id gets. The block's own session is
 * always its own. The one function every named reach goes through.
 */
export async function admitNamedSession(
  inputs: {
    readonly sessions: Pick<SessionStore, "get">;
    readonly registry: Pick<FlowRegistry, "get" | "list">;
    readonly caller: BlockCaller;
  },
  sessionId: string
): Promise<SessionRecord | undefined> {
  if (typeof sessionId !== "string" || sessionId.length === 0) return undefined;
  const { caller, registry } = inputs;
  const record = await inputs.sessions.get(resolveSessionStorageKey(sessionId, caller.tenantId));
  if (record === undefined) return undefined;
  // The run's own session, unchecked: `caller.sessionId` comes from the run,
  // never a payload, so it names the session this run already holds.
  if (sessionId === caller.sessionId) return record;
  // A machine's session owns nothing else, whichever run in it asks.
  const own = await inputs.sessions.get(resolveSessionStorageKey(caller.sessionId, caller.tenantId));
  if (sessionOwnsNothing(own)) return undefined;
  const admitted = await admitSession(
    { registry, callerFor: createBlockCallerResolver(caller), tenantId: caller.tenantId, hostRule: blockHostRule(registry, caller) },
    record
  );
  return admitted ? record : undefined;
}
