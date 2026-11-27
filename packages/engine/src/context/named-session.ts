// FIX-2942; BP-031.
/**
 * A block's admission to another session it names: the routes' own admission
 * (`admitSession`), fed the run's principal instead of HTTP credentials.
 *
 * A runner's envelope carries no credentials, so the block side cannot ask a
 * flow's resolver the way the HTTP doors do. It answers that question with
 * the principal's `resolvedBy`, set at the door: a target whose flow resolves
 * its callers with a resolver of its own admits the run when that resolver's
 * identity (`principalResolverIdentity`) is the one that produced the
 * principal. A principal another resolver produced, or none did (a schedule's
 * named person), reads such a target as missing. Any other target is judged
 * by the one owner comparison (`principalOwns`), then the instance's pin.
 *
 * A machine owns nothing: a run whose principal is a machine's, or whose own
 * session a machine created (`resolveSessionKind`), reaches no session but
 * its own.
 *
 * Every refusal reads as a missing session: {@link admitNamedSession} answers
 * `undefined`, exactly as it does for an id nobody holds, so a caller cannot
 * learn which ids exist.
 */
import type { DeliveryOrigin } from "../execution/delivery-origin";
import type { FlowRegistry } from "../registry/flow-registry";
import { admitSession, flowAuthenticates, type InstanceCallerResolver } from "../routes/instance-caller";
import { principalResolverIdentity } from "../transports/auth/pickPrincipalResolver";
import type { PrincipalResolver } from "../transports/types";
import { resolveSessionStorageKey } from "../stores/scope-keys";
import type { SessionRecord, StoreRegistry } from "../stores/types";
import { pinRejectsCaller } from "./instance-pin";
import { principalOwns, resolvedByMatches, type Principal } from "./principal";
import { resolveRecordOwner } from "./record-owner";
import { resolveSessionKind } from "./session-kind";

/** What a named reach is judged with: every field from the run itself, never a payload. */
export interface NamedSessionAdmission {
  readonly stores: Pick<StoreRegistry, "session" | "request">;
  readonly registry: Pick<FlowRegistry, "get" | "list">;
  /** The host's resolver, which names `host` in a resolver identity. Absent, an own resolver can't be named, and matches nothing. */
  readonly hostResolver?: PrincipalResolver;
  /** The run's principal, as its door set it. */
  readonly principal: Principal;
  /** The run's own session: the one session a machine still holds. */
  readonly sessionId: string;
}

/**
 * The block side's {@link InstanceCallerResolver}: a flow with a resolver of
 * its own resolves the run's principal only when that resolver produced it.
 */
function blockCallerFor(inputs: NamedSessionAdmission): InstanceCallerResolver {
  return async (flow) =>
    flowAuthenticates(flow) &&
    resolvedByMatches(inputs.principal.resolvedBy, principalResolverIdentity(inputs.registry, flow.id, inputs.hostResolver))
      ? inputs.principal
      : undefined;
}

/** The host rule for a target no own resolver owns: the one owner comparison, then the instance's pin. */
function blockHostRule(inputs: NamedSessionAdmission) {
  return (session: SessionRecord): boolean => {
    if (!principalOwns(session, inputs.principal)) return false;
    const owner = resolveRecordOwner(inputs.registry, session);
    return owner.ok && !pinRejectsCaller(owner.flow.ownerPin, inputs.principal);
  };
}

/**
 * The session `sessionId` names, when the run may reach it; otherwise
 * `undefined`, the same answer an unknown id gets. The run's own session is
 * always its own. The one function every named reach goes through.
 */
export async function admitNamedSession(
  inputs: NamedSessionAdmission,
  sessionId: string
): Promise<SessionRecord | undefined> {
  if (typeof sessionId !== "string" || sessionId.length === 0) return undefined;
  const { principal, stores } = inputs;
  const record = await stores.session.get(resolveSessionStorageKey(sessionId, principal.tenantId));
  if (record === undefined) return undefined;
  // The run's own session, unchecked: `inputs.sessionId` comes from the run,
  // never a payload, so it names the session this run already holds.
  if (sessionId === inputs.sessionId) return record;
  if (principal.kind !== "person") return undefined;
  const own = await stores.session.get(resolveSessionStorageKey(inputs.sessionId, principal.tenantId));
  if (own === undefined || (await resolveSessionKind(stores, own)) !== "person") return undefined;
  const admitted = await admitSession(
    { registry: inputs.registry, callerFor: blockCallerFor(inputs), tenantId: principal.tenantId, hostRule: blockHostRule(inputs) },
    record
  );
  return admitted ? record : undefined;
}

/**
 * What every verb on a named session answers when {@link admitNamedSession}
 * refuses it, and when no one holds the id: one message, naming neither the
 * id nor why, so the two answers are the same bytes.
 */
export class SessionNotFoundError extends Error {
  constructor() {
    super("Session not found");
    this.name = "SessionNotFoundError";
  }
}

/**
 * The refusal a turn an outside delivery started meets when it names
 * another session. It names the rule, never the target.
 */
export class UntrustedReachError extends Error {
  constructor() {
    super("A turn a webhook delivery started reaches no session but its own.");
    this.name = "UntrustedReachError";
  }
}

/**
 * The fence on a named reach, decided here and nowhere else: a turn a
 * webhook delivery started, or a run that delivery fired, reaches no session
 * but its own, on every verb, before anything is looked up. Keyed on the
 * run's delivery origin (`readDeliveryOrigin`), which may only restrict.
 *
 * A board's settle on its claimed task's session and a subscription delivery
 * take their session from a server-held record, not from a name, and don't
 * come through here.
 *
 * @throws {UntrustedReachError} When the run is fenced and `sessionId` isn't its own.
 */
export function fenceNamedReach(
  run: { readonly origin: DeliveryOrigin | undefined; readonly sessionId: string },
  sessionId: string
): void {
  if (run.origin !== undefined && sessionId !== run.sessionId) throw new UntrustedReachError();
}
