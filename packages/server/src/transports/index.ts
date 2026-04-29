/**
 * Public surface for the inbound transport adapter contract.
 *
 * Re-exports the contract types, errors, the Phase 1 stub principal
 * resolver, and the host/HTTP adapter factories. See
 * `docs/architecture/inbound-transports.md` for the full reference.
 */
export type {
  Dispatcher,
  DispatchHandle,
  InboundRequestEnvelope,
  InboundSource,
  InboundTransportAdapter,
  InboundTransportHost,
  PrincipalResolutionContext,
  PrincipalResolver,
  ResolvedPrincipal,
  TransportBindings,
  TransportRoute
} from "./types";

export {
  PrincipalResolutionError,
  TransportRouteCollisionError
} from "./errors";

export { defaultBodyUserIdPrincipalResolver } from "./auth/defaultBodyUserIdPrincipalResolver";

export {
  createInboundTransportHost,
  type CreateInboundTransportHostOptions
} from "./host/createInboundTransportHost";

export {
  createHttpTransportAdapter,
  type CreateHttpTransportAdapterOptions,
  HTTP_TRANSPORT_SOURCE
} from "./http/createHttpTransportAdapter";
