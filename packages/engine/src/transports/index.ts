/**
 * Public surface for the inbound transport adapter contract.
 *
 * Re-exports the contract types, errors, the Phase 1 stub principal
 * resolver, and the host/HTTP adapter factories. See
 * `docs/architecture/inbound-transports.md` for the full reference.
 */
export type {
  InboundDispatchHandle,
  InboundRequestEnvelope,
  InboundTransportAdapter,
  InboundTransportHost,
  PrincipalResolver,
  TransportBindings,
  TransportRoute
} from "./types";

export type {
  DispatchEnvelope,
  RunnerHandle,
  FlowRunner,
  LeaseTurn,
  StreamBridge,
  StreamBridgeEvent,
  StreamPublisher,
  StreamSubscriber
} from "./runner";

export {
  createInMemoryLeaseBackend,
  holdLeasePlace,
  planDeferWait,
  planQueueWait,
  type ConcurrencyLeaseBackend,
  type LeasePlaceHold,
  type LeasePlace,
  type LeaseTakeInput,
  type LeaseTakeResult,
  type DeferWaitStep,
  type QueueWaitStep
} from "./concurrency/lease-backend";

export {
  ConcurrencyLeaseLostError,
  ConcurrencyQueueTimeoutError,
  ConcurrencyRejectedError,
  OrgRequiredError,
  PrincipalResolutionError
} from "./errors";

export {
  defaultBodyUserIdPrincipalResolver,
  isDefaultBodyUserIdPrincipalResolver,
} from "./auth/defaultBodyUserIdPrincipalResolver";

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
  resolveInProcessPrincipal,
  type CreateInboundTransportHostOptions,
  type InProcessPrincipal,
  type InProcessPrincipalQuestion
} from "./host/createInboundTransportHost";

export {
  createHttpTransportAdapter,
  type CreateHttpTransportAdapterOptions,
  HTTP_TRANSPORT_SOURCE
} from "./http/createHttpTransportAdapter";

export {
  createWebhookVerifier,
  githubWebhookVerifier,
  slackWebhookVerifier,
  stripeWebhookVerifier,
  type CreateWebhookVerifierOptions,
  type SlackWebhookVerifierOptions,
  type WebhookVerifier
} from "./auth/createWebhookVerifier";

export {
  createWebhookTransportAdapter,
  type CreateWebhookTransportAdapterOptions,
  type WebhookProviderDefinition
} from "./webhook/createWebhookTransportAdapter";
