/**
 * Public surface for the inbound transport adapter contract.
 *
 * Re-exports the contract types, errors, the Phase 1 stub principal
 * resolver, and the host/HTTP adapter factories. See
 * `docs/architecture/inbound-transports.md` for the full reference.
 */
export type {
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

export type {
  DispatchEnvelope,
  FlowDispatchHandle,
  FlowDispatcher,
  StreamBridge,
  StreamEvent,
  StreamPublisher,
  StreamSubscriber
} from "./dispatcher";

export type { AuthenticationConfig, ResolvePrincipalFn } from "@flow-state-dev/core/types";

export {
  OrgRequiredError,
  PrincipalResolutionError,
  TransportRouteCollisionError
} from "./errors";

export { defaultBodyUserIdPrincipalResolver } from "./auth/defaultBodyUserIdPrincipalResolver";

export {
  createBearerSecretPrincipalResolver,
  type CreateBearerSecretPrincipalResolverOptions
} from "./auth/createBearerSecretPrincipalResolver";

export {
  createHmacVerifier,
  type CreateHmacVerifierOptions,
  type HmacAlgorithm,
  type HmacEncoding,
  type HmacSignatureParser,
  type HmacVerifier,
  type ParsedHmacSignature
} from "./auth/createHmacVerifier";

export {
  createHs256JwtVerifier,
  extractBearerToken,
  type CreateHs256JwtVerifierOptions,
  type Hs256JwtVerifier,
  type JwtPayload
} from "./auth/createBearerTokenVerifier";

export {
  createInboundTransportHost,
  type CreateInboundTransportHostOptions
} from "./host/createInboundTransportHost";

export {
  createInProcessDispatcher,
  type InProcessDispatcher,
  type InProcessDispatchContext,
  type InProcessDispatcherDeps
} from "./host/in-process-dispatcher";

export {
  createHttpTransportAdapter,
  type CreateHttpTransportAdapterOptions,
  HTTP_TRANSPORT_SOURCE
} from "./http/createHttpTransportAdapter";
