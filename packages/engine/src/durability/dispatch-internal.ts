// BP-031.
/**
 * The host-side start of an internal entry as a named principal: the one
 * dispatch skeleton a wake's fire (`fireWakeThrough`), an owner run
 * (`fireOwnerRunThrough`) and a service's routing (`routeServiceEvent`) share.
 *
 * Internal source, no response emitter (nobody is attached), and the
 * principal's org and tenant on the envelope. The caller decides who the
 * principal is, from a trusted record, never from a request's input.
 */
import { INTERNAL_SOURCE } from "../execution/transport-sources";
import type { InboundDispatchHandle, InboundTransportHost } from "../transports/types";
import type { Principal } from "../context/principal";

/** What to start: the flow's internal entry, its input, and the session it runs in. */
export interface InternalDispatch {
  readonly flowKind: string;
  readonly entry: string;
  readonly input: unknown;
  /** Who the run is: the one principal, read from the trusted record the run starts from. */
  readonly as: Principal;
  /** The session to run in. Required: every run names its session. */
  readonly sessionId: string;
  readonly metadata: Record<string, unknown>;
  readonly signal?: AbortSignal;
}

/** Start `run` through `host` as `run.as`, fire-and-forget. */
export function dispatchInternalAs(host: Pick<InboundTransportHost, "dispatch">, run: InternalDispatch): InboundDispatchHandle {
  const { userId, orgId, tenantId, kind, resolvedBy } = run.as;
  return host.dispatch({
    source: INTERNAL_SOURCE,
    flowKind: run.flowKind,
    action: run.entry,
    input: run.input,
    sessionId: run.sessionId,
    principal: { userId, orgId, kind, ...(resolvedBy !== undefined ? { resolvedBy } : {}) },
    orgId,
    ...(tenantId !== undefined ? { tenantId } : {}),
    metadata: run.metadata,
    responseEmitter: null,
    ...(run.signal !== undefined ? { signal: run.signal } : {})
  });
}
