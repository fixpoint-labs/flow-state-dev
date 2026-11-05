/**
 * The host-side start of an internal entry as a named principal: the one
 * dispatch skeleton a wake's fire (`fireWakeThrough`), an owner run
 * (`fireOwnerRunThrough`) and a service's routing (`routeServiceEvent`) share.
 *
 * Internal source, no response emitter (nobody is attached), and the
 * principal's org and tenant on the envelope. The caller decides who the
 * principal is, from a trusted record, never from a request's input (BP-031).
 */
import { INTERNAL_SOURCE } from "../execution/transport-sources";
import type { DispatchHandle, InboundTransportHost } from "../transports/types";

/** Who an internal run is, as its caller resolved it. */
export interface InternalPrincipal {
  readonly userId: string;
  readonly orgId: string;
  readonly tenantId?: string;
}

/** What to start: the flow's internal entry, its input, and the session it runs in. */
export interface InternalDispatch {
  readonly flowKind: string;
  readonly entry: string;
  readonly input: unknown;
  readonly as: InternalPrincipal;
  /** The session to run in: absent starts a new one. */
  readonly sessionId?: string;
  readonly metadata: Record<string, unknown>;
  readonly signal?: AbortSignal;
}

/** Start `run` through `host` as `run.as`, fire-and-forget. */
export function dispatchInternalAs(host: Pick<InboundTransportHost, "dispatch">, run: InternalDispatch): DispatchHandle {
  const { userId, orgId, tenantId } = run.as;
  return host.dispatch({
    source: INTERNAL_SOURCE,
    flowKind: run.flowKind,
    action: run.entry,
    input: run.input,
    ...(run.sessionId !== undefined ? { sessionId: run.sessionId } : {}),
    principal: { userId, orgId },
    orgId,
    ...(tenantId !== undefined ? { tenantId } : {}),
    metadata: run.metadata,
    responseEmitter: null,
    ...(run.signal !== undefined ? { signal: run.signal } : {})
  });
}
